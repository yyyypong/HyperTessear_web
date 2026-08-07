/**
 * Seed for the Charts & Stats and Product Details pages.
 *
 * Called by migrate.js after the v0.2 seed has run, because almost
 * everything here is *derived* from data that seed already wrote —
 * chiefly product_nav_history and products.tvl.
 *
 * The derivations are the plan's own formulas, not hand-typed
 * figures:
 *
 *   Cycle Yield        = (settlement price - previous) x share supply   §1.5
 *   Gross Cycle Yield  = Cycle Yield + feeAssets                        §1.5
 *   protocolFeeShares  = feeShares x protocolFeeShareBps / 10,000       §1.6
 *   protocolFeeIncome  = protocolFeeShares x settlementPrice            §1.6
 *   Protocol AUM       = sum of Vault.totalAssets()                     §1.2
 *   Tokenized Assets   = sum of totalSupply x NAV, NAV-less excluded    §1.3
 *
 * Writing them as code rather than as constants means the totals on
 * the page cannot drift from the rows they are meant to summarise —
 * and it is the same arithmetic the Indexer will have to do, so the
 * shapes carry over when the real data source arrives.
 *
 * Every figure produced here is demo data. `DEMO_AS_OF` is the
 * as-of date the whole dataset pretends to be.
 */

const DEMO_AS_OF = '2026-07-28';

// ---------------------------------------------------------------
// Vault-level configuration (plan §2.1, §2.2)
// ---------------------------------------------------------------
const VAULTS = {
  'cash-earn': {
    vault_address: '0x7Ae1C0f3B2d94A6E5C81f0D3b9A2E4F6C8D1a305',
    share_symbol: 'htCASH', product_type: 'Earn Vault',
    issuer: 'HyperTessera Labs Ltd.', risk_rating: 'Low',
    performance_fee_bps: 1000, protocol_fee_share_bps: 3000,
    cycle_days: 7, current_cycle: 21, cycle_state: 'ACCEPTING', product_state: 'SUBSCRIBING',
    maturity_date: null, investors: 8940,
    redemption_timeline_zh: '标准赎回在两次净值更新后处理，通常为 1–3 个工作日。',
    redemption_timeline_en: 'Standard redemptions are processed after two price updates, typically one to three business days.',
  },
  'note-earn': {
    vault_address: '0x2Bd9E4a17C63F805D2a9B7E1c4F6038A5e2D9b41',
    share_symbol: 'htNOTE', product_type: 'Earn Vault',
    issuer: 'HyperTessera Labs Ltd.', risk_rating: 'High',
    performance_fee_bps: 1500, protocol_fee_share_bps: 3000,
    cycle_days: 30, current_cycle: 5, cycle_state: 'CALCULATING', product_state: 'MATURING',
    maturity_date: '2027-02-25', investors: 3180,
    redemption_timeline_zh: '锁定期内不支持赎回，到期后本金与收益一次性发放。',
    redemption_timeline_en: 'No redemption during the lock. Principal and accrued yield are released in a single payment at maturity.',
  },
  'lp-earn': {
    vault_address: '0x9F51aB7d2E084C36b1D7f5A0c93E28D4b6F1c072',
    share_symbol: 'htLP', product_type: 'Liquidity Earn Vault',
    issuer: 'HyperTessera Labs Ltd.', risk_rating: 'Medium',
    performance_fee_bps: 800, protocol_fee_share_bps: 3000,
    cycle_days: 7, current_cycle: 15, cycle_state: 'ACCEPTING', product_state: 'SUBSCRIBING',
    maturity_date: null, investors: 2410,
    redemption_timeline_zh: '标准赎回在两次净值更新后处理，缓冲层高占用时可能延长。',
    redemption_timeline_en: 'Standard redemptions are processed after two price updates; processing may take longer while the buffer is heavily utilised.',
  },
  // Not yet deployed. The rows exist so the product pages render a
  // real empty state instead of a missing-record error.
  'cash-earn-usdc': {
    vault_address: null, share_symbol: 'htCASHc', product_type: 'Earn Vault',
    issuer: 'HyperTessera Labs Ltd.', risk_rating: 'Low',
    performance_fee_bps: 1000, protocol_fee_share_bps: 3000,
    cycle_days: null, current_cycle: null, cycle_state: null, product_state: 'CONFIGURING',
    maturity_date: null, investors: null,
    redemption_timeline_zh: null, redemption_timeline_en: null,
  },
  'hyper-liquidity': {
    vault_address: null, share_symbol: 'htHL', product_type: 'Liquidity Earn Vault',
    issuer: 'HyperTessera Labs Ltd.', risk_rating: 'Medium',
    performance_fee_bps: 1200, protocol_fee_share_bps: 3000,
    cycle_days: null, current_cycle: null, cycle_state: null, product_state: 'CONFIGURING',
    maturity_date: null, investors: null,
    redemption_timeline_zh: null, redemption_timeline_en: null,
  },
};

