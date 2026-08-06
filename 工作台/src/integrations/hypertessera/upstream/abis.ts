import legacyAbiMap from './abis.json';
import targetAbiMap from './abis.target.json';
import type { InterfaceAbi } from 'ethers';

/**
 * Deployment profiles carry different contract generations. `legacy` is the
 * currently deployed set (global Settlement multisig, vault-keyed NAVOracle,
 * global HyperAccessControl roles); `target` is the feat/client-fixes-202608
 * generation (per-vault Settlement and vault roles, rwaToken-keyed NAVOracle,
 * protocol fee split). Both are bundled so the UI can bind to whichever
 * generation a chain actually runs.
 */
export type DeploymentProfile = 'legacy' | 'target';

export type ContractName = keyof typeof legacyAbiMap | keyof typeof targetAbiMap;

const ABI_MAPS: Record<DeploymentProfile, Record<string, unknown>> = {
  legacy: legacyAbiMap as Record<string, unknown>,
  target: targetAbiMap as Record<string, unknown>,
};

export function getAbi(name: ContractName, profile: DeploymentProfile = 'legacy'): InterfaceAbi {
  const map = ABI_MAPS[profile] ?? ABI_MAPS.legacy;
  if (!Object.prototype.hasOwnProperty.call(map, name)) {
    throw new Error(`No ABI found for contract "${String(name)}" in the ${profile} profile`);
  }
  return map[name] as InterfaceAbi;
}

/** True when the profile's ABI advertises the exact function name. */
export function abiHasFunction(name: ContractName, fn: string, profile: DeploymentProfile = 'legacy'): boolean {
  const map = ABI_MAPS[profile] ?? ABI_MAPS.legacy;
  const abi = map[name];
  if (!Array.isArray(abi)) return false;
  return abi.some(entry => entry?.type === 'function' && entry?.name === fn);
}
