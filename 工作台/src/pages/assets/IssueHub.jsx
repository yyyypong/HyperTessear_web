import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { TabNav } from '../../components/blueprint/TabNav';
import { CallTag, ContextBar, EdgeList, EmptyState, PageHead, StatCards, StatusBadge } from '../../components/blueprint/chrome';
import RegisterAssetForm from '../../components/blueprint/RegisterAssetForm';
import WrapUnwrapForm from '../../components/blueprint/WrapUnwrapForm';
import { useAssetDirectory, useOwnedAssets, equalAddress } from '../../workspaces/core/onchainLists';

const TABS = [
  { id: 'issue', label: '发行', icon: '⊕' },
  { id: 'wrap', label: '包装/解包装', icon: '⇄' },
  { id: 'workspace', label: '工作台', icon: '⊞' },
];

function issueSteps(t) {
  return [
    { t: t.bp.issue.step1.t, d: t.bp.issue.step1.d },
    { t: t.bp.issue.step2.t, d: t.bp.issue.step2.d },
    { t: t.bp.issue.step3.t, d: t.bp.issue.step3.d },
    { t: t.bp.issue.step4.t, d: t.bp.issue.step4.d },
  ];
}

function modeLabel(mode, t) {
  if (mode === 0) return t.bp.wrap.modeCustody;
  if (mode === 1) return t.bp.wrap.modeProof;
  return '—';
}

function IssueTab({ onRegistered }) {
  const { t } = useI18n();
  return (
    <div className="bp-stack">
      <section className="bp-card bp-card-pad">
        <div className="bp-section-title">
          <h3>{t.bp.issue.title}</h3>
          <CallTag>AssetRegistry.registerAsset(metadataHash, name, symbol, decimals)</CallTag>
        </div>
        <div style={{ marginBottom: 18 }}><FlowBarInline steps={issueSteps(t)} /></div>
        <RegisterAssetForm onRegistered={onRegistered} />
      </section>
      <section className="bp-card bp-card-pad">
        <div className="bp-section-title"><h3>{t.bp.issue.autoTitle}</h3></div>
        <EdgeList rows={[
          { from: 'registerAsset', via: '→ 同交易', to: t.bp.issue.edge1.to, cond: t.bp.issue.edge1.cond },
          { from: t.bp.issue.edge2.from, via: '→ 落账', to: t.bp.issue.edge2.to, cond: t.bp.issue.edge2.cond },
          { from: t.bp.issue.edge3.from, via: '→ 自动成为', to: t.bp.issue.edge3.to, cond: t.bp.issue.edge3.cond },
        ]} />
      </section>
    </div>
  );
}

function FlowBarInline({ steps }) {
  return (
    <div className="bp-flowbar">
      {steps.map((s, i) => (
        <div key={s.t} className={`bp-flowstep${i === 0 ? ' bp-flowstep--current' : ''}`}>
          <span className="bp-flowstep__no">{i + 1}</span>
          <strong>{s.t}</strong>
          <span>{s.d}</span>
        </div>
      ))}
    </div>
  );
}

function WrapTab() {
  const { t } = useI18n();
  return (
    <div className="bp-stack">
      <div className="bp-stats">
        <div className="bp-stat">
          <div className="bp-section-title" style={{ margin: 0 }}><h3>{t.bp.wrap.modeCustody}</h3></div>
          <p className="bp-small bp-muted">{t.bp.wrap.custodyDesc}</p>
        </div>
        <div className="bp-stat">
          <div className="bp-section-title" style={{ margin: 0 }}><h3>{t.bp.wrap.modeProof}</h3></div>
          <p className="bp-small bp-muted">{t.bp.wrap.proofDesc}</p>
        </div>
      </div>
      <section className="bp-card bp-card-pad">
        <div className="bp-section-title">
          <h3>{t.bp.wrap.title}</h3>
          <CallTag>ReservePSM.wrap / unwrap / mintWithAuthorization</CallTag>
        </div>
        <WrapUnwrapForm />
      </section>
      <ConfiguredWrappedList />
    </div>
  );
}

