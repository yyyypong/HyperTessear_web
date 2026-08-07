import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import Reveal from './Reveal';
import { InfoTip } from './ui';
import { currencyFull, integer, percent } from '../lib/format';

/**
 * Shared furniture for the two data pages (Charts & Stats and Product
 * Details). Both render the same three shapes over and over — a figure
 * with a caption, a titled block, and a proportional breakdown — so
 * they live here rather than being written twice.
 */

/** A single headline figure. `tip` carries the metric's definition. */
export function StatCard({ label, value, sub, gold, tip }) {
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

/** Heading, optional lede, then content. */
export function Block({ title, lede, children, step = 0 }) {
  return (
    <section className="section--tight">
      <Reveal step={step}>
        <h2 className="section__title section__title--sm">{title}</h2>
        {lede && <p className="section__lede">{lede}</p>}
      </Reveal>
      <Reveal step={step + 1}>{children}</Reveal>
    </section>
  );
}

/** Key/value row; renders nothing rather than an empty row for a blank value. */
export function Fact({ k, v, mono }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="kv">
      <span className="kv__k">{k}</span>
      <span className={`kv__v${mono ? ' kv__v--mono' : ''}`}>{v}</span>
    </div>
  );
}

/**
 * A proportional breakdown: label, figure, and a bar showing its share
 * of the group.
 *
 * Rows carrying a `slug` become links — the plan (§1.2) asks for the
 * AUM composition to open the corresponding product page, and that is
 * the only navigation into a product this page offers.
 *
 * `counts` switches the value column from currency to a plain integer,
 * which is what the investor breakdowns need.
 */
export function BreakdownTable({ rows, valueLabel, counts = false, emptyText }) {
  const { t } = useI18n();
  if (!rows || rows.length === 0) {
    return <p className="dcard__body">{emptyText || t.charts.noData}</p>;
  }
  return (
    <div className="tablewrap">
      <table className="dtable">
        <thead>
          <tr>
            <th>{t.charts.colLabel}</th>
            <th style={{ textAlign: 'right' }}>{valueLabel || (counts ? t.charts.colCount : t.charts.colValue)}</th>
            <th style={{ textAlign: 'right' }}>{t.charts.colShare}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.label}-${r.slug || ''}`}>
              <td>
                {r.slug
                  ? <Link to={`/products/${r.slug}`} className="name">{r.label}</Link>
                  : <span style={{ fontWeight: 500, color: 'var(--navy)' }}>{r.label}</span>}
              </td>
              <td className="num">
                {counts ? integer(r.count) : currencyFull(r.value)}
              </td>
              <td>
                <div className="sharecell">
                  <span className="sharecell__track">
                    <span
                      className="sharecell__fill"
                      style={{ width: `${((r.share ?? 0) * 100).toFixed(1)}%` }}
                    />
                  </span>
                  <span className="sharecell__pct">{percent((r.share ?? 0) * 100, { digits: 1 })}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The "this is not real yet" marker.
 *
 * Development recommendation 7 of the plan requires all mock data to
 * be clearly marked as Demo. Rendering it as a standing banner at the
 * top of the page — rather than a footnote — is the only placement
 * where a reader cannot miss it before reading the figures.
 */
export function DemoNote({ badge, children }) {
  return (
    <div className="risk demo-note">
      <div className="risk__ic">i</div>
      <div>
        <div className="risk__title">
          <span className="pill pill--gold">{badge}</span>
        </div>
        <p className="risk__text">{children}</p>
      </div>
    </div>
  );
}
