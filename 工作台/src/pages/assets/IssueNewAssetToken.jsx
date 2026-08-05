import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keccak256, toUtf8Bytes } from 'ethers';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ROUTES } from '../../config/routes';
import { getDeployment } from '../../workspaces/config/deployments';
import { createWriteSdk } from '../../workspaces/core/createSdk';

/**
 * Issue a new asset token — real AssetRegistry.registerAsset form.
 *
 * Registration is permissionless: any wallet can call it, and the caller
 * becomes the asset Owner in the same transaction (a dedicated RWAToken is
 * deployed per asset). Minting itself needs ISSUER_ROLE + Token Agent
 * approval, which is why the success panel routes to the manage page.
 */
function IssueNewInner() {
  const { t } = useI18n();
  const { chainId, session } = useWallet();

  const deployment = chainId != null ? getDeployment(chainId) : null;
  const canWrite = Boolean(session?.provider);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [metadataHash, setMetadataHash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { txHash, assetId, token }
  const [error, setError] = useState(null);

  function generateHash() {
    const seed = `${name.trim() || 'asset'}.${symbol.trim() || 'token'}.${Date.now()}`;
    setMetadataHash(keccak256(toUtf8Bytes(seed)));
  }

  async function submit() {
    setError(null);
    setResult(null);
    if (!name.trim() || !symbol.trim() || decimals === '') {
      setError(t.assets.issueNewMissing);
      return;
    }
    const dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 18) {
      setError(t.assets.issueNewInvalidDecimals);
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(metadataHash.trim())) {
      setError(t.assets.issueNewInvalidHash);
      return;
    }
    setSubmitting(true);
    try {
      const sdk = await createWriteSdk(deployment, session.provider);
      const tx = await sdk.assetRegistry.registerAsset(
        metadataHash.trim(),
        name.trim(),
        symbol.trim(),
        dec,
      );
      const receipt = await tx.wait();

      let assetId = null;
      let token = null;
      for (const log of receipt.logs) {
        try {
          const parsed = sdk.assetRegistry.interface.parseLog(log);
          if (parsed?.name === 'AssetRegistered') {
            assetId = parsed.args.assetId.toString();
            token = parsed.args.token;
          }
        } catch { /* not a log this interface recognizes */ }
      }
      setResult({ txHash: receipt.hash, assetId, token });
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.issueEyebrow}</div>
        <h1 className="phead__title">{t.assets.issueNew}</h1>
        <p className="section__lede">{t.assets.issueNewPageLede}</p>
      </div>

      {!canWrite && (
        <div className="walletnote">
          <strong>{t.assets.issueNewWalletNeeded}</strong>
          <p>{t.assets.issueNewWalletNeededBody}</p>
        </div>
      )}

      <div className="shellcard">
        <div className="actionform">
          <div className="actionform__field">
            <label className="actionform__label">{t.assets.issueNewFieldName}</label>
            <input
              className="actionform__input"
              value={name}
              placeholder="RWA USDT Series"
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.issueNewFieldSymbol}</label>
            <input
              className="actionform__input"
              value={symbol}
              placeholder="htUSDT"
              onChange={e => setSymbol(e.target.value)}
            />
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.issueNewFieldDecimals}</label>
            <input
              className="actionform__input"
              value={decimals}
              inputMode="numeric"
              onChange={e => setDecimals(e.target.value)}
            />
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.assets.issueNewFieldMetadataHash}</label>
            <div className="actionform__row">
              <input
                className="actionform__input"
                value={metadataHash}
                placeholder="0x…"
                spellCheck={false}
                onChange={e => setMetadataHash(e.target.value)}
              />
              <button type="button" className="btn btn--ghost" onClick={generateHash}>
                {t.assets.issueNewGenerateHash}
              </button>
            </div>
            <p className="actionform__hint">{t.assets.issueNewMetaNote}</p>
          </div>

          {!deployment ? (
            <p className="actionform__note">{t.assets.issueNewNoDeployment}</p>
          ) : canWrite ? (
            <div className="actionform__actions">
              <button type="button" className="btn btn--gold" onClick={submit} disabled={submitting}>
                {submitting ? t.assets.issueNewSubmitting : t.assets.issueNewSubmit}
              </button>
            </div>
          ) : (
            <p className="actionform__note">{t.assets.issueNewWalletNeededBody}</p>
          )}

          {error && <p className="actionform__error">{error}</p>}

          {result && (
            <div className="chainresult">
              <div className="chainresult__title">{t.assets.issueNewSuccessTitle}</div>
              {result.assetId && (
                <div className="chainresult__row">
                  <span>{t.assets.issueNewAssetId}</span>
                  <strong className="chainresult__mono">{result.assetId}</strong>
                </div>
              )}
              {result.token && (
                <div className="chainresult__row">
                  <span>{t.assets.issueNewToken}</span>
                  <strong className="chainresult__mono">{result.token}</strong>
                </div>
              )}
              <div className="chainresult__row">
                <span>{t.assets.issueNewTxSent}</span>
                <a
                  className="chainresult__mono"
                  href={`${deployment.explorerUrl}/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.txHash}
                </a>
              </div>
              <div className="chainresult__note">
                <strong>{t.assets.issueNewNext}</strong>
                <p>{t.assets.issueNewNextBody}</p>
              </div>
              <Link to={ROUTES.assetsIssueManage} className="btn btn--ghost">
                {t.assets.issueNewGoManage}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IssueNewAssetToken() {
  return (
    <ManagementEntry>
      <IssueNewInner />
    </ManagementEntry>
  );
}
