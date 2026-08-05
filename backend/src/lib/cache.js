/**
 * Tiny in-memory TTL cache. These figures change daily at most, so
 * hitting MySQL on every page load is pure waste.
 */
const store = new Map();

function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function set(key, value, ttlSeconds = 60) {
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  return value;
}

/** Run `fn` only on a miss. */
async function wrap(key, ttlSeconds, fn) {
  const hit = get(key);
  if (hit !== null) return hit;
  return set(key, await fn(), ttlSeconds);
}

function clear() {
  store.clear();
}

module.exports = { get, set, wrap, clear };
