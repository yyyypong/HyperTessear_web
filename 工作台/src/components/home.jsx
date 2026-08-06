import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Hls from 'hls.js';
import { useI18n, Highlight } from '../i18n';
import { useCountUp, useInView } from '../hooks/useMotion';
import {
  apyDisplay, apyIsRange, currencyCompact, integer, isoDate, percent, utilisation,
} from '../lib/format';
import { ErrorState, Skeleton } from './ui';
import Reveal from './Reveal';

/* ----------------------------------------------------------------
   Hero cover.

   A bright paper field: a GPU fluid-glass backdrop on near-white, with
   all the type anchored to the bottom edge behind a hairline rule —
   eyebrow, two-tone headline, lede and two CTAs. Emphasis markers in
   the i18n strings render ink-on-paper.
   ---------------------------------------------------------------- */

const HeroShader = lazy(() => import('./HeroShader'));

/* Split the slogan into lines, keeping the *emphasis* markers. Lines
   are separate elements so each can rise out of its own clip mask. */
function sloganLines(text) {
  return String(text).split('\n').map(line => (
    line.split(/(\*[^*]+\*)/g).filter(Boolean).map((part, i) => (
      part.startsWith('*') && part.endsWith('*')
        ? <strong key={i}>{part.slice(1, -1)}</strong>
        : <Fragment key={i}>{part}</Fragment>
    ))
  ));
}

/* The backdrop is WebGPU-only and purely decorative: mount it after
   paint, and never when the device opts out of motion. */
function useGpuBackdrop() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!navigator.gpu) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setEnabled(true);
  }, []);

  return enabled;
}

