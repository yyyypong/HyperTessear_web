import { useI18n, Highlight } from '../i18n';
import { useMetrics } from '../hooks/useMetrics';
import PageHead from '../components/PageHead';
import Reveal from '../components/Reveal';
import { ErrorState, Skeleton } from '../components/ui';
import { isoDate } from '../lib/format';

function ChipGroup({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="chipgroup">
      <div className="chipgroup__label">{title}</div>
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
    <>
      <PageHead
        eyebrow={t.about.eyebrow}
        title={t.about.title}
        lede={t.about.lede}
      />

      <section className="band band--paper">
        <div className="wrap">
          {/* --- scope of responsibility --- */}
          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.about.missionTitle}</h2>
            </Reveal>
            <div className="duo">
              <Reveal className="duo__card duo__card--gold">
                <div className="duo__title">{t.about.doTitle}</div>
                <p className="duo__body">{t.about.doBody}</p>
              </Reveal>
              <Reveal step={1} className="duo__card">
                <div className="duo__title">{t.about.dontTitle}</div>
                <p className="duo__body">{t.about.dontBody}</p>
              </Reveal>
            </div>
          </section>

          {/* --- structure --- */}
          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.about.structureTitle}</h2>
            </Reveal>
            <Reveal step={1}>
              <div className="dcard" style={{ marginTop: 0 }}>
                <p className="dcard__body">{t.about.structureBody}</p>
              </div>
            </Reveal>
          </section>

          {/* --- counterparties --- */}
          <section className="section--tight">
            {loading && <Skeleton height={130} />}
            {error && <ErrorState error={error} onRetry={retry} />}
            {data && (
              <Reveal>
                <div className="dcard" style={{ marginTop: 0 }}>
                  <ChipGroup title={t.about.managersTitle} items={data.managers} />
                  <ChipGroup title={t.about.custodiansTitle} items={data.custodians} />
                  <ChipGroup title={t.about.integrationsTitle} items={data.partners} />

                  {data.audits?.length > 0 && (
                    <div className="chipgroup chipgroup--last">
                      <div className="chipgroup__label">{t.about.auditorsTitle}</div>
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
              </Reveal>
            )}
          </section>

          {/* --- entity --- */}
          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.about.entityTitle}</h2>
            </Reveal>
            <Reveal step={1}>
              <div className="dcard" style={{ marginTop: 0 }}>
                <p className="dcard__body dcard__body--strong">{t.footer.entity}</p>
                <Highlight text={t.footer.address} as="p" className="dcard__body" />
                <p className="dcard__note">{t.about.entityNote}</p>
              </div>
            </Reveal>
          </section>
        </div>
      </section>
    </>
  );
}
