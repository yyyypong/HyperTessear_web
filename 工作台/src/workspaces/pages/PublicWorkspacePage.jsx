import { useMemo, useRef } from 'react';
import { getAddress } from 'ethers';
import { CycleState, PauseState, ProductState, QueueType } from '../../integrations/hypertessera/upstream/types';
import { useWallet } from '../../wallet';
import ActionPanel from '../components/ActionPanel';
import { getDeployment } from '../config/deployments';
import { FORM_SCHEMAS } from '../config/formSchemas';
import { getActionDefinition } from '../config/roleDefinitions';
import { executeAction } from '../core/actionExecutors';
import { resolveCapability } from '../core/capabilityResolver';
import { CAPABILITY_STATES } from '../core/capabilityStates';
import { createAmountDecimalsResolver, createReadSdk } from '../core/createSdk';
import { useTransactions } from '../core/transactionStore';
import { actionRequiresAmountDecimals, validateActionInput, ValidationError } from '../core/validators';
import { getWriteSigner } from '../core/walletRunner';
import { createCurrentAdapter } from '../sdk/currentAdapter';

const CHAIN_ID = 97;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANCHE_KEYS = new Set(['cash', 'note', 'lp']);
const REQUEST_ACTIONS = new Set([
  'request.deposit', 'request.deposit.claim', 'request.redeem',
  'request.redeem.claim', 'request.cancel', 'request.refund.claim',
]);
const WRAPPER_ACTIONS = new Set(['wrapper.wrap', 'wrapper.unwrap']);

const publicAction = (id, title, description) => ({
  ...getActionDefinition(id), title, description,
});

const targetCreator = (id, title, description, requiredMethod, requiredModule) => ({
  id, schemaId: id, scope: 'permissionless', title, description,
  capability: {
    legacy: { state: CAPABILITY_STATES.TARGET_ONLY, badge: 'target', adapterMethod: null, requiredModules: [requiredModule], requiredMethod },
    target: { state: CAPABILITY_STATES.TARGET_ONLY, badge: 'target', adapterMethod: null, requiredModules: [requiredModule], requiredMethod },
  },
});

const assetRegistration = {
  ...getActionDefinition('asset.register'),
  title: 'Asset Creator',
  description: 'Register a new Asset through the reviewed permissionless AssetRegistry method. The connected wallet becomes its owner.',
};

const CREATOR_ACTIONS = Object.freeze([
  assetRegistration,
  targetCreator('vault.create', 'Vault Creator', 'The required permissionless Vault factory mapping is not available in the reviewed SDK, so this path cannot request a wallet transaction.', 'createVault', 'TargetVaultFactory'),
  targetCreator('wrapper.create', 'Wrapper Creator', 'The legacy deployment requires Governor authorization for deployWrappedToken. A permissionless creation method is not available, so this path stays disabled.', 'permissionlessDeployWrappedToken', 'TargetWrapperFactory'),
]);

const USER_ACTIONS = Object.freeze([
  publicAction('request.deposit', 'Request deposit', 'Create an asynchronous deposit request for the selected configured tranche.'),
  publicAction('request.deposit.claim', 'Claim deposit', 'Claim shares for a settled deposit request.'),
  publicAction('request.redeem', 'Request redemption', 'Create an asynchronous redemption request for the selected configured tranche.'),
  publicAction('request.redeem.claim', 'Claim redemption', 'Claim assets for a settled redemption request.'),
  publicAction('request.cancel', 'Cancel request', 'Cancel a pending request while the selected Vault cycle is accepting.'),
  publicAction('request.refund.claim', 'Claim refund', 'Claim a deposit request already marked refundable. The contract pays the recorded owner.'),
  publicAction('wrapper.wrap', 'Wrap asset', 'Lock an underlying token in a configured Token Custody PSM and mint its WrappedAsset.'),
  publicAction('wrapper.unwrap', 'Unwrap asset', 'Burn a configured WrappedAsset and request or receive its underlying release.'),
]);

function canonicalAddress(value) {
  try { return getAddress(value); } catch { return null; }
}

function canonicalPositiveUint(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  try { const parsed = BigInt(value); return parsed < (1n << 256n) ? parsed : null; } catch { return null; }
}

function configuredAddress(value) {
  const result = canonicalAddress(value);
  return result && result !== ZERO_ADDRESS ? result : null;
}

