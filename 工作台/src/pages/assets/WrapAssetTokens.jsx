import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ROUTES } from '../../config/routes';
import { ROLES, wrappedWorkspacePath } from '../../config/roles';

/**
 * Wrapped-asset business hub — two lanes: wrap/unwrap (public operation) and
 * manage wrapped assets (Wrapper Controller / PSM Authorized Signer workspaces).
 */
function WrapHubInner() {
  const { t } = useI18n();
  const { loading, wrappedAssets } = useAccess();

  const controllers = wrappedAssets.filter(
    asset => (asset.roles || []).includes(ROLES.WRAPPER_CONTROLLER),
  );
  const signers = wrappedAssets.filter(
    asset => (asset.roles || []).includes(ROLES.PSM_AUTHORIZED_SIGNER),
  );
  const roleCount = (controllers.length ? 1 : 0) + (signers.length ? 1 : 0);

  const entryRoles = [
    controllers.length > 0 && {
      label: t.assets.wrapGroupController,
      summary: t.assets.manageWrappedBody,
      to: ROUTES.assetsWrapManage,
    },
    signers.length > 0 && {
      label: t.assets.wrapGroupSigner,
      summary: t.assets.manageWrappedBody,
      to: ROUTES.assetsWrapManage,
    },
  ].filter(Boolean);

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.wrapEyebrow}</div>
        <h1 className="phead__title">{t.assets.wrapTitle}</h1>
        <p className="section__lede">{t.assets.wrapLede}</p>
      </div>

      <div className="hub-stats">
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatRoles}</div>
          <div className="hub-stat__value">{loading ? '…' : roleCount}</div>
          <div className="hub-stat__foot">{t.assets.hubStatDomain}</div>
        </div>
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatObjects}</div>
          <div className="hub-stat__value">{loading ? '…' : wrappedAssets.length}</div>
          <div className="hub-stat__foot">{t.access.network}</div>
        </div>
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatPending}</div>
          <div className="hub-stat__value">0</div>
          <div className="hub-stat__foot">{t.assets.hubStatDomain}</div>
        </div>
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatRecent}</div>
          <div className="hub-stat__value">0</div>
          <div className="hub-stat__foot">{t.assets.hubStatDomain}</div>
        </div>
      </div>

      <div className="entrygrid">
        <Link to={ROUTES.assetsWrapWrap} className="entrycard">
          <div className="entrycard__title">{t.assets.wrapOrUnwrap}</div>
          <div className="entrycard__body">{t.assets.wrapWrapLede}</div>
          <span className="hub-badge hub-badge--accent">{t.assets.hubOpen}</span>
        </Link>
        <Link to={ROUTES.assetsWrapManage} className="entrycard">
          <div className="entrycard__title">{t.assets.manageWrapped}</div>
          <div className="entrycard__body">{t.assets.manageWrappedBody}</div>
          <span className="hub-badge">{t.assets.hubOpen}</span>
        </Link>
      </div>

      <div className="hub-grid">
        <section className="hub-card" aria-label={t.assets.hubMyWrapped}>
          <div className="hub-card__head">
            <h3 className="hub-card__title">{t.assets.hubMyWrapped}</h3>
            <span className="hub-card__count">{t.assets.hubObjectCount.replace('{count}', wrappedAssets.length)}</span>
          </div>
          {!loading && wrappedAssets.length === 0 && (
            <div className="hub-empty">
              <h4>{t.assets.hubEmptyObjects}</h4>
              <p>{t.assets.hubEmptyObjectsBody}</p>
            </div>
          )}
          {wrappedAssets.map(asset => (
            <Link key={asset.id} to={wrappedWorkspacePath(asset.id, (asset.roles || [])[0])} className="hub-row">
              <span className="hub-row__main">
                <span className="hub-row__name">{asset.name}</span>
                <span className="hub-row__meta">
                  {asset.symbol ? `${asset.symbol} · ` : ''}{(asset.address || '').slice(0, 12)}…
                </span>
              </span>
              <span className="hub-row__badges">
                {(asset.roles || []).map(role => (
                  <span key={role} className="hub-badge">
                    {role === ROLES.WRAPPER_CONTROLLER ? t.assets.wrapGroupController : t.assets.wrapGroupSigner}
                  </span>
                ))}
              </span>
            </Link>
          ))}
        </section>

        <section className="hub-card" aria-label={t.assets.hubRoleEntries}>
          <div className="hub-card__head">
            <h3 className="hub-card__title">{t.assets.hubRoleEntries}</h3>
            <span className="hub-card__count">{t.assets.hubRoleDynamic}</span>
          </div>
          {!loading && entryRoles.length === 0 && (
            <div className="hub-empty">
              <h4>{t.assets.hubEmptyRoles}</h4>
              <p>{t.assets.hubEmptyRolesBody}</p>
            </div>
          )}
          {entryRoles.map(entry => (
            <Link key={entry.label} to={entry.to} className="hub-row">
              <span className="hub-row__main">
                <span className="hub-row__name">{entry.label}</span>
                <span className="hub-row__meta">{entry.summary}</span>
              </span>
              <span className="hub-row__badges"><span className="hub-badge">{t.assets.hubEnter}</span></span>
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}

export default function WrapAssetTokens() {
  return (
    <ManagementEntry>
      <WrapHubInner />
    </ManagementEntry>
  );
}
