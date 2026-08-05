import { useEffect, useMemo } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import ManagementEntry from '../../components/access/ManagementEntry';
import RoleGate from '../../components/access/RoleGate';
import { useAccess } from '../../contexts/AccessContext';
import { WRAPPED_ROLES, wrappedWorkspacePath } from '../../config/roles';
import { ROUTES } from '../../config/routes';

function Inner() {
  const { assetId, role } = useParams();
  const navigate = useNavigate();
  const {
    loading, wrappedAssets, selectedWrappedAsset, setSelectedWrappedAsset, setSelectedRole,
  } = useAccess();

  const wrapped = useMemo(() => {
    if (selectedWrappedAsset
      && (selectedWrappedAsset.id === assetId || selectedWrappedAsset.address === assetId)) {
      return selectedWrappedAsset;
    }
    return wrappedAssets.find(w => w.id === assetId || w.address === assetId) || null;
  }, [selectedWrappedAsset, wrappedAssets, assetId]);

  useEffect(() => {
    if (wrapped && wrapped !== selectedWrappedAsset) setSelectedWrappedAsset(wrapped);
    if (role) setSelectedRole(role);
  }, [wrapped, selectedWrappedAsset, role, setSelectedWrappedAsset, setSelectedRole]);

  useEffect(() => {
    if (!loading && !wrapped) navigate(ROUTES.assetsWrapManage, { replace: true });
  }, [loading, wrapped, navigate]);

  useEffect(() => {
    if (role && !WRAPPED_ROLES.includes(role)) {
      navigate(ROUTES.assetsWrapManage, { replace: true });
    }
  }, [role, navigate]);

  if (!wrapped || !WRAPPED_ROLES.includes(role)) return null;

  return (
    <RoleGate
      roles={wrapped.roles || []}
      selectedRole={role}
      requiredRole={role}
      loading={loading}
    >
      <Navigate to={wrappedWorkspacePath(wrapped.id, role)} replace />
    </RoleGate>
  );
}

export default function WrappedWorkspace() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