function vaultFor(deployment, tranche) {
  if (!TRANCHE_KEYS.has(tranche)) throw new ValidationError('invalidSelect', 'tranche');
  const address = tranche === 'cash' ? deployment.addresses.cashVault
    : tranche === 'note' ? deployment.addresses.noteVault : deployment.addresses.lpVault;
  const vault = configuredAddress(address);
  if (!vault) throw new ValidationError('objectMismatch', 'tranche');
  return vault;
}

function normalizePsmConfig(raw) {
  return {
    mode: Number(raw?.mode ?? raw?.[0]),
    underlyingToken: raw?.underlyingToken ?? raw?.[1],
    wrappedToken: raw?.wrappedToken ?? raw?.[2],
    allowPartialUnwrap: raw?.allowPartialUnwrap ?? raw?.[3],
    paused: raw?.paused ?? raw?.[5],
  };
}

function prevalidateRaw(actionId, rawInput) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new ValidationError('invalidInput');
  if (REQUEST_ACTIONS.has(actionId) && !TRANCHE_KEYS.has(rawInput.tranche)) throw new ValidationError('invalidSelect', 'tranche');
  if (['request.deposit.claim', 'request.redeem.claim', 'request.cancel', 'request.refund.claim'].includes(actionId)
    && canonicalPositiveUint(rawInput.requestId) === null) throw new ValidationError('invalidInteger', 'requestId');
  if (WRAPPER_ACTIONS.has(actionId) && canonicalPositiveUint(rawInput.assetId) === null) throw new ValidationError('invalidInteger', 'assetId');
  const addressField = ['request.deposit', 'request.redeem'].includes(actionId) ? 'owner'
    : ['request.deposit.claim', 'request.redeem.claim'].includes(actionId) ? 'receiver'
      : WRAPPER_ACTIONS.has(actionId) ? 'to' : null;
  if (addressField && !configuredAddress(rawInput[addressField])) throw new ValidationError('invalidAddress', addressField);
  if (!actionRequiresAmountDecimals(actionId)) return validateActionInput(actionId, rawInput);

  const amountField = actionId === 'request.deposit' ? 'assets' : actionId === 'request.redeem' ? 'shares' : 'amount';
  const amount = rawInput[amountField];
  if (typeof amount !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || /^0(?:\.0+)?$/.test(amount)) {
    throw new ValidationError('invalidAmount', amountField);
  }
  // Validate every non-amount field without making an RPC call. Live decimal
  // precision is applied later by validateActionInput.
  return validateActionInput(actionId, { ...rawInput, [amountField]: '1' }, { amountDecimals: 0 });
}

function initialCapability(action, wallet, deployment, adapter) {
  const profile = action.capability?.legacy;
  if (!wallet?.provider) return { state: CAPABILITY_STATES.WALLET_REQUIRED, detail: {} };
  if (Number(wallet.chainId) !== deployment.chainId) return { state: CAPABILITY_STATES.WRONG_NETWORK, detail: {} };
  if (profile?.state === CAPABILITY_STATES.TARGET_ONLY || !profile?.adapterMethod) {
    return {
      state: CAPABILITY_STATES.TARGET_ONLY,
      badge: 'target',
      detail: { requiredMethod: profile?.requiredMethod ?? profile?.adapterMethod, requiredModule: profile?.requiredModules?.[0] },
    };
  }
  if (!adapter?.supports(action.id, {})) return { state: CAPABILITY_STATES.UNSUPPORTED_DEPLOYMENT, detail: { check: 'adapter' } };
  return { state: CAPABILITY_STATES.AVAILABLE, badge: 'legacyCompatible', detail: {} };
}

async function readVaultState({ sdk, deployment, tranche, assertCurrent }) {
  const vault = vaultFor(deployment, tranche);
  const registered = await sdk.isVaultRegistered(vault);
  assertCurrent();
  if (registered !== true) throw new Error('Configured vault unavailable');
  const state = await sdk.getStateContext(vault);
  assertCurrent();
  return { vault, state };
}

