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

/* ================================================================
   Data-pages mappers (HyperTessera_Data_Pages_Plan.md)
   ================================================================ */

/**
 * A protocol_breakdowns row -> a chart slice.
 *
 * `share` is computed against the total passed in rather than stored,
 * so a slice can never disagree with the headline figure above it.
 * `slug` survives because the plan (§1.2) wants the AUM composition
 * chart to open the corresponding product page.
 */
function toBreakdown(row, total) {
  const value = row.value_num === null ? null : num(row.value_num);
  const count = row.value_int === null ? null : Number(row.value_int);
  const basis = value === null ? count : value;
  return {
    label: row.label,
    slug: row.slug || null,
    value,
    count,
    share: total ? (basis ?? 0) / total : null,
  };
}

/** product_vault + derived capacity -> the §2.1/§2.2 product header. */
function toVault(row, { capacity, tvl } = {}) {
  if (!row) return null;
  const cap = num(capacity);
  const aum = num(tvl);
  return {
    vaultAddress: row.vault_address,
    shareSymbol: row.share_symbol,
    productType: row.product_type,
    issuer: row.issuer,
    riskRating: row.risk_rating,
    totalSupply: num(row.total_supply),
    sharePrice: num(row.share_price),
    lastSettlementPrice: num(row.last_settlement_price),
    currentCycle: row.current_cycle,
    cycleState: row.cycle_state,
    productState: row.product_state,
    performanceFeeBps: row.performance_fee_bps,
    protocolFeeShareBps: row.protocol_fee_share_bps,
    maturityDate: row.maturity_date,
    investors: row.investors,
    subscriptionCap: cap,
    // Plan §2.2: available capacity is the cap less what is used.
    availableCapacity: cap === null || aum === null ? null : Math.max(0, cap - aum),
  };
}

function toCycle(row) {
  return {
    cycleNo: row.cycle_no,
    settledAt: row.settled_at,
    settlementPrice: num(row.settlement_price),
    shareSupply: num(row.share_supply),
    totalAssets: num(row.total_assets),
    cycleYield: num(row.cycle_yield),
    feeAssets: num(row.fee_assets),
    feeShares: num(row.fee_shares),
    protocolFeeShares: num(row.protocol_fee_shares),
  };
}

/** An allocation row. `share` is against Product AUM (plan §2.4). */
function toAllocation(row, locale, aum) {
  const value = num(row.real_assets);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    address: row.contract_address,
    network: row.network,
    realAssets: value,
    share: aum ? value / aum : null,
    description: locale === 'en' ? row.description_en : row.description_zh,
    explorerUrl: row.explorer_url,
  };
}

function toRwaAsset(row) {
  const supply = num(row.total_supply);
  const nav = num(row.nav);
  // Plan §1.3: an asset with no NAV is excluded from the valuation,
  // never valued at zero — so `value` stays null rather than 0.
  const valued = row.status === 'active' && row.token_address !== null && nav !== null;
  return {
    id: row.id,
    name: row.name,
    assetType: row.asset_type,
    network: row.network,
    tokenSymbol: row.token_symbol,
    tokenAddress: row.token_address,
    totalSupply: supply,
    nav,
    status: row.status,
    value: valued ? supply * nav : null,
    excludedReason: valued
      ? null
      : row.status !== 'active' ? 'inactive'
        : row.token_address === null ? 'no_token'
          : 'no_nav',
  };
}

function toHolding(row) {
  return {
    id: row.id,
    label: row.asset_label,
    kind: row.asset_kind,
    network: row.network,
    amount: num(row.amount),
    valueUsd: num(row.value_usd),
    priced: Boolean(row.priced),
  };
}

function toFlow(row, locale) {
  return {
    id: row.id,
    direction: row.direction,
    source: locale === 'en' ? row.source_en : row.source_zh,
    amount: num(row.amount),
    occurredAt: row.occurred_at,
  };
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
  toBreakdown,
  toVault,
  toCycle,
  toAllocation,
  toRwaAsset,
  toHolding,
  toFlow,
};
