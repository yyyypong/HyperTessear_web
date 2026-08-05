import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { apyDisplay, apyIsRange, currencyCompact } from '../lib/format';
import { CapacityBar, Monogram, StatusPill } from './ui';

/**
 * One product tile. Used both in the homepage preview row (above the
 * fold, mirroring midas.app) and in the products-page grid, so the two
 * can never drift apart.
 *
 * The APY is the largest thing on the card and everything else is set
 * against it: a reader scanning three tranches is comparing one number,
 * and the previous card gave that number the same weight as the product
 * name and the term chips.
 */
export default function ProductCard({ product, showSequence = true }) {
  const { t } = useI18n();
  const soon = product.status === 'coming_soon';
  const seqLabel = t.locale === 'en' ? `Tranche ${product.sequenceNo}` : `序列 ${product.sequenceNo}`;

  return (
    <Link
      to={`/products/${product.slug}`}
      className={`pcard${soon ? ' pcard--soon' : ''}`}
      aria-label={product.name}
    >
      <div className="pcard__top">
        {showSequence && <span className="pcard__seq">{seqLabel}</span>}
        {soon && <StatusPill status={product.status} />}
      </div>

      <div className="pcard__head">
        <Monogram name={product.name} />
        <div className="pcard__ident">
          <div className="pcard__name">{product.name}</div>
          <div className="pcard__sub">
            {product.roleLabel} · {product.strategyManager}
          </div>
        </div>
      </div>

      <div className="pcard__figure">
        <div className={`pcard__apy${apyIsRange(product.targetApy) ? ' pcard__apy--range' : ''}`}>
          {apyDisplay(product.targetApy)}
        </div>
        <div className="pcard__apy-cap">
          {apyIsRange(product.targetApy) ? t.common.apyRange : t.common.targetApyCap}
          <sup>1</sup>
        </div>
      </div>

      <dl className="pcard__meta">
        <div className="pcard__meta-cell">
          <dt>{t.common.term}</dt>
          <dd>{product.termLabel}</dd>
        </div>
        <div className="pcard__meta-cell">
          <dt>{t.common.denom}</dt>
          <dd>{product.denomination}</dd>
        </div>
        <div className="pcard__meta-cell">
          <dt>{t.common.underlying}</dt>
          <dd>{product.underlying}</dd>
        </div>
      </dl>

      {!soon && product.capacity && (
        <CapacityBar
          tvl={product.tvl}
          capacity={product.capacity}
          leftLabel={currencyCompact(product.tvl)}
          rightLabel={currencyCompact(product.capacity)}
        />
      )}

      <p className="pcard__desc">{product.tagline}</p>

      <span className="pcard__cta">
        {t.common.viewDetail.replace(' →', '')}
        <span className="pcard__cta-ic">→</span>
      </span>
    </Link>
  );
}
