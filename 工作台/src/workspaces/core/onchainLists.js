import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, getAddress, id as roleHash, ZeroAddress } from 'ethers';
import { useWallet } from '../../wallet';
import { getDeployment } from '../config/deployments';
import { createReadSdk } from './createSdk';
import { readNavSigner, resolveVaultRoles, usesVaultLocalRoles } from './vaultRoles';

/** How far back (in blocks) VaultDeployed events are scanned (~50 days on BSC). */
const VAULT_EVENT_LOOKBACK = 1_500_000n;

export function equalAddress(left, right) {
  try { return getAddress(left) === getAddress(right); } catch { return false; }
}

function reserveConfig(raw) {
  if (!raw) return null;
  return {
    mode: raw.mode ?? raw[0],
    underlyingToken: raw.underlyingToken ?? raw[1],
    wrappedToken: raw.wrappedToken ?? raw[2],
    allowPartialUnwrap: raw.allowPartialUnwrap ?? raw[3],
    authorizedSigner: raw.authorizedSigner ?? raw[4],
    paused: raw.paused ?? raw[5],
  };
}

/** Read SDK bound to the connected wallet's current chain (null when undeployed). */
export function useReadSdk() {
  const { chainId, session, connected, isDemo } = useWallet();
  const deployment = chainId != null ? getDeployment(chainId) : null;
  const sdk = useMemo(() => {
    if (!deployment || !session?.provider) return null;
    try { return createReadSdk(deployment, session.provider); } catch { return null; }
  }, [deployment, session?.provider]);
  return { sdk, deployment, ready: Boolean(connected && sdk), demo: Boolean(isDemo) };
}

function useAsyncQuery(fn, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(g => g + 1), []);
  useEffect(() => {
    if (!fn) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState(prev => ({ status: 'loading', data: prev.data, error: null }));
    fn()
      .then(data => { if (!cancelled) setState({ status: 'success', data, error: null }); })
      .catch(error => { if (!cancelled) setState({ status: 'error', data: null, error }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, generation]);
  return { ...state, reload };
}

// ---------------------------------------------------------------------
// Asset directory — AssetRegistry.nextAssetId + getAsset enumeration
// ---------------------------------------------------------------------

async function readTokenMeta(sdk, token) {
  try {
    const contract = sdk.getContract('RWAToken', token);
    const [name, symbol, decimals] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()]);
    return { name, symbol, decimals: Number(decimals) };
  } catch {
    return { name: null, symbol: null, decimals: null };
  }
}

async function readAssetNav(sdk, token) {
  try {
    const nav = await sdk.getNAV(token);
    return nav.nav > 0n ? formatUnits(nav.nav, 6) : null;
  } catch { return null; }
}

export async function listAssets(sdk) {
  const registry = sdk.assetRegistry;
  const next = Number(await registry.nextAssetId());
  const ids = [];
  for (let i = 1; i < next; i += 1) ids.push(i);
  const assets = await Promise.all(ids.map(async (assetId) => {
    try {
      const info = await sdk.getAssetInfo(BigInt(assetId));
      if (!info.token || info.token === ZeroAddress) return null;
      const [meta, wrappedToken, nav] = await Promise.all([
        readTokenMeta(sdk, info.token),
        sdk.wrappedTokenOf(BigInt(assetId)).catch(() => ZeroAddress),
        readAssetNav(sdk, info.token),
      ]);
      const wrapped = wrappedToken && !equalAddress(wrappedToken, ZeroAddress) ? getAddress(wrappedToken) : null;
      let psmConfig = null;
      if (wrapped) {
        psmConfig = reserveConfig(await sdk.reservePSM.assetConfig(BigInt(assetId)).catch(() => null));
      }
      return {
        id: assetId,
        owner: info.owner,
        token: info.token,
        active: info.active,
        registeredAt: Number(info.registeredAt),
        metadataHash: info.metadataHash,
        name: meta.name ?? `Asset #${assetId}`,
        symbol: meta.symbol ?? `RWA-${assetId}`,
        decimals: meta.decimals ?? 18,
        wrappedToken: wrapped,
        psmConfig,
        mode: psmConfig ? Number(psmConfig.mode) : null,
        nav,
      };
    } catch { return null; }
  }));
  return assets.filter(Boolean).reverse();
}

