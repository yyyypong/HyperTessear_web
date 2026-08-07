const pool = require('../db/pool');
const cache = require('../lib/cache');
const {
  toMetric, toBreakdown, toSeriesPoint, toRwaAsset, toHolding, toFlow, assertNoInternalFields,
} = require('../dto/publicShapes');

/**
 * Everything the Charts & Stats page needs, per plan section 1.
 *
 * The plan opens (§1.1) by insisting that Protocol AUM, Tokenized
 * Assets and Protocol Revenue are separate accounting metrics that
 * must not be combined into another total. This service therefore
 * returns them as three sibling branches and deliberately computes no
 * grand total anywhere — there is no field a caller could mistake for
 * one.
 */

/** Scalars that come from v_metric_latest. */
const CORE_KEYS = [
  'protocolAum',
  'tokenizedAssets',
  'activeVaults',
  'issuedRwaAssets',
  'totalInvestors',
  'totalInterestGenerated',
  'protocolRevenue',
  'revenuePoolValue',
  'revenuePoolOutflows',
  'revenuePoolOtherIncome',
];

const sum = (rows, pick) => rows.reduce((acc, r) => acc + (Number(pick(r)) || 0), 0);

/** Rows for one metric_key/dimension pair, with shares against their own total. */
function slice(rows, metricKey, dimension) {
  const picked = rows.filter(r => r.metric_key === metricKey && r.dimension === dimension);
  const total = sum(picked, r => (r.value_num === null ? r.value_int : r.value_num));
  return picked.map(r => toBreakdown(r, total));
}

/**
 * Yield accrued over a trailing window (plan §1.5 asks for 30d, 90d
 * and since-inception). The cumulative series is the source, so a
 * window is the difference between its endpoints rather than a
 * separate stored figure that could drift from the total.
 */
function windowed(series, days) {
  if (series.length === 0) return null;
  const last = series[series.length - 1].value;
  if (days === null) return last;
  const cutoff = new Date(`${String(series[series.length - 1].date).slice(0, 10)}T00:00:00Z`)
    .getTime() - days * 86400000;
  const before = series.filter(
    p => new Date(`${String(p.date).slice(0, 10)}T00:00:00Z`).getTime() <= cutoff
  );
  // No reading old enough means the whole series sits inside the
  // window, so everything accrued in it.
  return before.length ? last - before[before.length - 1].value : last;
}

