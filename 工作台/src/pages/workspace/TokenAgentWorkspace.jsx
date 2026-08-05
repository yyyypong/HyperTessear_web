import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import ManagementEntry from '../../components/access/ManagementEntry';
import RoleGate from '../../components/access/RoleGate';
import { useAccess } from '../../contexts/AccessContext';
import { ROLES, tokenAgentWorkspacePath } from '../../config/roles';
import { ROUTES } from '../../config/routes';

/**
 * Token Agent approval workspace.
 * No issued Asset selection — permission is network-scoped.
 */
function Inner() {
  const navigate = useNavigate();
  const { loading, isTokenAgentOnSelected, setSelectedRole } = useAccess();

  useEffect(() => {
    setSelectedRole(ROLES.TOKEN_AGENT);
  }, [setSelectedRole]);

  useEffect(() => {
    if (!loading && !isTokenAgentOnSelected) {
      navigate(ROUTES.assetsIssue, { replace: true });
    }
  }, [loading, isTokenAgentOnSelected, navigate]);

  const roles = isTokenAgentOnSelected ? [ROLES.TOKEN_AGENT] : [];

  return (
    <RoleGate
      roles={roles}
      selectedRole={ROLES.TOKEN_AGENT}
      requiredRole={ROLES.TOKEN_AGENT}
      loading={loading}
    >
      <Navigate to={tokenAgentWorkspacePath()} replace />
    </RoleGate>
  );
}

export default function TokenAgentWorkspace() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