export function Hero() {
  const { t } = useI18n();
  const backdrop = useGpuBackdrop();

  return (
    <section className="lhero">
      <div className="lhero__bg">
        {/* standing elevation — these render regardless of WebGPU, so the
            cover never loses its depth even without the shader */}
        <div className="lhero__glow lhero__glow--top" aria-hidden="true" />
        <div className="lhero__glow lhero__glow--base" aria-hidden="true" />

        {/* precision hairlines — a quiet coordinate hint, top-left tick +
            baseline rule, that reads "engineered" without shouting */}
        <div className="lhero__grid" aria-hidden="true">
          <span className="lhero__grid-tick" />
          <span className="lhero__grid-label">X · Y</span>
          <span className="lhero__grid-axis lhero__grid-axis--x" />
          <span className="lhero__grid-axis lhero__grid-axis--y" />
        </div>

        {backdrop && (
          <Suspense fallback={null}>
            <HeroShader />
          </Suspense>
        )}

        {/* paper tooth — a fixed ultra-fine grain above the shader so the
            field never reads flat, WebGPU or not */}
        <div className="lhero__grain" aria-hidden="true" />
      </div>

      <div className="lhero__stage">
        <div className="lhero__copy">
          <div className="lhero__eyebrow">
            <span className="lhero__eyebrow-dot" aria-hidden="true" />
            {t.hero.eyebrow}
          </div>
          <div className="lhero__rule" />

          <h1 className="lhero__title">
            {sloganLines(t.hero.slogan).map((line, i) => (
              <span className="lhero__line" key={i}>
                <span className="lhero__line-in" style={{ animationDelay: `${0.12 + i * 0.12}s` }}>
                  {line}
                </span>
              </span>
            ))}
          </h1>

          <div className="lhero__foot">
            <p className="lhero__sub">{t.hero.sub}</p>

            <div className="lhero__ctas">
              <Link to="/products" className="lbtn lbtn--ink">
                {t.hero.ctaPrimary}<span className="arw" aria-hidden="true">→</span>
              </Link>
              <button className="lbtn lbtn--wire">{t.hero.ctaSecondary}</button>
            </div>
          </div>
        </div>

        {/* scroll hint — a quiet ticked hairline that gently breathes */}
        <div className="lhero__scroll" aria-hidden="true">
          <span className="lhero__scroll-label">scroll</span>
          <span className="lhero__scroll-line" />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------
   Section head for the light body: counter label, then a split row —
   title in the left column, lede + optional link in the right one.
   ---------------------------------------------------------------- */
export function LSectionHead({
  counter, title, lede, aside,
}) {
  return (
    <>
      {counter && <Reveal className="lcounter">{counter}</Reveal>}
      <div className="lhead">
        <div className="lhead__main">
          <Reveal as="h2" step={1} className="lhead__title">{title}</Reveal>
        </div>
        {(lede || aside) && (
          <Reveal step={2} className="lhead__side">
            {lede && <p className="lhead__lede">{lede}</p>}
            {aside}
          </Reveal>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------
   Product tranche cards — homepage edition. Same data contract as the
   shared ProductCard, restyled for the light body: white card, hairline
   meta grid, big display APY, capacity hairline, disc arrow CTA.
   ---------------------------------------------------------------- */
export function HomeProductCard({ product }) {
  const { t } = useI18n();
  const soon = product.status === 'coming_soon';
  const pct = !soon && product.capacity ? utilisation(product.tvl, product.capacity) : null;

  return (
    <Link to={`/products/${product.slug}`} className="lpcard" aria-label={product.name}>
      <div className="lpcard__top">
        <span className="lpcard__seq">
          {t.locale === 'en' ? `Tranche 0${product.sequenceNo}` : `序列 0${product.sequenceNo}`}
        </span>
        {soon && <span>{t.common.statusComingSoon}</span>}
      </div>

      <div className="lpcard__name">{product.name}</div>
      <div className="lpcard__sub">{product.roleLabel} · {product.strategyManager}</div>

      <div className="lpcard__apy">{apyDisplay(product.targetApy)}</div>
      <div className="lpcard__apy-cap">
        {apyIsRange(product.targetApy) ? t.common.apyRange : t.common.targetApyCap}<sup>1</sup>
      </div>

      <dl className="lpcard__meta">
        <div>
          <dt>{t.common.term}</dt>
          <dd>{product.termLabel}</dd>
        </div>
        <div>
          <dt>{t.common.denom}</dt>
          <dd>{product.denomination}</dd>
        </div>
        <div>
          <dt>{t.common.underlying}</dt>
          <dd>{product.underlying}</dd>
        </div>
      </dl>

      {pct !== null && (
        <div className="lpcard__cap">
          <div className="lpcard__cap-track">
            <div className="lpcard__cap-fill" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
          </div>
          <div className="lpcard__cap-label">
            <span>{currencyCompact(product.tvl)}</span>
            <span>{currencyCompact(product.capacity)}</span>
          </div>
        </div>
      )}

      <p className="lpcard__tag">{product.tagline}</p>

      <span className="lpcard__cta">
        {t.common.viewDetail.replace(' →', '')}
        <span className="arw" aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

/* ----------------------------------------------------------------
   KPI row — the strategy manager's track record, each figure carrying
   its attribution and last-updated date.
   ---------------------------------------------------------------- */
function Kpi({ cell, metric, step }) {
  const { t } = useI18n();
  const [ref, isIn] = useInView({ threshold: 0.35 });
  const counted = useCountUp(metric.value, isIn);

  return (
    <Reveal step={step} className="lkpi">
      <div className="lkpi__value" ref={ref}>
        {cell.render(counted)}{cell.badge && <sup> ✓</sup>}
      </div>
      <div className="lkpi__label">{cell.label}</div>
      <div className="lkpi__meta">
        {t.common.asOf} {isoDate(metric.lastUpdated)}
        {metric.attribution && <> · <b>{metric.attribution}</b></>}
      </div>
    </Reveal>
  );
}

export function KpiRow({ state }) {
  const { t } = useI18n();
  const { data, loading, error, retry } = state;

  if (loading) {
    return (
      <div className="lkpis">
        {[0, 1, 2, 3].map(i => (
          <div className="lkpi" key={i}>
            <Skeleton height={40} />
            <Skeleton height={12} style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (!data) return null;

  const cells = [
    { key: 'historicalFailureRate', label: t.home.kpiFailureRate, badge: true,
      render: (v) => percent(v, { digits: 2 }) },
    { key: 'cumAssetsMinted', label: t.home.kpiAssetsMinted, render: (v) => currencyCompact(v) },
    { key: 'cumPayout', label: t.home.kpiPayout, render: (v) => currencyCompact(v) },
    { key: 'totalInvestors', label: t.home.kpiInvestors, render: (v) => integer(Math.round(v)) },
  ];

  return (
    <>
      <div className="lkpis">
        {cells.map((cell, i) => {
          const m = data[cell.key];
          if (!m) return null;
          return <Kpi key={cell.key} cell={cell} metric={m} step={i} />;
        })}
      </div>
      <Highlight text={t.home.kpiNote} as="div" className="lkpis__note" />
    </>
  );
}

/* ----------------------------------------------------------------
   Integrations marquee — official partner marks on one seamless
   track inside the dark panel. Logos sit grayscale at rest and
   recover their colour on hover.
   ---------------------------------------------------------------- */
const PARTNER_LOGOS = {
  aave: '/logos/aave.svg',
  morpho: '/logos/morpho.png',
  pendle: '/logos/pendle.svg',
  openeden: '/logos/openeden.jpg',
  maple: '/logos/maple.png',
  ondo: '/logos/ondo.svg',
  centrifuge: '/logos/centrifuge.svg',
};

export function PartnerMarquee({ partners }) {
  if (!partners?.length) return null;

  return (
    <div className="lmarquee">
      <div className="lmarquee__track">
        {[...partners, ...partners, ...partners, ...partners].map((p, i) => {
          const logo = PARTNER_LOGOS[String(p.name).toLowerCase()];
          return (
            <a
              key={`${p.id}-${i}`}
              className="lmarquee__item"
              href={p.linkUrl || undefined}
              target={p.linkUrl ? '_blank' : undefined}
              rel="noreferrer"
              aria-hidden={i >= partners.length}
              tabIndex={i >= partners.length ? -1 : undefined}
            >
              {logo && <img className="lmarquee__logo" src={logo} alt="" loading="lazy" />}
              {p.name}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Security & audits — every audit linked and verifiable.
   ---------------------------------------------------------------- */
export function SecuritySection({ audits }) {
  const { t } = useI18n();
  if (!audits?.length) return null;

  /* Spotlight border: track the cursor and paint the 1px rim only in
     its neighbourhood (see .laudit::before in landing.css). */
  const trackSpot = (e) => {
    const card = e.target.closest('.laudit');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
    card.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
  };

  return (
    <div className="laudits" onPointerMove={trackSpot}>
      {audits.map((a, i) => (
        <Reveal step={i} className="laudit" key={a.id}>
          <div className="laudit__top">
            <span className="laudit__mono">{a.auditor.slice(0, 2).toUpperCase()}</span>
            <span className="laudit__name">{a.auditor}</span>
          </div>
          <div className="laudit__scope">{a.scope}</div>
          <div className="laudit__foot">
            <span>{t.home.auditCompleted} {isoDate(a.completedAt)}</span>
            {a.reportUrl
              ? <a className="laudit__link" href={a.reportUrl} target="_blank" rel="noreferrer">{t.home.auditReport}</a>
              : <span>{t.home.auditNoReport}</span>}
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
   Core advantages as a numbered index list: liquidity first, since
   transparency and security exist to make that claim credible.
   ---------------------------------------------------------------- */
export function FeatureTriptych() {
  const { t } = useI18n();
  const items = [
    { k: 'liquidity', en: t.home.featureLiquidityEn, title: t.home.featureLiquidityTitle,
      body: t.home.featureLiquidityBody },
    { k: 'transparency', en: t.home.featureTransparencyEn, title: t.home.featureTransparencyTitle,
      body: t.home.featureTransparencyBody },
    { k: 'security', en: t.home.featureSecurityEn, title: t.home.featureSecurityTitle,
      body: t.home.featureSecurityBody },
  ];

  return (
    <div className="lfeatures">
      {items.map((it, i) => (
        <Reveal step={i} className="lfeat" key={it.k}>
          <span className="lfeat__n">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <div className="lfeat__en">{it.en}</div>
            <h3 className="lfeat__title">{it.title}</h3>
            <Highlight text={it.body} as="p" className="lfeat__body" />
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
   Closing band — a cinematic dark panel with an HLS video graded to
   grayscale behind the content: one liquid-glass CTA, one solid
   white CTA.
   ---------------------------------------------------------------- */
const CLOSING_VIDEO_SRC = 'https://stream.mux.com/8wrHPCX2dC3msyYU9ObwqNdm00u3ViXvOSHUMRYSEe5Q.m3u8';

function ClosingVideo() {
  const ref = useRef(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;

    let hls;
    if (Hls.isSupported()) {
      hls = new Hls({ capLevelToPlayerSize: true });
      hls.loadSource(CLOSING_VIDEO_SRC);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = CLOSING_VIDEO_SRC;
    }
    return () => hls?.destroy();
  }, []);

  return (
    <video
      ref={ref}
      className="lclosing__video"
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
    />
  );
}

export function ClosingCta() {
  const { t } = useI18n();
  return (
    <section className="lclosing">
      <ClosingVideo />
      <span className="lclosing__fade lclosing__fade--top" aria-hidden="true" />
      <span className="lclosing__fade lclosing__fade--bottom" aria-hidden="true" />
      <div className="lclosing__inner">
        <Reveal as="h2" className="lclosing__title">{t.home.closingTitle}</Reveal>
        <Reveal step={1} className="lclosing__ctas">
          <Link to="/products" className="lbtn lbtn--light">
            {t.home.closingPrimary}<span className="arw" aria-hidden="true">→</span>
          </Link>
          <button className="lbtn lbtn--ghost">{t.home.closingSecondary}</button>
        </Reveal>
      </div>
    </section>
  );
}
