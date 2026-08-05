import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import ManagementEntry from '../../components/access/ManagementEntry';
import ObjectGate from '../../components/access/ObjectGate';
import RoleGate from '../../components/access/RoleGate';
import { wrappedWorkspacePath } from '../../config/roles';

function Inner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    loading,
    wrappedAssets,
    selectedWrappedAsset,
    setSelectedWrappedAsset,
    selectedRole,
    setSelectedRole,
  } = useAccess();

  const roles = selectedWrappedAsset?.roles || [];

  useEffect(() => {
    if (!selectedWrappedAsset) return;
    if (roles.length === 1) {
      setSelectedRole(roles[0]);
      navigate(wrappedWorkspacePath(selectedWrappedAsset.id, roles[0]), { replace: true });
    } else if (roles.length > 1 && selectedRole) {
      navigate(wrappedWorkspacePath(selectedWrappedAsset.id, selectedRole), { replace: true });
    }
  }, [selectedWrappedAsset, roles, selectedRole, navigate, setSelectedRole]);

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.wrapEyebrow}</div>
        <h1 className="phead__title">{t.assets.manageWrapped}</h1>
        <p className="section__lede">{t.assets.manageWrappedPageLede}</p>
      </div>
      <ObjectGate
        objectType="wrapped"
        selected={selectedWrappedAsset}
        options={wrappedAssets}
        onSelect={(obj) => {
          setSelectedRole(null);
          setSelectedWrappedAsset(obj);
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

export default function ManageWrappedAssets() {
  return (
    <ManagementEntry>
      <Inner />
    </ManagementEntry>
  );
}
