import { useState } from 'react';
import { isAddress, parseUnits } from 'ethers';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { getDeployment } from '../../workspaces/config/deployments';
import { createAmountDecimalsResolver, createWriteSdk } from '../../workspaces/core/createSdk';

/**
 * Wrap / unwrap public operation page.
 *
 * No operational role is required — the ReservePSM wrap/unwrap entry points
 * are permissionless. Flow: pick or enter an asset ID → load the PSM config →
 * choose direction and amount → sign with the real wallet.
 *
 * TOKEN_CUSTODY (mode 0): wrap locks the underlying 1:1 and mints wrapped
 * tokens; unwrap releases the underlying 1:1. DOCUMENT_PROOF (mode 1): minting
 * needs an authorized-signer envelope (see the PSM signing workspace), so only
 * unwrap is offered here; wrap routes to the signer workspace instead.
 */
function WrapUnwrapInner() {
  const { t } = useI18n();
  const { wrappedAssets } = useAccess();
  const { address, chainId, session } = useWallet();

  const deployment = chainId != null ? getDeployment(chainId) : null;
  const canWrite = Boolean(session?.provider);

  const [assetId, setAssetId] = useState('');
  const [picked, setPicked] = useState(null);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [direction, setDirection] = useState('wrap');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const numericId = /^\d+$/.test(assetId.trim());
  const wrapBlocked = config && config.mode === 1;

  async function loadConfig() {
    setConfig(null);
    setConfigError(null);
    if (!numericId) {
      setConfigError(t.assets.wrapWrapInvalidAssetId);
      return;
    }
    if (!canWrite || !deployment) {
      setConfigError(t.assets.wrapWrapNoDeployment);
      return;
    }
    setLoadingConfig(true);
    try {
      const sdk = await createWriteSdk(deployment, session.provider);
      const raw = await sdk.reservePSM.assetConfig(BigInt(assetId.trim()));
      const cfg = {
        mode: Number(raw?.mode ?? raw?.[0]),
        underlyingToken: raw?.underlyingToken ?? raw?.[1],
        wrappedToken: raw?.wrappedToken ?? raw?.[2],
      };
      setConfig(cfg);
      if (cfg.mode === 1) setDirection('unwrap');
    } catch (e) {
      setConfigError(e?.shortMessage || e?.message || String(e));
    } finally {
      setLoadingConfig(false);
    }
  }

  async function submit() {
    setError(null);
    setResult(null);
    if (!numericId) {
      setError(t.assets.wrapWrapInvalidAssetId);
      return;
    }
    if (!amount.trim() || Number.isNaN(Number(amount)) || Number(amount) < 0) {
      setError(t.assets.wrapWrapAmountRequired);
      return;
    }
    const toAddress = to.trim() || address;
    if (!isAddress(toAddress)) {
      setError(t.assets.wrapWrapInvalidTo);
      return;
    }
    setSubmitting(true);
    try {
      const sdk = await createWriteSdk(deployment, session.provider);
      const resolveDecimals = createAmountDecimalsResolver(sdk);
      const actionId = direction === 'wrap' ? 'wrapper.wrap' : 'wrapper.unwrap';
      const decimals = await resolveDecimals({ actionId, rawInput: { assetId: BigInt(assetId.trim()) } });
      const amountWei = parseUnits(amount.trim(), decimals);
      const id = BigInt(assetId.trim());
      const tx = direction === 'wrap'
        ? await sdk.reservePSM.wrap(id, amountWei, toAddress)
        : await sdk.reservePSM.unwrap(id, amountWei, toAddress);
      await tx.wait();
      setResult({ txHash: tx.hash });
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function modeLabel(mode) {
    if (mode === 0) return t.assets.wrapWrapModeCustody;
    if (mode === 1) return t.assets.wrapWrapModeDocument;
    return t.assets.wrapWrapModeUnknown;
  }

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.wrapEyebrow}</div>
        <h1 className="phead__title">{t.assets.wrapOrUnwrap}</h1>
        <p className="section__lede">{t.assets.wrapWrapLede}</p>
      </div>

      {!canWrite && (
        <div className="walletnote">
          <strong>{t.assets.wrapWrapWalletNeeded}</strong>
          <p>{t.assets.wrapWrapWalletNeededBody}</p>
        </div>
      )}

      <div className="shellcard">
        <div className="actionform">
          <div className="actionform__field">
            <label className="actionform__label">{t.assets.wrapWrapSelect}</label>
            <div className="objlist">
              {wrappedAssets.length === 0 && (
                <p className="shellcard__note">{t.assets.hubEmptyObjects}</p>
              )}
              {wrappedAssets.map(asset => (
                <button
                  key={asset.id}
                  type="button"
                  className={`objlist__item${picked?.id === asset.id ? ' objlist__item--active' : ''}`}
                  onClick={() => { setPicked(asset); setAssetId(asset.id); setConfig(null); setConfigError(null); }}
                >
                  <span className="objlist__name">{asset.name}</span>
                  <span className="objlist__meta">{asset.symbol || ''}</span>
                </button>
              ))}
            </div>
            <p className="actionform__hint">{t.assets.wrapWrapOrManual}</p>
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.wrapWrapAssetId}</label>
            <input
              className="actionform__input"
              value={assetId}
              placeholder={t.assets.wrapWrapAssetIdPlaceholder}
              onChange={e => { setAssetId(e.target.value); setConfig(null); setConfigError(null); }}
            />
            <div className="actionform__actions">
              <button type="button" className="btn btn--ghost" onClick={loadConfig} disabled={loadingConfig}>
                {loadingConfig ? t.common.loading : t.assets.wrapWrapLoadConfig}
              </button>
            </div>
            {configError && <p className="actionform__error">{configError}</p>}
          </div>

          {config && (
            <div className="actionform__field">
              <div className="chainresult">
                <div className="chainresult__row">
                  <span>{t.assets.wrapWrapMode}</span>
                  <strong>{modeLabel(config.mode)}</strong>
                </div>
                <div className="chainresult__row">
                  <span>{t.assets.wrapWrapUnderlying}</span>
                  <strong className="chainresult__mono">{config.underlyingToken}</strong>
                </div>
                <div className="chainresult__row">
                  <span>{t.assets.wrapWrapWrapped}</span>
                  <strong className="chainresult__mono">{config.wrappedToken}</strong>
                </div>
              </div>
              {wrapBlocked && (
                <p className="actionform__note">{t.assets.wrapWrapSignerRequired}</p>
              )}
            </div>
          )}

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.wrapWrapDirection}</label>
            <div className="actionform__row">
              <label className="actionform__radio">
                <input
                  type="radio"
                  name="wrap-direction"
                  checked={direction === 'wrap' && !wrapBlocked}
                  disabled={wrapBlocked}
                  onChange={() => setDirection('wrap')}
                />
                {t.assets.wrapWrapIn}
              </label>
              <label className="actionform__radio">
                <input
                  type="radio"
                  name="wrap-direction"
                  checked={direction === 'unwrap'}
                  onChange={() => setDirection('unwrap')}
                />
                {t.assets.wrapWrapOut}
              </label>
            </div>
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.wrapWrapAmount}</label>
            <input
              className="actionform__input"
              value={amount}
              inputMode="decimal"
              placeholder="0.0"
              onChange={e => setAmount(e.target.value)}
            />
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.wrapWrapTo}</label>
            <input
              className="actionform__input"
              value={to}
              placeholder={address || '0x…'}
              onChange={e => setTo(e.target.value)}
            />
          </div>

          {!deployment ? (
            <p className="actionform__note">{t.assets.wrapWrapNoDeployment}</p>
          ) : canWrite ? (
            <div className="actionform__actions">
              <button
                type="button"
                className="btn btn--gold"
                onClick={submit}
                disabled={submitting || (wrapBlocked && direction === 'wrap')}
              >
                {submitting ? t.assets.wrapWrapSubmit : t.assets.wrapWrapSubmit}
              </button>
            </div>
          ) : (
            <p className="actionform__note">{t.assets.wrapWrapWalletNeededBody}</p>
          )}

          {error && <p className="actionform__error">{error}</p>}

          {result && (
            <div className="chainresult">
              <div className="chainresult__row">
                <span>{t.assets.wrapWrapTxSent}</span>
                <a
                  className="chainresult__mono"
                  href={`${deployment.explorerUrl}/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.txHash}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WrapUnwrapAssets() {
  return (
    <ManagementEntry>
      <WrapUnwrapInner />
    </ManagementEntry>
  );
}
