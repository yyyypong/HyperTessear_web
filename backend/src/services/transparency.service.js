const pool = require('../db/pool');
const cache = require('../lib/cache');
const {
  toReserve, toContract, toSeriesPoint, toAudit, assertNoInternalFields,
} = require('../dto/publicShapes');

const SUPPORTED_LOCALES = ['zh-CN', 'en'];
const normaliseLocale = (l) => (SUPPORTED_LOCALES.includes(l) ? l : 'zh-CN');

/**
 * Everything the /transparency page shows.
 *
 * The point of the page is that three independently-sourced numbers
 * agree: the sum of per-product TVL, the reported currentTVL metric,
 * and the sum of attested reserves. The response therefore carries all
 * three plus a `reconciles` flag computed server-side, so the page can
 * state the discrepancy rather than quietly hide it.
 */
async function getTransparency(locale = 'zh-CN') {
  const loc = normaliseLocale(locale);

  return cache.wrap(`transparency:${loc}`, 60, async () => {
    const [
      [productRows], [tvlMetricRows], [historyRows], [reserveRows], [auditRows], [navRows],
    ] = await Promise.all([
      pool.query(
        `SELECT p.slug, p.tvl, p.capacity, p.status, p.network, p.token_standard,
                p.contract_address, p.inception_date, t.name
           FROM products p
           JOIN product_translations t ON t.slug = p.slug AND t.locale = ?
          ORDER BY p.tvl DESC`,
        [loc]
      ),
      pool.query("SELECT * FROM v_metric_latest WHERE metric_key = 'currentTVL'"),
      pool.query(
        `SELECT captured_at, value_num FROM metric_readings
          WHERE metric_key = 'currentTVL' ORDER BY captured_at`
      ),
      pool.query('SELECT * FROM reserve_attestations ORDER BY sort_order'),
      pool.query('SELECT * FROM security_audits ORDER BY sort_order'),
      // latest NAV per product
      pool.query(
        `SELECT n.slug, n.captured_at, n.nav
           FROM product_nav_history n
           JOIN (SELECT slug, MAX(captured_at) d FROM product_nav_history GROUP BY slug) m
             ON n.slug = m.slug AND n.captured_at = m.d`
      ),
    ]);

    const live = productRows.filter(p => p.status === 'live');
    const productTvlSum = live.reduce((acc, p) => acc + Number(p.tvl), 0);
    const reportedTvl = tvlMetricRows.length ? Number(tvlMetricRows[0].value_num) : null;
    const reserveTotal = reserveRows.reduce((acc, r) => acc + Number(r.amount), 0);

    const navBySlug = Object.fromEntries(
      navRows.map(n => [n.slug, { nav: Number(n.nav), date: n.captured_at }])
    );

    const payload = {
      tvl: {
        reported: reportedTvl,
        lastUpdated: tvlMetricRows.length ? tvlMetricRows[0].captured_at : null,
        productSum: Number(productTvlSum.toFixed(4)),
        composition: live.map(p => ({
          slug: p.slug,
          name: p.name,
          tvl: Number(p.tvl),
          share: productTvlSum ? Number(p.tvl) / productTvlSum : 0,
          nav: navBySlug[p.slug]?.nav ?? null,
          navDate: navBySlug[p.slug]?.date ?? null,
        })),
      },
      tvlHistory: historyRows.map(toSeriesPoint),
      reserves: {
        total: Number(reserveTotal.toFixed(4)),
        lastUpdated: reserveRows.reduce(
          (acc, r) => (!acc || r.attested_at > acc ? r.attested_at : acc), null
        ),
        items: reserveRows.map(r => toReserve(r, loc, reserveTotal)),
      },
      // The whole point of the page: do the three figures agree?
      reconciliation: {
        productSum: Number(productTvlSum.toFixed(4)),
        reported: reportedTvl,
        reserves: Number(reserveTotal.toFixed(4)),
        reconciles:
          reportedTvl !== null &&
          Math.abs(productTvlSum - reportedTvl) < 0.01 &&
          Math.abs(reserveTotal - reportedTvl) < 0.01,
      },
      contracts: productRows.filter(p => p.contract_address).map(toContract),
      audits: auditRows.map(r => toAudit(r, loc)),
    };

    assertNoInternalFields(payload);
    return payload;
  });
}

module.exports = { getTransparency };
