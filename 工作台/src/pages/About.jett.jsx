import { useI18n, Highlight } from '../i18n';
import { useMetrics } from '../hooks/useMetrics';
import { ErrorState, Skeleton } from '../components/ui';
import { isoDate } from '../lib/format';

function ChipGroup({ title, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="filtergrp__label" style={{ marginBottom: 9 }}>{title}</div>
      <div className="chiprow">
        {items.map(p => (
          p.linkUrl
            ? <a className="pill" key={p.id} href={p.linkUrl} target="_blank" rel="noreferrer">{p.name}</a>
            : <span className="pill" key={p.id}>{p.name}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * /about.
 *
 * The load-bearing section is "what we do, and what we don't" — it
 * states plainly that HyperTessera does not make the investment
 * decisions, which is the same point the homepage KPI attribution
 * makes with dates and source labels.
 */
export default function About() {
  const { t } = useI18n();
  const { data, loading, error, retry } = useMetrics();

  return (
    <div className="wrap">
      <div className="phead">
        <div className="section__eyebrow">{t.about.eyebrow}</div>
        <h1 className="phead__title">{t.about.title}</h1>
        <p className="section__lede">{t.about.lede}</p>
      </div>

      {/* --- scope of responsibility --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.about.missionTitle}</h2>
        <div className="duo" style={{ marginTop: 12 }}>
          <div className="duo__card duo__card--gold">
            <div className="duo__title">{t.about.doTitle}</div>
            <p className="duo__body">{t.about.doBody}</p>
          </div>
          <div className="duo__card">
            <div className="duo__title">{t.about.dontTitle}</div>
            <p className="duo__body">{t.about.dontBody}</p>
          </div>
        </div>
      </section>

      {/* --- structure --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.about.structureTitle}</h2>
        <div className="dcard" style={{ marginTop: 12 }}>
          <p className="dcard__body">{t.about.structureBody}</p>
        </div>
      </section>

      {/* --- counterparties --- */}
      <section className="section--tight">
        {loading && <Skeleton height={120} />}
        {error && <ErrorState error={error} onRetry={retry} />}
        {data && (
          <div className="dcard" style={{ marginTop: 0 }}>
            <ChipGroup title={t.about.managersTitle} items={data.managers} />
            <ChipGroup title={t.about.custodiansTitle} items={data.custodians} />
            <ChipGroup title={t.about.integrationsTitle} items={data.partners} />

            {data.audits?.length > 0 && (
              <div>
                <div className="filtergrp__label" style={{ marginBottom: 9 }}>{t.about.auditorsTitle}</div>
                <div className="chiprow">
                  {data.audits.map(a => (
                    a.reportUrl
                      ? <a className="pill pill--gold" key={a.id} href={a.reportUrl} target="_blank" rel="noreferrer">
                        {a.auditor} · {isoDate(a.completedAt)}
                      </a>
                      : <span className="pill pill--gold" key={a.id}>{a.auditor}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* --- entity --- */}
      <section className="section--tight" style={{ paddingBottom: 20 }}>
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.about.entityTitle}</h2>
        <div className="dcard" style={{ marginTop: 12 }}>
          <p className="dcard__body" style={{ fontWeight: 600, color: 'var(--navy)' }}>
            {t.footer.entity}
          </p>
          <Highlight text={t.footer.address} as="p" className="dcard__body" />
          <p className="dcard__body" style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 12 }}>
            {t.about.entityNote}
          </p>
        </div>
      </section>
    </div>
  );
}
