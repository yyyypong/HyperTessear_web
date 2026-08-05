/**
 * Creates the database, applies schema.sql, and loads seed data.
 * Safe to re-run: it truncates the seeded tables first.
 *
 *   npm run migrate
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'HYT_TEST';

// ---------------------------------------------------------------
// Seed values
//
// KPI figures come from "Data Table Homepage (5).pdf". Note that
// currentTVL is reconciled against the sum of per-product TVL below
// (44,120,000.50 + 22,880,000.25 + 17,250,000.00 = 84,250,000.75)
// so the nav badge and the products page cannot contradict each other.
// ---------------------------------------------------------------
const METRICS = [
  // historicalFailureRate is DECIMAL here, not INT — PDF (4) said INT(4),
  // PDF (6) said float, and a failure rate needs decimals.
  { key: 'historicalFailureRate', num: 0.0, src: 'Human', ref: 'Risk Committee',
    attribution: 'Lindale Capital', dates: ['2026-05-01', '2026-06-01', '2026-07-01'] },
  { key: 'cumAssetsMinted', num: 102340000.25, src: 'Algorithm', ref: 'https://api.defillama.com',
    attribution: 'Lindale Capital', dates: ['2026-05-01', '2026-06-01', '2026-07-01'] },
  { key: 'cumPayout', num: 15750000.50, src: 'Human', ref: 'John Doe',
    attribution: 'Lindale Capital', dates: ['2026-05-01', '2026-06-01', '2026-07-01'] },
  { key: 'totalInvestors', num: 12456, src: 'Algorithm', ref: 'https://api.crm.example',
    attribution: 'Lindale Capital', dates: ['2026-05-01', '2026-06-01', '2026-07-01'] },
  // Protocol's own numbers — no attribution, because they are ours.
  // currentTVL is generated as a daily series below, not listed here.
  { key: 'protocolLiveStatus', bool: true, src: 'Algorithm', ref: 'https://status.example.com/api',
    attribution: null, dates: ['2026-07-28'] },
];

/** Live TVL as of the latest reading. Must equal SUM(products.tvl) for live products. */
const CURRENT_TVL = 84250000.75;

/**
 * Daily currentTVL readings ending exactly at CURRENT_TVL.
 *
 * The append-only metric_readings table exists so history survives; a
 * single row per metric could not draw the /transparency chart at all.
 */
function tvlSeries(days = 90) {
  const rows = [];
  const end = new Date('2026-07-28T00:00:00Z');
  for (let i = days; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    // grows toward CURRENT_TVL with a deterministic wobble
    const progress = 1 - i / (days + 12);
    const wobble = 1 + Math.sin(i / 7.3) * 0.012 + Math.sin(i / 2.1) * 0.004;
    const value = i === 0 ? CURRENT_TVL : CURRENT_TVL * progress * wobble;
    rows.push([
      'currentTVL',
      Number(value.toFixed(4)),
      null,
      'Algorithm',
      'https://api.defillama.com',
      null,
      d.toISOString().slice(0, 10),
    ]);
  }
  return rows;
}

const RESERVES = [
  [null, '短久期应收账款 / Short-duration receivables', 38420000.00, 'NAV Fund Services',
    'https://www.navfundservices.com/', '2026-07-01', 10],
  [null, '贸易融资敞口 / Trade finance exposure', 24180000.00, 'NAV Fund Services',
    'https://www.navfundservices.com/', '2026-07-01', 20],
  [null, '现金及等价物 / Cash and equivalents', 12960000.75, 'NAV Fund Services',
    'https://www.navfundservices.com/', '2026-07-01', 30],
  [null, '链上稳定币储备 / Onchain stablecoin reserves', 8690000.00, 'Chainlink Proof of Reserve',
    'https://chain.link/', '2026-07-28', 40],
];

