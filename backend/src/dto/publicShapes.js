/**
 * The public/internal boundary.
 *
 * "Data Table Homepage (6).pdf" specifies that each metric is stored
 * internally as {value, dataSource, lastUpdated, sourceRef} but sent to
 * React as {value, lastUpdated} only. Everything that crosses the wire
 * goes through a mapper in this file, so that rule is enforced in one
 * place rather than remembered in every route.
 *
 * `attribution` is an addition to the spec: it names whose number a
 * figure is when it is not the protocol's own (e.g. a strategy
 * manager's historical track record). It is deliberately public — it
 * is the opposite of a leak.
 */

/** Keys that must never reach the client. */
const INTERNAL_KEYS = ['data_source', 'dataSource', 'source_ref', 'sourceRef'];

/** Throws if an internal field leaked into a payload. Used by tests. */
function assertNoInternalFields(payload, path = 'root') {
  if (payload === null || typeof payload !== 'object') return;
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertNoInternalFields(v, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(payload)) {
    if (INTERNAL_KEYS.includes(key)) {
      throw new Error(`Internal field "${key}" leaked into public payload at ${path}`);
    }
    assertNoInternalFields(payload[key], `${path}.${key}`);
  }
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** A row of v_metric_latest -> the public {value, lastUpdated, attribution}. */
function toMetric(row) {
  if (!row) return null;
  return {
    value: row.value_bool !== null ? Boolean(row.value_bool) : num(row.value_num),
    lastUpdated: row.captured_at,
    attribution: row.attribution || null,
  };
}

function toPartner(row) {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    linkUrl: row.link_url,
    category: row.category,
  };
}

function toAudit(row, locale) {
  return {
    id: row.id,
    auditor: row.auditor,
    scope: locale === 'en' ? row.scope_en : row.scope_zh,
    reportUrl: row.report_url,
    completedAt: row.completed_at,
  };
}

/** Product row joined with its translation row. */
function toProductSummary(row) {
  return {
    slug: row.slug,
    sequenceNo: row.sequence_no,
    name: row.name,
    tagline: row.tagline,
    role: row.role,
    roleLabel: row.role_label,
    strategyManager: row.strategy_manager,
    strategyRef: row.strategy_ref,
    denomination: row.denomination,
    underlying: row.underlying,
    termDays: row.term_days,
    termLabel: row.term_label,
    targetApy: {
      min: num(row.target_apy_min),
      max: num(row.target_apy_max),
      openEnded: Boolean(row.apy_open_ended),
    },
    tvl: num(row.tvl),
    capacity: num(row.capacity),
    status: row.status,
    network: row.network,
  };
}

function toProductDetail(row, extras) {
  return {
    ...toProductSummary(row),
    tokenStandard: row.token_standard,
    contractAddress: row.contract_address,
    inceptionDate: row.inception_date,
    summary: row.summary,
    strategyNote: row.strategy_note,
    redemptionNote: row.redemption_note,
    riskNote: row.risk_note,
    navHistory: extras.navHistory,
    documents: extras.documents,
    activity: extras.activity,
  };
}

function toNavPoint(row) {
  return {
    date: row.captured_at,
    nav: num(row.nav),
    apy7d: num(row.apy_7d),
    apy30d: num(row.apy_30d),
  };
}

function toDocument(row, locale) {
  return {
    id: row.id,
    title: locale === 'en' ? row.title_en : row.title_zh,
    kind: row.kind,
    url: row.url,
  };
}

function toActivity(row) {
  return {
    id: row.id,
    kind: row.kind,
    amount: num(row.amount),
    occurredAt: row.occurred_at,
  };
}

/**
 * Bilingual seed columns are stored as "中文 / English" in a single
 * field. Split on the separator and pick the side for `locale`.
 */
function localisedPair(value, locale) {
  if (!value) return '';
  const parts = String(value).split(' / ');
  if (parts.length < 2) return value;
  return locale === 'en' ? parts[1] : parts[0];
}

function toReserve(row, locale, total) {
  return {
    id: row.id,
    assetClass: localisedPair(row.asset_class, locale),
    amount: num(row.amount),
    share: total ? Number(row.amount) / total : null,
    attestor: row.attestor,
    reportUrl: row.report_url,
    attestedAt: row.attested_at,
  };
}

function toContract(row) {
  return {
    slug: row.slug,
    name: row.name,
    address: row.contract_address,
    network: row.network,
    tokenStandard: row.token_standard,
    inceptionDate: row.inception_date,
  };
}

/** A metric_readings row reduced to a chart point. */
function toSeriesPoint(row) {
  return { date: row.captured_at, value: num(row.value_num) };
}

module.exports = {
  assertNoInternalFields,
  localisedPair,
  toReserve,
  toContract,
  toSeriesPoint,
  toMetric,
  toPartner,
  toAudit,
  toProductSummary,
  toProductDetail,
  toNavPoint,
  toDocument,
  toActivity,
};
