import { Link } from 'react-router-dom';
import { useI18n, Highlight } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import PageHead from '../components/PageHead';
import Reveal from '../components/Reveal';
import { ErrorState, Monogram, Skeleton } from '../components/ui';
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

  const head = (
    <PageHead
      eyebrow={t.liquidity.eyebrow}
      title={t.liquidity.title}
      lede={t.liquidity.lede}
    />
  );

  if (loading) {
    return (
      <>
        {head}
        <section className="band band--paper">
          <div className="wrap">
            <Skeleton height={120} />
            <Skeleton height={190} style={{ marginTop: 20 }} />
          </div>
        </section>
      </>
    );
  }
  if (error) {
    return (
      <>
        {head}
        <section className="band band--paper">
          <div className="wrap"><ErrorState error={error} onRetry={retry} /></div>
        </section>
      </>
    );
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
    <>
      {head}

      <section className="band band--paper">
        <div className="wrap">
          {/* --- redeemable vs locked --- */}
          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.liquidity.splitTitle}</h2>
            </Reveal>
            <Reveal step={1}>
              <div className="dcard" style={{ marginTop: 0 }}>
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
            </Reveal>
          </section>

          {/* --- buffer --- */}
          {buffer && (
            <section className="section--tight">
              <Reveal>
                <h2 className="section__title section__title--sm">{t.liquidity.bufferTitle}</h2>
                <p className="section__lede">{t.liquidity.bufferLede}</p>
              </Reveal>
              <div className="statgrid">
                <Reveal className="statbox statbox--gold">
                  <div className="statbox__label">{t.liquidity.bufferSize}</div>
                  <div className="statbox__value">{currencyCompact(buffer.tvl)}</div>
                  <div className="statbox__sub">
                    <Link to={`/products/${buffer.slug}`} className="audit__link">{buffer.name} →</Link>
                  </div>
                </Reveal>
                <Reveal step={1} className="statbox">
                  <div className="statbox__label">{t.liquidity.bufferUtil}</div>
                  <div className="statbox__value">
                    {buffer.utilisation === null ? '—' : percent(buffer.utilisation * 100, { digits: 1 })}
                  </div>
                  <div className="statbox__sub">
                    {currencyCompact(buffer.tvl)} {t.common.of} {currencyCompact(buffer.capacity)}
                  </div>
                </Reveal>
                <Reveal step={2} className="statbox">
                  <div className="statbox__label">{t.liquidity.coverage}</div>
                  <div className="statbox__value">
                    {coverageRatio === null ? '—' : percent(coverageRatio * 100, { digits: 1 })}
                  </div>
                  <div className="statbox__sub">{t.liquidity.coverageNote}</div>
                </Reveal>
              </div>
            </section>
          )}

          {/* --- per-product policies --- */}
          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.liquidity.policiesTitle}</h2>
            </Reveal>
            <Reveal step={1}>
              <div className="dcard" style={{ marginTop: 0 }}>
                {policies.map((p, i) => (
                  <div
                    className="policy"
                    key={p.slug}
                    style={i === policies.length - 1 ? { borderBottom: 'none', paddingBottom: 0 } : undefined}
                  >
                    <div className="policy__top">
                      <Monogram name={p.name} small />
                      <Link to={`/products/${p.slug}`} className="policy__name">{p.name}</Link>
                      <span className="pill">{p.termLabel}</span>
                      <span className={`pill ${p.redeemable ? 'pill--ok' : 'pill--mut'}`}>
                        {p.redeemable ? t.liquidity.policyRedeemable : t.liquidity.policyLocked}
                      </span>
                      <span className="policy__tvl mono">{currencyCompact(p.tvl)}</span>
                    </div>
                    <p className="duo__body">{p.redemptionNote}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          </section>

          {/* --- mechanics --- */}
          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.liquidity.mechanicsTitle}</h2>
              <p className="section__lede">{t.liquidity.mechanicsLede}</p>
            </Reveal>
            <Reveal step={1}>
              <div className="dcard" style={{ marginTop: 0 }}>
                <div className="steps">
                  {steps.map((s, i) => (
                    <div className={`step${s.gold ? ' step--gold' : ''}`} key={s.title}>
                      <div className="step__n">{i + 1}</div>
                      <div>
                        <div className="step__title">{s.title}</div>
                        <p className="step__body">{s.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </section>

          {/* --- the honest note --- */}
          <Reveal className="risk" style={{ marginTop: 32 }}>
            <div className="risk__ic">!</div>
            <div>
              <div className="risk__title">{t.liquidity.honestTitle}<sup>3</sup></div>
              <Highlight text={t.liquidity.honestBody} as="p" className="risk__text" />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
