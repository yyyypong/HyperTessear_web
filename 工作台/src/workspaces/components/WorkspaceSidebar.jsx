import { forwardRef, useImperativeHandle, useRef } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ROLE_DEFINITIONS } from '../config/roleDefinitions';
import { getDeployment } from '../config/deployments';

/* When the current route carries no object, fall back to the deployed
   manifest objects so every role link stays navigable. */
const FALLBACK_DEPLOYMENT = getDeployment(97);
const FALLBACK = Object.freeze({
  vault: FALLBACK_DEPLOYMENT?.addresses.cashVault ?? '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea',
  assetId: '1',
  adapter: FALLBACK_DEPLOYMENT?.addresses.cashAdapter ?? '0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4',
});

function routeFor(role, params) {
  if (role.scope === 'vault') return role.path.replace(':vault', params.vault || FALLBACK.vault);
  if (role.scope === 'asset' || role.scope === 'wrapper') return role.path.replace(':assetId', params.assetId ?? FALLBACK.assetId);
  if (role.scope === 'adapter') return role.path.replace(':adapter', params.adapter || FALLBACK.adapter);
  return role.path;
}

const WorkspaceSidebar = forwardRef(function WorkspaceSidebar({ mobile, open, onClose, onNavigate }, ref) {
  const { t } = useI18n();
  const params = useParams();
  const closeRef = useRef(null);
  const closedMobileDrawer = mobile && !open;

  useImperativeHandle(ref, () => ({
    focusDrawer: () => closeRef.current?.focus(),
  }));

  return (
    <aside
      id="workspace-sidebar"
      className={`ws-sidebar${open ? ' ws-sidebar--open' : ''}`}
      aria-hidden={closedMobileDrawer || undefined}
      inert={closedMobileDrawer || undefined}
    >
      <div className="ws-sidebar__head">
        <NavLink to="/workspaces" className="ws-sidebar__brand" onClick={onNavigate}>Workspaces</NavLink>
        <button ref={closeRef} type="button" className="ws-sidebar__close" aria-label="Close workspace navigation" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <nav tabIndex={-1} aria-label="Workspace roles" className="ws-sidebar__nav">
        <NavLink to="/workspaces" end onClick={onNavigate} className={({ isActive }) => `ws-sidebar__link${isActive ? ' is-active' : ''}`}>
          Overview
        </NavLink>
        {Object.values(ROLE_DEFINITIONS).map((role) => {
          const destination = routeFor(role, params);
          return (
            <NavLink
              key={role.id}
              to={destination}
              onClick={onNavigate}
              className={({ isActive }) => `ws-sidebar__link${isActive ? ' is-active' : ''}`}
            >
              {t.workspaces.roles[role.id].title}
            </NavLink>
          );
        })}
        <NavLink to="/workspaces/activity" onClick={onNavigate} className={({ isActive }) => `ws-sidebar__link${isActive ? ' is-active' : ''}`}>
          Activity
        </NavLink>
        <NavLink to="/workspaces/public" onClick={onNavigate} className={({ isActive }) => `ws-sidebar__link${isActive ? ' is-active' : ''}`}>
          Public workspace
        </NavLink>
      </nav>
    </aside>
  );
});

export default WorkspaceSidebar;