const PARTNERS = [
  [1, 'Morpho', 'https://morpho.org', 'integration', 10],
  [2, 'Aave', 'https://aave.com', 'integration', 20],
  [3, 'Pendle', 'https://www.pendle.finance', 'integration', 30],
  [4, 'OpenEden', 'https://openeden.com', 'integration', 40],
  [5, 'Maple', 'https://maple.finance', 'integration', 50],
  [6, 'Ondo', 'https://ondo.finance', 'integration', 60],
  [7, 'Centrifuge', 'https://centrifuge.io', 'integration', 70],
  [8, 'OSL', 'https://osl.com', 'custodian', 10],
  [9, 'EXIO', null, 'custodian', 20],
  [10, 'HashKey', 'https://www.hashkey.com', 'custodian', 30],
  [11, 'PeckShield', 'https://peckshield.com', 'auditor', 10],
  [12, 'SlowMist', 'https://www.slowmist.com', 'auditor', 20],
  [13, 'CertiK', 'https://www.certik.com', 'auditor', 30],
  [14, 'Lindale Capital', null, 'manager', 10],
  [15, 'Fasanara Capital', null, 'manager', 20],
];

const AUDITS = [
  ['PeckShield', 'Cash Earn 金库与铸造合约', 'Cash Earn vault and minting contracts',
    'https://github.com/peckshield/publications', '2026-05-18', 10],
  ['SlowMist', 'Note Earn 锁仓与到期结算逻辑', 'Note Earn lockup and maturity settlement logic',
    'https://www.slowmist.com/en/security-audit-solution.html', '2026-06-02', 20],
  ['CertiK', 'ERC-4626 LP 金库与预言机接入', 'ERC-4626 LP vault and oracle integration',
    'https://skynet.certik.com', '2026-06-24', 30],
];

const PRODUCTS = [
  {
    slug: 'cash-earn', sequence_no: 1, role: 'senior',
    strategy_manager: 'Lindale Capital', strategy_ref: 'CHUAN Private Credit',
    denomination: 'USDT', term_days: 7,
    target_apy_min: 8.0, target_apy_max: 8.0, apy_open_ended: 0,
    tvl: 44120000.50, capacity: 100000000.00,
    status: 'live', network: 'Ethereum', token_standard: 'ERC-20',
    contract_address: '0x7Ae1C0f3B2d94A6E5C81f0D3b9A2E4F6C8D1a305',
    inception_date: '2026-03-02', sort_order: 10,
  },
  {
    slug: 'note-earn', sequence_no: 2, role: 'junior',
    strategy_manager: 'Lindale Capital', strategy_ref: 'CHUAN Private Credit',
    denomination: 'USDT', term_days: 360,
    target_apy_min: 14.5, target_apy_max: null, apy_open_ended: 1,
    tvl: 22880000.25, capacity: 40000000.00,
    status: 'live', network: 'Ethereum', token_standard: 'ERC-20',
    contract_address: '0x2Bd9E4a17C63F805D2a9B7E1c4F6038A5e2D9b41',
    inception_date: '2026-03-02', sort_order: 20,
  },
  {
    slug: 'lp-earn', sequence_no: 3, role: 'liquidity',
    strategy_manager: 'Lindale Capital', strategy_ref: 'CHUAN Private Credit',
    denomination: 'USDT', term_days: 7,
    target_apy_min: 8.5, target_apy_max: 11.67, apy_open_ended: 0,
    tvl: 17250000.00, capacity: 30000000.00,
    status: 'live', network: 'Ethereum', token_standard: 'ERC-4626',
    contract_address: '0x9F51aB7d2E084C36b1D7f5A0c93E28D4b6F1c072',
    inception_date: '2026-04-14', sort_order: 30,
  },
  {
    slug: 'cash-earn-usdc', sequence_no: 1, role: 'senior',
    strategy_manager: 'Lindale Capital', strategy_ref: 'CHUAN Private Credit',
    denomination: 'USDC', term_days: 7,
    target_apy_min: 7.8, target_apy_max: 7.8, apy_open_ended: 0,
    tvl: 0, capacity: 50000000.00,
    status: 'coming_soon', network: 'BNB Chain', token_standard: 'ERC-20',
    contract_address: null, inception_date: null, sort_order: 40,
  },
  {
    slug: 'hyper-liquidity', sequence_no: 4, role: 'liquidity',
    strategy_manager: 'Fasanara Capital', strategy_ref: 'Global Diversified Alternative Debt',
    denomination: 'USDT', term_days: 30,
    target_apy_min: 9.0, target_apy_max: 12.0, apy_open_ended: 0,
    tvl: 0, capacity: null,
    status: 'coming_soon', network: 'Ethereum', token_standard: 'ERC-4626',
    contract_address: null, inception_date: null, sort_order: 50,
  },
];

