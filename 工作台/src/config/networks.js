/** Supported business networks for phase 1. Monad is intentionally omitted. */

export const NETWORKS = Object.freeze({
  ethereum: {
    id: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    shortName: 'ETH',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcHint: 'ethereum',
  },
  bnb: {
    id: 'bnb',
    chainId: 56,
    name: 'BNB Chain',
    shortName: 'BNB',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcHint: 'bsc',
  },
  bnbTestnet: {
    id: 'bnb-testnet',
    chainId: 97,
    name: 'BNB Testnet',
    shortName: 'BNB-T',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcHint: 'bsc-testnet',
  },
});

export const SUPPORTED_NETWORKS = Object.freeze([NETWORKS.ethereum, NETWORKS.bnb, NETWORKS.bnbTestnet]);

export const DEFAULT_NETWORK_ID = 'ethereum';

export function getNetworkById(id) {
  return SUPPORTED_NETWORKS.find(n => n.id === id) ?? null;
}

export function getNetworkByChainId(chainId) {
  const n = Number(chainId);
  return SUPPORTED_NETWORKS.find(net => net.chainId === n) ?? null;
}

export function isSupportedChainId(chainId) {
  return Boolean(getNetworkByChainId(chainId));
}
