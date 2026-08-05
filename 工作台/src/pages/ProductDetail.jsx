import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useWallet } from '../wallet';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import NavChart from '../components/NavChart';
import Reveal from '../components/Reveal';
import {
  CapacityBar, ErrorState, InfoTip, Monogram, Skeleton, StatusPill,
} from '../components/ui';
import {
  apyDisplay, apyIsRange, currencyCompact, currencyFull, dateTime,
  isoDate, percent, shortAddress, utilisation,
} from '../lib/format';

/* ---------------------------------------------------------------- */
function StatCard({ label, value, sub, gold, tip }) {
  return (
    <div className="dstat">
      <div className="dstat__label">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <div className={`dstat__value${gold ? ' dstat__value--gold' : ''}`}>{value}</div>
      {sub && <div className="dstat__sub">{sub}</div>}
    </div>
  );
}

function Fact({ k, v, mono }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="kv">
      <span className="kv__k">{k}</span>
      <span className={`kv__v${mono ? ' kv__v--mono' : ''}`}>{v}</span>
    </div>
  );
}

/* ----------------------------------------------------------------
   Deposit / redeem widget.

   The CTA opens the wallet sheet; the form itself stays read-only, so
   the page can never stage a transaction the terms do not cover.
   ---------------------------------------------------------------- */