const TRANSLATIONS = {
  'cash-earn': {
    zh: {
      name: 'Cash Earn', tagline: '稳定优先，7 天周期，随时可申赎',
      role_label: '优先', underlying: '信用 RWA', term_label: '7 天',
      summary: '面向短期稳定币资金管理用户。存入 USDT 后自持 Cash Token，代币价值随 NAV 增长，收益来自高优先级信用类 RWA 资产池。适合希望在保持流动性的前提下获得稳定回报的用户。',
      strategy_note: '底层资产由 Lindale Capital 通过 CHUAN Private Credit 策略管理，聚焦短久期、有抵押的应收账款与贸易融资敞口。资产筛选经过尽职调查与集中度限制，单一交易对手敞口上限为组合净值的 10%。',
      redemption_note: '标准赎回在两次净值更新后处理，通常为 1–3 个工作日。界面显示的赎回窗口为指示性信息，不具约束力：赎回须待策略管理人划拨对应资金后方可完成。处理时点采用的代币价格可能高于或低于申请时价格。',
      risk_note: '本产品面临信用风险（底层借款人违约）、流动性风险（赎回可能延迟）、市场风险及合规与监管风险。目标年化为测算值，不构成收益承诺。',
    },
    en: {
      name: 'Cash Earn', tagline: 'Senior tranche, 7-day cycle, redeemable on request',
      role_label: 'Senior', underlying: 'Credit RWA', term_label: '7 days',
      summary: 'For short-term stablecoin treasury management. Deposit USDT and hold Cash Token, whose value accrues with NAV. Yield is sourced from a senior-ranking credit RWA pool. Suited to users who want stable returns without giving up liquidity.',
      strategy_note: 'Underlying assets are managed by Lindale Capital through the CHUAN Private Credit strategy, focused on short-duration, collateralised receivables and trade finance exposure. Assets pass due diligence and concentration limits, with single-counterparty exposure capped at 10% of portfolio NAV.',
      redemption_note: 'Standard redemptions are processed after two price updates, typically 1–3 business days. The redemption window shown in the interface is indicative and not binding: a redemption completes only once the Strategy Manager has set aside the corresponding funds. The processing price may be higher or lower than the request-time price.',
      risk_note: 'This product carries credit risk (default of underlying borrowers), liquidity risk (redemptions may be delayed), market risk, and regulatory risk. The target APY is an estimate and is not a promised return.',
    },
  },
  'note-earn': {
    zh: {
      name: 'Note Earn', tagline: '长期高收益（劣后），每笔存入锁定 360 天',
      role_label: '劣后', underlying: 'X 劣后 / Y 货币', term_label: '锁定 1 年',
      summary: '面向愿以流动性换取更高收益的长期用户。每笔 deposit 单独锁定 360 天，NAV 持续累积，到期一次性发放本金与收益。作为劣后档，本产品优先承担底层资产池的信用损失。',
      strategy_note: '与 Cash Earn 共享同一真实资产池，但处于劣后受偿顺位：优先档先行获得约定回报后，剩余收益归属劣后档，因而目标年化更高，同时损失吸收顺序也更靠前。',
      redemption_note: '锁定期内不支持提前赎回。每笔存入独立计算到期日，到期后本金与累计收益一次性发放至存入地址。到期前 7 天界面会显示到期提醒。',
      risk_note: '作为劣后档，本产品在底层资产发生违约时先于优先档承担损失，极端情形下可能损失全部本金。360 天锁定期内资金不可动用。目标年化为测算值，不构成收益承诺。',
    },
    en: {
      name: 'Note Earn', tagline: 'Long-dated junior tranche, each deposit locked for 360 days',
      role_label: 'Junior', underlying: 'X junior / Y currency', term_label: '1-year lock',
      summary: 'For long-term users willing to trade liquidity for higher yield. Each deposit is locked independently for 360 days, NAV accrues throughout, and principal plus yield is released in a single payment at maturity. As the junior tranche, this product absorbs credit losses from the underlying pool first.',
      strategy_note: 'Shares the same real-asset pool as Cash Earn but sits junior in the waterfall: the senior tranche is paid its contracted return first, and residual yield accrues to the junior tranche. That is why the target APY is higher — and why it absorbs losses first.',
      redemption_note: 'Early redemption is not supported during the lock period. Each deposit has its own maturity date; principal and accrued yield are released in one payment to the depositing address at maturity. The interface shows a maturity reminder 7 days ahead.',
      risk_note: 'As the junior tranche, this product absorbs losses ahead of the senior tranche if underlying assets default, and in extreme scenarios the entire principal may be lost. Funds are not accessible during the 360-day lock. The target APY is an estimate and is not a promised return.',
    },
  },
  'lp-earn': {
    zh: {
      name: 'LP Earn', tagline: '流动性提供，基础收益 + 流动性补偿奖金',
      role_label: '流动性提供', underlying: 'Cash Token', term_label: '7 天',
      summary: '独立的 ERC-4626 金库。存入的 USDT 兑换为 Cash Token 持有，除享有基础收益外，另获流动性补偿奖金。LP Token 符合 ERC-4626 标准，可组合接入其他 DeFi 协议。',
      strategy_note: '金库为协议的即时赎回能力提供缓冲层：当 Cash Earn 出现集中赎回时，LP 金库先行垫付流动性，并因此获得补偿奖金。奖金随缓冲层使用率浮动，故目标年化以区间呈现。',
      redemption_note: '标准赎回在两次净值更新后处理。在缓冲层被大量占用期间，赎回处理时间可能延长；此时奖金费率通常同步上升。',
      risk_note: '除底层信用风险外，本产品额外承担缓冲层被占用导致的赎回延迟风险。奖金部分并非保证收益，随参与条款与第三方协议条件变化。目标年化区间为测算值。',
    },
    en: {
      name: 'LP Earn', tagline: 'Liquidity provision — base yield plus a liquidity premium',
      role_label: 'Liquidity', underlying: 'Cash Token', term_label: '7 days',
      summary: 'A standalone ERC-4626 vault. Deposited USDT is converted into Cash Token holdings, earning base yield plus a liquidity compensation bonus. The LP token follows the ERC-4626 standard and is composable with other DeFi protocols.',
      strategy_note: 'The vault provides the buffer layer behind the protocol\'s instant-redemption capacity: when Cash Earn sees concentrated redemptions, the LP vault fronts liquidity and is compensated for doing so. The bonus floats with buffer utilisation, which is why the target APY is expressed as a range.',
      redemption_note: 'Standard redemptions are processed after two price updates. While the buffer is heavily utilised, redemption processing may take longer — the bonus rate typically rises over the same period.',
      risk_note: 'In addition to underlying credit risk, this product carries redemption-delay risk when the buffer is heavily utilised. The bonus is not a guaranteed return and varies with participation terms and third-party protocol conditions. The target APY range is an estimate.',
    },
  },
  'cash-earn-usdc': {
    zh: {
      name: 'Cash Earn · USDC', tagline: 'USDC 系列优先档，第二期开放',
      role_label: '优先', underlying: '信用 RWA', term_label: '7 天',
      summary: 'Cash Earn 的 USDC 计价版本，计划于第二期在 BNB Chain 上线。产品结构与 USDT 版本一致。',
      strategy_note: null, redemption_note: null,
      risk_note: '产品尚未上线，参数以最终发行文件为准。',
    },
    en: {
      name: 'Cash Earn · USDC', tagline: 'USDC-denominated senior tranche, phase 2',
      role_label: 'Senior', underlying: 'Credit RWA', term_label: '7 days',
      summary: 'The USDC-denominated version of Cash Earn, planned for phase 2 on BNB Chain. Structurally identical to the USDT version.',
      strategy_note: null, redemption_note: null,
      risk_note: 'Not yet live. Final parameters will follow the offering documentation.',
    },
  },
  'hyper-liquidity': {
    zh: {
      name: 'HyperLiquidity', tagline: '多资产类型 RWA 金库，第二期开放',
      role_label: '流动性提供', underlying: '多资产 RWA', term_label: '30 天',
      summary: '由 Fasanara Capital 管理的多元化另类债权策略代币化版本，计划于第二期开放。',
      strategy_note: null, redemption_note: null,
      risk_note: '产品尚未上线，参数以最终发行文件为准。',
    },
    en: {
      name: 'HyperLiquidity', tagline: 'Multi-asset RWA vault, phase 2',
      role_label: 'Liquidity', underlying: 'Multi-asset RWA', term_label: '30 days',
      summary: 'A tokenised version of Fasanara Capital\'s Global Diversified Alternative Debt strategy, planned for phase 2.',
      strategy_note: null, redemption_note: null,
      risk_note: 'Not yet live. Final parameters will follow the offering documentation.',
    },
  },
};

