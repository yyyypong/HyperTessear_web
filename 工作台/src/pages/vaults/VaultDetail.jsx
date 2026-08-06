import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { RoleSidebar } from '../../components/blueprint/RoleSidebar';
import WorkspaceFrame from '../../components/blueprint/WorkspaceFrame';
import RoleWorkspacePage from '../../workspaces/pages/RoleWorkspacePage';
import SettlementOperatorWorkspace from './SettlementOperatorWorkspace';
import { useReadSdk, useVaultDirectory, getVaultRoleMarkers, getDemoVaultRoleMarkers, VAULT_DOMAIN_ROLES, roleLabels } from '../../workspaces/core/onchainLists';

function useVaultRoleMarkers(vaultAddress) {
  const { sdk, demo } = useReadSdk();
  const { address } = useWallet();
  const { vaults } = useVaultDirectory();
  const row = vaults.find(v => v.vault.toLowerCase() === String(vaultAddress).toLowerCase());
  const [state, setState] = useState({ markers: {}, status: 'idle' });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!vaultAddress) return undefined;
    let cancelled = false;
    setState(prev => ({ ...prev, status: 'loading' }));
    const loader = demo
      ? Promise.resolve(getDemoVaultRoleMarkers(row, address))
      : (sdk && row ? getVaultRoleMarkers(sdk, row.vault, address) : Promise.resolve({}));
    loader
      .then(markers => { if (!cancelled) setState({ markers, status: 'success' }); })
      .catch(() => { if (!cancelled) setState({ markers: {}, status: 'error' }); });
    return () => { cancelled = true; };
  }, [sdk, demo, row, vaultAddress, address, generation]);
  return { markers: state.markers, status: state.status, reload: () => setGeneration(g => g + 1) };
}

function VaultDetailInner() {
  const { t } = useI18n();
  const { vaultAddress, role: roleParam } = useParams();
  const { markers, status } = useVaultRoleMarkers(vaultAddress);
  const labels = useMemo(() => roleLabels(t, VAULT_DOMAIN_ROLES), [t]);

  if (!vaultAddress) {
    return (
      <div className="bp-page">
        <div className="bp-card bp-card-pad"><div className="bp-empty"><h3>{t.bp.vaultDetail.notFound}</h3><p>{t.bp.vaultDetail.notFoundBody}</p></div></div>
      </div>
    );
  }

  // Only the roles this wallet actually holds on this vault appear here.
  const heldRoles = VAULT_DOMAIN_ROLES.filter(role => markers[role.id] === true);
  const defaultRoleId = heldRoles[0]?.id ?? 'vault-owner';
  const roleId = heldRoles.some(r => r.id === roleParam) ? roleParam : defaultRoleId;

  const sidebarRoles = heldRoles.map(role => ({
    id: role.id,
    label: labels[role.id] ?? role.id,
    contract: role.contract,
    active: role.id === roleId,
    to: `/vaults/manage/${vaultAddress}/${role.id}`,
  }));

  return (
    <div className="bp-page">
      <div className="bp-workspace-shell">
        <RoleSidebar
          businessLinks={[
            { label: t.bp.vaultDetail.businessHub, to: '/vaults' },
            { label: t.bp.vaultDetail.businessManage, to: '/vaults/manage' },
          ]}
          roleLabel={t.bp.vaultDetail.rolesLabel}
          roles={sidebarRoles}
          note={t.bp.vaultDetail.sidebarNote}
        />
        <div className="bp-workspace-main">
          {status === 'loading' ? (
            <div className="bp-card bp-card-pad"><p className="bp-muted">{t.common.loading}</p></div>
          ) : heldRoles.length === 0 ? (
            <div className="bp-card bp-card-pad">
              <div className="bp-empty">
                <h3>{t.bp.vaultDetail.noRolesTitle}</h3>
                <p>{t.bp.vaultDetail.noRolesBody}</p>
              </div>
            </div>
          ) : (
            roleId === 'settlement-operator' ? (
              <SettlementOperatorWorkspace vault={vaultAddress} />
            ) : (
              <WorkspaceFrame>
                <RoleWorkspacePage roleId={roleId} vault={vaultAddress} />
              </WorkspaceFrame>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function VaultDetail() {
  return (
    <ManagementEntry>
      <VaultDetailInner />
    </ManagementEntry>
  );
}