export function useAssetDirectory() {
  const { sdk, demo } = useReadSdk();
  const query = useAsyncQuery(
    sdk ? () => listAssets(sdk)
      : demo ? () => Promise.resolve(demoAssets())
      : null,
    [sdk, demo],
  );
  return { ...query, assets: query.data ?? [] };
}

// ---------------------------------------------------------------------
// Mint / burn dual-signature queues
// ---------------------------------------------------------------------

export async function listMintBurnRequests(sdk, assetId) {
  const mbc = sdk.mintBurnController;
  const target = BigInt(assetId);
  const [nextMint, nextBurn] = await Promise.all([mbc.nextMintNonce(), mbc.nextBurnNonce()]);
  const scan = async (count, reader) => {
    const nonces = [];
    for (let i = 0; i < Number(count); i += 1) nonces.push(i);
    const rows = await Promise.all(nonces.map(async (nonce) => {
      try {
        const req = await reader(nonce);
        if (BigInt(req.assetId ?? req[0]) !== target) return null;
        const amount = BigInt(req.amount ?? req[1]);
        if (amount === 0n) return null;
        return {
          nonce,
          assetId: target.toString(),
          amount,
          party: req.to ?? req.from ?? req[2],
          approved: Boolean(req.approved ?? req[3]),
          executed: Boolean(req.executed ?? req[4]),
        };
      } catch { return null; }
    }));
    return rows.filter(Boolean).reverse();
  };
  const [mints, burns] = await Promise.all([
    scan(nextMint, nonce => mbc.mintRequests(nonce)),
    scan(nextBurn, nonce => mbc.burnRequests(nonce)),
  ]);
  return { mints, burns };
}

export function useMintBurnQueues(assetId) {
  const { sdk, demo } = useReadSdk();
  const query = useAsyncQuery(
    sdk && assetId ? () => listMintBurnRequests(sdk, assetId)
      : demo && assetId ? () => Promise.resolve(demoMintBurnQueues(assetId))
      : null,
    [sdk, demo, assetId],
  );
  return { ...query, mints: query.data?.mints ?? [], burns: query.data?.burns ?? [] };
}

// ---------------------------------------------------------------------
// Vault directory — configured tranche vaults + VaultDeployed events
// ---------------------------------------------------------------------

async function readVaultRow(sdk, provider, entry) {
  const row = { ...entry, state: null, nav: null, registered: null, deployer: entry.deployer ?? null };
  try { row.registered = await sdk.isVaultRegistered(entry.vault); } catch { /* optional */ }
  try { row.state = await sdk.getStateContext(entry.vault); } catch { /* optional */ }
  try {
    const nav = await sdk.getNAV(entry.vault);
    if (nav.nav > 0n) row.nav = formatUnits(nav.nav, 6);
  } catch { /* optional */ }
  if (!row.deployer && provider && entry.txHash) {
    try { row.deployer = (await provider.getTransaction(entry.txHash))?.from ?? null; } catch { /* optional */ }
  }
  return row;
}

