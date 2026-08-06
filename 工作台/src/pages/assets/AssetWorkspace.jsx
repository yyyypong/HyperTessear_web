import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { RoleSidebar } from '../../components/blueprint/RoleSidebar';
import WorkspaceFrame from '../../components/blueprint/WorkspaceFrame';
import RoleWorkspacePage from '../../workspaces/pages/RoleWorkspacePage';
import { useReadSdk, useAssetDirectory, getAssetRoleMarkers, getDemoAssetRoleMarkers, ASSET_DOMAIN_ROLES, roleLabels } from '../../workspaces/core/onchainLists';

function useAssetRoleMarkers(assetId) {
  const { sdk, demo } = useReadSdk();
  const { address } = useWallet();
  const { assets } = useAssetDirectory();
  const asset = assets.find(a => a.id === Number(assetId));
  const [state, setState] = useState({ markers: {}, status: 'idle' });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!asset) return undefined;
    let cancelled = false;
    setState(prev => ({ ...prev, status: 'loading' }));
    const loader = demo
      ? Promise.resolve(getDemoAssetRoleMarkers(asset, address))
      : (sdk ? getAssetRoleMarkers(sdk, asset, address) : Promise.resolve({}));
    loader
      .then(markers => { if (!cancelled) setState({ markers, status: 'success' }); })
      .catch(() => { if (!cancelled) setState({ markers: {}, status: 'error' }); });
    return () => { cancelled = true; };
  }, [sdk, demo, asset, address, generation]);
  return { asset, markers: state.markers, status: state.status, reload: () => setGeneration(g => g + 1) };
}

function AssetWorkspaceInner() {
  const { t } = useI18n();
  const { assetId, role: roleParam } = useParams();
  const { assets } = useAssetDirectory();
  const { asset, markers, status } = useAssetRoleMarkers(assetId);
  const labels = useMemo(() => roleLabels(t, ASSET_DOMAIN_ROLES), [t]);

  if (!asset) {
    return (
      <div className="bp-page">
        <div className="bp-card bp-card-pad"><div className="bp-empty"><h3>{t.bp.assetWorkspace.notFound}</h3><p>{t.bp.assetWorkspace.notFoundBody}</p></div></div>
      </div>
    );
  }

  // Only the roles this wallet actually holds on this asset appear here.
  const heldRoles = ASSET_DOMAIN_ROLES.filter(role => markers[role.id] === true);
  const defaultRoleId = heldRoles[0]?.id ?? 'asset-owner';
  const roleId = heldRoles.some(r => r.id === roleParam) ? roleParam : defaultRoleId;

  const sidebarRoles = heldRoles.map(role => ({
    id: role.id,
    label: labels[role.id] ?? role.id,
    contract: role.contract,
    active: role.id === roleId,
    to: `/assets/workspace/${asset.id}/${role.id}`,
  }));

  return (
    <div className="bp-page">
      <div className="bp-workspace-shell">
        <RoleSidebar
          businessLinks={[
            { label: t.bp.assetWorkspace.businessHub, to: '/assets/issue?tab=workspace' },
            { label: t.bp.assetWorkspace.businessManage, to: '/assets/issue/manage' },
          ]}
          roleLabel={t.bp.assetWorkspace.rolesLabel}
          roles={sidebarRoles}
          note={t.bp.assetWorkspace.sidebarNote}
        />
        <div className="bp-workspace-main">
          {status === 'loading' ? (
            <div className="bp-card bp-card-pad"><p className="bp-muted">{t.common.loading}</p></div>
          ) : heldRoles.length === 0 ? (
            <div className="bp-card bp-card-pad">
              <div className="bp-empty">
                <h3>{t.bp.assetWorkspace.noRolesTitle}</h3>
                <p>{t.bp.assetWorkspace.noRolesBody}</p>
              </div>
            </div>
          ) : (
            <WorkspaceFrame>
              <RoleWorkspacePage roleId={roleId} assetId={String(asset.id)} />
            </WorkspaceFrame>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AssetWorkspace() {
  return (
    <ManagementEntry>
      <AssetWorkspaceInner />
    </ManagementEntry>
  );
}
