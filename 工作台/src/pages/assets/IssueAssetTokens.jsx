import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import ManagementEntry from '../../components/access/ManagementEntry';
import { ROUTES } from '../../config/routes';
import {
  assetIssuerWorkspacePath,
  navProviderWorkspacePath,
  tokenAgentWorkspacePath,
} from '../../config/roles';

/**
 * Asset issuance business hub — dispatches by wallet role into the three
 * issuance lanes (issue new / manage issued / oracle data), mirroring the
 * approved hub layout: stats + entry cards + my-objects + role entries.
 */
function IssueHubInner() {
  const { t } = useI18n();
  const {
    loading,
    issuerAssets,
    navAssets,
    isTokenAgentOnSelected,
  } = useAccess();

  const objects = [
    ...issuerAssets.map(asset => ({ ...asset, kind: 'issuer' })),
    ...navAssets.map(asset => ({ ...asset, kind: 'nav' })),
  ];
  const roleCount = (issuerAssets.length ? 1 : 0)
    + (navAssets.length ? 1 : 0)
    + (isTokenAgentOnSelected ? 1 : 0);
  const pending = isTokenAgentOnSelected ? 1 : 0;

  const entryRoles = [
    issuerAssets.length > 0 && {
      label: t.assets.manageIssuedGroupIssuer,
      summary: t.assets.manageIssuedBody,
      to: ROUTES.assetsIssueManage,
    },
    navAssets.length > 0 && {
      label: t.assets.oracleGroupSigner,
      summary: t.assets.oracleDataBody,
      to: ROUTES.assetsIssueOracle,
    },
    isTokenAgentOnSelected && {
      label: t.assets.manageIssuedGroupAgent,
      summary: t.assets.issuanceApprovalBody,
      to: tokenAgentWorkspacePath(),
    },
  ].filter(Boolean);

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.issueEyebrow}</div>
        <h1 className="phead__title">{t.assets.issueTitle}</h1>
        <p className="section__lede">{t.assets.issueLede}</p>
      </div>

      <div className="hub-steps" aria-label={t.assets.issueNewSteps}>
        <span className="hub-step hub-step--done"><span className="hub-step__num">1</span>{t.assets.issueStep1}</span>
        <span className="hub-step hub-step--done"><span className="hub-step__num">2</span>{t.assets.issueStep2}</span>
        <span className="hub-step hub-step--done"><span className="hub-step__num">3</span>{t.assets.issueStep3}</span>
        <span className="hub-step hub-step--done"><span className="hub-step__num">4</span>{t.assets.issueStep4}</span>
        <span className="hub-step hub-step--done"><span className="hub-step__num">5</span>{t.assets.issueStep5}</span>
      </div>

      <div className="hub-stats">
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatRoles}</div>
          <div className="hub-stat__value">{loading ? '…' : roleCount}</div>
          <div className="hub-stat__foot">{t.assets.hubStatDomain}</div>
        </div>
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatObjects}</div>
          <div className="hub-stat__value">{loading ? '…' : objects.length}</div>
          <div className="hub-stat__foot">{t.access.network}</div>
        </div>
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatPending}</div>
          <div className="hub-stat__value">{loading ? '…' : pending}</div>
          <div className="hub-stat__foot">{t.assets.hubStatDomain}</div>
        </div>
        <div className="hub-stat">
          <div className="hub-stat__label">{t.assets.hubStatRecent}</div>
          <div className="hub-stat__value">0</div>
          <div className="hub-stat__foot">{t.assets.hubStatDomain}</div>
        </div>
      </div>

      <div className="entrygrid">
        <Link to={ROUTES.assetsIssueNew} className="entrycard">
          <div className="entrycard__title">{t.assets.issueNew}</div>
          <div className="entrycard__body">{t.assets.issueNewBody}</div>
          <span className="hub-badge hub-badge--accent">{t.assets.hubOpen}</span>
        </Link>
        <Link to={ROUTES.assetsIssueManage} className="entrycard">
          <div className="entrycard__title">{t.assets.manageIssued}</div>
          <div className="entrycard__body">{t.assets.manageIssuedBody}</div>
          <span className="hub-badge">{t.assets.hubOpen}</span>
        </Link>
        <Link to={ROUTES.assetsIssueOracle} className="entrycard">
          <div className="entrycard__title">{t.assets.oracleData}</div>
          <div className="entrycard__body">{t.assets.oracleDataBody}</div>
          <span className="hub-badge">{t.assets.hubOpen}</span>
        </Link>
        {!loading && isTokenAgentOnSelected && (
          <Link to={tokenAgentWorkspacePath()} className="entrycard entrycard--accent">
            <div className="entrycard__title">{t.assets.issuanceApproval}</div>
            <div className="entrycard__body">{t.assets.issuanceApprovalBody}</div>
            <span className="hub-badge hub-badge--accent">{t.assets.hubEnter}</span>
          </Link>
        )}
      </div>

      <div className="hub-grid">
        <section className="hub-card" aria-label={t.assets.hubMyObjects}>
          <div className="hub-card__head">
            <h3 className="hub-card__title">{t.assets.hubMyObjects}</h3>
            <span className="hub-card__count">{t.assets.hubObjectCount.replace('{count}', objects.length)}</span>
          </div>
          {!loading && objects.length === 0 && (
            <div className="hub-empty">
              <h4>{t.assets.hubEmptyObjects}</h4>
              <p>{t.assets.hubEmptyObjectsBody}</p>
              <Link to={ROUTES.assetsIssueNew} className="btn">{t.assets.issueNew}</Link>
            </div>
          )}
          {objects.map(object => {
            const to = object.kind === 'issuer'
              ? assetIssuerWorkspacePath(object.id)
              : navProviderWorkspacePath(object.id);
            return (
              <Link key={`${object.kind}-${object.id}`} to={to} className="hub-row">
                <span className="hub-row__main">
                  <span className="hub-row__name">{object.name}</span>
                  <span className="hub-row__meta">
                    {object.symbol ? `${object.symbol} · ` : ''}{(object.address || '').slice(0, 12)}…
                  </span>
                </span>
                <span className="hub-row__badges">
                  <span className="hub-badge">
                    {object.kind === 'issuer' ? t.assets.manageIssuedGroupIssuer : t.assets.oracleGroupSigner}
                  </span>
                </span>
              </Link>
            );
          })}
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

export default function IssueAssetTokens() {
  return (
    <ManagementEntry>
      <IssueHubInner />
    </ManagementEntry>
  );
}