export async function listVaults(sdk) {
  const addresses = sdk.addresses ?? {};
  const configured = [
    { key: 'cashVault', type: 'Earn' },
    { key: 'noteVault', type: 'Earn' },
    { key: 'lpVault', type: 'Liquidity' },
  ].filter(entry => addresses[entry.key] && !equalAddress(addresses[entry.key], ZeroAddress));

  const runner = sdk.stateManager?.runner ?? null;
  const provider = runner && typeof runner.getBlockNumber === 'function' ? runner : null;
  let events = [];
  if (provider) {
    try {
      const current = await provider.getBlockNumber();
      const from = Math.max(0, Number(BigInt(current) - VAULT_EVENT_LOOKBACK));
      events = await sdk.vaultFactory.queryFilter('VaultDeployed', from, current);
    } catch { events = []; }
  }

  const seen = new Set();
  const rows = [];
  for (const event of events) {
    const vault = event.args?.vault;
    if (!vault) continue;
    const checksummed = getAddress(vault);
    if (seen.has(checksummed)) continue;
    seen.add(checksummed);
    rows.push({
      vault: checksummed,
      type: Number(event.args.vaultType) === 1 ? 'Liquidity' : 'Earn',
      name: event.args.name ?? null,
      symbol: event.args.symbol ?? null,
      txHash: event.transactionHash,
      deployedAt: Number(event.args.timestamp ?? 0n),
      configured: false,
    });
  }
  for (const entry of configured) {
    const vault = getAddress(addresses[entry.key]);
    if (seen.has(vault)) continue;
    seen.add(vault);
    let meta = { name: null, symbol: null };
    try {
      const contract = sdk.getContract('EarnVault', vault);
      const [name, symbol] = await Promise.all([contract.name(), contract.symbol()]);
      meta = { name, symbol };
    } catch { /* metadata optional */ }
    rows.push({ vault, type: entry.type, ...meta, configured: true, deployedAt: null });
  }
  return Promise.all(rows.map(row => readVaultRow(sdk, provider, row)));
}

export function useVaultDirectory() {
  const { sdk, demo } = useReadSdk();
  const query = useAsyncQuery(
    sdk ? () => listVaults(sdk)
      : demo ? () => Promise.resolve(demoVaults())
      : null,
    [sdk, demo],
  );
  return { ...query, vaults: query.data ?? [] };
}

// ---------------------------------------------------------------------
// Per-object role markers for the workspace sidebars
// ---------------------------------------------------------------------

export const VAULT_DOMAIN_ROLES = Object.freeze([
  { id: 'vault-owner', contract: 'BaseVault · IVaultRoles' },
  { id: 'curator', contract: 'BaseVault · strategy' },
  { id: 'guardian', contract: 'BaseVault · pause' },
  { id: 'allocator', contract: 'BaseVault · allocation' },
  { id: 'settlement-operator', contract: 'Settlement' },
  { id: 'keeper', contract: 'Keeper · lifecycle' },
  { id: 'nav-signer', contract: 'NAVOracle' },
  { id: 'adapter-data-provider', contract: 'Adapter · data' },
]);

export const ASSET_DOMAIN_ROLES = Object.freeze([
  { id: 'asset-owner', contract: 'AssetRegistry · owner' },
  { id: 'token-agent', contract: 'MintBurnController' },
  { id: 'proof-publisher', contract: 'PoRRegistry' },
  { id: 'wrapper-controller', contract: 'ReservePSM' },
  { id: 'nav-signer', contract: 'NAVOracle' },
  { id: 'adapter-data-provider', contract: 'Adapter · data' },
  { id: 'psm-authorized-signer', contract: 'ReservePSM · auth' },
]);

async function safeHasRole(sdk, role, account) {
  try { return await sdk.hasRole(roleHash(role), account); } catch { return false; }
}

export async function getVaultRoleMarkers(sdk, vault, account) {
  const empty = Object.fromEntries(VAULT_DOMAIN_ROLES.map(r => [r.id, false]));
  if (!sdk || !account) return empty;
  return { ...empty, ...await resolveVaultRoles(sdk, vault, account) };
}