async function readPsmState({ sdk, deployment, assetId, assertCurrent }) {
  const parsedAssetId = canonicalPositiveUint(String(assetId ?? ''));
  if (parsedAssetId === null) throw new ValidationError('invalidInteger', 'assetId');
  const reserve = sdk.getContract('ReservePSM', deployment.addresses.reservePSM);
  const [rawConfig, globallyPaused] = await Promise.all([reserve.assetConfig(parsedAssetId), reserve.globalPaused()]);
  assertCurrent();
  const config = normalizePsmConfig(rawConfig);
  if (!configuredAddress(config.wrappedToken)) throw new Error('Wrapped asset unavailable');
  return { reserve, assetId: parsedAssetId, config, globallyPaused };
}

function createFreshHooks({ action, rawInput, sdk, deployment, assertCurrent }) {
  return {
    isPaused: async () => {
      if (['request.deposit', 'request.redeem'].includes(action.id)) {
        const { state } = await readVaultState({ sdk, deployment, tranche: rawInput.tranche, assertCurrent });
        return Number(state.pause) !== PauseState.ACTIVE;
      }
      if (WRAPPER_ACTIONS.has(action.id)) {
        const { config, globallyPaused } = await readPsmState({ sdk, deployment, assetId: rawInput.assetId, assertCurrent });
        return globallyPaused === true || config.paused === true;
      }
      return false;
    },
    isValidState: async () => {
      if (action.id === 'asset.register') return true;
      if (action.id === 'request.deposit') {
        const { state } = await readVaultState({ sdk, deployment, tranche: rawInput.tranche, assertCurrent });
        return Number(state.product) === ProductState.SUBSCRIBING
          || (Number(state.product) === ProductState.OPERATING && Number(state.cycle) === CycleState.ACCEPTING);
      }
      if (action.id === 'request.redeem') {
        const { state } = await readVaultState({ sdk, deployment, tranche: rawInput.tranche, assertCurrent });
        return Number(state.product) === ProductState.SETTLING
          || (Number(state.product) === ProductState.OPERATING && Number(state.cycle) === CycleState.ACCEPTING);
      }
      if (action.id === 'request.cancel') {
        const { vault, state } = await readVaultState({ sdk, deployment, tranche: rawInput.tranche, assertCurrent });
        if (Number(state.cycle) !== CycleState.ACCEPTING) return false;
        const queue = sdk.getContract('Queue', deployment.addresses.queue);
        const requestId = canonicalPositiveUint(rawInput.requestId);
        const [deposit, redeem] = await Promise.all([
          queue.isInQueue(vault, QueueType.DEPOSIT, requestId),
          queue.isInQueue(vault, QueueType.REDEEM, requestId),
        ]);
        assertCurrent();
        return deposit === true || redeem === true;
      }
      if (REQUEST_ACTIONS.has(action.id)) {
        const vault = vaultFor(deployment, rawInput.tranche);
        const registered = await sdk.isVaultRegistered(vault);
        assertCurrent();
        return registered === true;
      }
      if (WRAPPER_ACTIONS.has(action.id)) {
        const { config } = await readPsmState({ sdk, deployment, assetId: rawInput.assetId, assertCurrent });
        return action.id === 'wrapper.wrap'
          ? config.mode === 0 && Boolean(configuredAddress(config.underlyingToken))
          : [0, 1].includes(config.mode);
      }
      return false;
    },
  };
}

