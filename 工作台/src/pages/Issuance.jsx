import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import ProductCard from '../components/ProductCard';
import { ErrorState, Skeleton } from '../components/ui';

/**
 * /issuance — what is launching next.
 *
 * Reads coming_soon products straight from the product table rather
 * than a hardcoded list, so a status change in the database moves a
 * product from this page onto /products with no code change.
 */
export default function Issuance() {
  const { t } = useI18n();
  const { data, loading, error, retry } = useApi(api.products);

  const upcoming = data?.products?.filter(p => p.status === 'coming_soon') ?? [];

  const steps = [
    { title: t.issuance.p1Title, body: t.issuance.p1Body },
    { title: t.issuance.p2Title, body: t.issuance.p2Body },
    { title: t.issuance.p3Title, body: t.issuance.p3Body, gold: true },
    { title: t.issuance.p4Title, body: t.issuance.p4Body, gold: true },
  ];

  return (
    <div className="wrap">
      <div className="phead">
        <div className="section__eyebrow">{t.issuance.eyebrow}</div>
        <h1 className="phead__title">{t.issuance.title}</h1>
        <p className="section__lede">{t.issuance.lede}</p>
      </div>

      {/* --- upcoming products --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.issuance.upcomingTitle}</h2>

        {loading && (
          <div className="pcards" style={{ marginTop: 18 }}>
            {[0, 1].map(i => (
              <div className="pcard" key={i}>
                <Skeleton height={40} />
                <Skeleton height={30} style={{ marginTop: 14 }} />
              </div>
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={retry} />}

        {!loading && !error && (
          upcoming.length > 0 ? (
            <div className="pcards" style={{ marginTop: 18 }}>
              {upcoming.map(p => <ProductCard key={p.slug} product={p} />)}
            </div>
          ) : (
            <div className="comingsoon" style={{ marginTop: 18 }}>
              <div className="comingsoon__body">{t.issuance.noUpcoming}</div>
            </div>
          )
        )}
      </section>

      {/* --- process --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.issuance.processTitle}</h2>
        <p className="section__lede">{t.issuance.processLede}</p>
        <div className="dcard" style={{ marginTop: 0 }}>
          <div className="steps">
            {steps.map((s, i) => (
              <div className={`step${s.gold ? ' step--gold' : ''}`} key={i}>
                <div className="step__n">{i + 1}</div>
                <div>
                  <div className="step__title">{s.title}</div>
                  <p className="step__body">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section--tight" style={{ paddingBottom: 20 }}>
        <div className="comingsoon" style={{ marginTop: 0 }}>
          <div className="section__eyebrow" style={{ marginBottom: 6 }}>{t.issuance.notifyTitle}</div>
          <div className="comingsoon__body">{t.issuance.notifyBody}</div>
        </div>
      </section>
    </div>
  );
}