export async function getAssetRoleMarkers(sdk, asset, account) {
  const empty = Object.fromEntries(ASSET_DOMAIN_ROLES.map(r => [r.id, false]));
  if (!sdk || !account || !asset) return empty;
  const [tokenAgent, dataProvider, governor] = await Promise.all([
    safeHasRole(sdk, 'TOKEN_AGENT_ROLE', account),
    safeHasRole(sdk, 'DATA_PROVIDER_ROLE', account),
    safeHasRole(sdk, 'GOVERNOR_ROLE', account),
  ]);
  let psmSigner = false;
  try {
    const config = reserveConfig(await sdk.reservePSM.assetConfig(BigInt(asset.id)));
    psmSigner = equalAddress(config?.authorizedSigner, account);
  } catch { psmSigner = false; }
  let navSigner = false;
  if (usesVaultLocalRoles(sdk)) {
    // The target oracle keys signers by RWA token, so the asset answers directly.
    navSigner = await readNavSigner(sdk, { rwaToken: asset.token }, account);
  } else {
    try {
      const navOracle = sdk.getContract('NAVOracle', sdk.addresses?.navOracle);
      const candidates = [sdk.addresses?.cashVault, sdk.addresses?.noteVault, sdk.addresses?.lpVault].filter(Boolean);
      const signers = await Promise.all(candidates.map(vault => navOracle.authorizedSigner(vault).catch(() => ZeroAddress)));
      navSigner = signers.some(signer => equalAddress(signer, account));
    } catch { navSigner = false; }
  }
  return {
    ...empty,
    'asset-owner': equalAddress(asset.owner, account),
    'token-agent': tokenAgent,
    'proof-publisher': dataProvider,
    'wrapper-controller': governor,
    'nav-signer': navSigner,
    'adapter-data-provider': dataProvider,
    'psm-authorized-signer': psmSigner,
  };
}

export function useRoleMarkers(loader, deps) {
  const query = useAsyncQuery(loader, deps);
  return { markers: query.data ?? {}, status: query.status, reload: query.reload };
}

/** Role label lookup that falls back to the raw id for unknown roles. */
export function roleLabels(t, domain) {
  const labels = t.workspaces?.roles ?? {};
  return Object.fromEntries(domain.map(role => {
    const entry = labels[role.id];
    return [role.id, Array.isArray(entry) ? entry[0] : (entry?.title ?? role.id)];
  }));
}

// ---------------------------------------------------------------------
// Demo (mock) catalogue — served only to demo wallets so every possible
// operation can be previewed without real onchain data. A real wallet
// (isDemo === false) always goes through the live SDK paths above.
// ---------------------------------------------------------------------

export const DEMO_VAULT_A = '0xAaaa111111111111111111111111111111111111';
export const DEMO_VAULT_B = '0xAaaa222222222111111111111111111111111111';
export const DEMO_VAULT_C = '0xBbbb111111111111111111111111111111111111';

const MOCK_ASSET_OWNER = '0x3333333333333333333333333333333333333333';
const MOCK_VAULT_OWNER = '0x1111111111111111111111111111111111111111';
const MOCK_TOKEN_AGENT = '0x4444444444444444444444444444444444444444';
const MOCK_PSM_SIGNER = '0x5555555555555555555555555555555555555555';
const MOCK_GOVERNOR_BOTH = '0x6666666666666666666666666666666666666666';
const MOCK_GOVERNOR_ETH = '0x7777777777777777777777777777777777777777';
const MOCK_PARTY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function keyOf(account) {
  return (account || '').toLowerCase();
}

