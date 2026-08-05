import { useEffect, useMemo } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import ManagementEntry from '../../components/access/ManagementEntry';
import RoleGate from '../../components/access/RoleGate';
import { useAccess } from '../../contexts/AccessContext';
import { VAULT_ROLES, vaultWorkspacePath } from '../../config/roles';
import { ROUTES } from '../../config/routes';

function Inner() {
  const { vaultAddress, role } = useParams();
  const navigate = useNavigate();
  const {
    loading, vaults, selectedVault, setSelectedVault, setSelectedRole,
  } = useAccess();

  const vault = useMemo(() => {
    if (selectedVault
      && (selectedVault.address.toLowerCase() === vaultAddress?.toLowerCase()
        || selectedVault.id === vaultAddress)) {
      return selectedVault;
    }
    return vaults.find(
      v => v.address.toLowerCase() === vaultAddress?.toLowerCase()
        || v.id === vaultAddress,
    ) || null;
  }, [selectedVault, vaults, vaultAddress]);

  useEffect(() => {
    if (vault && vault !== selectedVault) setSelectedVault(vault);
    if (role) setSelectedRole(role);
  }, [vault, selectedVault, role, setSelectedVault, setSelectedRole]);

  useEffect(() => {
    if (!loading && !vault) {
      navigate(ROUTES.vaultsManage, { replace: true });
    }
  }, [loading, vault, navigate]);

  useEffect(() => {
    if (role && !VAULT_ROLES.includes(role)) {
      navigate(ROUTES.vaultsManage, { replace: true });
    }
  }, [role, navigate]);

  if (!vault || !VAULT_ROLES.includes(role)) return null;

  return (
    <RoleGate
      roles={vault.roles || []}
      selectedRole={role}
      requiredRole={role}
      loading={loading}
    >
      <Navigate to={vaultWorkspacePath(vault.address, role)} replace />
    </RoleGate>
  );
}

export default function VaultWorkspace() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
