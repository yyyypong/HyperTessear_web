import { Link } from 'react-router-dom';
import { useI18n, Highlight } from '../i18n';
import { currencyCompact, integer, isoDate, percent } from '../lib/format';
import { ErrorState, Skeleton, ValueWithTimestamp } from './ui';

/* ---------------------------------------------------------------- */
export function Hero() {
  const { t } = useI18n();
  return (
    <section className="hero">
      <Highlight text={t.hero.slogan} as="h1" className="hero__slogan" />
      <p className="hero__sub">{t.hero.sub}</p>
      <div className="hero__ctas">
        <Link to="/products" className="btn">{t.hero.ctaPrimary}</Link>
        <button className="btn btn--ghost">{t.hero.ctaSecondary}</button>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------
   KPI row.

   These are the strategy manager's numbers, not the protocol's — so
   each one carries its attribution and the date it was last updated,
   and the block sits BELOW the product cards rather than in the hero.
   The wireframe put them second-from-top with a footnote; the footnote
   was right, the placement was not.
   ---------------------------------------------------------------- */
export function KpiRow({ state }) {
  const { t } = useI18n();
  const { data, loading, error, retry } = state;

  if (loading) {
    return (
      <div className="kpis">
        {[0, 1, 2, 3].map(i => (
          <div className="kpi" key={i}><Skeleton height={30} /><Skeleton height={11} style={{ marginTop: 8 }} /></div>
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!data) return null;

  const cells = [
    { key: 'historicalFailureRate', label: t.home.kpiFailureRate, badge: true,
      render: (m) => percent(m.value, { digits: 2 }) },
    { key: 'cumAssetsMinted', label: t.home.kpiAssetsMinted, render: (m) => currencyCompact(m.value) },
    { key: 'cumPayout', label: t.home.kpiPayout, render: (m) => currencyCompact(m.value) },
    { key: 'totalInvestors', label: t.home.kpiInvestors, render: (m) => integer(m.value) },
  ];

  return (
    <>
      <div className="kpis">
        {cells.map(cell => {
          const m = data[cell.key];
          if (!m) return null;
          return (
            <div className={`kpi${cell.badge ? ' kpi--badge' : ''}`} key={cell.key}>
              <div className="kpi__value">{cell.render(m)}</div>
              <div className="kpi__label">{cell.label}</div>
              <div className="kpi__meta">
                {t.common.asOf} {isoDate(m.lastUpdated)}
                {m.attribution && <> · <b>{m.attribution}</b></>}
              </div>
            </div>
          );
        })}
      </div>
      <Highlight text={t.home.kpiNote} as="div" className="kpis__note" />
    </>
  );
}

/* ---------------------------------------------------------------- */
export function PartnerMarquee({ partners }) {
  if (!partners?.length) return null;
  // duplicated once so the -50% translate loops seamlessly
  const doubled = [...partners, ...partners];
  return (
    <div className="marquee">
      <div className="marquee__track">
        {doubled.map((p, i) => (
          <a
            key={`${p.id}-${i}`}
            className="marquee__item"
            href={p.linkUrl || undefined}
            target={p.linkUrl ? '_blank' : undefined}
            rel="noreferrer"
            aria-hidden={i >= partners.length}
          >
            <span className="marquee__dot" />
            {p.name}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Security & audits.

   The wireframe scrolled PeckShield / SlowMist / CertiK past in the
   same marquee as the DeFi integrations, which says nothing about what
   they actually did. Each auditor now gets a scope, a completion date
   and a link to the report — the midas.app pattern.
   ---------------------------------------------------------------- */
export function SecuritySection({ audits }) {
  const { t } = useI18n();
  if (!audits?.length) return null;

  return (
    <div className="audits">
      {audits.map(a => (
        <div className="audit" key={a.id}>
          <div className="audit__top">
            <span className="monogram monogram--sm">{a.auditor.slice(0, 2).toUpperCase()}</span>
            <span className="audit__name">{a.auditor}</span>
          </div>
          <div className="audit__scope">{a.scope}</div>
          <div className="audit__foot">
            <span>{t.home.auditCompleted} {isoDate(a.completedAt)}</span>
            {a.reportUrl
              ? <a className="audit__link" href={a.reportUrl} target="_blank" rel="noreferrer">{t.home.auditReport}</a>
              : <span>{t.home.auditNoReport}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
const ICONS = {
  liquidity: <path d="M3 6h13M3 12h9M3 18h13M19 9l3 3-3 3" />,
  transparency: <><circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /></>,
  security: <><path d="M12 2 4 5v6c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V5l-8-3Z" /><path d="M9 12l2 2 4-4" /></>,
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

export function FeatureTriptych() {
  const { t } = useI18n();
  const items = [
    { k: 'liquidity', en: t.home.featureLiquidityEn, title: t.home.featureLiquidityTitle,
      body: t.home.featureLiquidityBody, gold: false },
    { k: 'transparency', en: t.home.featureTransparencyEn, title: t.home.featureTransparencyTitle,
      body: t.home.featureTransparencyBody, gold: true },
    { k: 'security', en: t.home.featureSecurityEn, title: t.home.featureSecurityTitle,
      body: t.home.featureSecurityBody, gold: false },
  ];

  return (
    <div className="features">
      {items.map(it => (
        <div className={`feature${it.gold ? ' feature--gold' : ''}`} key={it.k}>
          <div className="feature__en">{it.en}</div>
          <div className="feature__title">
            {it.title}
            <span className="feature__ic"><Icon name={it.k} /></span>
          </div>
          <Highlight text={it.body} as="p" className="feature__body" />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
export function ClosingCta() {
  const { t } = useI18n();
  return (
    <div className="closing">
      <h2 className="closing__title">{t.home.closingTitle}</h2>
      <div className="closing__ctas">
        <Link to="/products" className="btn btn--gold">{t.home.closingPrimary}</Link>
        <button className="btn btn--ghost">{t.home.closingSecondary}</button>
      </div>
    </div>
  );
}
