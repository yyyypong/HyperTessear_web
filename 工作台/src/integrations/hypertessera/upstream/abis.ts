import abiMap from './abis.json';
import type { InterfaceAbi } from 'ethers';

export type ContractName = keyof typeof abiMap;

export function getAbi(name: ContractName): InterfaceAbi {
  if (!Object.prototype.hasOwnProperty.call(abiMap, name)) {
    throw new Error(`No ABI found for contract "${name}"`);
  }
  const abi = abiMap[name];
  return abi as InterfaceAbi;
}
