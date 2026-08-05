import { useEffect, useMemo } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import ManagementEntry from '../../components/access/ManagementEntry';
import RoleGate from '../../components/access/RoleGate';
import { useAccess } from '../../contexts/AccessContext';
import { ROLES, navProviderWorkspacePath } from '../../config/roles';
import { ROUTES } from '../../config/routes';

function Inner() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const {
    loading, navAssets, selectedAsset, setSelectedAsset, setSelectedRole,
  } = useAccess();

  const asset = useMemo(() => {
    if (selectedAsset && (selectedAsset.id === assetId || selectedAsset.address === assetId)) {
      return selectedAsset;
    }
    return navAssets.find(a => a.id === assetId || a.address === assetId) || null;
  }, [selectedAsset, navAssets, assetId]);

  useEffect(() => {
    if (asset && asset !== selectedAsset) setSelectedAsset(asset);
    setSelectedRole(ROLES.NAV_PROVIDER);
  }, [asset, selectedAsset, setSelectedAsset, setSelectedRole]);

  useEffect(() => {
    if (!loading && !asset) navigate(ROUTES.assetsIssueOracle, { replace: true });
  }, [loading, asset, navigate]);

  if (!asset) return null;

  return (
    <RoleGate
      roles={[ROLES.NAV_PROVIDER]}
      selectedRole={ROLES.NAV_PROVIDER}
      requiredRole={ROLES.NAV_PROVIDER}
      loading={loading}
    >
      <Navigate to={navProviderWorkspacePath(asset.id)} replace />
    </RoleGate>
  );
}

export default function NavProviderWorkspace() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
