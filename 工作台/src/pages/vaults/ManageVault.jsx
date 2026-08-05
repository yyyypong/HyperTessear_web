import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import ManagementEntry from '../../components/access/ManagementEntry';
import ObjectGate from '../../components/access/ObjectGate';
import RoleGate from '../../components/access/RoleGate';
import { vaultWorkspacePath } from '../../config/roles';

function Inner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    loading,
    vaults,
    selectedVault,
    setSelectedVault,
    selectedRole,
    setSelectedRole,
  } = useAccess();

  const roles = selectedVault?.roles || [];

  useEffect(() => {
    if (!selectedVault) return;
    if (roles.length === 1) {
      setSelectedRole(roles[0]);
      navigate(vaultWorkspacePath(selectedVault.address, roles[0]), { replace: true });
    } else if (roles.length > 1 && selectedRole) {
      navigate(vaultWorkspacePath(selectedVault.address, selectedRole), { replace: true });
    }
  }, [selectedVault, roles, selectedRole, navigate, setSelectedRole]);

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.vaults.eyebrow}</div>
        <h1 className="phead__title">{t.vaults.manageTitle}</h1>
        <p className="section__lede">{t.vaults.manageLede}</p>
      </div>
      <ObjectGate
        objectType="vault"
        selected={selectedVault}
        options={vaults}
        onSelect={(v) => {
          setSelectedRole(null);
          setSelectedVault(v);
        }}
        loading={loading}
      >
        <RoleGate
          roles={roles}
          selectedRole={selectedRole}
          onSelectRole={setSelectedRole}
          loading={loading}
        >
          <p className="gate__body">{t.common.loading}</p>
        </RoleGate>
      </ObjectGate>
    </div>
  );
}

export default function ManageVault() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