// ---------------------------------------------------------------
// AssetRegistry view (plan §1.3)
//
// Three rows are deliberately non-valuable, one per exclusion rule
// the plan states, so the Tokenized Assets figure demonstrates them
// rather than merely claiming to apply them:
//   id 6 — active, tokenised, but NAV unavailable  -> excluded
//   id 7 — active, registered, no RWAToken         -> excluded
//   id 8 — inactive                                -> excluded
// ---------------------------------------------------------------
const RWA_ASSETS = [
  [1, 'CHUAN Receivables Series A', 'Receivables', 'Ethereum', 'rCHUAN-A',
    '0x51C2b6a9E30F7d84B1c05e9A2f7D6438e0C9b125', 18, 38400000, 1.000000, 'active', 10],
  [2, 'CHUAN Trade Finance Pool', 'Trade finance', 'Ethereum', 'tfCHUAN',
    '0x8Ea41D7b0C296f53A8d1e46B905C7f2D3a86E410', 18, 24000000, 1.007500, 'active', 20],
  [3, 'Fasanara Diversified Debt', 'Private credit', 'Ethereum', 'fasDEBT',
    '0x3Cb07F92a15D8e46B0c8137Ae59D2f04b6C71E85', 18, 18500000, 1.024200, 'active', 30],
  [4, 'HK T-Bill Note 2026-Q4', 'Treasury bills', 'BNB Chain', 'hkTBILL',
    '0xB270e4C81a936D5f0E7c24A93b18Df650a7C3e29', 18, 12000000, 1.003100, 'active', 40],
  [5, 'Lindale Short Duration Note', 'Receivables', 'BNB Chain', 'lndSDN',
    '0x6D48a013C7e29B5f8A1d60E4b72C90F35a8De714', 18, 2800000, 1.011800, 'active', 50],
  [6, 'Structured Credit Tranche B', 'Private credit', 'Ethereum', 'scTRB',
    '0xE41b9C6a2D75830F1e64B0a97C5D283f7A0b6E33', 18, 5000000, null, 'active', 60],
  [7, 'Municipal Lease Pool 2025', 'Leases', 'Ethereum', null,
    null, 18, null, null, 'active', 70],
  [8, 'Legacy Receivables 2024', 'Receivables', 'Ethereum', 'legacyR',
    '0xA07f31D8b5C69e204a3F81c7D6e92B540f8C1a67', 18, 9000000, 0.998400, 'inactive', 80],
];

