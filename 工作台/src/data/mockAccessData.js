/**
 * Mock access data for frontend role recognition.
 * Addresses are lowercase checksums. Replace this module's consumer
 * (MockDataProvider) with OnchainDataProvider later — same shapes.
 */

import { ROLES } from '../config/roles';

/** Demo addresses used by the in-app demo wallet picker. */
export const DEMO_WALLETS = Object.freeze([
  {
    id: 'multi-vault',
    address: '0x1111111111111111111111111111111111111111',
    label: 'Multi-vault manager',
    description: 'Different vault roles across Ethereum and BNB Chain',
  },
  {
    id: 'multi-role',
    address: '0x2222222222222222222222222222222222222222',
    label: 'Multi-role vault',
    description: 'Owner + Curator + Allocator on one Ethereum vault',
  },
  {
    id: 'asset-ops',
    address: '0x3333333333333333333333333333333333333333',
    label: 'Asset issuer + NAV',
    description: 'Asset Issuer and NAV Provider on multiple assets',
  },
  {
    id: 'token-agent',
    address: '0x4444444444444444444444444444444444444444',
    label: 'Token Agent',
    description: 'Issuance approval on Ethereum',
  },
  {
    id: 'wrapped',
    address: '0x5555555555555555555555555555555555555555',
    label: 'Wrapped asset roles',
    description: 'Wrapper Controller and PSM Signer',
  },
  {
    id: 'governor-both',
    address: '0x6666666666666666666666666666666666666666',
    label: 'Governor (both networks)',
    description: 'Governor on Ethereum and BNB Chain',
  },
  {
    id: 'governor-eth',
    address: '0x7777777777777777777777777777777777777777',
    label: 'Governor (Ethereum only)',
    description: 'Governor on Ethereum only',
  },
  {
    id: 'none',
    address: '0x9999999999999999999999999999999999999999',
    label: 'No management roles',
    description: 'Connected wallet with no protocol permissions',
  },
]);

const VAULTS = {
  ethVaultA: {
    id: 'eth-vault-a',
    address: '0xAaaa111111111111111111111111111111111111',
    name: 'HyperTessera Earn Vault A',
    networkId: 'ethereum',
    symbol: 'HTVA',
  },
  ethVaultB: {
    id: 'eth-vault-b',
    address: '0xAaaa222222222222222222222222222222222222',
    name: 'HyperTessera Buffer Vault B',
    networkId: 'ethereum',
    symbol: 'HTVB',
  },
  bnbVaultC: {
    id: 'bnb-vault-c',
    address: '0xBbbb111111111111111111111111111111111111',
    name: 'HyperTessera BNB Vault C',
    networkId: 'bnb',
    symbol: 'HTVC',
  },
};

const ASSETS = {
  ethAsset1: {
    id: 'asset-rwa-usdt',
    address: '0xCccc111111111111111111111111111111111111',
    name: 'RWA USDT Series',
    symbol: 'htUSDT',
    networkId: 'ethereum',
  },
  ethAsset2: {
    id: 'asset-rwa-usdc',
    address: '0xCccc222222222222222222222222222222222222',
    name: 'RWA USDC Series',
    symbol: 'htUSDC',
    networkId: 'ethereum',
  },
  bnbAsset1: {
    id: 'asset-rwa-bnb',
    address: '0xCccc333333333333333333333333333333333333',
    name: 'RWA BNB Series',
    symbol: 'htBNB',
    networkId: 'bnb',
  },
};

const WRAPPED = {
  ethWrap1: {
    id: 'wrapped-htusdt',
    address: '0xDddd111111111111111111111111111111111111',
    name: 'Wrapped htUSDT',
    symbol: 'whtUSDT',
    networkId: 'ethereum',
    underlyingAssetId: 'asset-rwa-usdt',
  },
  ethWrap2: {
    id: 'wrapped-htusdc',
    address: '0xDddd222222222222222222222222222222222222',
    name: 'Wrapped htUSDC',
    symbol: 'whtUSDC',
    networkId: 'ethereum',
    underlyingAssetId: 'asset-rwa-usdc',
  },
  bnbWrap1: {
    id: 'wrapped-htbnb',
    address: '0xDddd333333333333333333333333333333333333',
    name: 'Wrapped htBNB',
    symbol: 'whtBNB',
    networkId: 'bnb',
    underlyingAssetId: 'asset-rwa-bnb',
  },
};

/**
 * Per-address access map keyed by lowercase address.
 * Shape is intentional for later OnchainDataProvider parity.
 */
