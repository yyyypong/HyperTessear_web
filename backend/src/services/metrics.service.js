const pool = require('../db/pool');
const cache = require('../lib/cache');
const { toMetric, toPartner, toAudit, assertNoInternalFields } = require('../dto/publicShapes');

const METRIC_KEYS = [
  'historicalFailureRate',
  'cumAssetsMinted',
  'cumPayout',
  'totalInvestors',
  'currentTVL',
  'protocolLiveStatus',
];

/**
 * Everything the homepage needs, in one round trip per table
 * (three queries total, cached for 60s) rather than the seven
 * sequential queries the original scaffold issued per page load.
 */
async function getHomepageMetrics(locale = 'zh-CN') {
  return cache.wrap(`homepage:${locale}`, 60, async () => {
    const [[metricRows], [partnerRows], [auditRows]] = await Promise.all([
      pool.query('SELECT * FROM v_metric_latest'),
      pool.query('SELECT * FROM partners ORDER BY category, sort_order'),
      pool.query('SELECT * FROM security_audits ORDER BY sort_order'),
    ]);

    const byKey = Object.fromEntries(metricRows.map(r => [r.metric_key, r]));
    const payload = {};
    for (const key of METRIC_KEYS) {
      payload[key] = toMetric(byKey[key]);
    }

    const partners = partnerRows.map(toPartner);
    payload.partners = partners.filter(p => p.category === 'integration');
    payload.custodians = partners.filter(p => p.category === 'custodian');
    payload.managers = partners.filter(p => p.category === 'manager');
    payload.audits = auditRows.map(r => toAudit(r, locale));

    // data_source / source_ref must never reach the client.
    assertNoInternalFields(payload);
    return payload;
  });
}

module.exports = { getHomepageMetrics, METRIC_KEYS };
