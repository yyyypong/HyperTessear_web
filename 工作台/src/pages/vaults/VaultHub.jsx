import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ContextBar, EmptyState, PageHead, StatCards, StatusBadge } from '../../components/blueprint/chrome';
import { useReadSdk, useVaultDirectory, useOwnedVaults, getVaultRoleMarkers, getDemoVaultRoleMarkers } from '../../workspaces/core/onchainLists';

function VaultHubInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { address } = useWallet();
  const { sdk, demo } = useReadSdk();
  const { vaults } = useVaultDirectory();
  const { owned: myVaults, loading } = useOwnedVaults();

  const [roleCount, setRoleCount] = useState(0);
  const vaultsKey = vaults.map(v => v.vault).join(',');

  useEffect(() => {
    if (!address || vaults.length === 0) { setRoleCount(0); return undefined; }
    let cancelled = false;
    const loaders = demo
      ? vaults.map(v => Promise.resolve(getDemoVaultRoleMarkers(v, address)))
      : (sdk ? vaults.map(v => getVaultRoleMarkers(sdk, v.vault, address)) : []);
    Promise.all(loaders)
      .then(rows => { if (!cancelled) setRoleCount(rows.reduce((n, r) => n + Object.values(r).filter(Boolean).length, 0)); })
      .catch(() => { if (!cancelled) setRoleCount(0); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, demo, address, vaultsKey]);

  const activeCount = vaults.filter(v => v.state && Number(v.state.pause) === 0).length;

  return (
    <div className="bp-page">
      <PageHead eyebrow="Vault hub" title={t.bp.vaultHub.title} lede={t.bp.vaultHub.lede}>
        <button className="btn btn--gold" onClick={() => navigate('/vaults/create')}>{t.bp.vaultHub.create}</button>
      </PageHead>
      <ContextBar />
      <StatCards items={[
        { label: t.bp.vaultHub.statRoles, value: roleCount, foot: t.bp.vaultHub.statRolesFoot },
        { label: t.bp.vaultHub.statVaults, value: myVaults.length, foot: t.bp.vaultHub.statVaultsFoot, dot: 'success' },
        { label: t.bp.vaultHub.statActive, value: activeCount, foot: t.bp.vaultHub.statActiveFoot, dot: 'warning' },
        { label: t.bp.vaultHub.statAll, value: vaults.length, foot: t.bp.vaultHub.statAllFoot },
      ]} />
      <section>
        <div className="bp-section-title">
          <div>
            <div className="bp-eyebrow">My vaults</div>
            <h2>{t.bp.vaultHub.manageTitle}</h2>
          </div>
          <span className="bp-badge">{t.bp.vaultHub.manageBadge}</span>
        </div>
        <section className="bp-card">
          <div className="bp-table-wrap">
            <table className="bp-table">
              <thead>
                <tr>
                  <th>{t.bp.vaultHub.colVault}</th>
                  <th>{t.bp.vaultHub.colContract}</th>
                  <th>{t.bp.vaultHub.colType}</th>
                  <th>NAV</th>
                  <th>{t.bp.vaultHub.colStatus}</th>
                  <th>{t.bp.vaultHub.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6}><p className="bp-muted bp-small" style={{ padding: 20 }}>{t.common.loading}</p></td></tr>
                )}
                {!loading && myVaults.length === 0 && (
                  <tr>
                    <EmptyState
                      title={t.bp.vaultHub.empty}
                      body={t.bp.vaultHub.noRoleVaultsBody}
                      action={<button className="btn btn--gold" onClick={() => navigate('/vaults/create')}>{t.bp.vaultHub.goCreate}</button>}
                    />
                  </tr>
                )}
                {!loading && myVaults.map(v => (
                  <tr key={v.vault}>
                    <td>
                      <span className="bp-table__main">{v.name ?? t.bp.vaultHub.unnamed}</span>
                      <span className="bp-table__sub">{v.symbol ?? ''} · {shortId(v.vault)}{v.configured ? ` · ${t.bp.vaultHub.configuredTag}` : ''}</span>
                    </td>
                    <td className="bp-mono bp-small">{v.vault}</td>
                    <td><span className="bp-role-chip">{v.type}</span></td>
                    <td className="bp-mono">{v.nav ?? '—'}</td>
                    <td><StatusBadge status={v.state && Number(v.state.pause) === 0 ? 'active' : 'pending'} /></td>
                    <td><button className="bp-table-link" onClick={() => navigate(`/vaults/manage/${v.vault}`)}>{t.bp.vaultHub.detail} →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function shortId(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
}

export default function VaultHub() {
  return (
    <ManagementEntry>
      <VaultHubInner />
    </ManagementEntry>
  );
}