// ---------------------------------------------------------------
// Asset allocation and transparency (plan §2.4).
// Per product these sum exactly to products.tvl, so "percentage of
// Product AUM" always totals 100%.
// ---------------------------------------------------------------
const ALLOCATIONS = [
  // slug, kind, name, address, network, real_assets, desc_zh, desc_en, explorer, sort
  ['cash-earn', 'vault_direct', 'Vault USDT balance', '0x7Ae1C0f3B2d94A6E5C81f0D3b9A2E4F6C8D1a305', 'Ethereum', 3120000.50,
    '金库直接持有的未部署 USDT，用于即时赎回。', 'Undeployed USDT held directly by the Vault, backing instant redemption.', null, 10],
  ['cash-earn', 'adapter', 'CHUAN Receivables Adapter', '0x14Ae7b2C09D5f836E1a04B7c8D62F350a9E1b743', 'Ethereum', 28400000.00,
    '短久期应收账款敞口，通过 CHUAN 策略适配器持有。', 'Short-duration receivables exposure held through the CHUAN strategy adapter.', 'https://etherscan.io/address/0x14Ae7b2C09D5f836E1a04B7c8D62F350a9E1b743', 20],
  ['cash-earn', 'adapter', 'Trade Finance Adapter', '0x7B25c94E0a8D163F5e02A9b7C48D6103e5F2a986', 'Ethereum', 11200000.00,
    '贸易融资敞口适配器。', 'Trade finance exposure adapter.', 'https://etherscan.io/address/0x7B25c94E0a8D163F5e02A9b7C48D6103e5F2a986', 30],
  ['cash-earn', 'in_transit', 'Settlement in transit', null, 'Ethereum', 1400000.00,
    '已发起但尚未确认的结算划转。', 'Settlement transfers initiated but not yet confirmed.', null, 40],

  ['note-earn', 'vault_direct', 'Vault USDT balance', '0x2Bd9E4a17C63F805D2a9B7E1c4F6038A5e2D9b41', 'Ethereum', 880000.25,
    '金库直接持有的 USDT。', 'USDT held directly by the Vault.', null, 10],
  ['note-earn', 'adapter', 'CHUAN Junior Tranche Adapter', '0xC5f1907B3e26D48a0F71c9E5b3A82D640e7C1b58', 'Ethereum', 16000000.00,
    '劣后受偿顺位的信用资产敞口。', 'Junior-ranking credit exposure in the shared real-asset pool.', 'https://etherscan.io/address/0xC5f1907B3e26D48a0F71c9E5b3A82D640e7C1b58', 20],
  ['note-earn', 'rwa_token', 'scTRB · Structured Credit Tranche B', '0xE41b9C6a2D75830F1e64B0a97C5D283f7A0b6E33', 'Ethereum', 6000000.00,
    '结构化信用劣后档 RWA 代币。当前无可用 NAV，按成本列示。', 'Structured credit junior-tranche RWA token. No NAV currently available; carried at cost.', 'https://etherscan.io/address/0xE41b9C6a2D75830F1e64B0a97C5D283f7A0b6E33', 30],

  ['lp-earn', 'vault_direct', 'Vault USDT balance', '0x9F51aB7d2E084C36b1D7f5A0c93E28D4b6F1c072', 'Ethereum', 2250000.00,
    '缓冲层可即时动用的 USDT。', 'USDT immediately callable by the buffer layer.', null, 10],
  ['lp-earn', 'wrapped_token', 'wCASH · Wrapped Cash Token', '0x4A81e07C2b95D63f8E0a17B4c96D5230f7A8b1E6', 'Ethereum', 13000000.00,
    '持有的 Cash Token 包装代币，构成缓冲层主体。', 'Wrapped Cash Token holdings, the main body of the buffer layer.', 'https://etherscan.io/address/0x4A81e07C2b95D63f8E0a17B4c96D5230f7A8b1E6', 20],
  ['lp-earn', 'adapter', 'Liquidity Buffer Adapter', '0xD73a2E96b0C518F47a2d09B6e31C8450f2A7c6D9', 'Ethereum', 2000000.00,
    '缓冲层再投资适配器。', 'Buffer-layer reinvestment adapter.', 'https://etherscan.io/address/0xD73a2E96b0C518F47a2d09B6e31C8450f2A7c6D9', 30],
];

