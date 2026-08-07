const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001/api/v1';

async function get(path, { locale, signal } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (locale) url.searchParams.set('locale', locale);

  const res = await fetch(url, { signal });
  if (res.status === 404) {
    const err = new Error('not_found');
    err.status = 404;
    throw err;
  }
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json();
}

export const api = {
  health: (opts) => get('/health', opts),
  homepageMetrics: (opts) => get('/metrics/homepage', opts),
  products: (opts) => get('/products', opts),
  product: (slug, opts) => get(`/products/${encodeURIComponent(slug)}`, opts),
  transparency: (opts) => get('/transparency', opts),
  liquidity: (opts) => get('/liquidity', opts),
  protocolStats: (opts) => get('/protocol/stats', opts),
};
