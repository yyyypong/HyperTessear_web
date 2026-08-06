import { id as roleHash, ZeroAddress } from 'ethers';

function sameAddress(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.toLowerCase() === right.toLowerCase();
}

async function safe(promise, fallback) {
  try { return await promise; } catch { return fallback; }
}

/**
 * Vault roles moved from protocol-global HyperAccessControl grants to
 * vault-local appointments (owner / curator / guardian / allocator / keeper on
 * BaseVault, operator on Settlement). Legacy deployments still only expose the
 * global grants, so resolution follows the SDK's deployment profile rather
 * than guessing from call failures.
 */
export function usesVaultLocalRoles(sdk) {
  return sdk?.profile === 'target';
}

/** Vault-local role holders, read straight off the vault (target profile). */
async function readVaultLocalRoles(sdk, vault, account) {
  const contract = sdk.getContract('EarnVault', vault);
  const [owner, curator, guardian, allocator, keeper] = await Promise.all([
    safe(contract.owner(), ZeroAddress),
    safe(contract.curator(), ZeroAddress),
    safe(contract.guardian(), ZeroAddress),
    safe(contract.allocator(), ZeroAddress),
    safe(contract.isKeeper(account), false),
  ]);
  return {
    'vault-owner': sameAddress(owner, account),
    curator: sameAddress(curator, account),
    guardian: sameAddress(guardian, account),
    allocator: sameAddress(allocator, account),
    keeper: keeper === true,
  };
}

/**
 * Legacy fallback: the deployed contracts gate every vault administrative call
 * on the global Governor role and the functional roles on their global grants,
 * so the same answer applies to every vault.
 */
async function readGlobalRoles(sdk, vault, account) {
  const [governor, curator, guardian, allocator, keeper] = await Promise.all([
    safe(sdk.hasRole(roleHash('GOVERNOR_ROLE'), account), false),
    safe(sdk.hasRole(roleHash('CURATOR_ROLE'), account), false),
    safe(sdk.hasRole(roleHash('GUARDIAN_ROLE'), account), false),
    safe(sdk.hasRole(roleHash('ALLOCATOR_ROLE'), account), false),
    safe(sdk.hasRole(roleHash('KEEPER_ROLE'), account), false),
  ]);
  return {
    'vault-owner': governor === true,
    curator: curator === true,
    guardian: guardian === true,
    allocator: allocator === true,
    keeper: keeper === true,
  };
}

/** Settlement operator, per vault on target and global on legacy. */
export async function readSettlementOperator(sdk, vault, account) {
  const settlement = sdk.settlement;
  if (usesVaultLocalRoles(sdk)) {
    return await safe(settlement.isOperator(vault, account), false) === true;
  }
  return await safe(settlement.isOperator(account), false) === true;
}

/**
 * NAV signer. The target oracle is keyed by RWA token (signerOf) while the
 * legacy oracle is keyed by vault (authorizedSigner), so the caller supplies
 * whichever key its object provides.
 */
export async function readNavSigner(sdk, { vault, rwaToken }, account) {
  const oracle = sdk.navOracle;
  if (usesVaultLocalRoles(sdk)) {
    if (!rwaToken) return false;
    return sameAddress(await safe(oracle.signerOf(rwaToken), ZeroAddress), account);
  }
  if (!vault) return false;
  return sameAddress(await safe(oracle.authorizedSigner(vault), ZeroAddress), account);
}

/**
 * Every vault-scoped role the account holds on this vault, resolved against
 * whichever contract generation the deployment runs.
 */
export async function resolveVaultRoles(sdk, vault, account, { rwaToken } = {}) {
  if (!sdk || !vault || !account) {
    return {
      'vault-owner': false, curator: false, guardian: false, allocator: false,
      keeper: false, 'settlement-operator': false, 'nav-signer': false,
      'adapter-data-provider': false,
    };
  }
  const [base, settlementOperator, navSigner, dataProvider] = await Promise.all([
    usesVaultLocalRoles(sdk) ? readVaultLocalRoles(sdk, vault, account) : readGlobalRoles(sdk, vault, account),
    readSettlementOperator(sdk, vault, account),
    readNavSigner(sdk, { vault, rwaToken }, account),
    safe(sdk.hasRole(roleHash('DATA_PROVIDER_ROLE'), account), false),
  ]);
  return {
    ...base,
    'settlement-operator': settlementOperator,
    'nav-signer': navSigner,
    'adapter-data-provider': dataProvider === true,
  };
}