// ---------------------------------------------------------------
// More Info CMS (plan §2.6)
// ---------------------------------------------------------------
const CONTENT = {
  'cash-earn': {
    'zh-CN': {
      subscription: '每个 7 天周期开放申购。申购在周期结算时按结算价格确认份额，申购上限受产品容量约束。',
      maturity: '本产品为开放式，无固定到期日。周期结束后自动进入下一周期。',
      issuer: '发行主体为 HyperTessera Labs Ltd.（香港），底层策略由持牌机构 Lindale Capital 管理。',
      providers: '托管：OSL、HashKey。审计：PeckShield。储备鉴证：NAV Fund Services。',
    },
    en: {
      subscription: 'Subscriptions open each 7-day cycle. Shares are confirmed at the settlement price when the cycle settles, and subscription is bounded by the product capacity.',
      maturity: 'This is an open-ended product with no fixed maturity date. Each cycle rolls automatically into the next.',
      issuer: 'Issued by HyperTessera Labs Ltd. (Hong Kong). The underlying strategy is managed by Lindale Capital, a licensed institution.',
      providers: 'Custody: OSL, HashKey. Audit: PeckShield. Reserve attestation: NAV Fund Services.',
    },
  },
  'note-earn': {
    'zh-CN': {
      subscription: '每 30 天开放一次申购窗口。每笔存入独立锁定 360 天。',
      maturity: '每笔存入自申购确认日起锁定 360 天，到期后本金与累计收益一次性发放至存入地址。',
      issuer: '发行主体为 HyperTessera Labs Ltd.（香港），底层策略由持牌机构 Lindale Capital 管理。',
      providers: '托管：OSL、HashKey。审计：SlowMist。储备鉴证：NAV Fund Services。',
    },
    en: {
      subscription: 'A subscription window opens every 30 days. Each deposit is locked independently for 360 days.',
      maturity: 'Each deposit is locked for 360 days from its confirmation date. Principal and accrued yield are released in a single payment to the depositing address at maturity.',
      issuer: 'Issued by HyperTessera Labs Ltd. (Hong Kong). The underlying strategy is managed by Lindale Capital, a licensed institution.',
      providers: 'Custody: OSL, HashKey. Audit: SlowMist. Reserve attestation: NAV Fund Services.',
    },
  },
  'lp-earn': {
    'zh-CN': {
      subscription: '每个 7 天周期开放申购，无最低申购额限制。',
      maturity: '本产品为开放式，无固定到期日。',
      issuer: '发行主体为 HyperTessera Labs Ltd.（香港）。',
      providers: '托管：OSL。审计：CertiK。储备鉴证：Chainlink Proof of Reserve。',
    },
    en: {
      subscription: 'Subscriptions open each 7-day cycle, with no minimum subscription amount.',
      maturity: 'This is an open-ended product with no fixed maturity date.',
      issuer: 'Issued by HyperTessera Labs Ltd. (Hong Kong).',
      providers: 'Custody: OSL. Audit: CertiK. Reserve attestation: Chainlink Proof of Reserve.',
    },
  },
};

// Proof-of-reserve, custody and legal documents (plan §2.4, §2.6).
const EXTRA_DOCUMENTS = [
  ['cash-earn', '托管证明（OSL）', 'Custody attestation (OSL)', 'custody', null, 40],
  ['cash-earn', '储备证明登记哈希', 'Proof-of-reserve registry hash', 'por', null, 50],
  ['cash-earn', '认购法律文件', 'Subscription legal documentation', 'legal', null, 60],
  ['note-earn', '托管证明（HashKey）', 'Custody attestation (HashKey)', 'custody', null, 40],
  ['note-earn', '储备证明登记哈希', 'Proof-of-reserve registry hash', 'por', null, 50],
  ['lp-earn', 'Chainlink 储备证明', 'Chainlink proof of reserve', 'por', 'https://chain.link/proof-of-reserve', 40],
  ['lp-earn', '认购法律文件', 'Subscription legal documentation', 'legal', null, 50],
];

// RevenuePool composition (plan §1.6). The last row is unpriced on
// purpose: the plan requires such assets to be listed separately
// rather than forced into a USD total.
const REVENUE_POOL = [
  ['htCASH · Cash Earn shares', 'vault_share', 'Ethereum', 142300.000000, 146128.53, 1, 10],
  ['htLP · LP Earn shares', 'vault_share', 'Ethereum', 38900.000000, 39682.71, 1, 20],
  ['USDT', 'stablecoin', 'Ethereum', 486200.000000, 486200.00, 1, 30],
  ['USDT', 'stablecoin', 'BNB Chain', 74500.000000, 74500.00, 1, 40],
  ['Unlisted ecosystem token', 'other', 'Ethereum', 250000.000000, null, 0, 50],
];

const REVENUE_FLOWS = [
  ['in', 'UnifiedPool 结余划入', 'UnifiedPool surplus transfer', 128400.00, '2026-05-19', 10],
  ['in', '适配器回收收益', 'Adapter recovery proceeds', 46150.00, '2026-06-23', 20],
  ['in', '第三方集成分成', 'Third-party integration share', 31900.00, '2026-07-14', 30],
  ['out', '协议金库提取', 'Protocol treasury withdrawal', 210000.00, '2026-06-30', 40],
  ['out', '审计与合规支出', 'Audit and compliance costs', 68500.00, '2026-07-21', 50],
];

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const round = (n, d = 4) => Number(Number(n).toFixed(d));
const addDays = (iso, n) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/**
 * DATE columns arrive as JS Date objects on this connection — the
 * `dateStrings` option lives on the app pool, not on the migration's
 * own connection — so every date is normalised to 'YYYY-MM-DD' here
 * before it is used as a key or written back.
 */
