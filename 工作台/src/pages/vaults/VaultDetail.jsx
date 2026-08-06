import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatUnits } from 'ethers';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { RoleSidebar } from '../../components/blueprint/RoleSidebar';
import WorkspaceFrame from '../../components/blueprint/WorkspaceFrame';
import RoleWorkspacePage from '../../workspaces/pages/RoleWorkspacePage';
import SettlementOperatorWorkspace from './SettlementOperatorWorkspace';
import { loadFeeOverview } from '../../workspaces/core/workspaceQueries';
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

const DEMO_FEE_RECIPIENT = '0x1111111111111111111111111111111111111111';
const DEMO_REVENUE_POOL = '0x5555555555555555555555555555555555555555';

function useFeeOverview(vaultAddress) {
  const { sdk, demo } = useReadSdk();
  const [state, setState] = useState({ data: null, status: 'idle' });
  useEffect(() => {
    if (!vaultAddress) return undefined;
    let cancelled = false;
    if (demo) {
      setState({
        status: 'success',
        data: {
          supported: true,
          values: {
            performanceFeeBps: 2000n,
            performanceFeeRecipient: DEMO_FEE_RECIPIENT,
            protocolFeeShareBps: 1000n,
            revenuePool: DEMO_REVENUE_POOL,
            feeHighWaterMark: 1_000_000n * 10n ** 6n,
          },
        },
      });
      return () => { cancelled = true; };
    }
    setState(prev => (prev.status === 'idle' ? { ...prev, status: 'loading' } : prev));
    loadFeeOverview({ sdk, vault: vaultAddress })
      .then(result => { if (!cancelled) setState({ data: result.data, status: result.status }); })
      .catch(() => { if (!cancelled) setState({ data: null, status: 'error' }); });
    return () => { cancelled = true; };
  }, [sdk, demo, vaultAddress]);
  return state;
}

function FeeOverviewCard({ t, data }) {
  const values = data?.values ?? {};
  const bps = value => (value === null || value === undefined ? '—' : `${Number(value) / 100}%`);
  const usdt = value => (value === null || value === undefined ? '—' : formatUnits(value, 6));
  const addr = value => (value ? `${String(value).slice(0, 6)}…${String(value).slice(-4)}` : '—');
  const item = (label, value, title) => (
    <div className="bp-stat" title={title ?? value}>
      <div className="bp-stat__label">{label}</div>
      <div className="bp-stat__value bp-stat__value--small">{value}</div>
    </div>
  );
  return (
    <div className="bp-card bp-card-pad">
      <div className="bp-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="bp-card-title">{t.bp.vaultDetail.feeOverview}</h4>
      </div>
      <div className="bp-stats">
        {item(t.bp.vaultDetail.feePerfBps, bps(values.performanceFeeBps))}
        {item(t.bp.vaultDetail.feeHighWater, usdt(values.feeHighWaterMark))}
        {item(t.bp.vaultDetail.feeProtocolShare, bps(values.protocolFeeShareBps))}
        {item(t.bp.vaultDetail.feeRecipient, addr(values.performanceFeeRecipient), values.performanceFeeRecipient ?? undefined)}
        {item(t.bp.vaultDetail.feeRevenuePool, addr(values.revenuePool), values.revenuePool ?? undefined)}
      </div>
    </div>
  );
}

function VaultDetailInner() {
  const { t } = useI18n();
  const { vaultAddress, role: roleParam } = useParams();
  const { markers, status } = useVaultRoleMarkers(vaultAddress);
  const fee = useFeeOverview(vaultAddress);
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
          {fee.status === 'success' && fee.data?.supported !== false && (
            <FeeOverviewCard t={t} data={fee.data} />
          )}
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