function ConfiguredWrappedList() {
  const { t } = useI18n();
  const { assets } = useAssetDirectory();
  const wrapped = assets.filter(a => a.mode !== null && a.mode !== undefined);
  return (
    <section className="bp-card bp-card-pad">
      <div className="bp-section-title">
        <h3>{t.bp.wrap.configuredTitle}</h3>
        <span className="bp-badge">{wrapped.length}</span>
      </div>
      <div className="bp-req-list">
        {wrapped.length === 0 && <p className="bp-muted bp-small">{t.bp.wrap.noneConfigured}</p>}
        {wrapped.map(a => (
          <div className="bp-req-item" key={a.id}>
            <div>
              <h4>{a.name} <span className="bp-mono bp-quiet">{a.symbol}</span></h4>
              <p>{modeLabel(Number(a.mode), t)} · {t.bp.wrap.wrappedToken} <span className="bp-mono">{a.wrappedToken}</span></p>
            </div>
            <StatusBadge status={a.active ? 'active' : 'paused'} />
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkspaceTab({ onEnterWorkspace }) {
  const { t } = useI18n();
  const { address } = useWallet();
  const { assets } = useAssetDirectory();
  const { owned: myAssets, loading } = useOwnedAssets();
  const myCount = useMemo(() => assets.filter(a => equalAddress(a.owner, address)).length, [assets, address]);
  const activeCount = useMemo(() => assets.filter(a => a.active).length, [assets]);
  const wrappedCount = useMemo(() => assets.filter(a => a.mode !== null && a.mode !== undefined).length, [assets]);
  return (
    <div className="bp-stack">
      <StatCards items={[
        { label: t.bp.hub.myAssets, value: myAssets.length, foot: t.bp.hub.myAssetsFoot, dot: 'success' },
        { label: t.bp.hub.allAssets, value: assets.length, foot: t.bp.hub.allAssetsFoot },
        { label: t.bp.hub.wrapped, value: wrappedCount, foot: t.bp.hub.wrappedFoot, dot: 'warning' },
        { label: t.bp.hub.active, value: activeCount, foot: t.bp.hub.activeFoot },
      ]} />
      <section className="bp-card">
        <div className="bp-section-title bp-card-pad" style={{ marginBottom: 0, paddingBottom: 0 }}>
          <div>
            <div className="bp-eyebrow">Issuance assets</div>
            <h3>{t.bp.hub.workspaceTitle}</h3>
          </div>
        </div>
        <div className="bp-table-wrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th>{t.bp.hub.colAsset}</th>
                <th>{t.bp.hub.colContract}</th>
                <th>{t.bp.hub.colType}</th>
                <th>{t.bp.hub.colStatus}</th>
                <th>{t.bp.hub.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5}><p className="bp-muted bp-small" style={{ padding: 20 }}>{t.common.loading}</p></td></tr>
              )}
              {!loading && myAssets.length === 0 && (
                <tr><EmptyState title={t.bp.hub.emptyAssets} body={t.bp.hub.noRoleAssetsBody} /></tr>
              )}
              {!loading && myAssets.map(a => (
                <tr key={a.id}>
                  <td>
                    <span className="bp-table__main">{a.name}</span>
                    <span className="bp-table__sub">{a.symbol} · assetId #{a.id}</span>
                  </td>
                  <td className="bp-mono bp-small">{a.token}</td>
                  <td><span className="bp-role-chip">{modeLabel(Number(a.mode), t)}</span></td>
                  <td><StatusBadge status={a.active ? 'active' : 'paused'} /></td>
                  <td><button className="bp-table-link" onClick={() => onEnterWorkspace(a.id)}>{t.bp.hub.enterWorkspace} →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="bp-small bp-quiet bp-card-pad" style={{ paddingTop: 14 }}>{t.bp.hub.workspaceNote}</p>
      </section>
    </div>
  );
}

function IssueHubInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'issue';
  const setTab = (id) => { params.set('tab', id); setParams(params, { replace: true }); };

  return (
    <div className="bp-page">
      <PageHead eyebrow="Issuance Hub" title={t.bp.hub.title} lede={t.bp.hub.lede} />
      <TabNav tabs={TABS} active={tab} onSelect={setTab} ariaLabel={t.bp.hub.tabsLabel} />
      <ContextBar />
      {tab === 'issue' && <IssueTab onRegistered={(r) => { if (r?.assetId) setTab('workspace'); }} />}
      {tab === 'wrap' && <WrapTab />}
      {tab === 'workspace' && <WorkspaceTab onEnterWorkspace={(id) => navigate(`/assets/workspace/${id}`)} />}
    </div>
  );
}

export default function IssueHub() {
  return (
    <ManagementEntry>
      <IssueHubInner />
    </ManagementEntry>
  );
}
