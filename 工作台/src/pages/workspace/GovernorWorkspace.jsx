import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import ManagementEntry from '../../components/access/ManagementEntry';
import RoleGate from '../../components/access/RoleGate';
import { useAccess } from '../../contexts/AccessContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { ROLES, governorWorkspacePath } from '../../config/roles';
import { ROUTES } from '../../config/routes';

/**
 * Governor workspace — protocol layer on a network.
 * No Vault / Asset / Wrapped Asset selection.
 * If permission exists on multiple networks, NetworkGate already required selection.
 */
function Inner() {
  const navigate = useNavigate();
  const {
    loading, governorNetworks, isGovernorOnSelected, setSelectedRole,
  } = useAccess();
  const { selectedNetworkId, setSelectedNetworkId } = useNetwork();

  useEffect(() => {
    setSelectedRole(ROLES.GOVERNOR);
  }, [setSelectedRole]);

  // If governor on exactly one network and current selection differs, align.
  useEffect(() => {
    if (governorNetworks.length === 1 && selectedNetworkId !== governorNetworks[0]) {
      setSelectedNetworkId(governorNetworks[0]);
    }
  }, [governorNetworks, selectedNetworkId, setSelectedNetworkId]);

  useEffect(() => {
    if (!loading && governorNetworks.length === 0) {
      navigate(ROUTES.home, { replace: true });
    }
  }, [loading, governorNetworks, navigate]);

  // Multi-network governor without permission on selected network — prompt via RoleGate empty / unauthorized.
  const roles = isGovernorOnSelected ? [ROLES.GOVERNOR] : [];

  return (
    <RoleGate
      roles={roles}
      selectedRole={ROLES.GOVERNOR}
      requiredRole={ROLES.GOVERNOR}
      loading={loading}
    >
      <Navigate to={governorWorkspacePath()} replace />
    </RoleGate>
  );
}

export default function GovernorWorkspace() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
