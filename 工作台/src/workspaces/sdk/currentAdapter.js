import { CycleState, PauseState, ProductState, QueueType } from '../../integrations/hypertessera/upstream/types';

function requireVariant(value, values, label) {
  if (!values.includes(value)) throw new Error(`Unsupported ${label}: ${String(value)}`);
  return value;
}

function requireBoolean(value, label = 'paused') {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function contractFor(writeSdk, name, address, signer) {
  if (!name || address === undefined || address === null) throw new Error(`Current SDK contract unavailable for ${name}`);
  return writeSdk.getContract(name, address, signer);
}

function invoke(contract, functionName, args) {
  return contract.getFunction(functionName)(...args);
}

function equalAddress(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

function vaultBinding(addresses, vault) {
  if (equalAddress(vault, addresses.cashVault) || equalAddress(vault, addresses.noteVault)) return { name: 'EarnVault', address: vault };
  if (equalAddress(vault, addresses.lpVault)) return { name: 'LiquidityEarnVault', address: vault };
  throw new Error('Unknown configured vault');
}

function adapterBinding(addresses, adapter) {
  if (equalAddress(adapter, addresses.cashAdapter) || equalAddress(adapter, addresses.noteAdapter)) return { name: 'FirstPeriodAdapter', address: adapter };
  if (equalAddress(adapter, addresses.lpAdapter)) return { name: 'LiquidityAdapter', address: adapter };
  throw new Error('Unknown configured adapter');
}

function vaultContract(writeSdk, addresses, input) {
  const binding = vaultBinding(addresses, input.vault);
  return contractFor(writeSdk, binding.name, binding.address, input.signer);
}

function adapterContract(writeSdk, addresses, input) {
  const binding = adapterBinding(addresses, input.adapter);
  return contractFor(writeSdk, binding.name, binding.address, input.signer);
}

function liquidityAdapterContract(writeSdk, addresses, input) {
  if (!equalAddress(input.adapter, addresses.lpAdapter)) throw new Error('Unknown configured liquidity adapter');
  return contractFor(writeSdk, 'LiquidityAdapter', addresses.lpAdapter, input.signer);
}

function normalizeAssetMode(mode) {
  if (mode === 'token-custody' || mode === 0) return 0;
  if (mode === 'document-proof' || mode === 1) return 1;
  throw new Error(`Unsupported wrapper mode: ${String(mode)}`);
}

const PUBLIC_QUEUE_ACTIONS = new Set([
  'request.deposit', 'request.deposit.claim', 'request.redeem',
  'request.redeem.claim', 'request.cancel', 'request.refund.claim',
]);
const PUBLIC_WRAPPER_ACTIONS = new Set(['wrapper.wrap', 'wrapper.unwrap']);

function requirePublicExecutionControl(actionId, executionControl) {
  if (!PUBLIC_QUEUE_ACTIONS.has(actionId) && !PUBLIC_WRAPPER_ACTIONS.has(actionId)) return null;
  if (typeof executionControl?.assertCurrent !== 'function'
    || typeof executionControl?.assertWalletCurrent !== 'function') {
    throw new Error('Public execution guard unavailable');
  }
  executionControl.assertCurrent();
  return executionControl;
}

async function guardedPublicWrite(executionControl, signer, write) {
  executionControl.assertCurrent();
  await executionControl.assertWalletCurrent(signer);
  executionControl.assertCurrent();
  return write();
}

function positiveUint(value, label) {
  let parsed;
  try { parsed = BigInt(value); } catch { throw new Error(`${label} must be a positive uint256`); }
  if (parsed <= 0n || parsed >= (1n << 256n)) throw new Error(`${label} must be a positive uint256`);
  return parsed;
}

function trancheVault(addresses, tranche) {
  const selected = requireVariant(tranche, ['cash', 'note', 'lp'], 'tranche');
  const address = selected === 'cash' ? addresses.cashVault : selected === 'note' ? addresses.noteVault : addresses.lpVault;
  if (!address) throw new Error('Configured tranche unavailable');
  return { tranche: selected, address };
}

function psmConfig(raw) {
  return {
    mode: Number(raw?.mode ?? raw?.[0]),
    underlyingToken: raw?.underlyingToken ?? raw?.[1],
    wrappedToken: raw?.wrappedToken ?? raw?.[2],
    allowPartialUnwrap: raw?.allowPartialUnwrap ?? raw?.[3],
    paused: raw?.paused ?? raw?.[5],
  };
}

function configuredAddress(value) {
  return typeof value === 'string'
    && /^0x[0-9a-fA-F]{40}$/.test(value)
    && !equalAddress(value, '0x0000000000000000000000000000000000000000');
}

async function preflightQueue(writeSdk, addresses, actionId, input, executionControl) {
  const { tranche, address: vault } = trancheVault(addresses, input.tranche);
  const requestId = actionId.includes('claim') || actionId === 'request.cancel'
    ? positiveUint(input.requestId, 'requestId') : null;
  if (actionId === 'request.deposit') {
    positiveUint(input.assets, 'assets');
    if (!configuredAddress(input.owner)) throw new Error('owner must be a nonzero address');
  } else if (actionId === 'request.redeem') {
    positiveUint(input.shares, 'shares');
    if (!configuredAddress(input.owner)) throw new Error('owner must be a nonzero address');
  } else if (actionId === 'request.deposit.claim' || actionId === 'request.redeem.claim') {
    if (!configuredAddress(input.receiver)) throw new Error('receiver must be a nonzero address');
  }
  if (typeof writeSdk.isVaultRegistered !== 'function') throw new Error('Configured vault unavailable');
  const registered = await writeSdk.isVaultRegistered(vault);
  executionControl.assertCurrent();
  if (registered !== true) {
    throw new Error('Configured vault unavailable');
  }
  if (actionId === 'request.deposit' || actionId === 'request.redeem' || actionId === 'request.cancel') {
    if (typeof writeSdk.getStateContext !== 'function') throw new Error('Vault state unavailable');
    const state = await writeSdk.getStateContext(vault);
    executionControl.assertCurrent();
    if (actionId === 'request.deposit') {
      const subscribable = Number(state.pause) === PauseState.ACTIVE
        && (Number(state.product) === ProductState.SUBSCRIBING
          || (Number(state.product) === ProductState.OPERATING && Number(state.cycle) === CycleState.ACCEPTING));
      if (!subscribable) throw new Error('Vault is not subscribable');
    } else if (actionId === 'request.redeem') {
      const operable = Number(state.pause) === PauseState.ACTIVE
        && (Number(state.product) === ProductState.SETTLING
          || (Number(state.product) === ProductState.OPERATING && Number(state.cycle) === CycleState.ACCEPTING));
      if (!operable) throw new Error('Vault is not redeemable');
    } else {
      if (Number(state.cycle) !== CycleState.ACCEPTING) throw new Error('Request cannot be cancelled in this cycle');
      const queue = contractFor(writeSdk, 'Queue', addresses.queue);
      const [deposit, redeem] = await Promise.all([
        queue.isInQueue(vault, QueueType.DEPOSIT, requestId),
        queue.isInQueue(vault, QueueType.REDEEM, requestId),
      ]);
      executionControl.assertCurrent();
      if (deposit !== true && redeem !== true) throw new Error('Request is not pending');
    }
  }
  return { tranche, requestId };
}

async function preflightWrapper(writeSdk, addresses, actionId, input, executionControl) {
  const assetId = positiveUint(input.assetId, 'assetId');
  const amount = positiveUint(input.amount, 'amount');
  if (!configuredAddress(input.to)) throw new Error('to must be a nonzero address');
  const reserve = contractFor(writeSdk, 'ReservePSM', addresses.reservePSM);
  const [raw, globallyPaused] = await Promise.all([reserve.assetConfig(assetId), reserve.globalPaused()]);
  executionControl.assertCurrent();
  const config = psmConfig(raw);
  if (!configuredAddress(config.wrappedToken)) throw new Error('Wrapped asset unavailable');
  if (globallyPaused === true || config.paused === true) throw new Error('PSM asset paused');
  if (config.mode !== 0 && config.mode !== 1) throw new Error('Unsupported PSM asset mode');
  if (actionId === 'wrapper.wrap') {
    if (config.mode !== 0 || !configuredAddress(config.underlyingToken)) throw new Error('Asset is not in token custody mode');
  } else {
    const owner = await input.signer?.getAddress?.();
    executionControl.assertCurrent();
    if (!configuredAddress(owner)) throw new Error('Signer unavailable');
    const rawBalance = await contractFor(writeSdk, 'WrappedAsset', config.wrappedToken).balanceOf(owner);
    executionControl.assertCurrent();
    const balance = BigInt(rawBalance);
    if (amount > balance || (config.mode === 1 || config.allowPartialUnwrap !== true) && amount !== balance) {
      throw new Error('Unwrap amount must match the available full balance');
    }
  }
}

function requestField(request, name, index) {
  return request?.[name] ?? request?.[index];
}

async function approveBoundRequest(writeSdk, addresses, input, kind) {
  const controller = contractFor(writeSdk, 'MintBurnController', addresses.mintBurnController, input.signer);
  const request = await controller[kind === 'mint' ? 'mintRequests' : 'burnRequests'](input.nonce);
  const requestAssetId = requestField(request, 'assetId', 0);
  const amount = requestField(request, 'amount', 1);
  const approved = requestField(request, 'approved', 3);
  const executed = requestField(request, 'executed', 4);
  let matches = false;
  try { matches = BigInt(requestAssetId) === BigInt(input.assetId) && BigInt(amount) > 0n; } catch { matches = false; }
  if (!matches || approved === true || executed === true) throw new Error('Approval request unavailable');
  return writeSdk[kind === 'mint' ? 'approveMint' : 'approveBurn'](input.nonce, input.tokenAgentSig, input.signer);
}

function pauseArgs(input) {
  if (requireBoolean(input.paused)) {
    if (input.reason === undefined) throw new Error('reason is required when pausing');
    return [input.vault, input.reason];
  }
  if (input.reason !== undefined) throw new Error('reason is only valid when pausing');
  return [input.vault];
}

function mappedMethods(writeSdk) {
  const addresses = writeSdk.addresses ?? {};
  const direct = (sdkMethod, args) => input => writeSdk[sdkMethod](...args(input));
  const directVault = (sdkMethod, args) => input => {
    vaultBinding(addresses, input.vault);
    return writeSdk[sdkMethod](...args(input));
  };
  const module = (name, address, fn, args) => input => {
    // Validate all input-controlled dispatch before touching the SDK/contract.
    const functionName = fn(input);
    const callArgs = args(input);
    return invoke(contractFor(writeSdk, name, address(input, addresses), input.signer), functionName, callArgs);
  };
  const adapter = (fn, args) => input => {
    // The same order keeps invalid operation variants from even resolving a contract.
    const functionName = fn(input);
    const callArgs = args(input);
    return invoke(adapterContract(writeSdk, addresses, input), functionName, callArgs);
  };
  const vaultAdapterWrite = input => invoke(
    vaultContract(writeSdk, addresses, input),
    requireBoolean(input.enabled, 'enabled') ? 'addAdapter' : 'removeAdapter',
    [input.adapter],
  );

  return {
    'lifecycle.open-subscription': directVault('openSubscription', i => [i.vault, i.signer]),
    'lifecycle.finalize-subscription': directVault('finalizeSubscription', i => [i.vault, i.signer]),
    'lifecycle.start-calculation': directVault('startCycleCalculation', i => [i.vault, i.signer]),
    'lifecycle.enter-final-settlement': directVault('enterFinalSettlement', i => [i.vault, i.signer]),
    'lifecycle.enter-maturing': directVault('enterMaturing', i => [i.vault, i.signer]),
    'lifecycle.enter-claiming': directVault('enterClaiming', i => [i.vault, i.signer]),
    'lifecycle.close-product': directVault('closeProduct', i => [i.vault, i.signer]),
    'mint.initiate': direct('initiateMint', i => [i.assetId, i.amount, i.to, i.issuerSig, i.signer]),
    'burn.initiate': direct('initiateBurn', i => [i.assetId, i.amount, i.from, i.issuerSig, i.signer]),
    'mint.approve': input => approveBoundRequest(writeSdk, addresses, input, 'mint'),
    'burn.approve': input => approveBoundRequest(writeSdk, addresses, input, 'burn'),
    'settlement.batch.submit': direct('submitBatch', i => [i.instruction, i.signatures, i.signer]),
    'nav.update.submit': direct('updateNAV', i => [i.vault, i.nav, i.dataTimestamp, i.sig, i.signer]),
    'wrapper.deploy': direct('deployWrappedToken', i => [i.assetId, normalizeAssetMode(i.mode), i.underlyingToken, i.name, i.symbol, i.decimals, i.allowPartialUnwrap, i.signer]),
    'wrapper.wrap': async (input, control) => { await preflightWrapper(writeSdk, addresses, 'wrapper.wrap', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.wrap(input.assetId, input.amount, input.to, input.signer)); },
    'wrapper.unwrap': async (input, control) => { await preflightWrapper(writeSdk, addresses, 'wrapper.unwrap', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.unwrap(input.assetId, input.amount, input.to, input.signer)); },
    'request.deposit': async (input, control) => { await preflightQueue(writeSdk, addresses, 'request.deposit', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.requestDeposit(input.tranche, input.assets, input.owner, input.signer)); },
    'request.deposit.claim': async (input, control) => { await preflightQueue(writeSdk, addresses, 'request.deposit.claim', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.claimDeposit(input.tranche, input.requestId, input.receiver, input.signer)); },
    'request.redeem': async (input, control) => { await preflightQueue(writeSdk, addresses, 'request.redeem', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.requestRedeem(input.tranche, input.shares, input.owner, input.signer)); },
    'request.redeem.claim': async (input, control) => { await preflightQueue(writeSdk, addresses, 'request.redeem.claim', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.claimRedeem(input.tranche, input.requestId, input.receiver, input.signer)); },
    'request.cancel': async (input, control) => { await preflightQueue(writeSdk, addresses, 'request.cancel', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.cancelRequest(input.tranche, input.requestId, input.signer)); },
    'request.refund.claim': async (input, control) => { await preflightQueue(writeSdk, addresses, 'request.refund.claim', input, control); return guardedPublicWrite(control, input.signer, () => writeSdk.claimRefund(input.tranche, input.requestId, input.signer)); },

    'governor.members.manage': module('HyperAccessControl', () => addresses.hyperAccessControl, i => requireVariant(i.operation, ['grant', 'revoke'], 'operation') === 'grant' ? 'grantRole' : 'revokeRole', i => [i.role, i.account]),
    'protocol.modules.pause': module('StateManager', () => addresses.stateManager, i => requireBoolean(i.paused) ? 'pauseModule' : 'unpauseModule', i => [i.module]),
    'psm.protocol.pause': module('ReservePSM', () => addresses.reservePSM, i => requireBoolean(i.paused) ? 'pause' : 'unpause', () => []),
    'revenue.treasury.set': module('RevenuePool', () => addresses.revenuePool, () => 'setYieldStrategy', i => [i.treasury]),
    'revenue.withdraw': module('RevenuePool', () => addresses.revenuePool, () => 'withdraw', i => [i.recipient, i.amount]),
    'revenue.withdraw.token': module('RevenuePool', () => addresses.revenuePool, () => 'withdrawToken', i => [i.token, i.to, i.amount]),
    'revenue.sources.manage': module('RevenuePool', () => addresses.revenuePool, i => requireBoolean(i.enabled, 'enabled') ? 'addAuthorizedSource' : 'removeAuthorizedSource', i => [i.source]),
    'protocol.fee.config': input => invoke(vaultContract(writeSdk, addresses, input), 'setProtocolFeeConfig', [input.revenuePool, input.protocolFeeShareBps]),
    'nav.deviation.set': module('NAVOracle', () => addresses.navOracle, () => 'setNAVDeviationMaxBps', i => [i.navDeviationMaxBps]),
    'settlement.return-principal': input => invoke(vaultContract(writeSdk, addresses, input), 'returnPrincipalToPool', [input.amount]),
    'vault.evict-deposit': input => invoke(vaultContract(writeSdk, addresses, input), 'evictDepositRequest', [input.requestId]),
    'nav.signer.manage': input => {
      requireVariant(input.operation, ['add', 'remove'], 'operation');
      vaultBinding(addresses, input.vault);
      // The target oracle keys signers by RWA token (setSigner) rather than by
      // vault (addAuthorizedSigner), and the current action schema is vault
      // scoped — surface a clear failure until the schema is updated.
      if (writeSdk.supportsFunction('NAVOracle', 'setSigner')) {
        throw new Error('nav.signer.manage targets the RWA-token-keyed NAVOracle; update the action to the token scope');
      }
      const functionName = input.operation === 'add' ? 'addAuthorizedSigner' : 'removeAuthorizedSigner';
      return invoke(contractFor(writeSdk, 'NAVOracle', addresses.navOracle, input.signer), functionName, [input.vault, input.account]);
    },
    'vault.roles.set': input => {
      requireVariant(input.role, ['curator', 'guardian', 'allocator', 'keeper'], 'role');
      // Target contracts appoint each vault role individually; the deployed
      // one models all four as a single vault operator.
      if (writeSdk.supportsFunction('EarnVault', 'setCurator')) {
        const contract = vaultContract(writeSdk, addresses, input);
        const fn = input.role === 'keeper' ? 'setKeeper' : `set${input.role[0].toUpperCase()}${input.role.slice(1)}`;
        const args = input.role === 'keeper'
          ? [input.account, requireBoolean(input.enabled, 'enabled')]
          : [input.account];
        return invoke(contract, fn, args);
      }
      return invoke(vaultContract(writeSdk, addresses, input), 'setOperator', [input.account, requireBoolean(input.enabled, 'enabled')]);
    },
    'vault.settlement.configure': input => {
      const operation = requireVariant(input.operation, ['add-operator', 'remove-operator', 'set-threshold'], 'operation');
      const settlement = contractFor(writeSdk, 'Settlement', addresses.settlement, input.signer);
      // Target Settlement scopes operators and thresholds per vault.
      if (writeSdk.supportsFunction('Settlement', 'setOperator')) {
        const args = operation === 'set-threshold'
          ? [input.vault, input.threshold]
          : [input.vault, input.account, operation === 'add-operator'];
        return invoke(settlement, operation === 'set-threshold' ? 'setThreshold' : 'setOperator', args);
      }
      const functionName = operation === 'add-operator' ? 'addOperator' : operation === 'remove-operator' ? 'removeOperator' : 'setThreshold';
      const args = operation === 'set-threshold' ? [input.threshold] : [input.account];
      return invoke(settlement, functionName, args);
    },
    'vault.modules.bind': input => {
      const operation = requireVariant(input.operation, ['settlement', 'unified-pool', 'gate', 'nav-signer'], 'operation');
      if (operation === 'nav-signer') {
        if (writeSdk.supportsFunction('NAVOracle', 'setSigner')) {
          throw new Error('vault.modules.bind nav-signer targets the RWA-token-keyed NAVOracle; update the action to the token scope');
        }
        return invoke(contractFor(writeSdk, 'NAVOracle', addresses.navOracle, input.signer), 'addAuthorizedSigner', [input.vault, input.contract]);
      }
      const functionName = operation === 'settlement' ? 'setSettlement' : operation === 'unified-pool' ? 'setUnifiedPool' : 'setGate';
      return invoke(vaultContract(writeSdk, addresses, input), functionName, [input.contract]);
    },
    'vault.adapters.configure': input => invoke(vaultContract(writeSdk, addresses, input), requireBoolean(input.enabled, 'enabled') ? 'addAdapter' : 'removeAdapter', [input.adapter]),
    'vault.adapters.manage': input => invoke(vaultContract(writeSdk, addresses, input), requireBoolean(input.enabled, 'enabled') ? 'addAdapter' : 'removeAdapter', [input.adapter]),
    'psm.authorization.submit': module('ReservePSM', () => addresses.reservePSM, () => 'mintWithAuthorization', i => [i.assetId, i.amount, i.to, i.nonce, i.expiry, i.signature, i.documentId]),
    'vault.fees.set': input => {
      const hasBps = input.feeBps !== undefined;
      const hasRecipient = input.recipient !== undefined;
      if (hasBps === hasRecipient) throw new Error('vault.fees.set requires exactly one feeBps or recipient');
      const contract = vaultContract(writeSdk, addresses, input);
      return hasBps ? invoke(contract, 'setPerformanceFeeBps', [input.feeBps]) : invoke(contract, 'setPerformanceFeeRecipient', [input.recipient]);
    },
    'vault.orders.manage': adapter(i => {
      const kind = requireVariant(i.operation ?? i.order?.kind, ['buy', 'sell', 'rebalance'], 'operation');
      return `create${kind[0].toUpperCase()}${kind.slice(1)}Order`;
    }, i => {
      const kind = requireVariant(i.operation ?? i.order?.kind, ['buy', 'sell', 'rebalance'], 'operation');
      const order = i.order ?? {};
      if (kind === 'buy') return [order.amount, order.destination, order.mode];
      if (kind === 'sell') return [order.amount];
      return [order.amount, order.source, order.destination, order.mode];
    }),
    'vault.data-policy.set': adapter(() => 'setStalenessWindow', i => [i.maxDataAge]),
    'vault.pause': module('StateManager', () => addresses.stateManager, i => requireBoolean(i.paused) ? 'pause' : 'unpause', pauseArgs),
    'vault.order.cancel': adapter(i => {
      const kind = requireVariant(i.operation ?? i.orderKind, ['buy', 'sell', 'rebalance'], 'operation');
      return `cancel${kind[0].toUpperCase()}${kind.slice(1)}Order`;
    }, i => [i.orderId]),
    'vault.allocator.freeze': adapter(i => requireBoolean(i.paused) ? 'freezeAllocator' : 'unfreezeAllocator', () => []),
    'vault.buy': adapter(() => 'executeBuy', i => [i.orderId]),
    'vault.sell': adapter(() => 'executeSell', i => [i.orderId]),
    'vault.rebalance': adapter(() => 'executeRebalance', i => [i.orderId]),
    'vault.deal.clear': adapter(() => 'clearDealValue', i => [i.orderId ?? i.dealId]),
    'vault.bridge': input => invoke(liquidityAdapterContract(writeSdk, addresses, input), 'bridgeToCash', [input.amount]),
    'request.mark-refundable': input => invoke(vaultContract(writeSdk, addresses, input), 'markRefundable', [input.requestIds ?? [input.requestId]]),
    'claim.record': module('ClaimRegistry', () => addresses.claimRegistry, () => 'recordClaim', i => [i.vault, i.owner, i.requestId, i.assets, i.kind]),
    'asset.register': module('AssetRegistry', () => addresses.assetRegistry, () => 'registerAsset', i => {
      const metadata = i.assetMetadata ?? i;
      return [metadata.metadataHash, metadata.name, metadata.symbol, metadata.decimals];
    }),
    'asset.metadata.update': module('AssetRegistry', () => addresses.assetRegistry, () => 'updateMetadataHash', i => [i.assetId, i.metadataHash]),
    'asset.owner.transfer': module('AssetRegistry', () => addresses.assetRegistry, () => 'transferAssetOwnership', i => [i.assetId, i.newOwner]),
    'asset.deactivate': module('AssetRegistry', () => addresses.assetRegistry, () => 'deactivateAsset', i => [i.assetId]),
    'proof.publish': module('PoRRegistry', () => addresses.poRRegistry, () => 'publishReserveProof', i => [i.assetId, i.proofHash, i.documentUri]),
    'wrapper.signer.set': module('ReservePSM', () => addresses.reservePSM, () => 'setAuthorizedSigner', i => [i.assetId, i.authorizedSigner]),
    'wrapper.asset.pause': module('ReservePSM', () => addresses.reservePSM, i => requireBoolean(i.paused) ? 'pauseAsset' : 'unpauseAsset', i => [i.assetId]),
    'adapter.deal-data.update': adapter(() => 'updateDealData', i => [i.dealId, i.newValue]),
  };
}

const DIRECT_SDK_METHODS = Object.freeze({
  'lifecycle.open-subscription': 'openSubscription', 'lifecycle.finalize-subscription': 'finalizeSubscription', 'lifecycle.start-calculation': 'startCycleCalculation', 'lifecycle.enter-final-settlement': 'enterFinalSettlement', 'lifecycle.enter-maturing': 'enterMaturing', 'lifecycle.enter-claiming': 'enterClaiming', 'lifecycle.close-product': 'closeProduct',
  'mint.initiate': 'initiateMint', 'burn.initiate': 'initiateBurn', 'mint.approve': 'approveMint', 'burn.approve': 'approveBurn', 'settlement.batch.submit': 'submitBatch', 'nav.update.submit': 'updateNAV', 'wrapper.deploy': 'deployWrappedToken', 'wrapper.wrap': 'wrap', 'wrapper.unwrap': 'unwrap', 'request.deposit': 'requestDeposit', 'request.deposit.claim': 'claimDeposit', 'request.redeem': 'requestRedeem', 'request.redeem.claim': 'claimRedeem', 'request.cancel': 'cancelRequest', 'request.refund.claim': 'claimRefund',
});
const VAULT_SCOPED_DIRECT_METHODS = new Set([
  'lifecycle.open-subscription', 'lifecycle.finalize-subscription', 'lifecycle.start-calculation',
  'lifecycle.enter-final-settlement', 'lifecycle.enter-maturing', 'lifecycle.enter-claiming', 'lifecycle.close-product',
]);

const CONTRACT_REQUIREMENTS = Object.freeze({
  'governor.members.manage': ['hyperAccessControl'], 'protocol.modules.pause': ['stateManager'], 'psm.protocol.pause': ['reservePSM'], 'revenue.treasury.set': ['revenuePool'], 'revenue.withdraw': ['revenuePool'], 'revenue.withdraw.token': ['revenuePool'], 'revenue.sources.manage': ['revenuePool'], 'protocol.fee.config': ['cashVault', 'noteVault', 'lpVault'], 'nav.deviation.set': ['navOracle'], 'settlement.return-principal': ['cashVault', 'noteVault', 'lpVault'], 'vault.evict-deposit': ['cashVault', 'noteVault', 'lpVault'], 'nav.signer.manage': ['navOracle'], 'vault.roles.set': ['cashVault', 'noteVault', 'lpVault'], 'vault.settlement.configure': ['settlement'], 'vault.modules.bind': ['navOracle'], 'vault.adapters.configure': ['cashVault', 'noteVault', 'lpVault'], 'vault.adapters.manage': ['cashVault', 'noteVault', 'lpVault'], 'psm.authorization.submit': ['reservePSM'], 'vault.fees.set': ['cashVault', 'noteVault', 'lpVault'], 'vault.orders.manage': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.data-policy.set': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.pause': ['stateManager'], 'vault.order.cancel': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.allocator.freeze': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.buy': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.sell': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.rebalance': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.deal.clear': ['cashAdapter', 'noteAdapter', 'lpAdapter'], 'vault.bridge': ['lpAdapter'], 'request.mark-refundable': ['cashVault', 'noteVault', 'lpVault'], 'claim.record': ['claimRegistry'], 'asset.register': ['assetRegistry'], 'asset.metadata.update': ['assetRegistry'], 'asset.owner.transfer': ['assetRegistry'], 'asset.deactivate': ['assetRegistry'], 'proof.publish': ['poRRegistry'], 'wrapper.signer.set': ['reservePSM'], 'wrapper.asset.pause': ['reservePSM'], 'adapter.deal-data.update': ['cashAdapter', 'noteAdapter', 'lpAdapter'],
});

function supportsMethod(writeSdk, actionId, input = {}) {
  if (DIRECT_SDK_METHODS[actionId]) {
    if (PUBLIC_QUEUE_ACTIONS.has(actionId)) {
      const addresses = writeSdk?.addresses ?? {};
      if (!addresses.cashVault || !addresses.noteVault || !addresses.lpVault || !addresses.queue
        || typeof writeSdk?.isVaultRegistered !== 'function') return false;
      if (input.tranche !== undefined) {
        try { trancheVault(addresses, input.tranche); } catch { return false; }
      }
    }
    if (PUBLIC_WRAPPER_ACTIONS.has(actionId)
      && (!writeSdk?.addresses?.reservePSM || typeof writeSdk?.getContract !== 'function')) return false;
    if (['mint.approve', 'burn.approve'].includes(actionId)
      && (!writeSdk?.addresses?.mintBurnController || typeof writeSdk?.getContract !== 'function')) return false;
    if (VAULT_SCOPED_DIRECT_METHODS.has(actionId)) {
      try { vaultBinding(writeSdk.addresses ?? {}, input.vault); } catch { return false; }
    }
    return typeof writeSdk?.[DIRECT_SDK_METHODS[actionId]] === 'function';
  }
  const required = CONTRACT_REQUIREMENTS[actionId];
  if (!required || typeof writeSdk?.getContract !== 'function') return false;
  const addresses = writeSdk.addresses ?? {};
  const hasConfiguredBinding = required.includes('cashVault')
    ? Boolean(addresses.cashVault || addresses.noteVault || addresses.lpVault)
    : required.includes('cashAdapter')
      ? Boolean(addresses.cashAdapter || addresses.noteAdapter || addresses.lpAdapter)
      : required.every(name => Boolean(addresses[name]));
  if (!hasConfiguredBinding) return false;
  if (input.vault) {
    try { vaultBinding(addresses, input.vault); } catch { return false; }
  }
  if (input.adapter) {
    if (actionId === 'vault.bridge' && !equalAddress(input.adapter, addresses.lpAdapter)) return false;
    try { adapterBinding(addresses, input.adapter); } catch { return false; }
  }
  return true;
}

export function createCurrentAdapter({ readSdk, writeSdk }) {
  const methods = mappedMethods(writeSdk);
  return {
    supports: (actionId, input) => typeof methods[actionId] === 'function' && supportsMethod(writeSdk, actionId, input),
    async execute(actionId, input = {}, executionControl) {
      const method = methods[actionId];
      if (!method) throw new Error(`Current SDK method unavailable for ${actionId}`);
      const control = requirePublicExecutionControl(actionId, executionControl);
      return method(input, control);
    },
    readSdk,
  };
}
