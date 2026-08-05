import { Link } from 'react-router-dom';
import { useI18n, Highlight } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { ErrorState, Monogram, Skeleton, StatusPill } from '../components/ui';
import { currencyCompact, currencyFull, percent } from '../lib/format';

/**
 * /liquidity.
 *
 * The wireframe's homepage promised 随时赎回 ("redeem anytime") while
 * Note Earn locks deposits for 360 days. Rather than restate the claim
 * more loudly, this page splits AUM into redeemable and locked,
 * publishes buffer utilisation, and walks through what actually happens
 * during a redemption — including the step HyperTessera does not
 * control.
 */
export default function Liquidity() {
  const { t } = useI18n();
  const { data, loading, error, retry } = useApi(api.liquidity);

  if (loading) {
    return (
      <div className="wrap" style={{ paddingTop: 40 }}>
        <Skeleton height={36} width="55%" />
        <Skeleton height={110} style={{ marginTop: 24 }} />
        <Skeleton height={180} style={{ marginTop: 16 }} />
      </div>
    );
  }
  if (error) {
    return <div className="wrap" style={{ padding: '40px 0' }}><ErrorState error={error} onRetry={retry} /></div>;
  }

  const { totals, buffer, coverageRatio, policies } = data;
  const freePct = totals.redeemableShare * 100;
  const lockedPct = 100 - freePct;

  const steps = [
    { title: t.liquidity.step1Title, body: t.liquidity.step1Body },
    { title: t.liquidity.step2Title, body: t.liquidity.step2Body },
    { title: t.liquidity.step3Title, body: t.liquidity.step3Body, gold: true },
    { title: t.liquidity.step4Title, body: t.liquidity.step4Body },
  ];

  return (
    <div className="wrap">
      <div className="phead">
        <div className="section__eyebrow">{t.liquidity.eyebrow}</div>
        <h1 className="phead__title">{t.liquidity.title}</h1>
        <p className="section__lede">{t.liquidity.lede}</p>
      </div>

      {/* --- redeemable vs locked --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.liquidity.splitTitle}</h2>
        <div className="dcard" style={{ marginTop: 12 }}>
          <div className="splitbar">
            <div className="splitbar__track">
              <div className="splitbar__seg splitbar__seg--free" style={{ width: `${freePct}%` }}>
                {freePct > 12 && percent(freePct, { digits: 1 })}
              </div>
              <div className="splitbar__seg splitbar__seg--locked" style={{ width: `${lockedPct}%` }}>
                {lockedPct > 12 && percent(lockedPct, { digits: 1 })}
              </div>
            </div>
            <div className="splitbar__legend">
              <span className="splitbar__key">
                <span className="splitbar__swatch" style={{ background: 'var(--gold)' }} />
                {t.liquidity.labelRedeemable} <b>{currencyFull(totals.redeemableTvl)}</b>
              </span>
              <span className="splitbar__key">
                <span className="splitbar__swatch" style={{ background: 'var(--navy)' }} />
                {t.liquidity.labelLocked} <b>{currencyFull(totals.lockedTvl)}</b>
              </span>
              <span className="splitbar__key">
                {t.liquidity.labelLive} <b>{currencyFull(totals.liveTvl)}</b>
              </span>
            </div>
          </div>
        </div>
        <div className="kpis__note">{t.liquidity.splitNote}</div>
      </section>

      {/* --- buffer --- */}
      {buffer && (
        <section className="section--tight">
          <h2 className="section__title" style={{ fontSize: 18 }}>{t.liquidity.bufferTitle}</h2>
          <p className="section__lede">{t.liquidity.bufferLede}</p>
          <div className="statgrid">
            <div className="statbox statbox--gold">
              <div className="statbox__label">{t.liquidity.bufferSize}</div>
              <div className="statbox__value">{currencyCompact(buffer.tvl)}</div>
              <div className="statbox__sub">
                <Link to={`/products/${buffer.slug}`} className="audit__link">{buffer.name} →</Link>
              </div>
            </div>
            <div className="statbox">
              <div className="statbox__label">{t.liquidity.bufferUtil}</div>
              <div className="statbox__value">
                {buffer.utilisation === null ? '—' : percent(buffer.utilisation * 100, { digits: 1 })}
              </div>
              <div className="statbox__sub">
                {currencyCompact(buffer.tvl)} {t.common.of} {currencyCompact(buffer.capacity)}
              </div>
            </div>
            <div className="statbox">
              <div className="statbox__label">{t.liquidity.coverage}</div>
              <div className="statbox__value">
                {coverageRatio === null ? '—' : percent(coverageRatio * 100, { digits: 1 })}
              </div>
              <div className="statbox__sub">{t.liquidity.coverageNote}</div>
            </div>
          </div>
        </section>
      )}

      {/* --- per-product policies --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.liquidity.policiesTitle}</h2>
        <div className="dcard" style={{ marginTop: 12 }}>
          {policies.map((p, i) => (
            <div key={p.slug} style={{
              paddingTop: i === 0 ? 0 : 16,
              paddingBottom: 16,
              borderBottom: i === policies.length - 1 ? 'none' : '1px dashed var(--blue-line)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <Monogram name={p.name} small />
                <Link to={`/products/${p.slug}`} style={{ fontWeight: 700, color: 'var(--navy)' }}>
                  {p.name}
                </Link>
                <span className="pill">{p.termLabel}</span>
                <span className={`pill ${p.redeemable ? 'pill--ok' : 'pill--mut'}`}>
                  {p.redeemable ? t.liquidity.policyRedeemable : t.liquidity.policyLocked}
                </span>
                <span style={{ marginLeft: 'auto' }} className="mono">{currencyCompact(p.tvl)}</span>
              </div>
              <p className="duo__body">{p.redemptionNote}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- mechanics --- */}
      <section className="section--tight">
        <h2 className="section__title" style={{ fontSize: 18 }}>{t.liquidity.mechanicsTitle}</h2>
        <p className="section__lede">{t.liquidity.mechanicsLede}</p>
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

      {/* --- the honest note --- */}
      <section className="section--tight" style={{ paddingBottom: 20 }}>
        <div className="risk" style={{ marginTop: 0 }}>
          <div className="risk__ic">!</div>
          <div>
            <div className="risk__title">{t.liquidity.honestTitle}<sup>3</sup></div>
            <Highlight text={t.liquidity.honestBody} as="p" className="risk__text" />
          </div>
        </div>
      </section>
    </div>
  );
}
