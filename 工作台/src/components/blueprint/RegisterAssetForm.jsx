import { useRef, useState } from 'react';
import { keccak256, isHexString } from 'ethers';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import { useReadSdk } from '../../workspaces/core/onchainLists';
import { getWriteSigner } from '../../workspaces/core/walletRunner';

/**
 * AssetRegistry.registerAsset form (blueprint "发行新资产代币").
 *
 * Registration is permissionless; the caller becomes Asset Owner in the same
 * transaction. A metadataHash is computed from the uploaded disclosure document
 * via keccak256 of the raw bytes (SDK computeDocumentHash).
 */
export default function RegisterAssetForm({ onRegistered }) {
  const { t } = useI18n();
  const { session } = useWallet();
  const { sdk, deployment } = useReadSdk();
  const canWrite = Boolean(session?.provider && deployment);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [metadataHash, setMetadataHash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  async function generateHashFromFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      const seed = `${name.trim() || 'asset'}.${symbol.trim() || 'token'}.${Date.now()}`;
      setMetadataHash(keccak256(new TextEncoder().encode(seed)));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setMetadataHash(keccak256(bytes));
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
    if (!isHexString(metadataHash.trim(), 32)) {
      setError(t.assets.issueNewInvalidHash);
      return;
    }
    setSubmitting(true);
    try {
      const signer = await getWriteSigner(session.provider);
      const tx = await sdk.assetRegistry.connect(signer).registerAsset(
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
      if (onRegistered) onRegistered({ assetId, token, txHash: receipt.hash });
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="bp-form-grid" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="bp-field bp-field--full">
        <label htmlFor="reg-name">{t.assets.issueNewFieldName} *</label>
        <input id="reg-name" className="bp-input" name="name" value={name} placeholder="如：US Treasury Token" onChange={e => setName(e.target.value)} required />
      </div>
      <div className="bp-field">
        <label htmlFor="reg-symbol">{t.assets.issueNewFieldSymbol} *</label>
        <input id="reg-symbol" className="bp-input" name="symbol" value={symbol} placeholder="如：htUST" onChange={e => setSymbol(e.target.value)} required />
      </div>
      <div className="bp-field">
        <label htmlFor="reg-decimals">{t.assets.issueNewFieldDecimals}</label>
        <input id="reg-decimals" className="bp-input" name="decimals" type="number" min="0" max="18" value={decimals} onChange={e => setDecimals(e.target.value)} />
      </div>
      <div className="bp-field bp-field--full">
        <label htmlFor="reg-file">{t.bp.issue.documentLabel}</label>
        <div className="bp-row">
          <input id="reg-file" className="bp-input" style={{ flex: 1 }} type="file" accept=".pdf,.doc,.docx,.md,.txt,.json,.xlsx" ref={fileRef} />
          <button type="button" className="btn btn--ghost" onClick={generateHashFromFile}>{t.assets.issueNewGenerateHash}</button>
        </div>
        <p className="bp-field__hint">{t.bp.issue.documentHint}</p>
      </div>
      <div className="bp-field bp-field--full">
        <label htmlFor="reg-hash">{t.bp.issue.hashLabel} *</label>
        <input id="reg-hash" className="bp-input bp-mono" name="metadataHash" value={metadataHash} placeholder="0x + 64 位十六进制（keccak256）" style={{ fontSize: 12 }} onChange={e => setMetadataHash(e.target.value)} required />
        <p className="bp-field__hint">{t.bp.issue.hashHint}</p>
      </div>
      <div className="bp-field bp-field--full">
        {!deployment ? (
          <p className="actionform__note">{t.assets.issueNewNoDeployment}</p>
        ) : canWrite ? (
          <button type="submit" className="btn btn--gold" disabled={submitting}>
            {submitting ? t.assets.issueNewSubmitting : t.assets.issueNewSubmit}
          </button>
        ) : (
          <p className="actionform__note">{t.assets.issueNewWalletNeededBody}</p>
        )}
        <p className="bp-field__hint">{t.bp.issue.ownerNote}</p>
      </div>

      {error && <p className="actionform__error" style={{ gridColumn: '1 / -1' }}>{error}</p>}

      {result && (
        <div className="chainresult" style={{ gridColumn: '1 / -1' }}>
          <div className="chainresult__title">{t.assets.issueNewSuccessTitle}</div>
          {result.assetId != null && (
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
            <a className="chainresult__mono" href={`${deployment.explorerUrl}/tx/${result.txHash}`} target="_blank" rel="noreferrer">{result.txHash}</a>
          </div>
          {result.assetId != null && (
            <p className="chainresult__note">{t.bp.issue.registeredNext.replace('{id}', result.assetId)}</p>
          )}
        </div>
      )}
    </form>
  );
}
