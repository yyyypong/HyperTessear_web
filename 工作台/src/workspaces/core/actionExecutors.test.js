import { describe, expect, test, vi } from 'vitest';
import { Wallet } from 'ethers';
import { executeAction, executeSignatureAction } from './actionExecutors';
import { createReadSdk } from './createSdk';
import { buildLegacyNavDigest, createSignatureCapabilityAdapter } from './signaturePayloads';
import { createTransactionStore } from './transactionStore';

const vault = '0x52908400098527886E0F7030069857D2E4169EE7';
const reservePsm = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const otherContract = '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe';
const settlementContract = '0x1111111111111111111111111111111111111111';
const context = adapter => ({ wallet: { address: vault }, chainId: 1, deployment: { profile: 'legacy', chainId: 1, addresses: { reservePSM: reservePsm, settlement: settlementContract, lpAdapter: otherContract } }, object: { vault }, adapter, getAssetDecimals: async () => 6, isPaused: async () => false, isValidState: async () => true, isAuthorized: async () => true });
const action = { id: 'lifecycle.open-subscription', scope: 'vault', capability: { legacy: { adapterMethod: 'openSubscription', requiredModules: [] } } };
const instructionFor = selectedVault => ({
  vaultSettlements: [{ distribution: { vault: selectedVault, amount: '1' }, depositRequestIds: [], redeemRequestIds: [] }],
  cycleNumber: '1',
  validUntil: '1893456000',
});

