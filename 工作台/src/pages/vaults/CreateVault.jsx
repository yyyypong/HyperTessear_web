import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ROUTES } from '../../config/routes';
import { getDeployment } from '../../workspaces/config/deployments';
import { createWriteSdk } from '../../workspaces/core/createSdk';

/** MockUSDT on BNB Testnet — the demo stablecoin every vault is denominated in. */
const MOCK_USDT = '0x66924eC2539ab478aba1112428cD6979baDa6bC6';

/**
 * Create a vault — real VaultFactory.deployVault form.
 *
 * Permission model (PR #12): the Governor designates the official factory via
 * StateManager.setVaultFactory; once set, deployVault is fully open — any
 * wallet can call it. The factory deploys the vault + timelock and registers
 * it with the StateManager by address match (msg.sender == vaultFactory).
 * The creator becomes the vault Owner on completion.
 */
function CreateVaultInner() {
  const { t } = useI18n();
  const { chainId, session } = useWallet();

  const deployment = chainId != null ? getDeployment(chainId) : null;
  const canWrite = Boolean(session?.provider);

  const [vaultType, setVaultType] = useState('0');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [initialProduct, setInitialProduct] = useState('0');
  const [initialCycle] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { txHash, vault }
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    setResult(null);
    if (!name.trim() || !symbol.trim()) {
      setError(t.vaults.createInvalid);
      return;
    }
    setSubmitting(true);
    try {
      const sdk = await createWriteSdk(deployment, session.provider);
      const params = {
        vaultType: Number(vaultType),
        name: name.trim(),
        symbol: symbol.trim(),
        usdt: MOCK_USDT,
        stateManager: deployment.addresses.stateManager,
        settlement: deployment.addresses.settlement,
        queue: deployment.addresses.queue,
        accessControl: deployment.addresses.hyperAccessControl,
        liquidityBridge: deployment.addresses.liquidityBridge,
        cashVault: deployment.addresses.cashVault,
        initialProduct: Number(initialProduct),
        initialCycle: Number(initialCycle),
      };
      const tx = await sdk.vaultFactory.deployVault(params);
      const receipt = await tx.wait();

      let vault = null;
      for (const log of receipt.logs) {
        try {
          const parsed = sdk.vaultFactory.interface.parseLog(log);
          if (parsed?.name === 'VaultDeployed') vault = parsed.args.vault;
        } catch { /* not a log this interface recognizes */ }
      }
      setResult({ txHash: receipt.hash, vault });
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.vaults.eyebrow}</div>
        <h1 className="phead__title">{t.vaults.createTitle}</h1>
        <p className="section__lede">{t.vaults.createLede}</p>
      </div>

      {!canWrite && (
        <div className="walletnote">
          <strong>{t.vaults.createWalletNeeded}</strong>
          <p>{t.vaults.createWalletNeededBody}</p>
        </div>
      )}

      <div className="shellcard">
        <div className="actionform">
          <div className="actionform__field">
            <label className="actionform__label">{t.vaults.createFieldType}</label>
            <select
              className="actionform__select"
              value={vaultType}
              onChange={e => setVaultType(e.target.value)}
            >
              <option value="0">{t.vaults.createTypeEarn}</option>
              <option value="1">{t.vaults.createTypeLp}</option>
            </select>
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.vaults.createFieldName}</label>
            <input
              className="actionform__input"
              value={name}
              placeholder="HyperTessera Earn Vault D"
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.vaults.createFieldSymbol}</label>
            <input
              className="actionform__input"
              value={symbol}
              placeholder="HTVD"
              onChange={e => setSymbol(e.target.value)}
            />
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.vaults.createFieldProduct}</label>
            <select
              className="actionform__select"
              value={initialProduct}
              onChange={e => setInitialProduct(e.target.value)}
            >
              <option value="0">{t.vaults.createProductConfiguring}</option>
              <option value="1">{t.vaults.createProductSubscribing}</option>
            </select>
          </div>

          <div className="actionform__field">
            <label className="actionform__label">{t.vaults.createFieldCycle}</label>
            <select className="actionform__select" value={initialCycle} disabled>
              <option value="0">{t.vaults.createCycleAccepting}</option>
            </select>
          </div>

          <div className="actionform__field">
            <div className="chainresult">
              <div className="chainresult__row">
                <span>USDT</span>
                <strong className="chainresult__mono">{MOCK_USDT}</strong>
              </div>
              <div className="chainresult__row">
                <span>StateManager</span>
                <strong className="chainresult__mono">{deployment?.addresses.stateManager || '—'}</strong>
              </div>
              <div className="chainresult__row">
                <span>Settlement</span>
                <strong className="chainresult__mono">{deployment?.addresses.settlement || '—'}</strong>
              </div>
              <div className="chainresult__row">
                <span>Queue</span>
                <strong className="chainresult__mono">{deployment?.addresses.queue || '—'}</strong>
              </div>
              <div className="chainresult__row">
                <span>AccessControl</span>
                <strong className="chainresult__mono">{deployment?.addresses.hyperAccessControl || '—'}</strong>
              </div>
              <div className="chainresult__row">
                <span>LiquidityBridge</span>
                <strong className="chainresult__mono">{deployment?.addresses.liquidityBridge || '—'}</strong>
              </div>
              <div className="chainresult__row">
                <span>CashVault</span>
                <strong className="chainresult__mono">{deployment?.addresses.cashVault || '—'}</strong>
              </div>
            </div>
            <p className="actionform__hint">{t.vaults.createAutoNote}</p>
          </div>

          {!deployment ? (
            <p className="actionform__note">{t.vaults.createNoDeployment}</p>
          ) : canWrite ? (
            <div className="actionform__actions">
              <button type="button" className="btn btn--gold" onClick={submit} disabled={submitting}>
                {submitting ? t.vaults.createSubmitting : t.vaults.createSubmit}
              </button>
            </div>
          ) : (
            <p className="actionform__note">{t.vaults.createWalletNeededBody}</p>
          )}

          {error && <p className="actionform__error">{error}</p>}

          {result && (
            <div className="chainresult">
              <div className="chainresult__title">{t.vaults.createSuccessTitle}</div>
              {result.vault && (
                <div className="chainresult__row">
                  <span>{t.vaults.createVaultAddress}</span>
                  <strong className="chainresult__mono">{result.vault}</strong>
                </div>
              )}
              <div className="chainresult__row">
                <span>{t.vaults.createTxSent}</span>
                <a
                  className="chainresult__mono"
                  href={`${deployment.explorerUrl}/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.txHash}
                </a>
              </div>
              <p className="chainresult__note">{t.vaults.createOwnerNote}</p>
              <Link to={ROUTES.vaultsManage} className="btn btn--ghost">
                {t.vaults.manageTitle}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CreateVault() {
  return (
    <ManagementEntry>
      <CreateVaultInner />
    </ManagementEntry>
  );
}
