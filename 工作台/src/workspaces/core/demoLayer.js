import { formatUnits, keccak256, toUtf8Bytes } from 'ethers';
import { getActionDefinition } from '../config/roleDefinitions';

/**
 * Demo execution layer for simulated (isDemo) wallets.
 *
 * Real wallets (isDemo === false) always go through the live HyperTesseraSDK
 * and wallet provider — nothing here leaks into that path. A demo wallet has
 * no injected provider, so every read is served from this module's mock SDK
 * and every write / signature is turned into a "simulated" result so the full
 * workflow can be walked end to end with virtual toasts instead of failing
 * because the contracts are not deployed yet.
 */

export const DEMO_SIGNATURE = `0x${'ab'.repeat(32)}${'cd'.repeat(32)}1c`;

export const DEMO_ADDRESSES = Object.freeze({
  vaultOwner: '0x1111111111111111111111111111111111111111',
  multiRole: '0x2222222222222222222222222222222222222222',
  assetOwner: '0x3333333333333333333333333333333333333333',
  tokenAgent: '0x4444444444444444444444444444444444444444',
  psmSigner: '0x5555555555555555555555555555555555555555',
  governorBoth: '0x6666666666666666666666666666666666666666',
  governorEth: '0x7777777777777777777777777777777777777777',
  relayer: '0x8888888888888888888888888888888888888888',
  noRoles: '0x9999999999999999999999999999999999999999',
  party: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
});

export const DEMO_OPERATORS = Object.freeze([
  DEMO_ADDRESSES.vaultOwner,
  DEMO_ADDRESSES.multiRole,
  DEMO_ADDRESSES.relayer,
]);

const DEMO_TOKEN = '0xCccc111111111111111111111111111111111111';
const DEMO_TOKEN_2 = '0xCccc222222222222222222222222222222222222';
const DEMO_WRAPPED_1 = '0xDddd111111111111111111111111111111111111';
const DEMO_WRAPPED_2 = '0xDddd222222222222111111111111111111111111';

const DEMO_PSM_CONFIGS = Object.freeze({
  1: {
    mode: 0,
    underlyingToken: DEMO_TOKEN,
    wrappedToken: DEMO_WRAPPED_1,
    allowPartialUnwrap: true,
    authorizedSigner: DEMO_ADDRESSES.psmSigner,
    paused: false,
  },
  2: {
    mode: 1,
    underlyingToken: DEMO_TOKEN_2,
    wrappedToken: DEMO_WRAPPED_2,
    allowPartialUnwrap: false,
    authorizedSigner: DEMO_ADDRESSES.psmSigner,
    paused: false,
  },
});

const EMPTY_CONFIG = Object.freeze({
  mode: 0,
  underlyingToken: '0x0000000000000000000000000000000000000000',
  wrappedToken: '0x0000000000000000000000000000000000000000',
  allowPartialUnwrap: false,
  authorizedSigner: '0x0000000000000000000000000000000000000000',
  paused: false,
});

const DEFAULT_VAULT_STATE = Object.freeze({
  product: 3,
  cycle: 0,
  pause: 0,
  cycleNumber: 5n,
});

function demoHash(value) {
  try { return keccak256(toUtf8Bytes(typeof value === 'string' ? value : JSON.stringify(value ?? {}))); }
  catch { return keccak256(toUtf8Bytes('demo')); }
}

/** A deterministic demo transaction hash for the given action. */
export function demoReceipt(actionId, input) {
  const hash = demoHash(`demo:${actionId}:${Date.now()}`);
  const receipt = {
    hash,
    blockNumber: 41234567,
    blockHash: demoHash(`block:${actionId}`),
    status: 1,
    simulated: true,
  };
  return Object.freeze({
    ...receipt,
    wait: async () => receipt,
  });
}

/** Demo signer: never touches the wallet, produces a well-formed fake signature. */
export function createDemoSigner(address) {
  return {
    _demo: true,
    async getAddress() { return address; },
    async getChainId() { return 97; },
    async signMessage() { return DEMO_SIGNATURE; },
  };
}

/**
 * Mock read SDK shaped like the deployed HyperTesseraSDK. Every read serves a
 * value that keeps the workspace panels and capability hooks healthy.
 */