describe('action execution', () => {
  test('waits for an ethers TransactionResponse before confirming', async () => {
    const receipt = { hash: '0xreceipt', status: 1 };
    const adapter = { supports: () => true, execute: vi.fn(async () => ({ hash: '0xtx', wait: async () => receipt })) };
    const transactions = createTransactionStore({ storage: null });
    await expect(executeAction({ action, rawInput: { vault }, capabilityContext: context(adapter), adapter, signer: {}, transactions })).resolves.toBe(receipt);
    expect(transactions.get().at(-1)).toMatchObject({ status: 'confirmed', txHash: '0xtx' });
  });

  test('accepts a curated SDK receipt that is already confirmed', async () => {
    const receipt = { hash: '0xreceipt', status: 1 };
    const adapter = { supports: () => true, execute: vi.fn(async () => receipt) };
    const transactions = createTransactionStore({ storage: null });
    await executeAction({ action, rawInput: { vault }, capabilityContext: context(adapter), adapter, signer: {}, transactions });
    expect(transactions.get().at(-1)).toMatchObject({ status: 'confirmed', txHash: '0xreceipt' });
  });

  test('passes exact non-18-decimal asset base units to the SDK adapter', async () => {
    const receipt = { hash: '0xreceipt', status: 1 };
    const adapter = { supports: () => true, execute: vi.fn(async () => receipt) };
    const rawInput = { assetId: '7', amount: '1.25', to: vault, issuerSig: `0x${'33'.repeat(65)}` };
    const getAmountDecimals = vi.fn(async () => 6);
    const capabilityContext = { ...context(adapter), object: { assetId: 7n }, getAmountDecimals };
    await executeAction({
      action: 'mint.initiate',
      rawInput,
      capabilityContext, adapter, signer: {}, transactions: createTransactionStore({ storage: null }),
    });
    expect(getAmountDecimals).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'mint.initiate', object: { assetId: 7n }, rawInput,
    }));
    expect(adapter.execute).toHaveBeenCalledWith('mint.initiate', expect.objectContaining({ assetId: 7n, amount: 1_250_000n }));
  });

  test('passes bridge adapter identity to the action-aware decimal resolver', async () => {
    const receipt = { hash: '0xreceipt', status: 1 };
    const adapter = { supports: () => true, execute: vi.fn(async () => receipt) };
    const rawInput = { vault, adapter: otherContract, amount: '1.25' };
    const getAmountDecimals = vi.fn(async () => 18);
    await executeAction({
      action: 'vault.bridge', rawInput, capabilityContext: { ...context(adapter), getAmountDecimals },
      adapter, signer: {}, transactions: createTransactionStore({ storage: null }),
    });
    expect(getAmountDecimals).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'vault.bridge', object: { vault }, rawInput,
    }));
    expect(adapter.execute).toHaveBeenCalledWith('vault.bridge', expect.objectContaining({ amount: 1_250_000_000_000_000_000n, adapter: otherContract }));
  });

  test('records wallet code 4001 as rejected and rethrows it', async () => {
    const rejected = Object.assign(new Error('no thanks'), { code: 4001 });
    const adapter = { supports: () => true, execute: vi.fn(async () => { throw rejected; }) };
    const transactions = createTransactionStore({ storage: null });
    await expect(executeAction({ action, rawInput: { vault }, capabilityContext: context(adapter), adapter, signer: {}, transactions })).rejects.toBe(rejected);
    expect(transactions.get().at(-1)).toMatchObject({ status: 'rejected', error: { code: 'walletRejected' } });
  });

  test('fails closed before the adapter is reached', async () => {
    const adapter = { supports: () => false, execute: vi.fn() };
    await expect(executeAction({ action, rawInput: { vault }, capabilityContext: context(adapter), adapter, signer: {}, transactions: createTransactionStore({ storage: null }) })).rejects.toMatchObject({ capability: { state: 'unsupportedDeployment' } });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  test('validation failure never reaches the adapter', async () => {
    const adapter = { supports: () => true, execute: vi.fn() };
    await expect(executeAction({ action, rawInput: { vault: '0x123' }, capabilityContext: context(adapter), adapter, signer: {}, transactions: createTransactionStore({ storage: null }) }))
      .rejects.toMatchObject({ code: 'invalidAddress' });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  test('binds ordinary transaction input to both object and route.params capability scopes', async () => {
    for (const capabilityContext of [
      context({ supports: () => true }),
      { ...context({ supports: () => true }), object: undefined, route: { params: { vault } } },
    ]) {
      const adapter = { supports: () => true, execute: vi.fn() };
      capabilityContext.adapter = adapter;
      const transactions = createTransactionStore({ storage: null });
      await expect(executeAction({ action, rawInput: { vault: otherContract }, capabilityContext, adapter, signer: {}, transactions }))
        .rejects.toMatchObject({ code: 'vaultMismatch', field: 'vault' });
      expect(adapter.execute).not.toHaveBeenCalled();
      expect(transactions.get()).toHaveLength(0);
    }
  });

  test('uses the same objectContext source as capability authorization', async () => {
    const adapter = { supports: () => true, execute: vi.fn(async () => ({ hash: '0xreceipt', status: 1 })) };
    const capabilityContext = { ...context(adapter), object: undefined, objectContext: { vault } };
    await expect(executeAction({
      action, rawInput: { vault }, capabilityContext, adapter, signer: {}, transactions: createTransactionStore({ storage: null }),
    })).resolves.toMatchObject({ hash: '0xreceipt' });
    expect(adapter.execute).toHaveBeenCalledOnce();
  });

  test.each([
    ['nav.sign', { vault: otherContract, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z' }, { vault }, 'vaultMismatch', 'vault'],
    ['settlement.instruction.sign', { vault: otherContract, instruction: instructionFor(otherContract), deadline: '2030-01-01T00:00:00Z' }, { vault }, 'vaultMismatch', 'vault'],
  ])('rejects %s route.params object mismatch before signing', async (actionId, rawInput, params, code, field) => {
    const signer = { signMessage: vi.fn() };
    const adapter = createSignatureCapabilityAdapter({ supports: () => false, execute: vi.fn() });
    const capabilityContext = { ...context(adapter), object: undefined, route: { params } };
    const transactions = createTransactionStore({ storage: null });
    await expect(executeSignatureAction({
      action: actionId, rawInput, capabilityContext, adapter, signer, transactions,
      signingContext: { chainId: 1, reservePsm, now: 1_700_000_000n },
    })).rejects.toMatchObject({ code, field });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(transactions.get()).toHaveLength(0);
  });

  test('rejects NAV signing on a cross-chain signing context before wallet interaction', async () => {
    const adapter = { supports: () => true };
    const signer = { signMessage: vi.fn() };
    const transactions = createTransactionStore({ storage: null });
    await expect(executeSignatureAction({
      action: 'nav.sign', rawInput: { vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z' },
      capabilityContext: context(adapter), adapter, signer, transactions,
      signingContext: { chainId: 2, now: 1_700_000_000n },
    })).rejects.toMatchObject({ code: 'crossChainPayload', field: 'chainId' });
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(transactions.get()).toHaveLength(0);
  });

  test('signs the legacy PSM authorization digest with the bound PSM contract and chain', async () => {
    const adapter = { supports: () => true };
    const signer = { signMessage: vi.fn().mockResolvedValue('0xsignature') };
    const capabilityContext = { ...context(adapter), object: { assetId: 1n } };
    const transactions = createTransactionStore({ storage: null });
    const result = await executeSignatureAction({
      action: 'psm.authorization.sign',
      rawInput: { assetId: '1', amount: '1', to: vault, documentId: `0x${'11'.repeat(32)}`, nonce: '0', expiry: '2030-01-01T00:00:00Z' },
      capabilityContext, adapter, signer, transactions,
      signingContext: { chainId: 1, reservePsm, now: 1_700_000_000n },
    });
    expect(signer.signMessage).toHaveBeenCalledOnce();
    expect(result.signature).toBe('0xsignature');
    expect(typeof result.digest).toBe('string');
  });

  test('binds settlement hashing to an SDK created for the configured Settlement contract', async () => {
    const adapter = createSignatureCapabilityAdapter({ supports: () => false, execute: vi.fn() });
    const capabilityContext = context(adapter);
    const foreignDeployment = {
      ...capabilityContext.deployment,
      addresses: { ...capabilityContext.deployment.addresses, settlement: otherContract },
    };
    const sdk = createReadSdk(foreignDeployment, { request: async () => { throw new Error('RPC should not be called'); } });
    const hashInstruction = vi.spyOn(sdk, 'hashInstruction');
    const signer = { signMessage: vi.fn() };
    const transactions = createTransactionStore({ storage: null });
    await expect(executeSignatureAction({
      action: 'settlement.instruction.sign',
      rawInput: { vault, instruction: instructionFor(vault), deadline: '2030-01-01T00:00:00Z' },
      capabilityContext, adapter, signer, transactions,
      signingContext: { chainId: 1, sdk, now: 1_700_000_000n },
    })).rejects.toMatchObject({ code: 'contractMismatch', field: 'settlement' });
    expect(hashInstruction).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(transactions.get()).toHaveLength(0);
  });

  test('uses one advertised built-in signature path and marks it signed only', async () => {
    const baseAdapter = { supports: () => false, execute: vi.fn() };
    const adapter = createSignatureCapabilityAdapter(baseAdapter);
    const capabilityContext = context(adapter);
    const signer = new Wallet('0x59c6995e998f97a5a0044976f094538a3e2f7a0d5bbfeb7e4b7a5b0525fbd3a5');
    const transactions = createTransactionStore({ storage: null });
    const result = await executeSignatureAction({
      action: 'nav.sign', rawInput: { vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z' },
      capabilityContext, adapter, signer, transactions, signingContext: { chainId: 1, now: 1_700_000_000n },
    });
    expect(result.digest).toBe(buildLegacyNavDigest({ vault, nav: 1_000_000n, dataTimestamp: 1_577_836_800n }));
    expect(transactions.get().at(-1)).toMatchObject({ status: 'signed' });
    expect(transactions.get().at(-1).status).not.toBe('confirmed');

    const genericTransactions = createTransactionStore({ storage: null });
    await expect(executeAction({
      action: 'nav.sign', rawInput: { vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z' },
      capabilityContext, adapter, signer, transactions: genericTransactions,
    })).rejects.toMatchObject({ code: 'signatureActionRequiresOfflineExecutor' });
    expect(baseAdapter.execute).not.toHaveBeenCalled();
    expect(genericTransactions.get()).toHaveLength(0);
  });

  test('rejects malformed conditional input before preparing a transaction', async () => {
    const adapter = { supports: () => true, execute: vi.fn() };
    const transactions = createTransactionStore({ storage: null });
    await expect(executeAction({
      action: 'vault.pause', rawInput: { vault, paused: true }, capabilityContext: context(adapter),
      adapter, signer: {}, transactions,
    })).rejects.toMatchObject({ code: 'pauseReasonRequired', field: 'reason' });
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(transactions.get()).toHaveLength(0);
  });

  test('persists only safe error codes and translation keys from hostile RPC errors', async () => {
    const rpcError = Object.assign(new Error('execution reverted transaction={ data: 0xdeadbeef, signature: 0xsecret }'), {
      code: 'CALL_EXCEPTION', reason: 'raw reason calldata=0xdeadbeef', info: { error: { provider: 'secret' } },
    });
    const adapter = { supports: () => true, execute: vi.fn(async () => { throw rpcError; }) };
    const storage = new Map();
    const transactions = createTransactionStore({ storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
    await expect(executeAction({ action, rawInput: { vault }, capabilityContext: context(adapter), adapter, signer: {}, transactions })).rejects.toBe(rpcError);
    expect(transactions.get().at(-1).error).toEqual({ code: 'contractReverted', messageKey: 'workspaces.errors.contractReverted' });
    const persisted = storage.get('hypertessera.workspace.transactions');
    expect(persisted).not.toMatch(/deadbeef|calldata|signature|secret|provider/i);
    expect(persisted).not.toMatch(/"(?:reason|detail|message)"\s*:/i);
  });

  test('enforces transaction transition legality and sanitizes persisted summaries', () => {
    const storage = new Map();
    const store = createTransactionStore({ storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
    const id = store.prepare('nav.sign', { signature: '0xsecret', instruction: { raw: 'nope' }, vault });
    expect(() => store.confirmed(id, {})).toThrow('Illegal transaction transition');
    store.awaitingWallet(id); store.signed(id, { signature: '0xsecret' });
    expect(storage.get('hypertessera.workspace.transactions')).not.toMatch(/signature|instruction|secret/i);
  });
});
