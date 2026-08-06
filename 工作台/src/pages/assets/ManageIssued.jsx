import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ContextBar, EmptyState, PageHead, StatusBadge } from '../../components/blueprint/chrome';
import { equalAddress, useAssetDirectory } from '../../workspaces/core/onchainLists';

function ManageIssuedInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { address } = useWallet();
  const { assets } = useAssetDirectory();
  const myAssets = useMemo(() => assets.filter(a => equalAddress(a.owner, address)), [assets, address]);

  return (
    <div className="bp-page">
      <PageHead
        eyebrow="Asset owner"
        title={t.bp.manageAssets.title}
        lede={t.bp.manageAssets.lede}
      >
        <button className="btn btn--ghost" onClick={() => navigate('/assets/issue?tab=workspace')}>{t.bp.manageAssets.back}</button>
      </PageHead>
      <ContextBar extra={[{ label: t.bp.context.scope, value: t.bp.manageAssets.scope }]} />
      <section className="bp-card">
        <div className="bp-table-wrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th>{t.bp.manageAssets.colAsset}</th>
                <th>{t.bp.manageAssets.colToken}</th>
                <th>NAV</th>
                <th>{t.bp.manageAssets.colStatus}</th>
                <th>{t.bp.manageAssets.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {myAssets.length === 0 && (
                <tr>
                  <EmptyState
                    title={t.bp.manageAssets.empty}
                    body={t.bp.manageAssets.emptyBody}
                    action={<button className="btn btn--gold" onClick={() => navigate('/assets/issue/new')}>{t.bp.manageAssets.goIssue}</button>}
                  />
                </tr>
              )}
              {myAssets.map(a => (
                <tr key={a.id}>
                  <td>
                    <span className="bp-table__main">{a.name}</span>
                    <span className="bp-table__sub">{a.symbol} · assetId #{a.id}</span>
                  </td>
                  <td className="bp-mono bp-small">{a.token}</td>
                  <td className="bp-mono">{a.nav ?? '—'}</td>
                  <td><StatusBadge status={a.active ? 'active' : 'paused'} /></td>
                  <td><button className="bp-table-link" onClick={() => navigate(`/assets/workspace/${a.id}`)}>{t.bp.manageAssets.detail} →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ManageIssued() {
  return (
    <ManagementEntry>
      <ManageIssuedInner />
    </ManagementEntry>
  );
}