const isoOf = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * Builds settled cycles for one product from its daily NAV series.
 *
 * Share supply is held constant at tvl / latest price, so the final
 * cycle's total_assets lands exactly on products.tvl and the page's
 * Product AUM agrees with the Vault row it came from.
 */
function buildCycles(slug, navRows, tvl, cfg) {
  const step = cfg.cycle_days;
  if (!step || navRows.length < 2) return [];

  const latestPrice = Number(navRows[navRows.length - 1].nav);
  const supply = tvl / latestPrice;

  // Walk backwards from the last reading so the final settlement is
  // the most recent NAV rather than an arbitrary offset.
  const marks = [];
  for (let i = navRows.length - 1; i >= 0; i -= step) marks.unshift(navRows[i]);
  if (marks.length < 2) return [];

  const cycles = [];
  for (let i = 1; i < marks.length; i++) {
    const price = Number(marks[i].nav);
    const prev = Number(marks[i - 1].nav);

    // §1.5 — the contracts expose no totalInterestGenerated, so
    // yield is the share-price delta applied to the supply earning it.
    const cycleYield = (price - prev) * supply;
    const feeAssets = cycleYield * (cfg.performance_fee_bps / 10000);
    const feeShares = price > 0 ? feeAssets / price : 0;
    const protocolFeeShares = feeShares * (cfg.protocol_fee_share_bps / 10000);

    cycles.push([
      slug,
      i,                                   // cycle_no
      isoOf(marks[i].captured_at),
      round(price, 6),
      round(supply, 6),
      round(supply * price),
      round(cycleYield),
      round(feeAssets),
      round(feeShares, 6),
      round(protocolFeeShares, 6),
    ]);
  }
  return cycles;
}

