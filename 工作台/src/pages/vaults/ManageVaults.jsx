import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ContextBar, EmptyState, PageHead, StatusBadge } from '../../components/blueprint/chrome';
import { useVaultDirectory, equalAddress } from '../../workspaces/core/onchainLists';

function ManageVaultsInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { address } = useWallet();
  const { vaults } = useVaultDirectory();
  const myVaults = vaults.filter(v => equalAddress(v.deployer, address));

  return (
    <div className="bp-page">
      <PageHead eyebrow="Vault owner" title={t.bp.manageVaults.title} lede={t.bp.manageVaults.lede}>
        <button className="btn btn--ghost" onClick={() => navigate('/vaults')}>{t.bp.manageVaults.back}</button>
      </PageHead>
      <ContextBar extra={[{ label: t.bp.context.scope, value: t.bp.manageVaults.scope }]} />
      <section className="bp-card">
        <div className="bp-table-wrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th>{t.bp.manageVaults.colVault}</th>
                <th>{t.bp.manageVaults.colContract}</th>
                <th>{t.bp.manageVaults.colType}</th>
                <th>NAV</th>
                <th>{t.bp.manageVaults.colStatus}</th>
                <th>{t.bp.manageVaults.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {myVaults.length === 0 && (
                <tr>
                  <EmptyState
                    title={t.bp.manageVaults.empty}
                    body={t.bp.manageVaults.emptyBody}
                    action={<button className="btn btn--gold" onClick={() => navigate('/vaults/create')}>{t.bp.manageVaults.goCreate}</button>}
                  />
                </tr>
              )}
              {myVaults.map(v => (
                <tr key={v.vault}>
                  <td>
                    <span className="bp-table__main">{v.name ?? v.vault}</span>
                    <span className="bp-table__sub">{v.symbol ?? ''} · {v.vault}</span>
                  </td>
                  <td className="bp-mono bp-small">{v.vault}</td>
                  <td><span className="bp-role-chip">{v.type}</span></td>
                  <td className="bp-mono">{v.nav ?? '—'}</td>
                  <td><StatusBadge status={v.state && Number(v.state.pause) === 0 ? 'active' : 'pending'} /></td>
                  <td><button className="bp-table-link" onClick={() => navigate(`/vaults/manage/${v.vault}`)}>{t.bp.manageVaults.detail} →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ManageVaults() {
  return (
    <ManagementEntry>
      <ManageVaultsInner />
    </ManagementEntry>
  );
}
