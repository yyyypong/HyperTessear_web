const pool = require('../db/pool');
const cache = require('../lib/cache');
const { assertNoInternalFields } = require('../dto/publicShapes');

const SUPPORTED_LOCALES = ['zh-CN', 'en'];
const normaliseLocale = (l) => (SUPPORTED_LOCALES.includes(l) ? l : 'zh-CN');

/** Anything locked for a year or more is not redeemable on request. */
const LOCKED_THRESHOLD_DAYS = 180;

/**
 * Data for /liquidity.
 *
 * The wireframe advertised 随时赎回 ("redeem anytime") as a headline
 * feature while Note Earn locks each deposit for 360 days. Rather than
 * repeat that claim, this endpoint splits TVL into what is actually
 * redeemable on request and what is locked, and exposes the buffer
 * vault's utilisation — the thing that determines whether a standard
 * redemption is fast or slow.
 */
async function getLiquidity(locale = 'zh-CN') {
  const loc = normaliseLocale(locale);

  return cache.wrap(`liquidity:${loc}`, 60, async () => {
    const [rows] = await pool.query(
      `SELECT p.slug, p.role, p.term_days, p.tvl, p.capacity, p.status,
              t.name, t.term_label, t.role_label, t.redemption_note
         FROM products p
         JOIN product_translations t ON t.slug = p.slug AND t.locale = ?
        WHERE p.status = 'live'
        ORDER BY p.sort_order`,
      [loc]
    );

    const num = (v) => Number(v);
    const liveTvl = rows.reduce((a, r) => a + num(r.tvl), 0);
    const lockedTvl = rows
      .filter(r => r.term_days >= LOCKED_THRESHOLD_DAYS)
      .reduce((a, r) => a + num(r.tvl), 0);
    const redeemableTvl = liveTvl - lockedTvl;

    // LP Earn is the buffer layer that fronts liquidity for redemptions.
    const bufferRow = rows.find(r => r.role === 'liquidity') || null;
    const buffer = bufferRow
      ? {
        slug: bufferRow.slug,
        name: bufferRow.name,
        tvl: num(bufferRow.tvl),
        capacity: bufferRow.capacity === null ? null : num(bufferRow.capacity),
        utilisation: bufferRow.capacity ? num(bufferRow.tvl) / num(bufferRow.capacity) : null,
      }
      : null;

    const payload = {
      totals: {
        liveTvl: Number(liveTvl.toFixed(4)),
        redeemableTvl: Number(redeemableTvl.toFixed(4)),
        lockedTvl: Number(lockedTvl.toFixed(4)),
        redeemableShare: liveTvl ? redeemableTvl / liveTvl : 0,
      },
      buffer,
      // Buffer depth relative to what could be redeemed on request.
      coverageRatio: redeemableTvl && buffer ? buffer.tvl / redeemableTvl : null,
      policies: rows.map(r => ({
        slug: r.slug,
        name: r.name,
        roleLabel: r.role_label,
        termDays: r.term_days,
        termLabel: r.term_label,
        redeemable: r.term_days < LOCKED_THRESHOLD_DAYS,
        redemptionNote: r.redemption_note,
        tvl: num(r.tvl),
      })),
    };

    assertNoInternalFields(payload);
    return payload;
  });
}

module.exports = { getLiquidity, LOCKED_THRESHOLD_DAYS };