function TradeWidget({ product }) {
  const { t } = useI18n();
  const { openModal } = useWallet();
  const [tab, setTab] = useState('deposit');
  const [amount, setAmount] = useState('10,000.00');

  const depositing = tab === 'deposit';
  const payCur = depositing ? product.denomination : `${product.name.split(' ')[0]} Token`;
  const getCur = depositing ? `${product.name.split(' ')[0]} Token` : product.denomination;

  return (
    <div className="widget">
      <div className="widget__tabs">
        <button onClick={() => setTab('deposit')} aria-pressed={depositing}>{t.detail.depositTab}</button>
        <button onClick={() => setTab('redeem')} aria-pressed={!depositing}>{t.detail.redeemTab}</button>
      </div>

      <div className="dstat__label">{t.detail.youPay}</div>
      <div className="widget__row">
        <span className="widget__cur"><Monogram name={payCur} small />{payCur}</span>
        <input
          className="widget__amt"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label={t.detail.youPay}
        />
      </div>

      <div className="widget__arrow">↓</div>

      <div className="dstat__label">{t.detail.youReceive}</div>
      <div className="widget__row">
        <span className="widget__cur"><Monogram name={getCur} small />{getCur}</span>
        <span className="widget__amt" style={{ color: 'var(--mut)' }}>{amount}</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="widget__kv">
          <span>{t.detail.estApy}<sup>1</sup></span>
          <b>{apyDisplay(product.targetApy)}</b>
        </div>
        <div className="widget__kv">
          <span>{t.detail.estTerm}</span>
          <b>{product.termLabel}</b>
        </div>
        <div className="widget__kv">
          <span>{t.detail.estFee}</span>
          <b>{t.detail.feeNone}</b>
        </div>
      </div>

      <button className="btn btn--gold btn--block widget__cta" onClick={openModal}>
        {t.detail.connectFirst}
      </button>
      <p className="widget__note">{t.detail.connectNote}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/** The dark opening band. Rendered in every request state so the masthead
    always has a dark field to sit over at the top of the route. */
function DetailHead({ t, children }) {
  return (
    <header className="phead phead--detail">
      <div className="phead__bg" aria-hidden="true" />
      <div className="wrap phead__inner">
        <div className="crumbs">
          <Link to="/">{t.detail.home}</Link>
          <span>/</span>
          <Link to="/products">{t.nav.products}</Link>
        </div>
        {children}
      </div>
    </header>
  );
}

export default function ProductDetail() {
  const { slug } = useParams();
  const { t } = useI18n();

  const fetcher = useCallback((opts) => api.product(slug, opts), [slug]);
  const { data: p, loading, error, retry } = useApi(fetcher, [slug]);

  if (loading) {
    return (
      <>
        <DetailHead t={t}>
          <Skeleton height={40} width="45%" style={{ background: 'rgba(255,255,255,.1)' }} />
          <Skeleton height={18} width="65%" style={{ marginTop: 14, background: 'rgba(255,255,255,.08)' }} />
        </DetailHead>
        <section className="band band--paper">
          <div className="wrap">
            <Skeleton height={100} />
            <Skeleton height={250} style={{ marginTop: 20 }} />
          </div>
        </section>
      </>
    );
  }

  if (error?.status === 404) {
    return (
      <>
        <DetailHead t={t}>
          <h1 className="phead__title">{t.detail.notFound}</h1>
          <p className="phead__lede">{t.detail.notFoundBody}</p>
          <div className="phead__extra">
            <Link to="/products" className="btn btn--light">{t.detail.back}</Link>
          </div>
        </DetailHead>
        <section className="band band--paper" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <DetailHead t={t}><h1 className="phead__title">{t.common.errorTitle}</h1></DetailHead>
        <section className="band band--paper">
          <div className="wrap"><ErrorState error={error} onRetry={retry} /></div>
        </section>
      </>
    );
  }
  if (!p) return null;

  const soon = p.status === 'coming_soon';
  const used = utilisation(p.tvl, p.capacity);

  return (
    <>
      <DetailHead t={t}>
        <div className="dhead">
          <div className="dhead__ic">{p.name.replace(/[·.]/g, ' ').split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</div>
          <div className="dhead__main">
            <h1 className="dhead__title">
              {p.name}
              <StatusPill status={p.status} />
            </h1>
            <p className="dhead__tagline">{p.tagline}</p>
            <div className="dhead__pills">
              <span className="pill pill--gold">{p.roleLabel}</span>
              <span className="pill">{p.network}</span>
              <span className="pill">{p.denomination}</span>
              {p.tokenStandard && <span className="pill">{p.tokenStandard}</span>}
              <span className="pill">{p.strategyManager}</span>
            </div>
          </div>
        </div>
      </DetailHead>

      <section className="band band--paper">
        <div className="wrap">
          {soon && (
            <div className="risk" style={{ marginBottom: 20 }}>
              <div className="risk__ic">!</div>
              <div><p className="risk__text">{t.detail.comingSoonNotice}</p></div>
            </div>
          )}

          <div className="dlayout">
            <div className="dmain">
              <div className="dstats">
                <StatCard
                  label={apyIsRange(p.targetApy) ? t.common.apyRange : t.detail.statApy}
                  value={apyDisplay(p.targetApy)}
                  gold
                  tip={t.footer.note1}
                />
                <StatCard
                  label={t.detail.statTvl}
                  value={currencyCompact(p.tvl)}
                  sub={p.capacity ? `${t.detail.statCapacityUsed} ${percent((used ?? 0) * 100, { digits: 1 })}` : undefined}
                />
                <StatCard label={t.detail.statTerm} value={p.termLabel} />
                <StatCard label={t.detail.statDenom} value={p.denomination} />
              </div>

              {p.capacity && (
                <CapacityBar
                  tvl={p.tvl}
                  capacity={p.capacity}
                  leftLabel={currencyFull(p.tvl)}
                  rightLabel={currencyFull(p.capacity)}
                />
              )}

              {p.navHistory?.length > 1 && (
                <Reveal><NavChart history={p.navHistory} inceptionDate={p.inceptionDate} /></Reveal>
              )}

              <Reveal className="dcard">
                <h2 className="dcard__title">{t.detail.overview}</h2>
                <p className="dcard__body">{p.summary}</p>
              </Reveal>

              {p.strategyNote && (
                <Reveal className="dcard">
                  <h2 className="dcard__title">{t.detail.strategy}</h2>
                  <p className="dcard__body">{p.strategyNote}</p>
                </Reveal>
              )}

              {p.redemptionNote && (
                <Reveal className="dcard">
                  <h2 className="dcard__title">{t.detail.redemption}<sup>3</sup></h2>
                  <p className="dcard__body">{p.redemptionNote}</p>
                </Reveal>
              )}

              <Reveal className="dcard">
                <h2 className="dcard__title">{t.detail.keyfacts}</h2>
                <div className="kvs">
                  <Fact k={t.detail.factRole} v={p.roleLabel} />
                  <Fact k={t.detail.factUnderlying} v={p.underlying} />
                  <Fact k={t.detail.factManager} v={p.strategyManager} />
                  <Fact k={t.detail.factStrategy} v={p.strategyRef} />
                  <Fact k={t.detail.factNetwork} v={p.network} />
                  <Fact k={t.detail.factStandard} v={p.tokenStandard} />
                  <Fact k={t.detail.factInception} v={p.inceptionDate ? isoDate(p.inceptionDate) : null} />
                  <Fact k={t.detail.factCapacity} v={p.capacity ? currencyFull(p.capacity) : null} />
                  <Fact k={t.detail.factContract} v={p.contractAddress ? shortAddress(p.contractAddress) : null} mono />
                </div>
              </Reveal>

              <Reveal className="dcard">
                <h2 className="dcard__title">{t.detail.documents}</h2>
                {p.documents.length === 0 && <p className="dcard__body">{t.detail.docNone}</p>}
                <div className="doclist">
                  {p.documents.map(d => (
                    <div className="doc" key={d.id}>
                      <span className="doc__ic">↓</span>
                      <span className="doc__title">{d.title}</span>
                      <span className="doc__kind">{d.kind}</span>
                      {d.url
                        ? <a className="btn btn--sm btn--ghost doc__open" href={d.url} target="_blank" rel="noreferrer">↗</a>
                        : <span className="doc__na doc__open">{t.home.auditNoReport}</span>}
                    </div>
                  ))}
                </div>
              </Reveal>

              {p.activity.length > 0 && (
                <Reveal className="dcard">
                  <h2 className="dcard__title">{t.detail.activity}</h2>
                  {p.activity.map(a => {
                    const label = { deposit: t.detail.actDeposit, redeem: t.detail.actRedeem, yield: t.detail.actYield }[a.kind];
                    const glyph = { deposit: '↓', redeem: '↑', yield: '✦' }[a.kind];
                    return (
                      <div className="act" key={a.id}>
                        <span className={`act__ic act__ic--${a.kind}`}>{glyph}</span>
                        <span className="act__txt">{label}</span>
                        <span className="act__amt">{currencyFull(a.amount)}</span>
                        <span className="act__dt">{dateTime(a.occurredAt)}</span>
                      </div>
                    );
                  })}
                </Reveal>
              )}

              <Reveal className="risk" style={{ marginTop: 20 }}>
                <div className="risk__ic">!</div>
                <div>
                  <div className="risk__title">{t.detail.risk}</div>
                  <p className="risk__text">{p.riskNote}</p>
                </div>
              </Reveal>
            </div>

            <aside className="dside">
              <TradeWidget product={p} />
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
