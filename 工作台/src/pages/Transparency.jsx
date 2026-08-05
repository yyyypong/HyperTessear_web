import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import TimeSeriesChart from '../components/TimeSeriesChart';
import PageHead from '../components/PageHead';
import Reveal from '../components/Reveal';
import { ErrorState, Monogram, Skeleton } from '../components/ui';
import { currencyCompact, currencyFull, isoDate, percent, shortAddress } from '../lib/format';

/**
 * The page the nav has been promising since the wireframe.
 *
 * Its organising idea: a transparency page that only *asserts* a TVL
 * figure is marketing. This one shows the same number arrived at three
 * ways — sum of product TVL, the reported metric, and attested
 * reserves — and prints the difference when they disagree.
 */
function Reconciliation({ recon, t }) {
  const ok = recon.reconciles;
  const diff = Math.max(
    Math.abs(recon.productSum - recon.reported),
    Math.abs(recon.reserves - recon.reported)
  );

  return (
    <div className="recon">
      <div className="recon__cell">
        <div className="recon__label">{t.transparency.labelProductSum}</div>
        <div className="recon__value">{currencyFull(recon.productSum)}</div>
      </div>
      <div className="recon__cell">
        <div className="recon__label">{t.transparency.labelReported}</div>
        <div className="recon__value">{currencyFull(recon.reported)}</div>
      </div>
      <div className="recon__cell">
        <div className="recon__label">{t.transparency.labelReserves}</div>
        <div className="recon__value">{currencyFull(recon.reserves)}</div>
      </div>
      <div className={`recon__verdict${ok ? '' : ' recon__verdict--bad'}`}>
        <div className="recon__verdict-title">
          {ok ? '✓' : '!'} {ok ? t.transparency.reconcileOk : t.transparency.reconcileFail}
        </div>
        {!ok && (
          <div className="recon__verdict-sub">
            {t.transparency.diff} {currencyFull(diff)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Heading + optional lede for a block inside the page body. */
function Block({ title, lede, children, step = 0 }) {
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

export default function Transparency() {
  const { t } = useI18n();
  const { data, loading, error, retry } = useApi(api.transparency);

  /* The head renders regardless of request state: it holds no remote data,
     and the masthead is white-on-dark at the top of every route, so a
     light-background loading screen would leave the nav unreadable. */
  const head = (
    <PageHead
      eyebrow={t.transparency.eyebrow}
      title={t.transparency.title}
      lede={t.transparency.lede}
    />
  );

  if (loading) {
    return (
      <>
        {head}
        <section className="band band--paper">
          <div className="wrap">
            <Skeleton height={110} />
            <Skeleton height={260} style={{ marginTop: 20 }} />
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

  const tvlSeries = data.tvlHistory.map(p => ({ date: p.date, value: p.value }));

  return (
    <>
      {head}

      <section className="band band--paper">
        <div className="wrap">
          <Block title={t.transparency.reconcileTitle}>
            <Reconciliation recon={data.reconciliation} t={t} />
            <div className="kpis__note">
              {t.transparency.reconcileNote} · {t.common.asOf} {isoDate(data.tvl.lastUpdated)}
            </div>
          </Block>

          <Block title={t.transparency.tvlChartTitle} lede={t.transparency.tvlChartLede}>
            <div className="dcard" style={{ marginTop: 0 }}>
              <TimeSeriesChart
                data={tvlSeries}
                label={t.transparency.tvlChartTitle}
                tooltipLabel="TVL"
                formatValue={(v) => currencyCompact(v)}
                formatAxis={(v) => currencyCompact(v)}
                ranges={[
                  { label: t.detail.range30, days: 30 },
                  { label: t.detail.range90, days: 90 },
                  { label: t.detail.rangeAll, days: 'all' },
                ]}
                defaultRangeIndex={2}
                subLabel={(first, last) => `${isoDate(first.date)} → ${isoDate(last.date)}`}
              />
            </div>
          </Block>

          <Block title={t.transparency.compositionTitle} lede={t.transparency.compositionLede}>
            <div className="dcard" style={{ marginTop: 0 }}>
              <div className="tablewrap">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>{t.transparency.colProduct}</th>
                      <th style={{ textAlign: 'right' }}>{t.transparency.colTvl}</th>
                      <th style={{ textAlign: 'right' }}>{t.transparency.colShare}</th>
                      <th style={{ textAlign: 'right' }}>{t.transparency.colNav}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tvl.composition.map(c => (
                      <tr key={c.slug}>
                        <td>
                          <Link to={`/products/${c.slug}`} className="name">
                            <Monogram name={c.name} small />
                            {c.name}
                          </Link>
                        </td>
                        <td className="num">{currencyFull(c.tvl)}</td>
                        <td>
                          <div className="sharecell">
                            <span className="sharecell__track">
                              <span className="sharecell__fill" style={{ width: `${(c.share * 100).toFixed(1)}%` }} />
                            </span>
                            <span className="sharecell__pct">{percent(c.share * 100, { digits: 1 })}</span>
                          </div>
                        </td>
                        <td className="num">{c.nav === null ? '—' : c.nav.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t.transparency.labelProductSum}</td>
                      <td className="num">{currencyFull(data.tvl.productSum)}</td>
                      <td className="num">100%</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </Block>

          <Block title={t.transparency.reservesTitle} lede={t.transparency.reservesLede}>
            <div className="dcard" style={{ marginTop: 0 }}>
              <div className="tablewrap">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>{t.transparency.colAsset}</th>
                      <th style={{ textAlign: 'right' }}>{t.transparency.colAmount}</th>
                      <th style={{ textAlign: 'right' }}>{t.transparency.colShare}</th>
                      <th>{t.transparency.colAttestor}</th>
                      <th>{t.transparency.colAttested}</th>
                      <th>{t.transparency.colReport}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reserves.items.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 500, color: 'var(--navy)' }}>{r.assetClass}</td>
                        <td className="num">{currencyFull(r.amount)}</td>
                        <td className="num">{percent(r.share * 100, { digits: 1 })}</td>
                        <td>{r.attestor}</td>
                        <td className="addr">{isoDate(r.attestedAt)}</td>
                        <td>
                          {r.reportUrl
                            ? <a className="audit__link" href={r.reportUrl} target="_blank" rel="noreferrer">{t.transparency.viewReport}</a>
                            : <span className="doc__na">{t.transparency.noReport}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t.transparency.labelReserves}</td>
                      <td className="num">{currencyFull(data.reserves.total)}</td>
                      <td className="num">100%</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </Block>

          <Block title={t.transparency.contractsTitle} lede={t.transparency.contractsLede}>
            <div className="dcard" style={{ marginTop: 0 }}>
              <div className="tablewrap">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>{t.transparency.colProduct}</th>
                      <th>{t.transparency.colNetwork}</th>
                      <th>{t.transparency.colStandard}</th>
                      <th>{t.transparency.colAddress}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contracts.map(c => (
                      <tr key={c.slug}>
                        <td>
                          <Link to={`/products/${c.slug}`} className="name">
                            <Monogram name={c.name} small />
                            {c.name}
                          </Link>
                        </td>
                        <td>{c.network}</td>
                        <td>{c.tokenStandard}</td>
                        <td className="addr" title={c.address}>{shortAddress(c.address)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Block>

          <section className="section--tight">
            <Reveal>
              <h2 className="section__title section__title--sm">{t.transparency.auditsTitle}</h2>
            </Reveal>
            <div className="audits" style={{ marginTop: 16 }}>
              {data.audits.map((a, i) => (
                <Reveal step={i} className="audit" key={a.id}>
                  <div className="audit__top">
                    <span className="monogram monogram--sm">{a.auditor.slice(0, 2).toUpperCase()}</span>
                    <span className="audit__name">{a.auditor}</span>
                  </div>
                  <div className="audit__scope">{a.scope}</div>
                  <div className="audit__foot">
                    <span>{t.home.auditCompleted} {isoDate(a.completedAt)}</span>
                    {a.reportUrl
                      ? <a className="audit__link" href={a.reportUrl} target="_blank" rel="noreferrer">{t.home.auditReport}</a>
                      : <span>{t.home.auditNoReport}</span>}
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
