import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ROUTES } from '../../config/routes';
import { assetIssuerWorkspacePath, tokenAgentWorkspacePath } from '../../config/roles';

/**
 * Manage issued asset tokens — multi-role dispatcher.
 *
 * Groups the object lanes by wallet role on the selected network:
 *   - Asset Issuer: assets the wallet can mint/burn (ISSUER_ROLE or owner)
 *   - Token Agent: issuance approval workspace (role-based)
 *   - Proof Publisher: reserve-proof publishing (DATA_PROVIDER_ROLE)
 * Each row routes into the corresponding full operational workspace.
 */
function ManageIssuedInner() {
  const { t } = useI18n();
  const { loading, issuerAssets, isTokenAgentOnSelected } = useAccess();

  const objectCards = [
    {
      title: t.assets.manageIssuedGroupIssuer,
      count: issuerAssets.length,
      emptyTitle: t.assets.hubEmptyObjects,
      emptyBody: t.assets.manageIssuedEmpty,
      action: { label: t.assets.manageIssuedGoNew, to: ROUTES.assetsIssueNew },
      rows: issuerAssets.map(asset => ({
        key: asset.id,
        label: asset.name,
        meta: asset.symbol ? `${asset.symbol} · ${(asset.address || '').slice(0, 12)}…` : (asset.address || ''),
        to: assetIssuerWorkspacePath(asset.id),
      })),
    },
  ];

  const entryCards = [
    {
      title: t.assets.manageIssuedGroupAgent,
      visible: isTokenAgentOnSelected,
      rows: [
        {
          key: 'token-agent',
          label: t.assets.issueNewNextBody,
          meta: t.assets.manageIssuedPageLede,
          to: tokenAgentWorkspacePath(),
        },
      ],
    },
    {
      title: t.assets.manageIssuedGroupProof,
      visible: false,
      rows: [],
    },
  ];

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.issueEyebrow}</div>
        <h1 className="phead__title">{t.assets.manageIssued}</h1>
        <p className="section__lede">{t.assets.manageIssuedPageLede}</p>
      </div>

      <div className="hub-grid">
        {objectCards.map(card => (
          <section key={card.title} className="hub-card">
            <div className="hub-card__head">
              <h3 className="hub-card__title">{card.title}</h3>
              <span className="hub-card__count">{t.assets.hubObjectCount.replace('{count}', loading ? '…' : card.count)}</span>
            </div>
            {!loading && card.rows.length === 0 && (
              <div className="hub-empty">
                <h4>{card.emptyTitle}</h4>
                <p>{card.emptyBody}</p>
                {card.action && (
                  <Link to={card.action.to} className="btn btn--ghost btn--sm">{card.action.label}</Link>
                )}
              </div>
            )}
            {card.rows.map(row => (
              <Link key={row.key} to={row.to} className="hub-row">
                <span className="hub-row__main">
                  <span className="hub-row__name">{row.label}</span>
                  {row.meta && <span className="hub-row__meta">{row.meta}</span>}
                </span>
                <span className="hub-row__badges"><span className="hub-badge">{t.assets.hubEnter}</span></span>
              </Link>
            ))}
          </section>
        ))}

        {entryCards.map(card => (
          <section key={card.title} className="hub-card">
            <div className="hub-card__head">
              <h3 className="hub-card__title">{card.title}</h3>
              <span className="hub-card__count">{t.assets.hubRoleDynamic}</span>
            </div>
            {!loading && !card.visible && card.rows.length === 0 && (
              <div className="hub-empty">
                <h4>{t.assets.hubEmptyRoles}</h4>
                <p>{t.assets.hubEmptyRolesBody}</p>
              </div>
            )}
            {card.rows.map(row => (
              <Link key={row.key} to={row.to} className="hub-row">
                <span className="hub-row__main">
                  <span className="hub-row__name">{row.label}</span>
                  {row.meta && <span className="hub-row__meta">{row.meta}</span>}
                </span>
                <span className="hub-row__badges"><span className="hub-badge">{t.assets.hubEnter}</span></span>
              </Link>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function ManageIssuedAssets() {
  return (
    <ManagementEntry>
      <ManageIssuedInner />
    </ManagementEntry>
  );
}
