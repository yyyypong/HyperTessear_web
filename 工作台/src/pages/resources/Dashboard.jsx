import { fmt, useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import PageHead from '../../components/PageHead';
import Reveal from '../../components/Reveal';
import TimeSeriesChart from '../../components/TimeSeriesChart';
import { ErrorState, Skeleton } from '../../components/ui';
import { Block, BreakdownTable, DemoNote, StatCard } from '../../components/stats';
import { currencyCompact, currencyFull, integer, isoDate } from '../../lib/format';

/**
 * Charts & Stats — protocol-level aggregated data, per section 1 of
 * HyperTessera_Data_Pages_Plan.md.
 *
 * The page's organising constraint comes from §1.1: Protocol AUM,
 * Tokenized Assets and Protocol Revenue are separate accounting
 * measures and must not be combined. So the core strip presents them
 * side by side without a total, and each gets its own section below
 * rather than being rolled into a single "protocol size" narrative.
 *
 * Where the plan states a rule about what a figure excludes, this page
 * shows the exclusions rather than only obeying them — the NAV-less
 * RWA assets and the investor double-count are both printed, because a
 * reader can only judge a figure they can see the edges of.
 */

/** One chart in a `.dcard`, with the page's standard range tabs. */
function ChartCard({ title, data, tooltipLabel, format, defaultRangeIndex = 2 }) {
  const { t } = useI18n();
  if (!data || data.length < 2) return null;
  return (
    <div className="dcard" style={{ marginTop: 0 }}>
      <TimeSeriesChart
        data={data}
        label={title}
        tooltipLabel={tooltipLabel}
        formatValue={format}
        formatAxis={format}
        ranges={[
          { label: t.detail.range30, days: 30 },
          { label: t.detail.range90, days: 90 },
          { label: t.detail.rangeAll, days: 'all' },
        ]}
        defaultRangeIndex={defaultRangeIndex}
        subLabel={(first, last) => `${isoDate(first.date)} → ${isoDate(last.date)}`}
      />
    </div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { data, loading, error, retry } = useApi(api.protocolStats);

  /* The head renders in every request state: it holds no remote data,
     and the masthead sits white-on-dark at the top of the route, so a
     light loading screen would leave the nav unreadable. */
  const head = (
    <PageHead
      eyebrow={t.resources.dashboardEyebrow}
      title={t.resources.dashboardTitle}
      lede={t.resources.dashboardLede}
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

  const { core, aum, tokenized, investors, interest, revenue } = data;
  const asOf = `${t.common.asOf} ${isoDate(data.asOf)}`;
  const money = (v) => currencyCompact(v);

  const reasonLabel = {
    no_nav: t.charts.reasonNoNav,
    no_token: t.charts.reasonNoToken,
    inactive: t.charts.reasonInactive,
  };

  return (
    <>
      {head}

      <section className="band band--paper">
        <div className="wrap">
          <Reveal>
            <DemoNote badge={t.charts.demoBadge}>{t.charts.demoNote}</DemoNote>
          </Reveal>

          {/* ---- core metrics (§1.1) ---- */}
          <Block title={t.charts.coreTitle}>
            <div className="dstats dstats--wide">
              <StatCard label={t.charts.mAum} value={money(core.protocolAum?.value)} sub={asOf} gold />
              <StatCard label={t.charts.mTokenized} value={money(core.tokenizedAssets?.value)} sub={asOf} />
              <StatCard label={t.charts.mRevenue} value={money(core.protocolRevenue?.value)} sub={asOf} />
              <StatCard label={t.charts.mInterest} value={money(core.totalInterestGenerated?.value)} sub={asOf} />
              <StatCard label={t.charts.mInvestors} value={integer(core.totalInvestors?.value)} sub={asOf} />
              <StatCard label={t.charts.mVaults} value={integer(core.activeVaults?.value)} sub={asOf} />
              <StatCard label={t.charts.mAssets} value={integer(core.issuedRwaAssets?.value)} sub={asOf} />
            </div>
            <div className="kpis__note">{t.charts.coreNote}</div>
          </Block>

          {/* ---- Protocol AUM (§1.2) ---- */}
          <Block title={t.charts.aumTitle} lede={t.charts.aumLede}>
            <ChartCard
              title={t.charts.aumHistory}
              data={aum.history}
              tooltipLabel="AUM"
              format={money}
            />
            <div className="pairgrid">
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.aumByProduct}</h3>
                <BreakdownTable rows={aum.byProduct} />
                <p className="dcard__note">{t.charts.aumByProductNote}</p>
              </div>
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.aumByNetwork}</h3>
                <BreakdownTable rows={aum.byNetwork} />
                <h3 className="dcard__title" style={{ marginTop: 22 }}>{t.charts.aumByType}</h3>
                <BreakdownTable rows={aum.byProductType} />
              </div>
            </div>
          </Block>

          {/* ---- Tokenized assets (§1.3) ---- */}
          <Block title={t.charts.tokTitle} lede={t.charts.tokLede}>
            <div className="dstats">
              <StatCard label={t.charts.mTokenized} value={money(core.tokenizedAssets?.value)} gold />
              <StatCard label={t.charts.tokActive} value={integer(tokenized.activeAssets)} />
              <StatCard label={t.charts.tokTokens} value={integer(tokenized.tokenCount)} />
              <StatCard label={t.charts.tokValued} value={integer(tokenized.valuedCount)} />
            </div>
            <ChartCard
              title={t.charts.tokHistory}
              data={tokenized.history}
              tooltipLabel={t.charts.mTokenized}
              format={money}
            />
            <div className="pairgrid">
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.tokByType}</h3>
                <BreakdownTable rows={tokenized.byAssetType} />
                <h3 className="dcard__title" style={{ marginTop: 22 }}>{t.charts.tokByNetwork}</h3>
                <BreakdownTable rows={tokenized.byNetwork} />
              </div>
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.tokByToken}</h3>
                <BreakdownTable rows={tokenized.byToken} />
              </div>
            </div>

            {/* The plan requires NAV-less assets to be excluded rather
                than zero-valued; printing them is what makes that
                rule checkable instead of merely asserted. */}
            {tokenized.excluded.length > 0 && (
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.tokExcluded}</h3>
                <p className="dcard__body">{t.charts.tokExcludedNote}</p>
                <div className="tablewrap">
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th>{t.charts.colLabel}</th>
                        <th>{t.charts.colType}</th>
                        <th>{t.charts.colNetwork}</th>
                        <th>{t.charts.colReason}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokenized.excluded.map(a => (
                        <tr key={a.name}>
                          <td style={{ fontWeight: 500, color: 'var(--navy)' }}>{a.name}</td>
                          <td>{a.assetType}</td>
                          <td>{a.network}</td>
                          <td><span className="pill pill--mut">{reasonLabel[a.reason] || a.reason}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Block>

          {/* ---- Total investors (§1.4) ---- */}
          <Block title={t.charts.invTitle} lede={t.charts.invLede}>
            <ChartCard
              title={t.charts.invHistory}
              data={investors.history}
              tooltipLabel={t.charts.mInvestors}
              format={(v) => integer(Math.round(v))}
            />
            <div className="pairgrid">
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.invByProduct}</h3>
                <BreakdownTable rows={investors.byProduct} counts />
              </div>
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.invByNetwork}</h3>
                <BreakdownTable rows={investors.byNetwork} counts />
              </div>
            </div>
            <div className="kpis__note">
              {fmt(t.charts.invOverlapNote, {
                sum: integer(investors.sumOfProducts),
                unique: integer(core.totalInvestors?.value),
              })}
              {' '}
              {t.charts.invCaveat}
            </div>
          </Block>

          {/* ---- Total interest generated (§1.5) ---- */}
          <Block title={t.charts.intTitle} lede={t.charts.intLede}>
            <div className="dstats">
              <StatCard label={t.charts.int30} value={money(interest.last30d)} />
              <StatCard label={t.charts.int90} value={money(interest.last90d)} />
              <StatCard label={t.charts.intInception} value={money(interest.sinceInception)} gold />
            </div>
            <ChartCard
              title={t.charts.intHistory}
              data={interest.history}
              tooltipLabel={t.charts.mInterest}
              format={money}
            />
            <div className="pairgrid">
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.intByProduct}</h3>
                <BreakdownTable rows={interest.byProduct} />
              </div>
              <div className="dcard">
                <h3 className="dcard__title">{t.charts.intByNetwork}</h3>
                <BreakdownTable rows={interest.byNetwork} />
              </div>
            </div>
            <div className="kpis__note">{t.charts.intCaveat}</div>
          </Block>

          {/* ---- Protocol revenue (§1.6) ---- */}
          <Block title={t.charts.revTitle} lede={t.charts.revLede}>
            <div className="dstats">
              <StatCard label={t.charts.revFeeIncome} value={money(core.protocolRevenue?.value)} gold />
              <StatCard label={t.charts.revPoolValue} value={money(core.revenuePoolValue?.value)} />
              <StatCard label={t.charts.revOther} value={money(core.revenuePoolOtherIncome?.value)} />
              <StatCard label={t.charts.revOutflows} value={money(core.revenuePoolOutflows?.value)} />
            </div>
            <ChartCard
              title={t.charts.revHistory}
              data={revenue.history}
              tooltipLabel={t.charts.mRevenue}
              format={money}
            />

            <div className="dcard">
              <h3 className="dcard__title">{t.charts.revByVault}</h3>
              <BreakdownTable rows={revenue.byVault} />
            </div>

            <div className="dcard">
              <h3 className="dcard__title">{t.charts.revHoldings}</h3>
              <div className="tablewrap">
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>{t.charts.colLabel}</th>
                      <th>{t.charts.colNetwork}</th>
                      <th style={{ textAlign: 'right' }}>{t.charts.colAmount}</th>
                      <th style={{ textAlign: 'right' }}>{t.charts.colValue}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.holdings.priced.map(h => (
                      <tr key={h.id}>
                        <td style={{ fontWeight: 500, color: 'var(--navy)' }}>{h.label}</td>
                        <td>{h.network}</td>
                        <td className="num">{integer(Math.round(h.amount))}</td>
                        <td className="num">{currencyFull(h.valueUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t.charts.revPoolValue}</td>
                      <td />
                      <td />
                      <td className="num">{currencyFull(revenue.holdings.pricedTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Kept out of the total on purpose — see the note. */}
              {revenue.holdings.unpriced.length > 0 && (
                <>
                  <h3 className="dcard__title" style={{ marginTop: 24 }}>{t.charts.revUnpriced}</h3>
                  <p className="dcard__body">{t.charts.revUnpricedNote}</p>
                  <div className="tablewrap">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>{t.charts.colLabel}</th>
                          <th>{t.charts.colNetwork}</th>
                          <th style={{ textAlign: 'right' }}>{t.charts.colAmount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenue.holdings.unpriced.map(h => (
                          <tr key={h.id}>
                            <td style={{ fontWeight: 500, color: 'var(--navy)' }}>{h.label}</td>
                            <td>{h.network}</td>
                            <td className="num">{integer(Math.round(h.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="pairgrid">
              {[
                [t.charts.revInflows, revenue.inflows],
                [t.charts.revOutflowsTitle, revenue.outflows],
              ].map(([title, rows]) => (
                <div className="dcard" key={title}>
                  <h3 className="dcard__title">{title}</h3>
                  <div className="tablewrap">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th>{t.charts.colSource}</th>
                          <th>{t.charts.colDate}</th>
                          <th style={{ textAlign: 'right' }}>{t.charts.colAmount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(f => (
                          <tr key={f.id}>
                            <td style={{ fontWeight: 500, color: 'var(--navy)' }}>{f.source}</td>
                            <td className="addr">{isoDate(f.occurredAt)}</td>
                            <td className="num">{currencyFull(f.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Block>
        </div>
      </section>
    </>
  );
}
