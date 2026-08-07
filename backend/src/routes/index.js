const express = require('express');
const pool = require('../db/pool');
const metricsService = require('../services/metrics.service');
const productsService = require('../services/products.service');
const transparencyService = require('../services/transparency.service');
const liquidityService = require('../services/liquidity.service');
const protocolService = require('../services/protocol.service');

const router = express.Router();

/** `?locale=en` on any route; anything unrecognised falls back to zh-CN. */
const localeOf = (req) =>
  productsService.SUPPORTED_LOCALES.includes(req.query.locale) ? req.query.locale : 'zh-CN';

// Wraps an async handler so a rejected promise reaches the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/health', h(async (_req, res) => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  res.json({ status: 'ok', db: rows[0].ok === 1 ? 'connected' : 'unknown' });
}));

router.get('/metrics/homepage', h(async (req, res) => {
  res.json(await metricsService.getHomepageMetrics(localeOf(req)));
}));

router.get('/products', h(async (req, res) => {
  const locale = localeOf(req);
  const [products, filters] = await Promise.all([
    productsService.listProducts(locale),
    productsService.getFilterOptions(locale),
  ]);
  res.json({ products, filters });
}));

router.get('/transparency', h(async (req, res) => {
  res.json(await transparencyService.getTransparency(localeOf(req)));
}));

router.get('/liquidity', h(async (req, res) => {
  res.json(await liquidityService.getLiquidity(localeOf(req)));
}));

// Charts & Stats — protocol-level aggregates (data-pages plan §1).
router.get('/protocol/stats', h(async (req, res) => {
  res.json(await protocolService.getProtocolStats(localeOf(req)));
}));

router.get('/products/:slug', h(async (req, res) => {
  const product = await productsService.getProduct(req.params.slug, localeOf(req));
  if (!product) {
    return res.status(404).json({ error: 'not_found', message: `No product "${req.params.slug}"` });
  }
  res.json(product);
}));

module.exports = router;