export function createDemoReadSdk(deployment) {
  const addresses = deployment?.addresses ?? {};
  const binding = Object.freeze({
    chainId: Number(deployment?.chainId ?? 97),
    profile: 'legacy',
    settlement: addresses.settlement ?? null,
    reservePSM: addresses.reservePSM ?? null,
    lpAdapter: addresses.lpAdapter ?? null,
    cashVault: addresses.cashVault ?? null,
    noteVault: addresses.noteVault ?? null,
    lpVault: addresses.lpVault ?? null,
  });

  const request = {
    assetId: '1',
    amount: 1000n * 10n ** 6n,
    to: DEMO_ADDRESSES.party,
    approved: false,
    executed: false,
  };

  const demoContract = (name) => new Proxy({}, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      const calls = {
        modulePaused: () => false,
        globalPaused: () => false,
        assetConfig: async (assetId) => DEMO_PSM_CONFIGS[Number(assetId)] ?? EMPTY_CONFIG,
        wrappedTokenOf: async (assetId) => DEMO_WRAPPED_1,
        authorizedSigner: () => DEMO_ADDRESSES.assetOwner,
        signerOf: () => DEMO_ADDRESSES.assetOwner,
        isOperator: () => true,
        owner: () => DEMO_ADDRESSES.vaultOwner,
        curator: () => DEMO_ADDRESSES.vaultOwner,
        guardian: () => DEMO_ADDRESSES.vaultOwner,
        allocator: () => DEMO_ADDRESSES.vaultOwner,
        isKeeper: () => false,
        name: () => 'HyperTessera Demo Vault',
        symbol: () => 'DEMO',
        decimals: () => 6n,
        balanceOf: () => 10n ** 30n,
        usdt: () => DEMO_TOKEN,
        asset: () => DEMO_TOKEN,
        isInQueue: () => true,
        mintRequests: () => ({ ...request }),
        burnRequests: () => ({ ...request }),
        usedNonce: () => false,
        nextMintNonce: () => 2n,
        nextBurnNonce: () => 1n,
        getFunction: () => async () => true,
      };
      if (calls[prop]) return calls[prop];
      // Unknown contract reads answer a neutral true so preflight checks pass.
      return async () => true;
    },
  });

  return {
    addresses,
    profile: 'legacy',
    __htDeploymentBinding: binding,
    getContract: (name, address) => demoContract(name),
    supportsFunction: () => false,
    settlement: {
      isOperator: async (...args) => {
        const account = args[args.length - 1];
        return DEMO_OPERATORS.some(operator => operator.toLowerCase() === String(account).toLowerCase());
      },
      threshold: async () => 2n,
    },
    navOracle: {
      authorizedSigner: async () => DEMO_ADDRESSES.assetOwner,
      signerOf: async () => DEMO_ADDRESSES.assetOwner,
    },
    isVaultRegistered: async () => true,
    isVaultActive: async () => true,
    getStateContext: async () => ({ ...DEFAULT_VAULT_STATE }),
    getNAV: async () => ({ nav: 1210000n, dataTimestamp: 1754300000n, updatedAt: 1754300000n }),
    isNAVFresh: async () => true,
    hasRole: async () => true,
    isOperator: async (account) => DEMO_OPERATORS.some(operator => operator.toLowerCase() === String(account).toLowerCase()),
    threshold: async () => 2n,
    pending: async () => 1_000_000n,
    availableToDistribute: async () => 400_000_000n,
    totalPending: async () => 1_250_000_000n,
    getAssetInfo: async (assetId) => ({
      metadataHash: `0x${'ab'.repeat(32)}`,
      token: DEMO_TOKEN,
      active: true,
      registeredAt: 1754300000n,
      owner: DEMO_ADDRESSES.assetOwner,
    }),
    wrappedTokenOf: async (assetId) => {
      const numeric = Number(assetId);
      return numeric === 1 ? DEMO_WRAPPED_1 : numeric === 2 ? DEMO_WRAPPED_2 : null;
    },
    hashInstruction: async (instruction) => demoHash(instruction),
    isExecuted: async () => false,
  };
}

/** Mock adapter: every legacy action is supported and executes a simulated receipt. */
export function createDemoAdapter(deployment) {
  const demo = true;
  return {
    supports(actionId, input) {
      const action = getActionDefinition(actionId);
      return Boolean(action?.capability?.legacy?.adapterMethod);
    },
    async execute(actionId, input = {}) {
      const action = getActionDefinition(actionId);
      if (!action?.capability?.legacy?.adapterMethod) {
        throw new Error(`Current SDK method unavailable for ${actionId}`);
      }
      return demoReceipt(actionId, input);
    },
    readSdk: { demo },
  };
}

/** Demo amount-decimals resolver: fixed precision so every amount form validates. */
export function createDemoAmountDecimalsResolver() {
  return async () => 6;
}

export function isDemoWallet(wallet) {
  return Boolean(wallet?.isDemo);
}

/* ------------------------------------------------------------------ */
/* Relayer demo import: validate the exported JSON shape without any    */
/* crypto recovery, then turn it into a submission for virtual submit.  */
/* ------------------------------------------------------------------ */

const DEMO_RELAYER_KINDS = new Set(['nav', 'psm', 'settlement']);

export function validateDemoRelayerSource(source) {
  if (typeof source !== 'string' || source.length > 64 * 1024) throw new Error('Signature import unavailable');
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new Error('Invalid signature import'); }
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (!candidates.length || candidates.length > 100) throw new Error('Invalid signature import');
  const kind = candidates[0]?.kind;
  if (candidates.some(item => item?.kind !== kind) || (kind !== 'settlement' && candidates.length !== 1)) {
    throw new Error('Mixed signature kinds');
  }
  if (!DEMO_RELAYER_KINDS.has(kind)) throw new Error('Unsupported signature kind');
  const scope = candidates[0]?.scope;
  const payload = candidates[0]?.payload;
  if (!scope || !payload || typeof payload !== 'object') throw new Error('Invalid signature import');
  if (kind === 'nav' && (!scope.vault || payload.vault === undefined)) throw new Error('Invalid signature import');
  if (kind === 'psm' && (!scope.assetId || payload.assetId === undefined)) throw new Error('Invalid signature import');
  if (kind === 'settlement' && !Array.isArray(payload.instruction?.vaultSettlements)) throw new Error('Invalid signature import');
  return candidates.length === 1 ? candidates[0] : candidates;
}

export function toDemoRelayerSubmission(source) {
  const list = Array.isArray(source) ? source : [source];
  const first = list[0];
  if (first.kind === 'nav') {
    return {
      actionId: 'nav.update.submit',
      scope: first.scope,
      rawInput: {
        vault: first.scope.vault,
        nav: formatUnits(BigInt(first.payload.nav ?? 0), 6),
        dataTimestamp: first.payload.dataTimestamp,
        sig: first.signature,
      },
    };
  }
  return {
    actionId: 'settlement.batch.submit',
    scope: first.scope,
    rawInput: {
      vault: first.scope.vault,
      instruction: first.payload.instruction,
      signatures: list.map(item => item.signature),
    },
  };
}
