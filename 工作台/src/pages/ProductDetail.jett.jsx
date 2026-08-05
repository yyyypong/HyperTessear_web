import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import NavChart from '../components/NavChart';
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

   Read-only on purpose: wallet connection lands in phase 4. It shows
   the shape of the flow and the terms that apply, and cannot submit
   anything — a disabled button that says why beats a live-looking
   form that silently does nothing.
   ---------------------------------------------------------------- */
function TradeWidget({ product }) {
  const { t } = useI18n();
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

      <button className="btn btn--gold btn--block widget__cta" disabled>
        {t.detail.connectFirst}
      </button>
      <p className="widget__note">{t.detail.connectNote}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
export default function ProductDetail() {
  const { slug } = useParams();
  const { t } = useI18n();

  const fetcher = useCallback((opts) => api.product(slug, opts), [slug]);
  const { data: p, loading, error, retry } = useApi(fetcher, [slug]);

  if (loading) {
    return (
      <div className="wrap" style={{ paddingTop: 40 }}>
        <Skeleton height={40} width="45%" />
        <Skeleton height={18} width="65%" style={{ marginTop: 12 }} />
        <Skeleton height={90} style={{ marginTop: 26 }} />
        <Skeleton height={240} style={{ marginTop: 16 }} />
      </div>
    );
  }

  if (error?.status === 404) {
    return (
      <div className="wrap" style={{ padding: '60px 0' }}>
        <h1 className="phead__title">{t.detail.notFound}</h1>
        <p className="section__lede">{t.detail.notFoundBody}</p>
        <Link to="/products" className="btn">{t.detail.back}</Link>
      </div>
    );
  }

  if (error) {
    return <div className="wrap" style={{ padding: '40px 0' }}><ErrorState error={error} onRetry={retry} /></div>;
  }
  if (!p) return null;

  const soon = p.status === 'coming_soon';
  const used = utilisation(p.tvl, p.capacity);

  return (
    <div className="wrap">
      <div className="crumbs">
        <Link to="/">{t.detail.home}</Link>
        <span>/</span>
        <Link to="/products">{t.nav.products}</Link>
        <span>/</span>
        {p.name}
      </div>

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

      {soon && (
        <div className="risk" style={{ marginTop: 0, marginBottom: 20 }}>
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
            <div style={{ marginTop: 12 }}>
              <CapacityBar
                tvl={p.tvl}
                capacity={p.capacity}
                leftLabel={currencyFull(p.tvl)}
                rightLabel={currencyFull(p.capacity)}
              />
            </div>
          )}

          {p.navHistory?.length > 1 && (
            <NavChart history={p.navHistory} inceptionDate={p.inceptionDate} />
          )}

          <div className="dcard">
            <h2 className="dcard__title">{t.detail.overview}</h2>
            <p className="dcard__body">{p.summary}</p>
          </div>

          {p.strategyNote && (
            <div className="dcard">
              <h2 className="dcard__title">{t.detail.strategy}</h2>
              <p className="dcard__body">{p.strategyNote}</p>
            </div>
          )}

          {p.redemptionNote && (
            <div className="dcard">
              <h2 className="dcard__title">{t.detail.redemption}<sup style={{ color: 'var(--gold)' }}>3</sup></h2>
              <p className="dcard__body">{p.redemptionNote}</p>
            </div>
          )}

          <div className="dcard">
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
          </div>

          <div className="dcard">
            <h2 className="dcard__title">{t.detail.documents}</h2>
            {p.documents.length === 0 && <p className="dcard__body">{t.detail.docNone}</p>}
            <div className="doclist">
              {p.documents.map(d => (
                <div className="doc" key={d.id}>
                  <span className="doc__ic">↓</span>
                  <span className="doc__title">{d.title}</span>
                  <span className="doc__kind">{d.kind}</span>
                  {d.url
                    ? <a className="btn btn--sm btn--ghost" href={d.url} target="_blank" rel="noreferrer" style={{ marginLeft: 12 }}>↗</a>
                    : <span className="doc__na" style={{ marginLeft: 12 }}>{t.home.auditNoReport}</span>}
                </div>
              ))}
            </div>
          </div>

          {p.activity.length > 0 && (
            <div className="dcard">
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
            </div>
          )}

          <div className="risk">
            <div className="risk__ic">!</div>
            <div>
              <div className="risk__title">{t.detail.risk}</div>
              <p className="risk__text">{p.riskNote}</p>
            </div>
          </div>
        </div>

        <aside className="dside">
          <TradeWidget product={p} />
        </aside>
      </div>
    </div>
  );
}
