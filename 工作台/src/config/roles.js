/** Role identifiers and workspace routing helpers. */

export const ROLES = Object.freeze({
  GOVERNOR: 'governor',
  VAULT_OWNER: 'vault-owner',
  VAULT_CURATOR: 'vault-curator',
  VAULT_ALLOCATOR: 'vault-allocator',
  VAULT_GUARDIAN: 'vault-guardian',
  VAULT_SETTLEMENT_OPERATOR: 'vault-settlement-operator',
  ASSET_ISSUER: 'asset-issuer',
  TOKEN_AGENT: 'token-agent',
  NAV_PROVIDER: 'nav-provider',
  WRAPPER_CONTROLLER: 'wrapper-controller',
  PSM_AUTHORIZED_SIGNER: 'psm-authorized-signer',
});

export const VAULT_ROLES = Object.freeze([
  ROLES.VAULT_OWNER,
  ROLES.VAULT_CURATOR,
  ROLES.VAULT_ALLOCATOR,
  ROLES.VAULT_GUARDIAN,
  ROLES.VAULT_SETTLEMENT_OPERATOR,
]);

export const WRAPPED_ROLES = Object.freeze([
  ROLES.WRAPPER_CONTROLLER,
  ROLES.PSM_AUTHORIZED_SIGNER,
]);

/** Roles that do not require selecting a Vault / Asset / Wrapped Asset. */
export const OBJECTLESS_ROLES = Object.freeze([
  ROLES.GOVERNOR,
  ROLES.TOKEN_AGENT,
]);

export const ROLE_LABEL_KEYS = Object.freeze({
  [ROLES.GOVERNOR]: 'roles.governor',
  [ROLES.VAULT_OWNER]: 'roles.vaultOwner',
  [ROLES.VAULT_CURATOR]: 'roles.vaultCurator',
  [ROLES.VAULT_ALLOCATOR]: 'roles.vaultAllocator',
  [ROLES.VAULT_GUARDIAN]: 'roles.vaultGuardian',
  [ROLES.VAULT_SETTLEMENT_OPERATOR]: 'roles.vaultSettlementOperator',
  [ROLES.ASSET_ISSUER]: 'roles.assetIssuer',
  [ROLES.TOKEN_AGENT]: 'roles.tokenAgent',
  [ROLES.NAV_PROVIDER]: 'roles.navProvider',
  [ROLES.WRAPPER_CONTROLLER]: 'roles.wrapperController',
  [ROLES.PSM_AUTHORIZED_SIGNER]: 'roles.psmAuthorizedSigner',
});

/* Role resolution lands in the full operational workspaces (/workspaces),
   not the bare identity shells — the shells only carried context. */

const LEGACY_VAULT_ROLE = Object.freeze({
  [ROLES.VAULT_OWNER]: 'vault-owner',
  [ROLES.VAULT_CURATOR]: 'curator',
  [ROLES.VAULT_ALLOCATOR]: 'allocator',
  [ROLES.VAULT_GUARDIAN]: 'guardian',
  [ROLES.VAULT_SETTLEMENT_OPERATOR]: 'settlement-operator',
});

const LEGACY_WRAPPED_ROLE = Object.freeze({
  [ROLES.WRAPPER_CONTROLLER]: 'wrapper-controller',
  [ROLES.PSM_AUTHORIZED_SIGNER]: 'psm-authorized-signer',
});

/* Mock asset / wrapped ids are slugs; legacy workspaces expect numeric ids. */
const LEGACY_ASSET_ID = Object.freeze({
  'asset-rwa-usdt': '1',
  'asset-rwa-usdc': '2',
  'asset-rwa-bnb': '3',
  'wrapped-htusdt': '1',
  'wrapped-htusdc': '2',
  'wrapped-htbnb': '3',
});

/* NAV signing is vault-scoped in the legacy workspaces; the demo NAV
   provider manages assets tied to the first demo vault. */
const DEMO_NAV_VAULT = '0xAaaa111111111111111111111111111111111111';

function legacyAssetId(id) {
  if (LEGACY_ASSET_ID[id]) return LEGACY_ASSET_ID[id];
  return /^[1-9]\d*$/.test(String(id)) ? String(id) : '1';
}

export function vaultWorkspacePath(vaultAddress, role) {
  const legacy = LEGACY_VAULT_ROLE[role] || 'vault-owner';
  return `/workspaces/${legacy}/${encodeURIComponent(vaultAddress)}`;
}

export function assetIssuerWorkspacePath(assetId) {
  return `/workspaces/asset-owner/${legacyAssetId(assetId)}`;
}

export function navProviderWorkspacePath(assetId) {
  return `/workspaces/nav-signer/${encodeURIComponent(DEMO_NAV_VAULT)}`;
}

export function wrappedWorkspacePath(assetId, role) {
  const legacy = LEGACY_WRAPPED_ROLE[role] || 'wrapper-controller';
  return `/workspaces/${legacy}/${legacyAssetId(assetId)}`;
}

export function tokenAgentWorkspacePath() {
  return '/workspaces/token-agent/1';
}

export function governorWorkspacePath() {
  return '/workspaces/governor';
}
