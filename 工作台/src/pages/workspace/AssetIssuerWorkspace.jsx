import { useEffect, useMemo } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import ManagementEntry from '../../components/access/ManagementEntry';
import RoleGate from '../../components/access/RoleGate';
import { useAccess } from '../../contexts/AccessContext';
import { ROLES, assetIssuerWorkspacePath } from '../../config/roles';
import { ROUTES } from '../../config/routes';

function Inner() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const {
    loading, issuerAssets, selectedAsset, setSelectedAsset, setSelectedRole,
  } = useAccess();

  const asset = useMemo(() => {
    if (selectedAsset && (selectedAsset.id === assetId || selectedAsset.address === assetId)) {
      return selectedAsset;
    }
    return issuerAssets.find(a => a.id === assetId || a.address === assetId) || null;
  }, [selectedAsset, issuerAssets, assetId]);

  useEffect(() => {
    if (asset && asset !== selectedAsset) setSelectedAsset(asset);
    setSelectedRole(ROLES.ASSET_ISSUER);
  }, [asset, selectedAsset, setSelectedAsset, setSelectedRole]);

  useEffect(() => {
    if (!loading && !asset) navigate(ROUTES.assetsIssueManage, { replace: true });
  }, [loading, asset, navigate]);

  if (!asset) return null;

  return (
    <RoleGate
      roles={[ROLES.ASSET_ISSUER]}
      selectedRole={ROLES.ASSET_ISSUER}
      requiredRole={ROLES.ASSET_ISSUER}
      loading={loading}
    >
      <Navigate to={assetIssuerWorkspacePath(asset.id)} replace />
    </RoleGate>
  );
}

export default function AssetIssuerWorkspace() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