async function verifyNormalized({ actionId, input, sdk, deployment, account, assertCurrent }) {
  if (REQUEST_ACTIONS.has(actionId)) {
    const { vault, state } = await readVaultState({ sdk, deployment, tranche: input.tranche, assertCurrent });
    if (actionId === 'request.deposit') {
      const valid = Number(state.pause) === PauseState.ACTIVE
        && (Number(state.product) === ProductState.SUBSCRIBING
          || (Number(state.product) === ProductState.OPERATING && Number(state.cycle) === CycleState.ACCEPTING));
      if (!valid) throw new Error('Vault is not subscribable');
    }
    if (actionId === 'request.redeem') {
      const valid = Number(state.pause) === PauseState.ACTIVE
        && (Number(state.product) === ProductState.SETTLING
          || (Number(state.product) === ProductState.OPERATING && Number(state.cycle) === CycleState.ACCEPTING));
      if (!valid) throw new Error('Vault is not redeemable');
    }
    if (actionId === 'request.cancel') {
      if (Number(state.cycle) !== CycleState.ACCEPTING) throw new Error('Request cannot be cancelled');
      const queue = sdk.getContract('Queue', deployment.addresses.queue);
      const [deposit, redeem] = await Promise.all([
        queue.isInQueue(vault, QueueType.DEPOSIT, input.requestId),
        queue.isInQueue(vault, QueueType.REDEEM, input.requestId),
      ]);
      assertCurrent();
      if (deposit !== true && redeem !== true) throw new Error('Request is not pending');
    }
    return;
  }
  if (!WRAPPER_ACTIONS.has(actionId)) return;
  const { config, globallyPaused } = await readPsmState({ sdk, deployment, assetId: input.assetId, assertCurrent });
  if (globallyPaused === true || config.paused === true) throw new Error('PSM asset paused');
  if (actionId === 'wrapper.wrap') {
    if (config.mode !== 0 || !configuredAddress(config.underlyingToken)) throw new Error('Asset is not in token custody mode');
    return;
  }
  const wrapped = sdk.getContract('WrappedAsset', config.wrappedToken);
  const balance = BigInt(await wrapped.balanceOf(account));
  assertCurrent();
  if (input.amount > balance || ((config.mode === 1 || config.allowPartialUnwrap !== true) && input.amount !== balance)) {
    throw new Error('Unwrap amount must match the available full balance');
  }
}

