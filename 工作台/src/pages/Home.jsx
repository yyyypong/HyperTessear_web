import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useMetrics } from '../hooks/useMetrics';
import Reveal from '../components/Reveal';
import { ErrorState, Skeleton } from '../components/ui';
import {
  Hero, LSectionHead, HomeProductCard, KpiRow, PartnerMarquee,
  SecuritySection, FeatureTriptych, ClosingCta,
} from '../components/home';

/**
 * Homepage 2.0 — dark charcoal cover, then a light #EDEEF5 body that
 * overlaps it with a rounded top edge. Section order is unchanged from
 * the data-driven original: for a yield product the number is the pitch,
 * so the three tranches sit directly under the cover.
 */
/* Official marks for the custody & trading partners row. */
const CUSTODIAN_LOGOS = {
  osl: '/logos/osl.png',
  exio: '/logos/exio.png',
  hashkey: '/logos/hashkey.png',
};

export default function Home() {
  const { t } = useI18n();
  const metricsState = useMetrics();
  const { data, loading, error, retry } = useApi(api.products);

  const live = data?.products?.filter(p => p.status === 'live') ?? [];

  /* Cover exit choreography: as the page starts scrolling, the hero
     drifts up (parallax) while the body card grows from a slightly
     shrunk state into full width — the reverse of miro's shrink-away.
     rAF-throttled, ease-out so the growth settles gently. */
  useEffect(() => {
    const hero = document.querySelector('.lhero');
    const body = document.querySelector('.lbody');
    if (!hero || !body) return undefined;

    let raf = 0;
    const update = () => {
      raf = 0;
      const range = window.innerHeight * 0.9;
      const p = Math.min(1, Math.max(0, window.scrollY / range));
      const e = 1 - (1 - p) * (1 - p); // easeOutQuad
      hero.style.transform = `translateY(${(-24 * e).toFixed(2)}vh)`;
      body.style.transform = `scale(${(0.94 + 0.06 * e).toFixed(4)})`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      hero.style.transform = '';
      body.style.transform = '';
    };
  }, []);

  return (
    <>
      <Hero />

      <div className="lbody">
        {/* --- 001 · products, straight off the cover --- */}
        <section className="lsec">
          <div className="lwrap">
            <LSectionHead
              counter={`001 / 006 · ${t.home.productsEyebrow}`}
              title={t.home.productsTitle}
              lede={t.home.productsLede}
              aside={
                <Link to="/products" className="larrowlink">
                  {t.home.viewAll}<span className="arw" aria-hidden="true">→</span>
                </Link>
              }
            />

            {loading && (
              <div className="lpcards">
                {[0, 1, 2].map(i => (
                  <div className="lpcard" key={i} aria-hidden="true">
                    <Skeleton height={40} />
                    <Skeleton height={34} style={{ marginTop: 18 }} />
                    <Skeleton height={70} style={{ marginTop: 18 }} />
                  </div>
                ))}
              </div>
            )}
            {error && <ErrorState error={error} onRetry={retry} />}
            {!loading && !error && (
              <div className="lpcards">
                {live.map((p, i) => (
                  <Reveal step={i} key={p.slug}><HomeProductCard product={p} /></Reveal>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* --- 002 · strategy manager track record --- */}
        <section className="lsec">
          <div className="lwrap">
            <LSectionHead
              counter={`002 / 006 · ${t.home.kpiEyebrow}`}
              title={t.home.kpiTitle}
            />
            <KpiRow state={metricsState} />
          </div>
        </section>

        {/* --- 003 · DeFi integrations, inset dark panel --- */}
        <section className="lsec">
          <div className="lpanel-dark">
            <div className="lwrap">
              <LSectionHead
                counter={`003 / 006 · ${t.home.partnersEyebrow}`}
                title={t.home.partnersTitle}
                lede={t.home.partnersLede}
              />
              <Reveal><PartnerMarquee partners={metricsState.data?.partners} /></Reveal>
            </div>
          </div>
        </section>

        {/* --- 004 · security & audits --- */}
        <section className="lsec">
          <div className="lwrap">
            <LSectionHead
              counter={`004 / 006 · ${t.home.auditsEyebrow}`}
              title={t.home.auditsTitle}
              lede={t.home.auditsLede}
            />
            <SecuritySection audits={metricsState.data?.audits} />

            {metricsState.data?.custodians?.length > 0 && (
              <Reveal className="lcustodians">
                <div className="lcustodians__label">{t.home.custodiansTitle}</div>
                <div className="lchips">
                  {metricsState.data.custodians.map(c => (
                    <span className="lchip" key={c.id} title={c.name} aria-label={c.name}>
                      {CUSTODIAN_LOGOS[String(c.name).toLowerCase()]
                        ? <img src={CUSTODIAN_LOGOS[String(c.name).toLowerCase()]} alt={c.name} loading="lazy" />
                        : c.name}
                    </span>
                  ))}
                </div>
              </Reveal>
            )}
          </div>
        </section>

        {/* --- 005 · core advantages, numbered index --- */}
        <section className="lsec">
          <div className="lwrap">
            <LSectionHead
              counter={`005 / 006`}
              title={t.home.featuresEyebrow}
            />
            <FeatureTriptych />
          </div>
        </section>

        {/* --- 006 · closing --- */}
        <ClosingCta />
      </div>
    </>
  );
}
