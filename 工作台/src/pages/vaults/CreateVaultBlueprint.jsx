import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { CallTag, ContextBar, FlowBar, PageHead, SidePanel, WorkLayout } from '../../components/blueprint/chrome';
import { getDeployment } from '../../workspaces/config/deployments';
import { createWriteSdk } from '../../workspaces/core/createSdk';

/** MockUSDT on BNB Testnet — the demo stablecoin every vault is denominated in. */
const MOCK_USDT = '0x66924eC2539ab478aba1112428cD6979baDa6bC6';

const PRODUCT_STATES = [
  { value: '0', labelKey: 'configuring' },
  { value: '1', labelKey: 'subscribing' },
  { value: '2', labelKey: 'fundingFailed' },
  { value: '3', labelKey: 'operating' },
  { value: '4', labelKey: 'settling' },
  { value: '5', labelKey: 'maturing' },
  { value: '6', labelKey: 'claiming' },
  { value: '7', labelKey: 'closed' },
];

const CYCLE_STATES = [
  { value: '0', labelKey: 'accepting' },
  { value: '1', labelKey: 'calculating' },
  { value: '2', labelKey: 'fulfilling' },
  { value: '3', labelKey: 'completed' },
];

function vaultSteps(t) {
  return [
    { t: t.bp.createVault.step1.t, d: t.bp.createVault.step1.d },
    { t: t.bp.createVault.step2.t, d: t.bp.createVault.step2.d },
    { t: t.bp.createVault.step3.t, d: t.bp.createVault.step3.d },
    { t: t.bp.createVault.step4.t, d: t.bp.createVault.step4.d },
  ];
}

function CreateVaultInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { chainId, session } = useWallet();
  const deployment = chainId != null ? getDeployment(chainId) : null;
  const canWrite = Boolean(session?.provider && deployment);

  const [vaultType, setVaultType] = useState('0');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [usdt, setUsdt] = useState(MOCK_USDT);
  const [initialProduct, setInitialProduct] = useState('0');
  const [initialCycle, setInitialCycle] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const productLabel = (key) => t.bp.createVault[`product${key[0].toUpperCase()}${key.slice(1)}`];
  const cycleLabel = (key) => t.bp.createVault[`cycle${key[0].toUpperCase()}${key.slice(1)}`];

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
        usdt: usdt.trim() || MOCK_USDT,
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

  const readonlyRows = [
    ['StateManager', deployment?.addresses.stateManager],
    ['Settlement', deployment?.addresses.settlement],
    ['Queue', deployment?.addresses.queue],
    ['AccessControl', deployment?.addresses.hyperAccessControl],
    ['LiquidityBridge', deployment?.addresses.liquidityBridge],
    ['CashVault', deployment?.addresses.cashVault],
  ];

  return (
    <div className="bp-page">
      <PageHead eyebrow="Deploy vault" title={t.bp.createVault.title} lede={t.bp.createVault.lede}>
        <button className="btn btn--ghost" onClick={() => navigate('/vaults')}>{t.bp.createVault.back}</button>
      </PageHead>
      <ContextBar />
      <WorkLayout
        main={(
          <div className="bp-stack">
            <section className="bp-card bp-card-pad">
              <div className="bp-section-title">
                <h3>{t.bp.createVault.paramsTitle}</h3>
                <CallTag>VaultFactory.deployVault(VaultParams)</CallTag>
              </div>
              <div className="bp-flowbar" style={{ marginBottom: 18 }}>
                {vaultSteps(t).map((s, i) => (
                  <div key={s.t} className={`bp-flowstep${i === 0 ? ' bp-flowstep--current' : ''}`}>
                    <span className="bp-flowstep__no">{i + 1}</span>
                    <strong>{s.t}</strong>
                    <span>{s.d}</span>
                  </div>
                ))}
              </div>
              <form className="bp-form-grid" onSubmit={e => { e.preventDefault(); submit(); }}>
                <div className="bp-field">
                  <label htmlFor="cv-type">{t.bp.createVault.fieldType} *</label>
                  <select id="cv-type" className="bp-select" value={vaultType} onChange={e => setVaultType(e.target.value)}>
                    <option value="0">{t.bp.createVault.typeEarn}</option>
                    <option value="1">{t.bp.createVault.typeLp}</option>
                  </select>
                </div>
                <div className="bp-field">
                  <label htmlFor="cv-name">{t.bp.createVault.fieldName} *</label>
                  <input id="cv-name" className="bp-input" value={name} placeholder="如：T-Bill Income Vault" onChange={e => setName(e.target.value)} required />
                </div>
                <div className="bp-field">
                  <label htmlFor="cv-symbol">{t.bp.createVault.fieldSymbol} *</label>
                  <input id="cv-symbol" className="bp-input" value={symbol} placeholder="如：htTBILL" onChange={e => setSymbol(e.target.value)} required />
                </div>
                <div className="bp-field">
                  <label htmlFor="cv-usdt">{t.bp.createVault.fieldUsdt}</label>
                  <input id="cv-usdt" className="bp-input bp-mono bp-small" value={usdt} onChange={e => setUsdt(e.target.value)} required />
                </div>
                <div className="bp-field">
                  <label htmlFor="cv-product">{t.bp.createVault.fieldProduct} *</label>
                  <select id="cv-product" className="bp-select" value={initialProduct} onChange={e => setInitialProduct(e.target.value)}>
                    {PRODUCT_STATES.map(s => <option key={s.value} value={s.value}>{productLabel(s.labelKey)}</option>)}
                  </select>
                </div>
                <div className="bp-field">
                  <label htmlFor="cv-cycle">{t.bp.createVault.fieldCycle} *</label>
                  <select id="cv-cycle" className="bp-select" value={initialCycle} onChange={e => setInitialCycle(e.target.value)}>
                    {CYCLE_STATES.map(s => <option key={s.value} value={s.value}>{cycleLabel(s.labelKey)}</option>)}
                  </select>
                </div>
                <div className="bp-field bp-field--full">
                  <div className="bp-section-title" style={{ marginBottom: 0 }}><h3>{t.bp.createVault.modulesTitle}</h3></div>
                  <div className="chainresult" style={{ marginTop: 8 }}>
                    {readonlyRows.map(([label, value]) => (
                      <div className="chainresult__row" key={label}>
                        <span>{label}</span>
                        <strong className="chainresult__mono">{value || '—'}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bp-field bp-field--full">
                  {!deployment ? (
                    <p className="actionform__note">{t.vaults.createNoDeployment}</p>
                  ) : canWrite ? (
                    <button type="submit" className="btn btn--gold" disabled={submitting}>
                      {submitting ? t.vaults.createSubmitting : t.bp.createVault.deploy}
                    </button>
                  ) : (
                    <p className="actionform__note">{t.vaults.createWalletNeededBody}</p>
                  )}
                  <p className="bp-field__hint">{t.bp.createVault.ownerNote}</p>
                </div>
              </form>

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
                    <a className="chainresult__mono" href={`${deployment.explorerUrl}/tx/${result.txHash}`} target="_blank" rel="noreferrer">{result.txHash}</a>
                  </div>
                  <p className="chainresult__note">{t.vaults.createOwnerNote}</p>
                  {result.vault && (
                    <button className="btn btn--ghost" onClick={() => navigate(`/vaults/manage/${result.vault}`)}>{t.bp.createVault.enterDetail}</button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
        aside={(
          <SidePanel
            contract="VaultFactory.deployVault + StateManager.registerVault"
            permission={t.bp.createVault.perm}
            permissionNote={t.bp.createVault.permNote}
            pre={t.bp.createVault.pre}
            events="VaultDeployed(vaultType, vault, owner, timelock, name, symbol, timestamp)"
            next={t.bp.createVault.next}
            note={t.bp.createVault.note}
          />
        )}
      />
    </div>
  );
}

export default function CreateVaultBlueprint() {
  return (
    <ManagementEntry>
      <CreateVaultInner />
    </ManagementEntry>
  );
}
