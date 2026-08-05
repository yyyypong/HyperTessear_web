import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useMetrics } from '../hooks/useMetrics';
import ProductCard from '../components/ProductCard';
import { ErrorState, Skeleton } from '../components/ui';
import {
  Hero, KpiRow, PartnerMarquee, SecuritySection, FeatureTriptych, ClosingCta,
} from '../components/home';

/**
 * Section order is deliberate and differs from the wireframe.
 *
 * Wireframe:  slogan -> KPIs -> partners -> features
 * Here:       slogan -> PRODUCTS -> KPIs -> integrations -> audits -> features -> CTA
 *
 * For a yield product the number is the pitch, so the three tranches
 * and their target APYs sit above the fold — the midas.app pattern,
 * where the hero is the product table rather than a slogan.
 */
export default function Home() {
  const { t } = useI18n();
  const metricsState = useMetrics();
  const { data, loading, error, retry } = useApi(api.products);

  const live = data?.products?.filter(p => p.status === 'live') ?? [];

  return (
    <>
      <div className="wrap">
        <Hero />

        {/* --- products, above the fold (primary CTA area) --- */}
        <section className="section--tight">
          {loading && (
            <div className="pcards">
              {[0, 1, 2].map(i => (
                <div className="pcard" key={i}>
                  <Skeleton height={40} />
                  <Skeleton height={30} style={{ marginTop: 14 }} />
                  <Skeleton height={60} style={{ marginTop: 14 }} />
                </div>
              ))}
            </div>
          )}
          {error && <ErrorState error={error} onRetry={retry} />}
          {!loading && !error && (
            <>
              <div className="pcards">
                {live.map(p => <ProductCard key={p.slug} product={p} />)}
              </div>
              <div style={{ textAlign: 'center', marginTop: 26 }}>
                <Link to="/products" className="btn btn--ghost">{t.home.viewAll}</Link>
              </div>
            </>
          )}
        </section>

        {/* Secondary protocol entries — lower visual priority than Yield Products */}
        <section className="section--tight home-secondary">
          <div className="section__eyebrow">{t.home.protocolEyebrow}</div>
          <h2 className="section__title">{t.home.protocolTitle}</h2>
          <p className="section__lede">{t.home.protocolLede}</p>
          <div className="entrygrid entrygrid--home">
            <Link to="/assets/issue" className="entrycard">
              <div className="entrycard__title">{t.home.issuanceEntry}</div>
              <div className="entrycard__body">{t.home.issuanceEntryBody}</div>
            </Link>
            <Link to="/assets/wrap" className="entrycard">
              <div className="entrycard__title">{t.home.wrapEntry}</div>
              <div className="entrycard__body">{t.home.wrapEntryBody}</div>
            </Link>
            <Link to="/vaults/create" className="entrycard">
              <div className="entrycard__title">{t.home.vaultCreateEntry}</div>
              <div className="entrycard__body">{t.home.vaultCreateEntryBody}</div>
            </Link>
            <Link to="/vaults/manage" className="entrycard">
              <div className="entrycard__title">{t.home.vaultManageEntry}</div>
              <div className="entrycard__body">{t.home.vaultManageEntryBody}</div>
            </Link>
          </div>
        </section>

        {/* --- strategy manager track record --- */}
        <section className="section">
          <div className="section__eyebrow">{t.home.kpiEyebrow}</div>
          <h2 className="section__title">{t.home.kpiTitle}</h2>
          <div style={{ marginTop: 18 }}>
            <KpiRow state={metricsState} />
          </div>
        </section>

        {/* --- DeFi integrations --- */}
        <section className="section--tight">
          <div className="section__eyebrow">{t.home.partnersEyebrow}</div>
          <h2 className="section__title">{t.home.partnersTitle}</h2>
          <p className="section__lede">{t.home.partnersLede}</p>
          <PartnerMarquee partners={metricsState.data?.partners} />
        </section>

        {/* --- security & audits --- */}
        <section className="section">
          <div className="section__eyebrow">{t.home.auditsEyebrow}</div>
          <h2 className="section__title">{t.home.auditsTitle}</h2>
          <p className="section__lede">{t.home.auditsLede}</p>
          <SecuritySection audits={metricsState.data?.audits} />

          {metricsState.data?.custodians?.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="filtergrp__label" style={{ marginBottom: 10 }}>
                {t.home.custodiansTitle}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {metricsState.data.custodians.map(c => (
                  <span className="pill" key={c.id}>{c.name}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* --- core advantages --- */}
        <section className="section--tight">
          <div className="section__eyebrow">{t.home.featuresEyebrow}</div>
          <FeatureTriptych />
        </section>

        <section className="section">
          <ClosingCta />
        </section>
      </div>
    </>
  );
}