export function demoAssets() {
  const base = {
    owner: MOCK_ASSET_OWNER,
    active: true,
    registeredAt: 1754300000,
    metadataHash: `0x${'ab'.repeat(32)}`,
  };
  const custody = {
    mode: 0,
    underlyingToken: '0xCccc111111111111111111111111111111111111',
    wrappedToken: '0xDddd111111111111111111111111111111111111',
    allowPartialUnwrap: true,
    authorizedSigner: MOCK_PSM_SIGNER,
    paused: false,
  };
  const proof = {
    mode: 1,
    underlyingToken: '0xCccc222222222222222222222222222222222222',
    wrappedToken: '0xDddd222222222222111111111111111111111111',
    allowPartialUnwrap: false,
    authorizedSigner: MOCK_PSM_SIGNER,
    paused: false,
  };
  return [
    {
      ...base,
      id: 1,
      name: 'RWA USDT Series',
      symbol: 'htUSDT',
      decimals: 6,
      token: '0xCccc111111111111111111111111111111111111',
      wrappedToken: custody.wrappedToken,
      psmConfig: custody,
      mode: 0,
      nav: '1.001234',
    },
    {
      ...base,
      id: 2,
      name: 'US Treasury Token',
      symbol: 'htUST',
      decimals: 6,
      token: '0xCccc222222222222222222222222222222222222',
      wrappedToken: proof.wrappedToken,
      psmConfig: proof,
      mode: 1,
      nav: '1.052000',
    },
    {
      ...base,
      id: 3,
      name: 'Gold Vault Token',
      symbol: 'htGOLD',
      decimals: 18,
      token: '0xCccc333333333111111111111111111111111111',
      wrappedToken: null,
      psmConfig: null,
      mode: null,
      nav: '2234.500000',
    },
    {
      ...base,
      id: 4,
      name: 'RWA BNB Series',
      symbol: 'htBNB',
      decimals: 18,
      token: '0xCccc444444444111111111111111111111111111',
      wrappedToken: null,
      psmConfig: null,
      mode: null,
      active: false,
      nav: null,
    },
  ];
}

export function demoVaults() {
  return [
    {
      vault: DEMO_VAULT_A,
      type: 'Earn',
      name: 'HyperTessera Earn Vault A',
      symbol: 'HTVA',
      configured: true,
      deployer: MOCK_VAULT_OWNER,
      deployedAt: 1754200000,
      state: { pause: 0 },
      nav: '1.210000',
      registered: true,
    },
    {
      vault: DEMO_VAULT_B,
      type: 'Earn',
      name: 'HyperTessera Buffer Vault B',
      symbol: 'HTVB',
      configured: true,
      deployer: MOCK_VAULT_OWNER,
      deployedAt: 1754200100,
      state: { pause: 0 },
      nav: '0.980000',
      registered: true,
    },
    {
      vault: DEMO_VAULT_C,
      type: 'Liquidity',
      name: 'HyperTessera BNB Vault C',
      symbol: 'HTVC',
      configured: false,
      deployer: MOCK_VAULT_OWNER,
      deployedAt: 1754200200,
      state: { pause: 1 },
      nav: null,
      registered: true,
    },
  ];
}

export function demoMintBurnQueues(assetId) {
  const target = String(assetId);
  const e6 = 10n ** 6n;
  const e18 = 10n ** 18n;
  const isSix = Number(assetId) === 1 || Number(assetId) === 2;
  const unit = isSix ? e6 : e18;
  return {
    mints: [
      { nonce: 0, assetId: target, amount: 1000n * unit, party: MOCK_PARTY, approved: false, executed: false },
      { nonce: 1, assetId: target, amount: 2500n * unit, party: MOCK_PARTY, approved: true, executed: false },
    ],
    burns: [
      { nonce: 0, assetId: target, amount: 500n * unit, party: MOCK_PARTY, approved: false, executed: false },
    ],
  };
}

/**
 * Precise demo role profiles. A wallet only holds the roles listed here
 * (plus vault-owner / asset-owner when it matches the object's owner); any
 * other demo wallet holds none of these roles.
 */
const MOCK_VAULT_ROLE_PROFILES = {
  // Multi-vault manager: different functional roles on each vault it owns.
  [MOCK_VAULT_OWNER]: vault =>
    (vault === DEMO_VAULT_A ? ['keeper', 'settlement-operator', 'nav-signer']
      : vault === DEMO_VAULT_B ? ['guardian', 'allocator']
      : ['allocator']),
  // Multi-role vault: curator / guardian / allocator / keeper on Vault A.
  '0x2222222222222222222222222222222222222222': vault =>
    (vault === DEMO_VAULT_A ? ['curator', 'guardian', 'allocator', 'keeper'] : []),
  // Governors also carry the vault-owner identity (matches onchain mapping).
  [MOCK_GOVERNOR_BOTH]: () => ['vault-owner'],
  [MOCK_GOVERNOR_ETH]: () => ['vault-owner'],
};

