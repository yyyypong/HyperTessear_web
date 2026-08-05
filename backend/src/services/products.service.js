const pool = require('../db/pool');
const cache = require('../lib/cache');
const {
  toProductSummary, toProductDetail, toNavPoint, toDocument, toActivity, assertNoInternalFields,
} = require('../dto/publicShapes');

const SUPPORTED_LOCALES = ['zh-CN', 'en'];
const normaliseLocale = (l) => (SUPPORTED_LOCALES.includes(l) ? l : 'zh-CN');

/** Products with their translation for `locale`, ordered for display. */
async function listProducts(locale = 'zh-CN') {
  const loc = normaliseLocale(locale);
  return cache.wrap(`products:${loc}`, 60, async () => {
    const [rows] = await pool.query(
      `SELECT p.*, t.name, t.tagline, t.role_label, t.underlying, t.term_label
         FROM products p
         JOIN product_translations t ON t.slug = p.slug AND t.locale = ?
        ORDER BY p.sort_order`,
      [loc]
    );
    const payload = rows.map(toProductSummary);
    assertNoInternalFields(payload);
    return payload;
  });
}

/** Full detail for one product, including NAV series, docs and activity. */
async function getProduct(slug, locale = 'zh-CN') {
  const loc = normaliseLocale(locale);
  return cache.wrap(`product:${slug}:${loc}`, 60, async () => {
    const [rows] = await pool.query(
      `SELECT p.*, t.name, t.tagline, t.role_label, t.underlying, t.term_label,
              t.summary, t.strategy_note, t.redemption_note, t.risk_note
         FROM products p
         JOIN product_translations t ON t.slug = p.slug AND t.locale = ?
        WHERE p.slug = ?`,
      [loc, slug]
    );
    if (rows.length === 0) return null;

    const [[navRows], [docRows], [actRows]] = await Promise.all([
      pool.query(
        'SELECT * FROM product_nav_history WHERE slug = ? ORDER BY captured_at',
        [slug]
      ),
      pool.query(
        'SELECT * FROM product_documents WHERE slug = ? ORDER BY sort_order',
        [slug]
      ),
      pool.query(
        'SELECT * FROM product_activity WHERE slug = ? ORDER BY occurred_at DESC LIMIT 8',
        [slug]
      ),
    ]);

    const payload = toProductDetail(rows[0], {
      navHistory: navRows.map(toNavPoint),
      documents: docRows.map(r => toDocument(r, loc)),
      activity: actRows.map(toActivity),
    });
    assertNoInternalFields(payload);
    return payload;
  });
}

/** Distinct values for the products-page filter bar, so filters are real. */
async function getFilterOptions(locale = 'zh-CN') {
  const loc = normaliseLocale(locale);
  return cache.wrap(`filters:${loc}`, 60, async () => {
    const products = await listProducts(loc);
    const uniq = (arr) => [...new Set(arr)];
    return {
      terms: uniq(products.map(p => p.termLabel)),
      roles: uniq(products.map(p => p.roleLabel)),
      managers: uniq(products.map(p => p.strategyManager)),
      networks: uniq(products.map(p => p.network)),
      denominations: uniq(products.map(p => p.denomination)),
    };
  });
}

module.exports = { listProducts, getProduct, getFilterOptions, SUPPORTED_LOCALES };
