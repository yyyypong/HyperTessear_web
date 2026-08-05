import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAccess } from '../../contexts/AccessContext';
import ManagementEntry from '../../components/access/ManagementEntry';
import { navProviderWorkspacePath } from '../../config/roles';

/**
 * Oracle data — multi-role dispatcher.
 *
 * Two lanes complete one oracle update:
 *   - NAV Signer: generates the signed NAV envelope offchain per vault
 *   - Relayer: imports the envelope and submits it onchain (permissionless relay)
 * NAV Signer rows are the wallet's nav-scoped assets; the Relayer entry is
 * always available because submission itself carries no role requirement.
 */
function OracleInner() {
  const { t } = useI18n();
  const { loading, navAssets } = useAccess();

  const navRows = navAssets.map(asset => ({
    key: asset.id,
    label: asset.name,
    meta: asset.symbol ? `${asset.symbol} · ${(asset.address || '').slice(0, 12)}…` : (asset.address || ''),
    to: navProviderWorkspacePath(asset.id),
  }));

  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.assets.issueEyebrow}</div>
        <h1 className="phead__title">{t.assets.oracleData}</h1>
        <p className="section__lede">{t.assets.oraclePageLede}</p>
      </div>

      <div className="hub-grid">
        <section className="hub-card">
          <div className="hub-card__head">
            <h3 className="hub-card__title">{t.assets.oracleGroupSigner}</h3>
            <span className="hub-card__count">{t.assets.hubObjectCount.replace('{count}', loading ? '…' : navRows.length)}</span>
          </div>
          {!loading && navRows.length === 0 && (
            <div className="hub-empty">
              <h4>{t.assets.hubEmptyObjects}</h4>
              <p>{t.assets.oracleEmpty}</p>
            </div>
          )}
          {navRows.map(row => (
            <Link key={row.key} to={row.to} className="hub-row">
              <span className="hub-row__main">
                <span className="hub-row__name">{row.label}</span>
                {row.meta && <span className="hub-row__meta">{row.meta}</span>}
              </span>
              <span className="hub-row__badges"><span className="hub-badge">{t.assets.hubEnter}</span></span>
            </Link>
          ))}
        </section>

        <section className="hub-card">
          <div className="hub-card__head">
            <h3 className="hub-card__title">{t.assets.oracleGroupRelayer}</h3>
            <span className="hub-card__count">{t.assets.hubRoleDynamic}</span>
          </div>
          <Link to="/workspaces/relayer" className="hub-row">
            <span className="hub-row__main">
              <span className="hub-row__name">{t.assets.oracleGroupRelayer}</span>
              <span className="hub-row__meta">{t.assets.oraclePageLede}</span>
            </span>
            <span className="hub-row__badges"><span className="hub-badge">{t.assets.hubEnter}</span></span>
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function OracleData() {
  return (
    <ManagementEntry>
      <OracleInner />
    </ManagementEntry>
  );
}