const MOCK_ASSET_ROLE_PROFILES = {
  // Asset issuer + NAV: owns every asset, publishes proofs and NAV.
  [MOCK_ASSET_OWNER]: () => ['asset-owner', 'proof-publisher', 'nav-signer', 'adapter-data-provider'],
  // Token Agent: approves mint/burn on the demo assets.
  [MOCK_TOKEN_AGENT]: () => ['token-agent'],
  // Wrapper roles: PSM signer + wrapper controller on wrapped assets.
  [MOCK_PSM_SIGNER]: asset =>
    (asset.mode !== null ? ['wrapper-controller', 'psm-authorized-signer'] : []),
};

/** Demo wallet role markers for one vault row (vault-owner = deployer match). */
export function getDemoVaultRoleMarkers(vaultRow, account) {
  const empty = Object.fromEntries(VAULT_DOMAIN_ROLES.map(r => [r.id, false]));
  if (!account || !vaultRow) return empty;
  const profile = MOCK_VAULT_ROLE_PROFILES[keyOf(account)];
  const ids = profile ? profile(vaultRow.vault) : [];
  return {
    ...empty,
    ...Object.fromEntries(ids.map(id => [id, true])),
    'vault-owner': equalAddress(vaultRow.deployer, account),
  };
}

/** Demo wallet role markers for one asset row (asset-owner = owner match). */
export function getDemoAssetRoleMarkers(asset, account) {
  const empty = Object.fromEntries(ASSET_DOMAIN_ROLES.map(r => [r.id, false]));
  if (!account || !asset) return empty;
  const profile = MOCK_ASSET_ROLE_PROFILES[keyOf(account)];
  const ids = profile ? profile(asset) : [];
  return {
    ...empty,
    ...Object.fromEntries(ids.map(id => [id, true])),
    'asset-owner': equalAddress(asset.owner, account),
  };
}

/**
 * Objects the connected wallet holds at least one role on. Real wallets are
 * filtered by live chain markers; demo wallets by the demo profiles. A
 * wallet with no roles sees an empty "my workbench" directory.
 */
function useOwnedObjects(rows, rowsKey, loaderFor) {
  const { sdk, demo } = useReadSdk();
  const { address } = useWallet();
  const [state, setState] = useState({ owned: [], loading: false });
  useEffect(() => {
    if (!address || rows.length === 0) {
      setState(prev => (prev.owned.length === 0 && !prev.loading ? prev : { owned: [], loading: false }));
      return undefined;
    }
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true }));
    const loaders = rows.map(row => demo
      ? Promise.resolve(loaderFor(row, address, true))
      : (sdk ? loaderFor(row, address, false) : Promise.resolve({})));
    Promise.all(loaders)
      .then(markers => {
        if (cancelled) return;
        setState({
          owned: rows.filter((_, i) => Object.values(markers[i] ?? {}).some(Boolean)),
          loading: false,
        });
      })
      .catch(() => { if (!cancelled) setState({ owned: [], loading: false }); });
    return () => { cancelled = true; };
    // rowsKey keeps the effect stable across the array identity churn upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, demo, address, rowsKey]);
  return state;
}

/** Assets the connected wallet holds at least one role on (demo-aware). */
export function useOwnedAssets() {
  const { assets } = useAssetDirectory();
  const { sdk } = useReadSdk();
  return useOwnedObjects(
    assets,
    assets.map(a => a.id).join(','),
    (asset, account, isDemo) =>
      (isDemo ? getDemoAssetRoleMarkers(asset, account) : getAssetRoleMarkers(sdk, asset, account)),
  );
}

/** Vaults the connected wallet holds at least one role on (demo-aware). */
export function useOwnedVaults() {
  const { vaults } = useVaultDirectory();
  const { sdk } = useReadSdk();
  return useOwnedObjects(
    vaults,
    vaults.map(v => v.vault).join(','),
    (vault, account, isDemo) =>
      (isDemo ? getDemoVaultRoleMarkers(vault, account) : getVaultRoleMarkers(sdk, vault.vault, account)),
  );
}