const ACCESS_BY_ADDRESS = {
  '0x1111111111111111111111111111111111111111': {
    governorNetworks: [],
    tokenAgentNetworks: [],
    vaults: {
      ethereum: [
        { ...VAULTS.ethVaultA, roles: [ROLES.VAULT_OWNER] },
        { ...VAULTS.ethVaultB, roles: [ROLES.VAULT_GUARDIAN] },
      ],
      bnb: [
        { ...VAULTS.bnbVaultC, roles: [ROLES.VAULT_ALLOCATOR] },
      ],
    },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
  '0x2222222222222222222222222222222222222222': {
    governorNetworks: [],
    tokenAgentNetworks: [],
    vaults: {
      ethereum: [
        {
          ...VAULTS.ethVaultA,
          roles: [ROLES.VAULT_OWNER, ROLES.VAULT_CURATOR, ROLES.VAULT_ALLOCATOR],
        },
      ],
      bnb: [],
    },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
  '0x3333333333333333333333333333333333333333': {
    governorNetworks: [],
    tokenAgentNetworks: [],
    vaults: { ethereum: [], bnb: [] },
    issuerAssets: {
      ethereum: [ASSETS.ethAsset1, ASSETS.ethAsset2],
      bnb: [ASSETS.bnbAsset1],
    },
    navAssets: {
      ethereum: [ASSETS.ethAsset1],
      bnb: [ASSETS.bnbAsset1],
    },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
  '0x4444444444444444444444444444444444444444': {
    governorNetworks: [],
    tokenAgentNetworks: ['ethereum'],
    vaults: { ethereum: [], bnb: [] },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
  '0x5555555555555555555555555555555555555555': {
    governorNetworks: [],
    tokenAgentNetworks: [],
    vaults: { ethereum: [], bnb: [] },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: {
      ethereum: [
        { ...WRAPPED.ethWrap1, roles: [ROLES.WRAPPER_CONTROLLER] },
        { ...WRAPPED.ethWrap2, roles: [ROLES.WRAPPER_CONTROLLER, ROLES.PSM_AUTHORIZED_SIGNER] },
      ],
      bnb: [
        { ...WRAPPED.bnbWrap1, roles: [ROLES.PSM_AUTHORIZED_SIGNER] },
      ],
    },
  },
  '0x6666666666666666666666666666666666666666': {
    governorNetworks: ['ethereum', 'bnb'],
    tokenAgentNetworks: [],
    vaults: { ethereum: [], bnb: [] },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
  '0x7777777777777777777777777777777777777777': {
    governorNetworks: ['ethereum'],
    tokenAgentNetworks: [],
    vaults: { ethereum: [], bnb: [] },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
  '0x9999999999999999999999999999999999999999': {
    governorNetworks: [],
    tokenAgentNetworks: [],
    vaults: { ethereum: [], bnb: [] },
    issuerAssets: { ethereum: [], bnb: [] },
    navAssets: { ethereum: [], bnb: [] },
    wrappedAssets: { ethereum: [], bnb: [] },
  },
};

const EMPTY_ACCESS = {
  governorNetworks: [],
  tokenAgentNetworks: [],
  vaults: { ethereum: [], bnb: [] },
  issuerAssets: { ethereum: [], bnb: [] },
  navAssets: { ethereum: [], bnb: [] },
  wrappedAssets: { ethereum: [], bnb: [] },
};

function delay(ms = 180) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(address) {
  return (address || '').toLowerCase();
}

export function getMockAccessSnapshot(address) {
  const key = normalize(address);
  const raw = ACCESS_BY_ADDRESS[key] || EMPTY_ACCESS;
  const snap = structuredClone(raw);
  // BNB Testnet (chainId 97, the real deployment network) mirrors the BNB
  // Chain demo objects so the demo wallet keeps working when it is selected.
  snap.vaults['bnb-testnet'] = snap.vaults.bnb || [];
  snap.issuerAssets['bnb-testnet'] = snap.issuerAssets.bnb || [];
  snap.navAssets['bnb-testnet'] = snap.navAssets.bnb || [];
  snap.wrappedAssets['bnb-testnet'] = snap.wrappedAssets.bnb || [];
  return snap;
}

export async function fetchMockAccessSnapshot(address) {
  await delay();
  return getMockAccessSnapshot(address);
}

export { VAULTS, ASSETS, WRAPPED, ACCESS_BY_ADDRESS };