async function getProtocolStats(locale = 'zh-CN') {
  return cache.wrap(`protocol:${locale}`, 60, async () => {
    const [
      [metricRows], [breakdownRows], [assetRows], [holdingRows], [flowRows],
      [aumHistory], [tokHistory], [invHistory], [interestHistory], [revenueHistory],
      [productNames],
    ] = await Promise.all([
      pool.query('SELECT * FROM v_metric_latest'),
      pool.query('SELECT * FROM protocol_breakdowns ORDER BY metric_key, dimension, sort_order'),
      pool.query('SELECT * FROM rwa_assets ORDER BY sort_order'),
      pool.query('SELECT * FROM revenue_pool_holdings ORDER BY sort_order'),
      pool.query('SELECT * FROM revenue_flows ORDER BY occurred_at'),
      pool.query("SELECT captured_at, value_num FROM metric_readings WHERE metric_key = 'protocolAum' ORDER BY captured_at"),
      pool.query("SELECT captured_at, value_num FROM metric_readings WHERE metric_key = 'tokenizedAssets' ORDER BY captured_at"),
      pool.query("SELECT captured_at, value_num FROM metric_readings WHERE metric_key = 'totalInvestorsSeries' ORDER BY captured_at"),
      pool.query("SELECT captured_at, value_num FROM metric_readings WHERE metric_key = 'totalInterestGenerated' ORDER BY captured_at"),
      pool.query("SELECT captured_at, value_num FROM metric_readings WHERE metric_key = 'protocolRevenue' ORDER BY captured_at"),
      pool.query(`SELECT p.slug, t.name FROM products p
                    JOIN product_translations t ON t.slug = p.slug AND t.locale = ?`, [locale]),
    ]);

    const byKey = Object.fromEntries(metricRows.map(r => [r.metric_key, r]));
    const core = {};
    for (const key of CORE_KEYS) core[key] = toMetric(byKey[key]);

    // Breakdown rows store the product slug as their label; swap in
    // the localised product name for display, keeping slug for links.
    const nameOf = Object.fromEntries(productNames.map(r => [r.slug, r.name]));
    const named = (rows) => rows.map(r => ({ ...r, label: r.slug ? (nameOf[r.slug] || r.label) : r.label }));

    const assets = assetRows.map(toRwaAsset);
    const valued = assets.filter(a => a.value !== null);
    const interestSeries = interestHistory.map(toSeriesPoint);

    const holdings = holdingRows.map(toHolding);
    const flows = flowRows.map(r => toFlow(r, locale));

    const payload = {
      asOf: byKey.protocolAum ? byKey.protocolAum.captured_at : null,
      core,

      // §1.2 Protocol AUM
      aum: {
        history: aumHistory.map(toSeriesPoint),
        byNetwork: slice(breakdownRows, 'protocolAum', 'network'),
        byProductType: slice(breakdownRows, 'protocolAum', 'product_type'),
        byProduct: named(slice(breakdownRows, 'protocolAum', 'product')),
      },

      // §1.3 Tokenized Assets
      tokenized: {
        history: tokHistory.map(toSeriesPoint),
        activeAssets: assets.filter(a => a.status === 'active').length,
        tokenCount: assets.filter(a => a.status === 'active' && a.tokenAddress).length,
        valuedCount: valued.length,
        // Surfaced rather than hidden: the plan is explicit that
        // NAV-less assets are excluded, and a reader can only trust
        // the figure if they can see how many rows it left out.
        excluded: assets
          .filter(a => a.value === null)
          .map(a => ({ name: a.name, assetType: a.assetType, network: a.network, reason: a.excludedReason })),
        byAssetType: slice(breakdownRows, 'tokenizedAssets', 'asset_type'),
        byNetwork: slice(breakdownRows, 'tokenizedAssets', 'network'),
        byToken: slice(breakdownRows, 'tokenizedAssets', 'token'),
      },

      // §1.4 Total Investors
      investors: {
        history: invHistory.map(toSeriesPoint),
        byProduct: named(slice(breakdownRows, 'totalInvestors', 'product')),
        byNetwork: slice(breakdownRows, 'totalInvestors', 'network'),
        // An address holding shares in several Vaults counts once
        // protocol-wide but appears under each product, so the
        // per-product column legitimately sums to more than the
        // headline. Exposing the sum lets the page say so.
        sumOfProducts: sum(
          breakdownRows.filter(r => r.metric_key === 'totalInvestors' && r.dimension === 'product'),
          r => r.value_int
        ),
      },

      // §1.5 Total Interest Generated
      interest: {
        history: interestSeries,
        byProduct: named(slice(breakdownRows, 'totalInterestGenerated', 'product')),
        byNetwork: slice(breakdownRows, 'totalInterestGenerated', 'network'),
        last30d: windowed(interestSeries, 30),
        last90d: windowed(interestSeries, 90),
        sinceInception: windowed(interestSeries, null),
      },

      // §1.6 Protocol Revenue
      revenue: {
        history: revenueHistory.map(toSeriesPoint),
        byVault: named(slice(breakdownRows, 'protocolRevenue', 'vault')),
        holdings: {
          priced: holdings.filter(h => h.priced),
          // Kept apart deliberately: the plan says assets without
          // reliable pricing are shown separately, not converted.
          unpriced: holdings.filter(h => !h.priced),
          pricedTotal: sum(holdings.filter(h => h.priced), h => h.valueUsd),
        },
        inflows: flows.filter(f => f.direction === 'in'),
        outflows: flows.filter(f => f.direction === 'out'),
      },
    };

    assertNoInternalFields(payload);
    return payload;
  });
}

module.exports = { getProtocolStats, CORE_KEYS };
