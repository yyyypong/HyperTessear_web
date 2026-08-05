/**
 * All number/date formatting lives here so a figure looks the same
 * in the nav badge, on a card, and in the detail header.
 */

/** $84.25M / $1.02B / $12,456 */
export function currencyCompact(value, { currency = '$' } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${currency}${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${currency}${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${currency}${(n / 1e3).toFixed(2)}K`;
  return `${currency}${n.toFixed(2)}`;
}

/** $84,250,000.75 */
export function currencyFull(value, { currency = '$' } = {}) {
  if (value === null || value === undefined) return '—';
  return currency + Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** 12,456 */
export function integer(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-US');
}

/** 8% / 14.5% / 0% — trims trailing zeros. */
export function percent(value, { digits = 2 } = {}) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  const s = n.toFixed(digits).replace(/\.?0+$/, '');
  return `${s}%`;
}

/**
 * Formats a targetApy object into its display string.
 * Covers all three wireframe cases:
 *   {min:8, max:8}                  -> "8%"
 *   {min:14.5, openEnded:true}      -> "14.5%+"
 *   {min:8.5, max:11.67}            -> "8.5%–11.67%"
 */
export function apyDisplay(apy) {
  if (!apy || apy.min === null || apy.min === undefined) return '—';
  if (apy.openEnded) return `${percent(apy.min)}+`;
  if (apy.max === null || apy.max === undefined || apy.max === apy.min) return percent(apy.min);
  return `${percent(apy.min)}–${percent(apy.max)}`;
}

/** True when the APY is a range rather than a single figure. */
export function apyIsRange(apy) {
  return Boolean(apy && !apy.openEnded && apy.max !== null && apy.max !== apy.min);
}

/** 2026-07-01 -> 2026-07-01 (kept ISO; unambiguous across locales) */
export function isoDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

/** 2026-07-27 09:14 */
export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Whole days between an ISO date and now. */
export function daysSince(value) {
  if (!value) return null;
  const then = new Date(`${String(value).slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

/** 0x7Ae1…a305 */
export function shortAddress(addr) {
  if (!addr) return '—';
  return addr.length <= 14 ? addr : `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

/** 44120000.5 of 100000000 -> 0.4412 */
export function utilisation(tvl, capacity) {
  if (!capacity || Number(capacity) <= 0) return null;
  return Math.min(1, Number(tvl) / Number(capacity));
}

/** Initials for the monogram fallback: "Cash Earn" -> "CE" */
export function initials(name) {
  if (!name) return '?';
  const words = String(name).replace(/[·.]/g, ' ').trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