export default function PublicWorkspacePage() {
  const wallet = useWallet();
  const transactions = useTransactions();
  const deployment = getDeployment(CHAIN_ID);
  const sdkResult = useMemo(() => {
    if (!wallet.session?.provider || Number(wallet.session.chainId) !== deployment.chainId) return { sdk: null, error: null };
    try { return { sdk: createReadSdk(deployment, wallet.session.provider), error: null }; }
    catch { return { sdk: null, error: 'The configured deployment could not be initialized.' }; }
  }, [deployment, wallet.session?.provider, wallet.session?.chainId]);
  const readSdk = sdkResult.sdk;
  const adapter = useMemo(() => readSdk ? createCurrentAdapter({ readSdk, writeSdk: readSdk }) : null, [readSdk]);
  const getAmountDecimals = useMemo(() => readSdk ? createAmountDecimalsResolver(readSdk) : null, [readSdk]);
  const identityKey = `${canonicalAddress(wallet.session?.address)?.toLowerCase() ?? 'disconnected'}|${Number(wallet.session?.chainId) || 'no-chain'}|${deployment.chainId}:${deployment.profile}:${deployment.sourceCommit}`;
  const identityRef = useRef(identityKey);
  const operationGenerationRef = useRef(0);
  identityRef.current = identityKey;

  const capabilityFor = action => initialCapability(action, wallet.session, deployment, adapter);

  const onExecute = async (action, rawInput) => {
    prevalidateRaw(action.id, rawInput);
    const expectedIdentity = identityKey;
    const generation = ++operationGenerationRef.current;
    const assertCurrent = () => {
      if (identityRef.current !== expectedIdentity || operationGenerationRef.current !== generation) {
        throw new Error('Workspace operation changed');
      }
    };
    if (!readSdk || !adapter || !wallet.session?.provider) throw new Error('Public workspace unavailable');
    const executionProvider = wallet.session.provider;

    const currentChainId = Number(await executionProvider.request({ method: 'eth_chainId' }));
    assertCurrent();
    const accounts = await executionProvider.request({ method: 'eth_accounts' });
    assertCurrent();
    const currentAccount = canonicalAddress(accounts?.[0]);
    const sessionAccount = canonicalAddress(wallet.session.address);
    if (currentChainId !== deployment.chainId || !currentAccount || currentAccount !== sessionAccount) throw new Error('Workspace account unavailable');

    const rawBoundAdapter = {
      ...adapter,
      supports: (actionId, context) => adapter.supports(actionId, { ...context, ...rawInput }),
    };
    const hooks = createFreshHooks({ action, rawInput, sdk: readSdk, deployment, assertCurrent });
    const capabilityContext = {
      wallet: { ...wallet.session, address: currentAccount }, chainId: currentChainId, deployment,
      object: {}, adapter: rawBoundAdapter, getAmountDecimals, ...hooks,
    };
    const capability = await resolveCapability(capabilityContext, action);
    assertCurrent();
    if (capability.state !== CAPABILITY_STATES.AVAILABLE) throw Object.assign(new Error(capability.reasonKey), { capability });

    let decimals;
    if (actionRequiresAmountDecimals(action.id)) {
      decimals = await getAmountDecimals({ actionId: action.id, action, object: {}, rawInput, deployment });
      assertCurrent();
    }
    const normalized = validateActionInput(action.id, rawInput, { amountDecimals: decimals });
    await verifyNormalized({ actionId: action.id, input: normalized, sdk: readSdk, deployment, account: currentAccount, assertCurrent });
    assertCurrent();

    const signer = await getWriteSigner(executionProvider);
    assertCurrent();
    const signerAddress = canonicalAddress(await signer?.getAddress?.());
    assertCurrent();
    if (!signerAddress || signerAddress !== currentAccount) throw new Error('Workspace signer unavailable');

    const assertWalletCurrent = async writeSigner => {
      assertCurrent();
      const liveChainId = Number(await executionProvider.request({ method: 'eth_chainId' }));
      assertCurrent();
      const liveAccounts = await executionProvider.request({ method: 'eth_accounts' });
      assertCurrent();
      const liveSignerAddress = canonicalAddress(await writeSigner?.getAddress?.());
      assertCurrent();
      if (liveChainId !== deployment.chainId
        || canonicalAddress(liveAccounts?.[0]) !== currentAccount
        || liveSignerAddress !== currentAccount) throw new Error('Workspace identity changed');
    };
    const executionControl = Object.freeze({ assertCurrent, assertWalletCurrent });

    const guardedAdapter = {
      ...rawBoundAdapter,
      execute: async (actionId, input, suppliedControl) => {
        if (suppliedControl !== executionControl) throw new Error('Workspace execution guard unavailable');
        assertCurrent();
        const liveChainId = Number(await executionProvider.request({ method: 'eth_chainId' }));
        assertCurrent();
        const liveAccounts = await executionProvider.request({ method: 'eth_accounts' });
        assertCurrent();
        if (liveChainId !== deployment.chainId || canonicalAddress(liveAccounts?.[0]) !== currentAccount) throw new Error('Workspace identity changed');
        await verifyNormalized({ actionId, input, sdk: readSdk, deployment, account: currentAccount, assertCurrent });
        assertCurrent();
        return adapter.execute(actionId, input, suppliedControl);
      },
    };
    return executeAction({
      action, rawInput, capabilityContext: { ...capabilityContext, adapter: guardedAdapter },
      adapter: guardedAdapter, signer, transactions, executionControl,
    });
  };

  const renderAction = action => (
    <div key={action.id} data-testid={`public-action-${action.id}`}>
      <ActionPanel
        action={action}
        schema={FORM_SCHEMAS[action.schemaId]}
        capability={capabilityFor(action)}
        onExecute={(_actionId, rawInput) => onExecute(action, rawInput)}
        onSwitchNetwork={() => wallet.switchChain(deployment.chainId)}
        targetAddress={action.id === 'asset.register' ? deployment.addresses.assetRegistry
          : WRAPPER_ACTIONS.has(action.id) ? deployment.addresses.reservePSM : null}
      />
    </div>
  );

  return (
    <section className="ws-page ws-public-page">
      <p className="ws-eyebrow">Permissionless protocol functions</p>
      <h1>Public workspace</h1>
      <p>These functions do not grant an administrative identity. Wallet, network, deployment, object, pause and lifecycle checks still apply before every write.</p>
      {sdkResult.error && <p className="ws-workspace-error" role="alert">{sdkResult.error}</p>}
      <section className="ws-public-page__section" aria-labelledby="public-creators-title">
        <h2 id="public-creators-title">Public creation functions</h2>
        <p>Asset creation is available on the current deployment. Vault and Wrapper creation remain fail-closed where the reviewed contracts do not expose a permissionless mapping.</p>
        <div className="ws-action-list">{CREATOR_ACTIONS.map(renderAction)}</div>
      </section>
      <section className="ws-public-page__section" aria-labelledby="public-user-title">
        <h2 id="public-user-title">Regular user operations</h2>
        <p>Operate configured legacy Vault tranches and Wrapper assets through the exact SDK methods deployed on BNB Smart Chain Testnet.</p>
        <div className="ws-action-list">{USER_ACTIONS.map(renderAction)}</div>
      </section>
    </section>
  );
}
