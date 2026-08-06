import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isAddress, parseUnits } from 'ethers';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import { useAssetDirectory, useReadSdk } from '../../workspaces/core/onchainLists';
import { createAmountDecimalsResolver, createWriteSdk } from '../../workspaces/core/createSdk';
import { CallTag } from './chrome';

/**
 * ReservePSM wrap / unwrap form (blueprint "包装或解包装").
 *
 * TOKEN_CUSTODY (mode 0): wrap locks the underlying 1:1 and mints wrapped
 * tokens; unwrap releases 1:1. DOCUMENT_PROOF (mode 1): minting needs a PSM
 * Authorized Signer envelope, so wrap routes to the signer workspace and only
 * unwrap is offered here.
 */
export default function WrapUnwrapForm({ compact = false }) {
  const { t } = useI18n();
  const { session, address } = useWallet();
  const { deployment, demo } = useReadSdk();
  const { assets } = useAssetDirectory();
  const wrapped = assets.filter(a => a.psmConfig && a.psmConfig.mode !== undefined);

  const [assetId, setAssetId] = useState('');
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [direction, setDirection] = useState('wrap');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (config && Number(config.mode) === 1) setDirection('unwrap');
  }, [config]);

  const numericId = /^\d+$/.test(assetId.trim());
  const wrapBlocked = config && Number(config.mode) === 1;
  const decimals = config ? (config.asset?.decimals ?? 18) : 18;

  async function loadConfig(idOverride) {
    const id = idOverride !== undefined ? String(idOverride).trim() : assetId.trim();
    setConfig(null);
    setConfigError(null);
    if (!/^\d+$/.test(id)) {
      setConfigError(t.assets.wrapWrapInvalidAssetId);
      return;
    }
    if (!deployment || !session?.provider) {
      setConfigError(t.assets.wrapWrapNoDeployment);
      return;
    }
    setLoadingConfig(true);
    try {
      if (demo) {
        const matched = wrapped.find(a => a.id === Number(id));
        if (!matched || !matched.psmConfig) throw new Error(t.assets.wrapWrapNoDeployment);
        setConfig({
          mode: Number(matched.psmConfig.mode),
          underlyingToken: matched.psmConfig.underlyingToken,
          wrappedToken: matched.psmConfig.wrappedToken,
          asset: matched,
        });
        return;
      }
      const sdk = await createWriteSdk(deployment, session.provider);
      const raw = await sdk.reservePSM.assetConfig(BigInt(id));
      const matched = wrapped.find(a => a.id === Number(id));
      setConfig({
        mode: Number(raw?.mode ?? raw?.[0]),
        underlyingToken: raw?.underlyingToken ?? raw?.[1],
        wrappedToken: raw?.wrappedToken ?? raw?.[2],
        asset: matched ?? null,
      });
    } catch (e) {
      setConfigError(e?.shortMessage || e?.message || String(e));
    } finally {
      setLoadingConfig(false);
    }
  }

  function pickAsset(id) {
    setAssetId(String(id));
    loadConfig(String(id));
  }

  async function submit() {
    setError(null);
    setResult(null);
    if (!numericId) { setError(t.assets.wrapWrapInvalidAssetId); return; }
    if (!amount.trim() || Number.isNaN(Number(amount)) || Number(amount) < 0) { setError(t.assets.wrapWrapAmountRequired); return; }
    const toAddress = to.trim() || address;
    if (!isAddress(toAddress)) { setError(t.assets.wrapWrapInvalidTo); return; }
    setSubmitting(true);
    try {
      const sdk = await createWriteSdk(deployment, session.provider);
      const resolveDecimals = createAmountDecimalsResolver(sdk);
      const actionId = direction === 'wrap' ? 'wrapper.wrap' : 'wrapper.unwrap';
      const resolved = await resolveDecimals({ actionId, rawInput: { assetId: BigInt(assetId.trim()) } });
      const amountWei = parseUnits(amount.trim(), Number(resolved));
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
    <form className="bp-form-grid" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="bp-field bp-field--full">
        <label htmlFor="wrap-asset">{t.bp.wrap.assetLabel}</label>
        <div className="bp-row">
          <select
            id="wrap-asset"
            className="bp-select"
            value={wrapped.some(a => String(a.id) === assetId) ? assetId : ''}
            onChange={e => e.target.value && pickAsset(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">{t.bp.wrap.selectHint}</option>
            {wrapped.map(a => (
              <option key={a.id} value={a.id}>{a.name}（{a.symbol} · {modeLabel(Number(a.mode))}）</option>
            ))}
          </select>
          <input className="bp-input bp-mono" style={{ flex: 1 }} value={assetId} placeholder={t.assets.wrapWrapAssetIdPlaceholder} onChange={e => { setAssetId(e.target.value); setConfig(null); setConfigError(null); }} />
          <button type="button" className="btn btn--ghost" onClick={() => loadConfig()} disabled={loadingConfig}>
            {loadingConfig ? t.common.loading : t.assets.wrapWrapLoadConfig}
          </button>
        </div>
        {configError && <p className="actionform__error">{configError}</p>}
      </div>

      {config && (
        <div className="bp-field bp-field--full">
          <div className="chainresult">
            <div className="chainresult__row"><span>{t.assets.wrapWrapMode}</span><strong>{modeLabel(Number(config.mode))}</strong></div>
            <div className="chainresult__row"><span>{t.assets.wrapWrapUnderlying}</span><strong className="chainresult__mono">{config.underlyingToken}</strong></div>
            <div className="chainresult__row"><span>{t.assets.wrapWrapWrapped}</span><strong className="chainresult__mono">{config.wrappedToken}</strong></div>
          </div>
        </div>
      )}

      <div className="bp-field">
        <label>{t.assets.wrapWrapDirection}</label>
        <div className="bp-row">
          <label className="actionform__radio">
            <input type="radio" name="wrap-direction" checked={direction === 'wrap' && !wrapBlocked} disabled={wrapBlocked} onChange={() => setDirection('wrap')} />
            {t.assets.wrapWrapIn}
          </label>
          <label className="actionform__radio">
            <input type="radio" name="wrap-direction" checked={direction === 'unwrap'} onChange={() => setDirection('unwrap')} />
            {t.assets.wrapWrapOut}
          </label>
        </div>
        {wrapBlocked && <p className="actionform__note">{t.bp.wrap.signatureRequired}</p>}
      </div>

      <div className="bp-field">
        <label>{t.assets.wrapWrapAmount} *</label>
        <input className="bp-input bp-mono" value={amount} inputMode="decimal" placeholder="如 100" onChange={e => setAmount(e.target.value)} required />
      </div>
      <div className="bp-field">
        <label>{t.assets.wrapWrapTo} *</label>
        <input className="bp-input bp-mono" value={to} placeholder={address || '0x…'} onChange={e => setTo(e.target.value)} required />
      </div>

      {wrapBlocked && (
        <div className="bp-field bp-field--full">
          <div className="bp-alert">
            {t.bp.wrap.proofModeNote}
            <div className="bp-row" style={{ marginTop: 10 }}>
              <Link className="btn btn--ghost" to={`/assets/workspace/${assetId}/psm-authorized-signer`}>{t.bp.wrap.goSign}</Link>
            </div>
          </div>
        </div>
      )}

      <div className="bp-field bp-field--full">
        {!deployment ? (
          <p className="actionform__note">{t.assets.wrapWrapNoDeployment}</p>
        ) : session?.provider ? (
          <button type="submit" className="btn btn--gold" disabled={submitting || (wrapBlocked && direction === 'wrap')}>
            {submitting ? t.common.loading : t.bp.wrap.confirm}
          </button>
        ) : (
          <p className="actionform__note">{t.assets.wrapWrapWalletNeededBody}</p>
        )}
      </div>

      {error && <p className="actionform__error" style={{ gridColumn: '1 / -1' }}>{error}</p>}

      {result && (
        <div className="chainresult" style={{ gridColumn: '1 / -1' }}>
          <div className="chainresult__row">
            <span>{t.assets.wrapWrapTxSent}</span>
            <a className="chainresult__mono" href={`${deployment.explorerUrl}/tx/${result.txHash}`} target="_blank" rel="noreferrer">{result.txHash}</a>
          </div>
        </div>
      )}

      {compact && <div className="bp-field bp-field--full"><p className="bp-field__hint"><CallTag>ReservePSM.wrap / unwrap / mintWithAuthorization</CallTag></p></div>}
    </form>
  );
}
