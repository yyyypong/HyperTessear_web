import { describe, expect, it, vi } from 'vitest';
import { createCurrentAdapter } from './currentAdapter';
import { createTargetAdapter } from './targetAdapter';
import { ACTION_DEFINITIONS } from '../config/roleDefinitions';

const signerAccount = '0x0000000000000000000000000000000000000005';
const signer = { name: 'signer', getAddress: vi.fn().mockResolvedValue(signerAccount) };
const vault = '0x0000000000000000000000000000000000000001';
const adapterAddress = '0x0000000000000000000000000000000000000003';
const lpAdapterAddress = '0x0000000000000000000000000000000000000004';
const unconfiguredVault = '0x0000000000000000000000000000000000000009';
const zeroAddress = '0x0000000000000000000000000000000000000000';
const GUARDED_PUBLIC_ACTIONS = new Set([
  'request.deposit', 'request.deposit.claim', 'request.redeem', 'request.redeem.claim',
  'request.cancel', 'request.refund.claim', 'wrapper.wrap', 'wrapper.unwrap',
]);
const TASK_6_SIGNATURE_ACTIONS = new Set(['settlement.instruction.sign', 'nav.sign']);
const KEEPER_LIFECYCLE = [
  ['lifecycle.open-subscription', 'openSubscription'],
  ['lifecycle.finalize-subscription', 'finalizeSubscription'],
  ['lifecycle.start-calculation', 'startCycleCalculation'],
  ['lifecycle.enter-final-settlement', 'enterFinalSettlement'],
  ['lifecycle.enter-maturing', 'enterMaturing'],
  ['lifecycle.enter-claiming', 'enterClaiming'],
  ['lifecycle.close-product', 'closeProduct'],
];

function writeSdk() {
  const sdk = Object.fromEntries([
    'openSubscription finalizeSubscription startCycleCalculation enterFinalSettlement enterMaturing enterClaiming closeProduct initiateMint initiateBurn approveMint approveBurn submitBatch updateNAV deployWrappedToken mintWithAuthorization wrap unwrap requestDeposit claimDeposit requestRedeem claimRedeem cancelRequest claimRefund'.split(' '),
  ].flat().map(name => [name, vi.fn().mockResolvedValue(name)]));
  sdk.addresses = {
    cashVault: vault, noteVault: 'noteVault', lpVault: 'lpVault', mintBurnController: 'mintBurnController',
    reservePSM: 'psm', queue: 'queue',
  };
  sdk.requestContract = {
    mintRequests: vi.fn().mockResolvedValue([7n, 9n, 'to', false, false]),
    burnRequests: vi.fn().mockResolvedValue([7n, 9n, 'from', false, false]),
  };
  sdk.reserveContract = {
    assetConfig: vi.fn().mockResolvedValue([0, '0x0000000000000000000000000000000000000006', '0x0000000000000000000000000000000000000007', false, signerAccount, false]),
    globalPaused: vi.fn().mockResolvedValue(false),
  };
  sdk.queueContract = { isInQueue: vi.fn().mockResolvedValue(true) };
  sdk.wrappedContract = { balanceOf: vi.fn().mockResolvedValue(9n) };
  sdk.getContract = vi.fn(name => name === 'MintBurnController' ? sdk.requestContract
    : name === 'ReservePSM' ? sdk.reserveContract
      : name === 'Queue' ? sdk.queueContract
        : name === 'WrappedAsset' ? sdk.wrappedContract : {});
  sdk.isVaultRegistered = vi.fn().mockResolvedValue(true);
  sdk.getStateContext = vi.fn().mockResolvedValue({ product: 3, cycle: 0, pause: 0, cycleNumber: 1n });
  return sdk;
}

function escapeSdk() {
  const sdk = writeSdk();
  sdk.addresses = { hyperAccessControl: 'access', stateManager: 'state', reservePSM: 'psm', assetRegistry: 'assetRegistry', mintBurnController: 'mintBurnController', poRRegistry: 'por', claimRegistry: 'claims', queue: 'queue', cashVault: vault, noteVault: 'noteVault', lpVault: 'lpVault', cashAdapter: adapterAddress, noteAdapter: 'noteAdapter', lpAdapter: lpAdapterAddress, liquidityBridge: 'bridge' };
  sdk.getContract = vi.fn((_name, _address, _signer) => ({ getFunction: vi.fn(name => vi.fn((...args) => ({ name, args }))) }));
  return sdk;
}