const DOCUMENTS = [
  ['cash-earn', '产品发行文件', 'Offering documentation', 'offering', null, 10],
  ['cash-earn', 'PeckShield 审计报告', 'PeckShield audit report', 'audit', 'https://github.com/peckshield/publications', 20],
  ['cash-earn', '储备证明（月度）', 'Proof of reserves (monthly)', 'attestation', null, 30],
  ['note-earn', '产品发行文件', 'Offering documentation', 'offering', null, 10],
  ['note-earn', 'SlowMist 审计报告', 'SlowMist audit report', 'audit', 'https://www.slowmist.com/en/security-audit-solution.html', 20],
  ['note-earn', '锁仓条款', 'Lockup terms', 'terms', null, 30],
  ['lp-earn', '产品发行文件', 'Offering documentation', 'offering', null, 10],
  ['lp-earn', 'CertiK 审计报告', 'CertiK audit report', 'audit', 'https://skynet.certik.com', 20],
];

// ---------------------------------------------------------------
// Generated series
// ---------------------------------------------------------------
function navSeries(slug, startNav, annualPct, days) {
  const rows = [];
  const daily = annualPct / 100 / 365;
  let nav = startNav;
  const today = new Date('2026-07-28T00:00:00Z');
  for (let i = days; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    // deterministic wobble so the chart isn't a straight line
    const wobble = 1 + Math.sin(i / 6.5) * 0.00012;
    nav = nav * (1 + daily) * wobble;
    const jitter = Math.sin(i / 4.0) * 0.45;
    rows.push([
      slug,
      d.toISOString().slice(0, 10),
      Number(nav.toFixed(6)),
      Number((annualPct + jitter).toFixed(3)),
      Number((annualPct + jitter * 0.4).toFixed(3)),
    ]);
  }
  return rows;
}

