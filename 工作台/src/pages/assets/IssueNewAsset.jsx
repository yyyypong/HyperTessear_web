import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import ManagementEntry from '../../components/access/ManagementEntry';
import { CallTag, ContextBar, EdgeList, PageHead, SidePanel, WorkLayout } from '../../components/blueprint/chrome';
import RegisterAssetForm from '../../components/blueprint/RegisterAssetForm';

export function issueSteps(t) {
  return [
    { t: t.bp.issue.step1.t, d: t.bp.issue.step1.d },
    { t: t.bp.issue.step2.t, d: t.bp.issue.step2.d },
    { t: t.bp.issue.step3.t, d: t.bp.issue.step3.d },
    { t: t.bp.issue.step4.t, d: t.bp.issue.step4.d },
  ];
}

function IssueNewInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="bp-page">
      <PageHead
        eyebrow="Issue asset"
        title={t.bp.register.title}
        lede={t.bp.register.lede}
      >
        <button className="btn btn--ghost" onClick={() => navigate('/assets/issue?tab=issue')}>{t.bp.register.back}</button>
      </PageHead>
      <ContextBar />
      <WorkLayout
        main={(
          <div className="bp-stack">
            <section className="bp-card bp-card-pad">
              <div className="bp-section-title">
                <h3>{t.bp.issue.title}</h3>
                <CallTag>AssetRegistry.registerAsset(metadataHash, name, symbol, decimals)</CallTag>
              </div>
              <div className="bp-flowbar" style={{ marginBottom: 18 }}>
                {issueSteps(t).map((s, i) => (
                  <div key={s.t} className={`bp-flowstep${i === 0 ? ' bp-flowstep--current' : ''}`}>
                    <span className="bp-flowstep__no">{i + 1}</span>
                    <strong>{s.t}</strong>
                    <span>{s.d}</span>
                  </div>
                ))}
              </div>
              <RegisterAssetForm onRegistered={(r) => { if (r?.assetId) navigate(`/assets/workspace/${r.assetId}`); }} />
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
        )}
        aside={(
          <SidePanel
            contract="AssetRegistry.registerAsset"
            permission={t.bp.register.perm}
            permissionNote={t.bp.register.permNote}
            pre={t.bp.register.pre}
            events="AssetRegistered(assetId, owner, token, metadataHash, timestamp)"
            next={t.bp.register.next}
            note={t.bp.register.note}
          />
        )}
      />
    </div>
  );
}

export default function IssueNewAsset() {
  return (
    <ManagementEntry>
      <IssueNewInner />
    </ManagementEntry>
  );
}
