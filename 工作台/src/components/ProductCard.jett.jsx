import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { apyDisplay, apyIsRange, currencyCompact } from '../lib/format';
import { CapacityBar, Monogram, StatusPill } from './ui';

/**
 * One product tile. Used both in the homepage preview row (above the
 * fold, mirroring midas.app) and in the products-page grid, so the two
 * can never drift apart.
 */
export default function ProductCard({ product, showSequence = true }) {
  const { t } = useI18n();
  const soon = product.status === 'coming_soon';
  const seqLabel = t.locale === 'en' ? `TRANCHE ${product.sequenceNo}` : `序列 ${product.sequenceNo}`;

  return (
    <Link
      to={`/products/${product.slug}`}
      className={`pcard${soon ? ' pcard--soon' : ''}`}
      aria-label={product.name}
    >
      {showSequence && <span className="pcard__seq">{seqLabel}</span>}

      <div className="pcard__head">
        <Monogram name={product.name} />
        <div style={{ flex: 1 }}>
          <div className="pcard__name">{product.name}</div>
          <div className="pcard__sub">
            {product.roleLabel} · {product.strategyManager}
          </div>
        </div>
        {soon && <StatusPill status={product.status} />}
      </div>

      <div className="pcard__apy">{apyDisplay(product.targetApy)}</div>
      <div className="pcard__apy-cap">
        {apyIsRange(product.targetApy) ? t.common.apyRange : t.common.targetApyCap}
        <sup>1</sup>
      </div>

      <div className="pcard__meta">
        <div className="pcard__meta-cell">
          <div className="pcard__meta-l">{t.common.term}</div>
          <div className="pcard__meta-v">{product.termLabel}</div>
        </div>
        <div className="pcard__meta-cell">
          <div className="pcard__meta-l">{t.common.denom}</div>
          <div className="pcard__meta-v">{product.denomination}</div>
        </div>
        <div className="pcard__meta-cell">
          <div className="pcard__meta-l">{t.common.underlying}</div>
          <div className="pcard__meta-v">{product.underlying}</div>
        </div>
      </div>

      {!soon && product.capacity && (
        <CapacityBar
          tvl={product.tvl}
          capacity={product.capacity}
          leftLabel={currencyCompact(product.tvl)}
          rightLabel={currencyCompact(product.capacity)}
        />
      )}

      <p className="pcard__desc">{product.tagline}</p>

      <span className="pcard__cta">{t.common.viewDetail}</span>
    </Link>
  );
}
