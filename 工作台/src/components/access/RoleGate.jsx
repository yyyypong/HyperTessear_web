import { useI18n } from '../../i18n';
import { ROLE_LABEL_KEYS } from '../../config/roles';

function roleLabel(t, role) {
  const key = ROLE_LABEL_KEYS[role];
  if (!key) return role;
  const [, leaf] = key.split('.');
  return t.roles?.[leaf] || role;
}

/**
 * Ensures the wallet holds the target role on the selected object.
 * When multiple roles exist and none is chosen, renders a role picker.
 */
export default function RoleGate({
  children,
  roles = [],
  selectedRole,
  onSelectRole,
  requiredRole = null,
  loading = false,
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="gate">
        <p className="gate__body">{t.common.loading}</p>
      </div>
    );
  }

  if (!roles.length) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.roleEyebrow}</div>
        <h2 className="gate__title">{t.access.noRoleTitle}</h2>
        <p className="gate__body">{t.access.noRoleBody}</p>
      </div>
    );
  }

  if (requiredRole && !roles.includes(requiredRole)) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.roleEyebrow}</div>
        <h2 className="gate__title">{t.access.unauthorizedTitle}</h2>
        <p className="gate__body">
          {t.access.unauthorizedBody.replace('{role}', roleLabel(t, requiredRole))}
        </p>
      </div>
    );
  }

  const active = requiredRole || selectedRole || (roles.length === 1 ? roles[0] : null);

  if (!active && roles.length > 1) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.roleEyebrow}</div>
        <h2 className="gate__title">{t.access.selectRoleTitle}</h2>
        <p className="gate__body">{t.access.selectRoleBody}</p>
        <div className="objlist">
          {roles.map(role => (
            <button
              key={role}
              type="button"
              className="objlist__item"
              onClick={() => onSelectRole?.(role)}
            >
              <span className="objlist__name">{roleLabel(t, role)}</span>
              <span className="objlist__meta">{role}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (active && !roles.includes(active)) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.roleEyebrow}</div>
        <h2 className="gate__title">{t.access.unauthorizedTitle}</h2>
        <p className="gate__body">
          {t.access.unauthorizedBody.replace('{role}', roleLabel(t, active))}
        </p>
      </div>
    );
  }

  return children;
}

export { roleLabel };