function activityRows(slug, seed) {
  const kinds = ['deposit', 'redeem', 'yield'];
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(2026, 6, 27 - i * 2, 9 + ((seed + i) % 9), (seed * 7 + i * 13) % 60));
    rows.push([
      slug,
      kinds[(seed + i) % 3],
      Number((((seed + 1) * 37000 + i * 12500) % 900000 + 12000).toFixed(2)),
      d.toISOString().slice(0, 19).replace('T', ' '),
    ]);
  }
  return rows;
}

// ---------------------------------------------------------------
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    port: Number(process.env.DB_PORT) || 8889,
    multipleStatements: true,
  });

  console.log(`→ creating database \`${DB_NAME}\` if needed`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  await conn.query(`USE \`${DB_NAME}\`;`);

  console.log('→ applying schema.sql');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);

  console.log('→ clearing seeded tables');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
  for (const t of ['metric_readings', 'partners', 'security_audits', 'reserve_attestations',
    'product_activity', 'product_documents', 'product_nav_history', 'product_translations',
    'products']) {
    await conn.query(`TRUNCATE TABLE \`${t}\`;`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1;');

  console.log('→ seeding metric_readings');
  const metricRows = [];
  for (const m of METRICS) {
    m.dates.forEach((date, idx) => {
      // earlier readings are scaled down slightly so history is visible
      const scale = 1 - (m.dates.length - 1 - idx) * 0.04;
      metricRows.push([
        m.key,
        m.num === undefined ? null : Number((m.num * (m.key === 'historicalFailureRate' ? 1 : scale)).toFixed(4)),
        m.bool === undefined ? null : m.bool,
        m.src, m.ref, m.attribution, date,
      ]);
    });
  }
  metricRows.push(...tvlSeries(90));
  await conn.query(
    'INSERT INTO metric_readings (metric_key, value_num, value_bool, data_source, source_ref, attribution, captured_at) VALUES ?',
    [metricRows]
  );

  console.log('→ seeding reserve_attestations');
  await conn.query(
    'INSERT INTO reserve_attestations (slug, asset_class, amount, attestor, report_url, attested_at, sort_order) VALUES ?',
    [RESERVES]
  );

  console.log('→ seeding partners');
  await conn.query(
    'INSERT INTO partners (id, name, link_url, category, sort_order) VALUES ?',
    [PARTNERS]
  );

  console.log('→ seeding security_audits');
  await conn.query(
    'INSERT INTO security_audits (auditor, scope_zh, scope_en, report_url, completed_at, sort_order) VALUES ?',
    [AUDITS]
  );

  console.log('→ seeding products');
  await conn.query(
    `INSERT INTO products (slug, sequence_no, role, strategy_manager, strategy_ref, denomination,
       term_days, target_apy_min, target_apy_max, apy_open_ended, tvl, capacity, status, network,
       token_standard, contract_address, inception_date, sort_order) VALUES ?`,
    [PRODUCTS.map(p => [p.slug, p.sequence_no, p.role, p.strategy_manager, p.strategy_ref,
      p.denomination, p.term_days, p.target_apy_min, p.target_apy_max, p.apy_open_ended,
      p.tvl, p.capacity, p.status, p.network, p.token_standard, p.contract_address,
      p.inception_date, p.sort_order])]
  );

  console.log('→ seeding product_translations');
  const trRows = [];
  for (const [slug, locales] of Object.entries(TRANSLATIONS)) {
    for (const [loc, t] of Object.entries(locales)) {
      trRows.push([slug, loc === 'zh' ? 'zh-CN' : 'en', t.name, t.tagline, t.role_label,
        t.underlying, t.term_label, t.summary, t.strategy_note, t.redemption_note, t.risk_note]);
    }
  }
  await conn.query(
    `INSERT INTO product_translations (slug, locale, name, tagline, role_label, underlying,
       term_label, summary, strategy_note, redemption_note, risk_note) VALUES ?`,
    [trRows]
  );

  console.log('→ seeding product_nav_history');
  const navRows = [
    ...navSeries('cash-earn', 1.0, 8.0, 120),
    ...navSeries('note-earn', 1.0, 14.5, 120),
    ...navSeries('lp-earn', 1.0, 10.1, 90),
  ];
  await conn.query(
    'INSERT INTO product_nav_history (slug, captured_at, nav, apy_7d, apy_30d) VALUES ?',
    [navRows]
  );

  console.log('→ seeding product_documents');
  await conn.query(
    'INSERT INTO product_documents (slug, title_zh, title_en, kind, url, sort_order) VALUES ?',
    [DOCUMENTS]
  );

  console.log('→ seeding product_activity');
  const actRows = [
    ...activityRows('cash-earn', 1),
    ...activityRows('note-earn', 2),
    ...activityRows('lp-earn', 3),
  ];
  await conn.query(
    'INSERT INTO product_activity (slug, kind, amount, occurred_at) VALUES ?',
    [actRows]
  );

  // Sanity check: the TVL badge must reconcile with the products page.
  const [[{ sum }]] = await conn.query(
    "SELECT SUM(tvl) AS sum FROM products WHERE status = 'live'"
  );
  const [[{ tvl }]] = await conn.query(
    "SELECT value_num AS tvl FROM v_metric_latest WHERE metric_key = 'currentTVL'"
  );
  const [[{ res }]] = await conn.query('SELECT SUM(amount) AS res FROM reserve_attestations');
  const ok = Math.abs(Number(sum) - Number(tvl)) < 0.01 && Math.abs(Number(res) - Number(tvl)) < 0.01;
  console.log(`\n  live product TVL sum : ${Number(sum).toFixed(2)}`);
  console.log(`  currentTVL metric    : ${Number(tvl).toFixed(2)}`);
  console.log(`  attested reserves    : ${Number(res).toFixed(2)}`);
  console.log(`  reconciles           : ${ok ? 'yes' : 'NO — fix the seed'}`);

  console.log('\nMigration complete.');
  await conn.end();
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
