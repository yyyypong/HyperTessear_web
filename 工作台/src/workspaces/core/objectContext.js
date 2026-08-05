const ROUTE_KEYS = ['vault', 'assetId', 'wrapper', 'adapter'];

/**
 * Converts the route/object shapes used by workspace screens to a small,
 * deterministic scope object. It deliberately preserves only supplied values:
 * no address or identifier is derived from a route name or another field.
 */
export function normalizeObjectContext(source) {
  const candidates = [source, source?.params, source?.object, source?.route?.params];
  const normalized = {};
  for (const key of ROUTE_KEYS) {
    for (const candidate of candidates) {
      const value = candidate?.[key];
      if (value !== undefined && value !== null && value !== '') {
        normalized[key] = value;
        break;
      }
    }
  }
  return normalized;
}

export function hasRequiredObject(scope, objectContext) {
  if (scope === 'permissionless' || scope === 'protocol') return true;
  const object = normalizeObjectContext(objectContext);
  if (scope === 'vault') return Boolean(object.vault);
  if (scope === 'asset') return object.assetId !== undefined;
  if (scope === 'wrapper') return object.assetId !== undefined || Boolean(object.wrapper);
  if (scope === 'adapter') return Boolean(object.adapter);
  return false;
}