// ---------------------------------------------------------------
async function seedDataPages(conn) {
  console.log('→ applying schema.data-pages.sql');
  const fs = require('fs');
  const path = require('path');
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.data-pages.sql'), 'utf8'));

  console.log('→ clearing data-page tables');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
  for (const t of ['product_vault', 'product_cycles', 'product_allocations', 'product_content',
    'rwa_assets', 'protocol_breakdowns', 'revenue_pool_holdings', 'revenue_flows']) {
    await conn.query(`TRUNCATE TABLE \`${t}\`;`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1;');

  // --- products the derivations run over -----------------------
  const [products] = await conn.query(
    'SELECT slug, tvl, status, network, role FROM products ORDER BY sort_order'
  );
  const liveProducts = products.filter(p => p.status === 'live');
  const [navAll] = await conn.query(
    'SELECT slug, captured_at, nav FROM product_nav_history ORDER BY slug, captured_at'
  );
  const navBySlug = navAll.reduce((acc, r) => {
    (acc[r.slug] ||= []).push(r);
    return acc;
  }, {});

  // --- product_cycles ------------------------------------------
  console.log('→ seeding product_cycles');
  const cycleRows = [];
  for (const p of liveProducts) {
    const cfg = VAULTS[p.slug];
    cycleRows.push(...buildCycles(p.slug, navBySlug[p.slug] || [], Number(p.tvl), cfg));
  }
  if (cycleRows.length) {
    await conn.query(
      `INSERT INTO product_cycles (slug, cycle_no, settled_at, settlement_price, share_supply,
         total_assets, cycle_yield, fee_assets, fee_shares, protocol_fee_shares) VALUES ?`,
      [cycleRows]
    );
  }

  // --- product_vault -------------------------------------------
  console.log('→ seeding product_vault');
  const vaultRows = products.map(p => {
    const cfg = VAULTS[p.slug];
    const nav = navBySlug[p.slug] || [];
    const livePrice = nav.length ? Number(nav[nav.length - 1].nav) : null;
    const mine = cycleRows.filter(c => c[0] === p.slug);
    const lastSettlement = mine.length ? mine[mine.length - 1][3] : null;
    const supply = livePrice ? round(Number(p.tvl) / livePrice, 6) : null;
    return [
      p.slug, cfg.vault_address, cfg.share_symbol, cfg.product_type, cfg.issuer, cfg.risk_rating,
      supply, livePrice ? round(livePrice, 6) : null, lastSettlement,
      cfg.current_cycle, cfg.cycle_state, cfg.product_state,
      cfg.performance_fee_bps, cfg.protocol_fee_share_bps, cfg.maturity_date, cfg.investors,
      cfg.redemption_timeline_zh, cfg.redemption_timeline_en,
    ];
  });
  await conn.query(
    `INSERT INTO product_vault (slug, vault_address, share_symbol, product_type, issuer,
       risk_rating, total_supply, share_price, last_settlement_price, current_cycle, cycle_state,
       product_state, performance_fee_bps, protocol_fee_share_bps, maturity_date, investors,
       redemption_timeline_zh, redemption_timeline_en) VALUES ?`,
    [vaultRows]
  );

  // --- allocations, content, documents -------------------------
  console.log('→ seeding product_allocations');
  await conn.query(
    `INSERT INTO product_allocations (slug, kind, name, contract_address, network, real_assets,
       description_zh, description_en, explorer_url, sort_order) VALUES ?`,
    [ALLOCATIONS]
  );

  console.log('→ seeding product_content');
  const contentRows = [];
  for (const [slug, locales] of Object.entries(CONTENT)) {
    for (const [locale, sections] of Object.entries(locales)) {
      Object.entries(sections).forEach(([section, body], i) => {
        contentRows.push([slug, locale, section, body, (i + 1) * 10]);
      });
    }
  }
  await conn.query(
    'INSERT INTO product_content (slug, locale, section, body, sort_order) VALUES ?',
    [contentRows]
  );

  console.log('→ seeding extra product_documents');
  await conn.query(
    'INSERT INTO product_documents (slug, title_zh, title_en, kind, url, sort_order) VALUES ?',
    [EXTRA_DOCUMENTS]
  );

  // --- rwa_assets ----------------------------------------------
  console.log('→ seeding rwa_assets');
  await conn.query(
    `INSERT INTO rwa_assets (id, name, asset_type, network, token_symbol, token_address,
       token_decimals, total_supply, nav, status, sort_order) VALUES ?`,
    [RWA_ASSETS]
  );

  // --- RevenuePool ---------------------------------------------
  console.log('→ seeding revenue_pool_holdings and revenue_flows');
  await conn.query(
    `INSERT INTO revenue_pool_holdings (asset_label, asset_kind, network, amount, value_usd,
       priced, captured_at, sort_order) VALUES ?`,
    [REVENUE_POOL.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], DEMO_AS_OF, r[6]])]
  );
  await conn.query(
    'INSERT INTO revenue_flows (direction, source_zh, source_en, amount, occurred_at, sort_order) VALUES ?',
    [REVENUE_FLOWS]
  );

  // =============================================================
  // Derived protocol metrics (plan §1)
  // =============================================================
  const protocolAum = liveProducts.reduce((s, p) => s + Number(p.tvl), 0);

  // §1.3 — only active, tokenised assets with an available NAV.
  const valuableAssets = RWA_ASSETS.filter(
    a => a[9] === 'active' && a[5] !== null && a[8] !== null
  );
  const tokenizedAssets = valuableAssets.reduce((s, a) => s + a[7] * a[8], 0);

  const totalInterest = cycleRows.reduce((s, c) => s + c[6], 0);
  const protocolFeeIncome = cycleRows.reduce((s, c) => s + c[9] * c[3], 0);
  const otherIncome = REVENUE_FLOWS.filter(f => f[0] === 'in').reduce((s, f) => s + f[3], 0);
  const outflows = REVENUE_FLOWS.filter(f => f[0] === 'out').reduce((s, f) => s + f[3], 0);
  const revenuePoolValue = REVENUE_POOL.filter(r => r[5] === 1).reduce((s, r) => s + r[4], 0);

  const totalInvestorsUnique = 12456;        // unique holders, §1.4
  const activeVaults = liveProducts.length;
  const issuedRwaAssets = RWA_ASSETS.length; // registered in AssetRegistry

  // --- metric_readings: current values + history ---------------
  console.log('→ seeding protocol metric readings');
  const readings = [];
  const push = (key, num, date, source = 'Algorithm', ref = 'Indexer') =>
    readings.push([key, round(num), null, source, ref, null, date]);

  // A 90-day approach series for each headline figure, ending
  // exactly on the derived value so the chart's last point and the
  // headline number are the same number.
  const series = (key, end, days = 90, curve = 0.72) => {
    for (let i = days; i >= 0; i--) {
      const t = 1 - i / (days + 18);
      const wobble = 1 + Math.sin(i / 8.1) * 0.011 + Math.sin(i / 2.7) * 0.003;
      push(key, i === 0 ? end : end * (curve + (1 - curve) * t) * wobble, addDays(DEMO_AS_OF, -i));
    }
  };
  series('protocolAum', protocolAum);
  series('tokenizedAssets', tokenizedAssets);
  series('totalInvestorsSeries', totalInvestorsUnique, 90, 0.55);

  // Interest and revenue are cumulative: their history is the
  // running total of settled cycles, not a synthesised curve.
  const byDate = new Map();
  for (const c of cycleRows) {
    const d = isoOf(c[2]);
    const cur = byDate.get(d) || { y: 0, r: 0 };
    cur.y += c[6];
    cur.r += c[9] * c[3];
    byDate.set(d, cur);
  }
  let cumY = 0;
  let cumR = 0;
  for (const d of [...byDate.keys()].sort()) {
    cumY += byDate.get(d).y;
    cumR += byDate.get(d).r;
    push('totalInterestGenerated', cumY, d, 'Algorithm', 'CycleSnapshot');
    push('protocolRevenue', cumR, d, 'Algorithm', 'RevenuePool');
  }

  // Latest scalars. captured_at is the as-of date so v_metric_latest
  // resolves these as current.
  push('protocolAum', protocolAum, DEMO_AS_OF);
  push('tokenizedAssets', tokenizedAssets, DEMO_AS_OF);
  push('totalInterestGenerated', totalInterest, DEMO_AS_OF, 'Algorithm', 'CycleSnapshot');
  push('protocolRevenue', protocolFeeIncome, DEMO_AS_OF, 'Algorithm', 'RevenuePool');
  push('activeVaults', activeVaults, DEMO_AS_OF, 'Algorithm', 'VaultFactory');
  push('issuedRwaAssets', issuedRwaAssets, DEMO_AS_OF, 'Algorithm', 'AssetRegistry');
  push('revenuePoolValue', revenuePoolValue, DEMO_AS_OF, 'Algorithm', 'RevenuePool');
  push('revenuePoolOutflows', outflows, DEMO_AS_OF, 'Algorithm', 'RevenuePool');
  push('revenuePoolOtherIncome', otherIncome, DEMO_AS_OF, 'Algorithm', 'RevenuePool');
  push('totalInvestors', totalInvestorsUnique, DEMO_AS_OF, 'Algorithm', 'Indexer');

  await conn.query(
    `INSERT INTO metric_readings
       (metric_key, value_num, value_bool, data_source, source_ref, attribution, captured_at)
     VALUES ?
     ON DUPLICATE KEY UPDATE value_num = VALUES(value_num)`,
    [readings]
  );

  // --- protocol_breakdowns -------------------------------------
  console.log('→ seeding protocol_breakdowns');
  const breakdowns = [];
  const bd = (metric, dimension, label, slug, num, int, sort) =>
    breakdowns.push([metric, dimension, label, slug, num === null ? null : round(num), int, DEMO_AS_OF, sort]);

  // §1.2 Protocol AUM
  const aumByNetwork = {};
  const aumByType = {};
  liveProducts.forEach((p, i) => {
    aumByNetwork[p.network] = (aumByNetwork[p.network] || 0) + Number(p.tvl);
    const type = VAULTS[p.slug].product_type;
    aumByType[type] = (aumByType[type] || 0) + Number(p.tvl);
    bd('protocolAum', 'product', p.slug, p.slug, Number(p.tvl), null, (i + 1) * 10);
  });
  Object.entries(aumByNetwork).forEach(([k, v], i) => bd('protocolAum', 'network', k, null, v, null, (i + 1) * 10));
  Object.entries(aumByType).forEach(([k, v], i) => bd('protocolAum', 'product_type', k, null, v, null, (i + 1) * 10));

  // §1.3 Tokenized Assets
  const tokByType = {};
  const tokByNetwork = {};
  valuableAssets.forEach((a, i) => {
    const v = a[7] * a[8];
    tokByType[a[2]] = (tokByType[a[2]] || 0) + v;
    tokByNetwork[a[3]] = (tokByNetwork[a[3]] || 0) + v;
    bd('tokenizedAssets', 'token', `${a[4]} · ${a[1]}`, null, v, null, (i + 1) * 10);
  });
  Object.entries(tokByType).forEach(([k, v], i) => bd('tokenizedAssets', 'asset_type', k, null, v, null, (i + 1) * 10));
  Object.entries(tokByNetwork).forEach(([k, v], i) => bd('tokenizedAssets', 'network', k, null, v, null, (i + 1) * 10));

  // §1.4 Total Investors. Per-product counts intentionally exceed
  // the unique total: an address holding shares in several Vaults is
  // counted once protocol-wide but appears under each product.
  liveProducts.forEach((p, i) => bd('totalInvestors', 'product', p.slug, p.slug, null, VAULTS[p.slug].investors, (i + 1) * 10));

  // Per-network counts are unique-address counts in their own right,
  // NOT the sum of the per-product rows above — summing those would
  // reproduce exactly the double-count the product breakdown warns
  // about. Every live Vault currently sits on Ethereum, so the one
  // network row carries the full unique total.
  const networksLive = [...new Set(liveProducts.map(p => p.network))];
  networksLive.forEach((net, i) => {
    const unique = networksLive.length === 1
      ? totalInvestorsUnique
      : Math.round(
        totalInvestorsUnique
          * liveProducts.filter(p => p.network === net).reduce((s, p) => s + Number(p.tvl), 0)
          / protocolAum
      );
    bd('totalInvestors', 'network', net, null, null, unique, (i + 1) * 10);
  });

  // §1.5 Total Interest Generated
  const yieldBySlug = {};
  cycleRows.forEach(c => { yieldBySlug[c[0]] = (yieldBySlug[c[0]] || 0) + c[6]; });
  liveProducts.forEach((p, i) => bd('totalInterestGenerated', 'product', p.slug, p.slug, yieldBySlug[p.slug] || 0, null, (i + 1) * 10));
  const yieldByNetwork = {};
  liveProducts.forEach(p => { yieldByNetwork[p.network] = (yieldByNetwork[p.network] || 0) + (yieldBySlug[p.slug] || 0); });
  Object.entries(yieldByNetwork).forEach(([k, v], i) => bd('totalInterestGenerated', 'network', k, null, v, null, (i + 1) * 10));

  // §1.6 Revenue contribution by Vault
  const revBySlug = {};
  cycleRows.forEach(c => { revBySlug[c[0]] = (revBySlug[c[0]] || 0) + c[9] * c[3]; });
  liveProducts.forEach((p, i) => bd('protocolRevenue', 'vault', p.slug, p.slug, revBySlug[p.slug] || 0, null, (i + 1) * 10));

  await conn.query(
    `INSERT INTO protocol_breakdowns
       (metric_key, dimension, label, slug, value_num, value_int, captured_at, sort_order) VALUES ?`,
    [breakdowns]
  );

  // --- reconciliation ------------------------------------------
  const [[{ allocSum }]] = await conn.query(
    'SELECT SUM(real_assets) AS allocSum FROM product_allocations'
  );
  const aumOk = Math.abs(Number(allocSum) - protocolAum) < 0.01;

  console.log('\n  Protocol AUM              : ' + protocolAum.toFixed(2));
  console.log('  allocation rows sum       : ' + Number(allocSum).toFixed(2));
  console.log('  AUM reconciles            : ' + (aumOk ? 'yes' : 'NO — fix the seed'));
  console.log('  Tokenized Assets          : ' + tokenizedAssets.toFixed(2)
    + `  (${valuableAssets.length} of ${RWA_ASSETS.length} assets valued)`);
  console.log('  Total Interest Generated  : ' + totalInterest.toFixed(2)
    + `  (${cycleRows.length} settled cycles)`);
  console.log('  Protocol fee income       : ' + protocolFeeIncome.toFixed(2));
  console.log('  RevenuePool priced value  : ' + revenuePoolValue.toFixed(2));
}

module.exports = { seedDataPages, DEMO_AS_OF };
