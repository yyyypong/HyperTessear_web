import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';

/**
 * Left column of the dual-column role workspace: business links plus the
 * per-object role list. Only the roles the connected wallet actually holds
 * on this object are rendered by callers, so no ownership markers are shown.
 */
export function RoleSidebar({ businessLinks = [], roleLabel, roles = [], note }) {
  const { t } = useI18n();
  return (
    <aside className="bp-sidebar">
      <div>
        <div className="bp-side-label">{t.bp.sidebar.business}</div>
        <div className="bp-side-links">
          {businessLinks.map(link => (
            <Link key={link.to} className="bp-side-link" to={link.to}>{link.label}</Link>
          ))}
        </div>
      </div>
      <div>
        <div className="bp-side-label">{roleLabel}</div>
        <div className="bp-side-links">
          {roles.length === 0 && <div className="bp-side-note">{t.bp.sidebar.noRoles}</div>}
          {roles.map(role => (
            <Link
              key={role.id}
              to={role.to}
              className={`bp-side-link${role.active ? ' bp-side-link--active' : ''}`}
            >
              {role.label}
              <small>{role.contract}</small>
            </Link>
          ))}
        </div>
      </div>
      {note && <div className="bp-side-note">{note}</div>}
    </aside>
  );
}