function publicExecutionControl() {
  return {
    assertCurrent: vi.fn(),
    assertWalletCurrent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('current SDK adapter', () => {
  it('implements every registry on-chain action advertised as legacy-available', () => {
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: escapeSdk() });
    const missing = Object.values(ACTION_DEFINITIONS)
      .filter(action => action.capability.legacy.state === 'available' && !TASK_6_SIGNATURE_ACTIONS.has(action.id))
      .filter(action => !adapter.supports(action.id, action.scope === 'vault' ? { vault } : undefined))
      .map(action => action.id);
    expect(missing).toEqual([]);
  });

  it('forwards curated lifecycle, mint/burn, settlement, NAV, wrapper, PSM, and queue calls in SDK order', async () => {
    const sdk = writeSdk();
    const adapter = createCurrentAdapter({ readSdk: { read: true }, writeSdk: sdk });
    const cases = [
      ['lifecycle.open-subscription', { vault, signer }, 'openSubscription', [vault, signer]],
      ['lifecycle.finalize-subscription', { vault, signer }, 'finalizeSubscription', [vault, signer]],
      ['lifecycle.start-calculation', { vault, signer }, 'startCycleCalculation', [vault, signer]],
      ['lifecycle.enter-final-settlement', { vault, signer }, 'enterFinalSettlement', [vault, signer]],
      ['lifecycle.enter-maturing', { vault, signer }, 'enterMaturing', [vault, signer]],
      ['lifecycle.enter-claiming', { vault, signer }, 'enterClaiming', [vault, signer]],
      ['lifecycle.close-product', { vault, signer }, 'closeProduct', [vault, signer]],
      ['mint.initiate', { assetId: 7n, amount: 9n, to: 'to', issuerSig: 'issuer', signer }, 'initiateMint', [7n, 9n, 'to', 'issuer', signer]],
      ['burn.initiate', { assetId: 7n, amount: 9n, from: 'from', issuerSig: 'issuer', signer }, 'initiateBurn', [7n, 9n, 'from', 'issuer', signer]],
      ['mint.approve', { assetId: 7n, nonce: 3n, tokenAgentSig: 'agent', signer }, 'approveMint', [3n, 'agent', signer]],
      ['burn.approve', { assetId: 7n, nonce: 3n, tokenAgentSig: 'agent', signer }, 'approveBurn', [3n, 'agent', signer]],
      ['settlement.batch.submit', { instruction: 'instruction', signatures: ['s1'], signer }, 'submitBatch', ['instruction', ['s1'], signer]],
      ['nav.update.submit', { vault, nav: 11n, dataTimestamp: 12n, sig: 'sig', signer }, 'updateNAV', [vault, 11n, 12n, 'sig', signer]],
      ['wrapper.deploy', { assetId: 7n, mode: 1, underlyingToken: 'underlying', name: 'Name', symbol: 'N', decimals: 18, allowPartialUnwrap: true, signer }, 'deployWrappedToken', [7n, 1, 'underlying', 'Name', 'N', 18, true, signer]],
      ['wrapper.wrap', { assetId: 7n, amount: 9n, to: signerAccount, signer }, 'wrap', [7n, 9n, signerAccount, signer]],
      ['wrapper.unwrap', { assetId: 7n, amount: 9n, to: signerAccount, signer }, 'unwrap', [7n, 9n, signerAccount, signer]],
      ['request.deposit', { tranche: 'cash', assets: 5n, owner: signerAccount, signer }, 'requestDeposit', ['cash', 5n, signerAccount, signer]],
      ['request.deposit.claim', { tranche: 'cash', requestId: 4n, receiver: signerAccount, signer }, 'claimDeposit', ['cash', 4n, signerAccount, signer]],
      ['request.redeem', { tranche: 'lp', shares: 5n, owner: signerAccount, signer }, 'requestRedeem', ['lp', 5n, signerAccount, signer]],
      ['request.redeem.claim', { tranche: 'lp', requestId: 4n, receiver: signerAccount, signer }, 'claimRedeem', ['lp', 4n, signerAccount, signer]],
      ['request.cancel', { tranche: 'note', requestId: 4n, signer }, 'cancelRequest', ['note', 4n, signer]],
      ['request.refund.claim', { tranche: 'note', requestId: 4n, signer }, 'claimRefund', ['note', 4n, signer]],
    ];
    for (const [actionId, input, method, args] of cases) {
      await adapter.execute(actionId, input, GUARDED_PUBLIC_ACTIONS.has(actionId) ? publicExecutionControl() : undefined);
      expect(sdk[method]).toHaveBeenLastCalledWith(...args);
    }
  });

  it('fails closed on an unknown configured wrapper mode before calling unwrap', async () => {
    const sdk = writeSdk();
    sdk.reserveContract.assetConfig.mockResolvedValue([
      2,
      '0x0000000000000000000000000000000000000006',
      '0x0000000000000000000000000000000000000007',
      false,
      signerAccount,
      false,
    ]);
    const adapter = createCurrentAdapter({ readSdk: sdk, writeSdk: sdk });

    await expect(adapter.execute('wrapper.unwrap', { assetId: 7n, amount: 9n, to: signerAccount, signer }, publicExecutionControl()))
      .rejects.toThrow('Unsupported PSM asset mode');
    expect(sdk.unwrap).not.toHaveBeenCalled();
  });

  it('rejects zero public amounts and transfer destinations before calling the SDK write', async () => {
    const sdk = writeSdk();
    const adapter = createCurrentAdapter({ readSdk: sdk, writeSdk: sdk });

    await expect(adapter.execute('request.deposit', { tranche: 'cash', assets: 0n, owner: signerAccount, signer }, publicExecutionControl()))
      .rejects.toThrow('assets must be a positive uint256');
    await expect(adapter.execute('request.deposit', { tranche: 'cash', assets: 1n, owner: zeroAddress, signer }, publicExecutionControl()))
      .rejects.toThrow('owner must be a nonzero address');
    await expect(adapter.execute('wrapper.wrap', { assetId: 7n, amount: 9n, to: zeroAddress, signer }, publicExecutionControl()))
      .rejects.toThrow('to must be a nonzero address');
    expect(sdk.requestDeposit).not.toHaveBeenCalled();
    expect(sdk.wrap).not.toHaveBeenCalled();
  });

  it.each([
    ['request.deposit', { tranche: 'cash', assets: 5n, owner: signerAccount, signer }, 'requestDeposit'],
    ['request.deposit.claim', { tranche: 'cash', requestId: 4n, receiver: signerAccount, signer }, 'claimDeposit'],
    ['request.redeem', { tranche: 'lp', shares: 5n, owner: signerAccount, signer }, 'requestRedeem'],
    ['request.redeem.claim', { tranche: 'lp', requestId: 4n, receiver: signerAccount, signer }, 'claimRedeem'],
    ['request.cancel', { tranche: 'note', requestId: 4n, signer }, 'cancelRequest'],
    ['request.refund.claim', { tranche: 'note', requestId: 4n, signer }, 'claimRefund'],
    ['wrapper.wrap', { assetId: 7n, amount: 9n, to: signerAccount, signer }, 'wrap'],
    ['wrapper.unwrap', { assetId: 7n, amount: 9n, to: signerAccount, signer }, 'unwrap'],
  ])('fails %s closed when the non-serializable execution guard is absent', async (actionId, input, sdkMethod) => {
    const sdk = writeSdk();
    const adapter = createCurrentAdapter({ readSdk: sdk, writeSdk: sdk });

    await expect(adapter.execute(actionId, input)).rejects.toThrow('Public execution guard unavailable');
    expect(sdk[sdkMethod]).not.toHaveBeenCalled();
  });

  it('re-reads and binds Token Agent approval requests at the adapter boundary', async () => {
    const sdk = writeSdk();
    sdk.requestContract.mintRequests.mockResolvedValue([8n, 9n, 'to', false, false]);
    const adapter = createCurrentAdapter({ readSdk: sdk, writeSdk: sdk });
    await expect(adapter.execute('mint.approve', { assetId: 7n, nonce: 3n, tokenAgentSig: 'agent', signer }))
      .rejects.toThrow('Approval request unavailable');
    expect(sdk.approveMint).not.toHaveBeenCalled();

    sdk.requestContract.mintRequests.mockResolvedValue([7n, 9n, 'to', false, false]);
    await adapter.execute('mint.approve', { assetId: 7n, nonce: 3n, tokenAgentSig: 'agent', signer });
    expect(sdk.approveMint).toHaveBeenCalledWith(3n, 'agent', signer);
  });

  it('does not advertise or execute the unsafe legacy PSM submit path', async () => {
    const sdk = writeSdk();
    const adapter = createCurrentAdapter({ readSdk: sdk, writeSdk: sdk });
    expect(adapter.supports('psm.authorization.submit', { assetId: 7n })).toBe(false);
    await expect(adapter.execute('psm.authorization.submit', { assetId: 7n, signer }))
      .rejects.toThrow('Current SDK method unavailable');
    expect(sdk.mintWithAuthorization).not.toHaveBeenCalled();
  });

  it('uses the SDK getContract escape hatch with ABI-verified argument order and validated variants', async () => {
    const sdk = escapeSdk();
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    const cases = [
      ['governor.members.manage', { operation: 'grant', role: 'role', account: 'member', signer }, 'HyperAccessControl', 'access', 'grantRole', ['role', 'member']],
      ['protocol.modules.pause', { module: 2, paused: false, signer }, 'StateManager', 'state', 'unpauseModule', [2]],
      ['psm.protocol.pause', { paused: true, signer }, 'ReservePSM', 'psm', 'pause', []],
      ['vault.fees.set', { vault, feeBps: 100, signer }, 'EarnVault', vault, 'setPerformanceFeeBps', [100]],
      ['vault.orders.manage', { adapter: adapterAddress, operation: 'buy', order: { amount: 1n, destination: 'dest', mode: 2 }, signer }, 'FirstPeriodAdapter', adapterAddress, 'createBuyOrder', [1n, 'dest', 2]],
      ['vault.order.cancel', { adapter: adapterAddress, operation: 'rebalance', orderId: 5n, signer }, 'FirstPeriodAdapter', adapterAddress, 'cancelRebalanceOrder', [5n]],
      ['vault.allocator.freeze', { adapter: adapterAddress, paused: false, signer }, 'FirstPeriodAdapter', adapterAddress, 'unfreezeAllocator', []],
      ['claim.record', { vault, owner: 'owner', requestId: 8n, assets: 9n, kind: 1, signer }, 'ClaimRegistry', 'claims', 'recordClaim', [vault, 'owner', 8n, 9n, 1]],
      ['asset.register', { metadataHash: 'hash', name: 'Name', symbol: 'SYM', decimals: 18, signer }, 'AssetRegistry', 'assetRegistry', 'registerAsset', ['hash', 'Name', 'SYM', 18]],
      ['proof.publish', { assetId: 1n, proofHash: 'hash', documentUri: 'uri', signer }, 'PoRRegistry', 'por', 'publishReserveProof', [1n, 'hash', 'uri']],
      ['wrapper.asset.pause', { assetId: 1n, paused: false, signer }, 'ReservePSM', 'psm', 'unpauseAsset', [1n]],
      ['adapter.deal-data.update', { adapter: lpAdapterAddress, dealId: 9n, newValue: 10n, signer }, 'LiquidityAdapter', lpAdapterAddress, 'updateDealData', [9n, 10n]],
    ];
    for (const [actionId, input, abi, address, method, args] of cases) {
      const result = await adapter.execute(actionId, input);
      expect(sdk.getContract).toHaveBeenLastCalledWith(abi, address, signer);
      expect(result).toEqual({ name: method, args });
    }
  });

  it('covers every remaining registered escape-hatch mapping with its ABI argument order', async () => {
    const sdk = escapeSdk();
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    const cases = [
      ['vault.fees.set', { vault: 'lpVault', recipient: 'recipient', signer }, 'LiquidityEarnVault', 'lpVault', 'setPerformanceFeeRecipient', ['recipient']],
      ['vault.orders.manage', { adapter: adapterAddress, operation: 'sell', order: { amount: 2n }, signer }, 'FirstPeriodAdapter', adapterAddress, 'createSellOrder', [2n]],
      ['vault.orders.manage', { adapter: adapterAddress, operation: 'rebalance', order: { amount: 2n, source: 'source', destination: 'destination', mode: 1 }, signer }, 'FirstPeriodAdapter', adapterAddress, 'createRebalanceOrder', [2n, 'source', 'destination', 1]],
      ['vault.data-policy.set', { adapter: adapterAddress, maxDataAge: 60n, signer }, 'FirstPeriodAdapter', adapterAddress, 'setStalenessWindow', [60n]],
      ['vault.pause', { vault, paused: true, reason: 2, signer }, 'StateManager', 'state', 'pause', [vault, 2]],
      ['vault.pause', { vault, paused: false, signer }, 'StateManager', 'state', 'unpause', [vault]],
      ['vault.order.cancel', { adapter: adapterAddress, operation: 'buy', orderId: 1n, signer }, 'FirstPeriodAdapter', adapterAddress, 'cancelBuyOrder', [1n]],
      ['vault.order.cancel', { adapter: adapterAddress, operation: 'sell', orderId: 2n, signer }, 'FirstPeriodAdapter', adapterAddress, 'cancelSellOrder', [2n]],
      ['vault.allocator.freeze', { adapter: adapterAddress, paused: true, signer }, 'FirstPeriodAdapter', adapterAddress, 'freezeAllocator', []],
      ['vault.buy', { adapter: adapterAddress, orderId: 1n, signer }, 'FirstPeriodAdapter', adapterAddress, 'executeBuy', [1n]],
      ['vault.sell', { adapter: adapterAddress, orderId: 2n, signer }, 'FirstPeriodAdapter', adapterAddress, 'executeSell', [2n]],
      ['vault.rebalance', { adapter: adapterAddress, orderId: 3n, signer }, 'FirstPeriodAdapter', adapterAddress, 'executeRebalance', [3n]],
      ['vault.deal.clear', { adapter: adapterAddress, dealId: 4n, signer }, 'FirstPeriodAdapter', adapterAddress, 'clearDealValue', [4n]],
      ['vault.bridge', { adapter: lpAdapterAddress, amount: 5n, signer }, 'LiquidityAdapter', lpAdapterAddress, 'bridgeToCash', [5n]],
      ['request.mark-refundable', { vault, requestId: 6n, signer }, 'EarnVault', vault, 'markRefundable', [[6n]]],
      ['asset.metadata.update', { assetId: 7n, metadataHash: 'hash', signer }, 'AssetRegistry', 'assetRegistry', 'updateMetadataHash', [7n, 'hash']],
      ['asset.owner.transfer', { assetId: 7n, newOwner: 'owner', signer }, 'AssetRegistry', 'assetRegistry', 'transferAssetOwnership', [7n, 'owner']],
      ['asset.deactivate', { assetId: 7n, signer }, 'AssetRegistry', 'assetRegistry', 'deactivateAsset', [7n]],
      ['wrapper.signer.set', { assetId: 7n, authorizedSigner: 'authorized', signer }, 'ReservePSM', 'psm', 'setAuthorizedSigner', [7n, 'authorized']],
      ['wrapper.asset.pause', { assetId: 7n, paused: true, signer }, 'ReservePSM', 'psm', 'pauseAsset', [7n]],
    ];
    for (const [actionId, input, abi, address, method, args] of cases) {
      const result = await adapter.execute(actionId, input);
      expect(sdk.getContract).toHaveBeenLastCalledWith(abi, address, signer);
      expect(result).toEqual({ name: method, args });
    }
  });

  it('rejects unsupported actions and invalid variants before requesting a contract', async () => {
    const sdk = escapeSdk();
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    await expect(adapter.execute('unknown.action', {})).rejects.toThrow('Current SDK method unavailable for unknown.action');
    await expect(adapter.execute('governor.members.manage', { operation: 'replace', signer })).rejects.toThrow('Unsupported operation');
    await expect(adapter.execute('vault.pause', { vault, paused: 'yes', signer })).rejects.toThrow('paused must be a boolean');
    expect(sdk.getContract).not.toHaveBeenCalled();
  });

  it('keeps target actions fail-closed with a stable error', async () => {
    const adapter = createTargetAdapter();
    expect(adapter.supports('vault.fees.set')).toBe(false);
    await expect(adapter.execute('vault.fees.set')).rejects.toThrow('Target SDK method unavailable for vault.fees.set');
  });

  it('binds vault and adapter ABIs to configured addresses before touching getContract', async () => {
    const sdk = escapeSdk();
    sdk.addresses = { ...sdk.addresses, cashVault: vault, noteVault: 'note', lpVault: 'lp', cashAdapter: adapterAddress, noteAdapter: 'noteAdapter', lpAdapter: 'lpAdapter' };
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    await expect(adapter.execute('vault.fees.set', { vault: 'unconfigured', feeBps: 1, signer })).rejects.toThrow('Unknown configured vault');
    await expect(adapter.execute('vault.buy', { adapter: 'unconfigured', orderId: 1n, signer })).rejects.toThrow('Unknown configured adapter');
    await expect(adapter.execute('vault.bridge', { adapter: adapterAddress, amount: 1n, signer })).rejects.toThrow('Unknown configured liquidity adapter');
    expect(sdk.getContract).not.toHaveBeenCalled();
  });

  it.each(KEEPER_LIFECYCLE)('binds %s support and execution to a configured manifest vault', async (actionId, sdkMethod) => {
    const sdk = escapeSdk();
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });

    expect(adapter.supports(actionId, { vault: unconfiguredVault })).toBe(false);
    await expect(adapter.execute(actionId, { vault: unconfiguredVault, signer })).rejects.toThrow('Unknown configured vault');
    expect(sdk[sdkMethod]).not.toHaveBeenCalled();
    expect(adapter.supports(actionId, { vault })).toBe(true);
  });

  it('normalizes documented wrapper modes and rejects unknown values before calling the SDK', async () => {
    const sdk = writeSdk();
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    const input = { assetId: 1n, underlyingToken: 'token', name: 'Name', symbol: 'SYM', decimals: 18, allowPartialUnwrap: false, signer };
    await adapter.execute('wrapper.deploy', { ...input, mode: 'token-custody' });
    await adapter.execute('wrapper.deploy', { ...input, mode: 'document-proof' });
    await adapter.execute('wrapper.deploy', { ...input, mode: 1 });
    expect(sdk.deployWrappedToken).toHaveBeenNthCalledWith(1, 1n, 0, 'token', 'Name', 'SYM', 18, false, signer);
    expect(sdk.deployWrappedToken).toHaveBeenNthCalledWith(2, 1n, 1, 'token', 'Name', 'SYM', 18, false, signer);
    await expect(adapter.execute('wrapper.deploy', { ...input, mode: 'other' })).rejects.toThrow('Unsupported wrapper mode');
  });

  it('requires exactly one vault fee mutation before resolving the vault contract', async () => {
    const sdk = escapeSdk();
    sdk.addresses = { ...sdk.addresses, cashVault: vault, noteVault: 'note', lpVault: 'lp' };
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    await expect(adapter.execute('vault.fees.set', { vault, signer })).rejects.toThrow('exactly one');
    await expect(adapter.execute('vault.fees.set', { vault, feeBps: 1, recipient: 'recipient', signer })).rejects.toThrow('exactly one');
    expect(sdk.getContract).not.toHaveBeenCalled();
  });

  it('rejects a pause reason on unpause rather than silently dropping it', async () => {
    const sdk = escapeSdk();
    const adapter = createCurrentAdapter({ readSdk: {}, writeSdk: sdk });
    await expect(adapter.execute('vault.pause', { vault, paused: false, reason: 0, signer })).rejects.toThrow('reason is only valid when pausing');
    expect(sdk.getContract).not.toHaveBeenCalled();
  });

  it('does not advertise unavailable SDK facilities or an unconfigured ClaimRegistry', () => {
    expect(createCurrentAdapter({ readSdk: {}, writeSdk: {} }).supports('lifecycle.open-subscription')).toBe(false);
    const sdk = escapeSdk();
    delete sdk.addresses.claimRegistry;
    expect(createCurrentAdapter({ readSdk: {}, writeSdk: sdk }).supports('claim.record')).toBe(false);
    sdk.addresses.claimRegistry = 'claims';
    expect(createCurrentAdapter({ readSdk: {}, writeSdk: sdk }).supports('claim.record')).toBe(true);
    delete sdk.addresses.mintBurnController;
    expect(createCurrentAdapter({ readSdk: {}, writeSdk: sdk }).supports('mint.approve')).toBe(false);
  });
});
