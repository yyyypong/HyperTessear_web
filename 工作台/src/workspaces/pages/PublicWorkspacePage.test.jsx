import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../i18n';
import { ROLE_DEFINITIONS } from '../config/roleDefinitions';
import { createTransactionStore, TransactionProvider } from '../core/transactionStore';
import { validateActionInput } from '../core/validators';
import { getWriteSigner } from '../core/walletRunner';
import PublicWorkspacePage from './PublicWorkspacePage';

let wallet;
let sdk;
let resolveDecimals;
const createReadSdk = vi.fn(() => sdk);
const currentAdapterTestHooks = vi.hoisted(() => ({ decorate: null }));

vi.mock('../../wallet', () => ({ useWallet: () => wallet }));
vi.mock('../core/createSdk', async importOriginal => ({
  ...await importOriginal(),
  createReadSdk: (...args) => createReadSdk(...args),
  createAmountDecimalsResolver: () => resolveDecimals,
}));
vi.mock('../core/walletRunner', async importOriginal => ({ ...await importOriginal(), getWriteSigner: vi.fn() }));
vi.mock('../sdk/currentAdapter', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    createCurrentAdapter: options => {
      const adapter = actual.createCurrentAdapter(options);
      return currentAdapterTestHooks.decorate?.(adapter) ?? adapter;
    },
  };
});

const account = '0x2222222222222222222222222222222222222222';
const other = '0x4444444444444444444444444444444444444444';
const zeroAddress = '0x0000000000000000000000000000000000000000';
const wrappedToken = '0x5555555555555555555555555555555555555555';
const underlying = '0x6666666666666666666666666666666666666666';
const addresses = {
  hyperAccessControl: '0x9bbefE25f656732015969778dF26e104D2394Bb8',
  stateManager: '0x2a9bb2053dD14b36652f1F6Bc2511b3Eb31b1DCd',
  assetRegistry: '0x50222D8849f44F90fCd911fC5f36387Db8EAD429',
  reservePSM: '0x67D10e814B57E381cE020697eF14CCDf922Dd654',
  queue: '0xCAd26BEF4ef0E71d2d54b11C1930df2F37bB1080',
  cashVault: '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea',
  noteVault: '0xf95F69488393d73D0cDbFB40e6D6B3494b832242',
  lpVault: '0x6AAAaAe6c30997D7c36E4297b0e44B3eC6126335',
};
const requestBoundaryActions = [
  { actionId: 'request.deposit.claim', sdkMethod: 'claimDeposit', receiver: true },
  { actionId: 'request.redeem.claim', sdkMethod: 'claimRedeem', receiver: true },
  { actionId: 'request.cancel', sdkMethod: 'cancelRequest', receiver: false },
  { actionId: 'request.refund.claim', sdkMethod: 'claimRefund', receiver: false },
];
const requestBoundaryCases = requestBoundaryActions.flatMap(({ actionId, sdkMethod, receiver }) => {
  const valid = { tranche: 'cash', requestId: '4', ...(receiver ? { receiver: other } : {}) };
  return [
    { label: `${actionId} invalid tranche`, actionId, sdkMethod, values: { ...valid, tranche: 'senior' } },
    { label: `${actionId} zero request id`, actionId, sdkMethod, values: { ...valid, requestId: '0' } },
    { label: `${actionId} leading-zero request id`, actionId, sdkMethod, values: { ...valid, requestId: '004' } },
    { label: `${actionId} overflowing request id`, actionId, sdkMethod, values: { ...valid, requestId: (1n << 256n).toString() } },
    ...(receiver ? [
      { label: `${actionId} invalid receiver`, actionId, sdkMethod, values: { ...valid, receiver: '0x123' } },
      { label: `${actionId} zero receiver`, actionId, sdkMethod, values: { ...valid, receiver: zeroAddress } },
    ] : []),
  ];
});

function makeSdk(overrides = {}) {
  const registerAsset = vi.fn().mockResolvedValue({ hash: '0xasset' });
  const assetRegistry = { getFunction: vi.fn(() => registerAsset) };
  const reserve = {
    assetConfig: vi.fn().mockResolvedValue([0, underlying, wrappedToken, true, other, false]),
    globalPaused: vi.fn().mockResolvedValue(false),
    wrappedTokenOf: vi.fn().mockResolvedValue(wrappedToken),
  };
  const queue = { isInQueue: vi.fn().mockResolvedValue(true) };
  const wrapped = { decimals: vi.fn().mockResolvedValue(18), balanceOf: vi.fn().mockResolvedValue(5_000_000_000_000_000_000n) };
  const underlyingToken = { decimals: vi.fn().mockResolvedValue(6) };
  const vault = { usdt: vi.fn().mockResolvedValue(underlying), decimals: vi.fn().mockResolvedValue(18) };
  const methods = Object.fromEntries('requestDeposit claimDeposit requestRedeem claimRedeem cancelRequest claimRefund wrap unwrap deployWrappedToken'.split(' ').map(name => [name, vi.fn().mockResolvedValue({ hash: `0x${name}` })]));
  return {
    addresses,
    ...methods,
    isVaultRegistered: vi.fn().mockResolvedValue(true),
    getStateContext: vi.fn().mockResolvedValue({ product: 3, cycle: 0, pause: 0, cycleNumber: 4n }),
    getAssetInfo: vi.fn().mockResolvedValue({ active: true, token: underlying, owner: other }),
    getContract: vi.fn((name, address) => {
      if (name === 'AssetRegistry') return assetRegistry;
      if (name === 'ReservePSM') return reserve;
      if (name === 'Queue') return queue;
      if (name === 'WrappedAsset') return wrapped;
      if (name === 'RWAToken') return underlyingToken;
      if (name === 'EarnVault' || name === 'LiquidityEarnVault') return vault;
      throw new Error(`Unexpected contract ${name}:${address}`);
    }),
    registerAsset,
    reserve,
    queue,
    wrapped,
    vault,
    ...overrides,
  };
}

function renderPublic(store = createTransactionStore({ storage: null })) {
  return render(
    <LocaleProvider>
      <TransactionProvider store={store}>
        <MemoryRouter initialEntries={['/workspaces/public']}>
          <PublicWorkspacePage />
        </MemoryRouter>
      </TransactionProvider>
    </LocaleProvider>,
  );
}

function actionPanel(actionId) {
  return screen.getByTestId(`public-action-${actionId}`);
}

function fill(panel, values) {
  for (const [name, value] of Object.entries(values)) {
    const control = panel.querySelector(`[name="${name}"]`);
    if (!control) throw new Error(`Missing control ${name}`);
    fireEvent.change(control, { target: { value: String(value) } });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

async function submit(actionId, values) {
  const panel = actionPanel(actionId);
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
  fill(panel, values);
  await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
  return panel;
}

beforeEach(() => {
  localStorage.setItem('hyt.locale', 'en');
  currentAdapterTestHooks.decorate = null;
  sdk = makeSdk();
  resolveDecimals = vi.fn(async ({ actionId }) => {
    if (actionId === 'request.redeem' || actionId === 'wrapper.unwrap') return 18;
    return 6;
  });
  createReadSdk.mockClear();
  const provider = {
    request: vi.fn(async ({ method }) => method === 'eth_chainId' ? '0x61' : method === 'eth_accounts' ? [account] : null),
  };
  wallet = { session: { address: account, chainId: 97, provider }, switchChain: vi.fn() };
  vi.mocked(getWriteSigner).mockReset().mockResolvedValue({ getAddress: async () => account });
});

afterEach(() => {
  currentAdapterTestHooks.decorate = null;
  localStorage.clear();
  cleanup();
});

describe('permissionless public workspace', () => {
  it('presents creators and user operations as public functions without adding role identities', () => {
    renderPublic();
    expect(screen.getByRole('heading', { name: 'Asset Creator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vault Creator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wrapper Creator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Regular user operations' })).toBeInTheDocument();
    expect(Object.keys(ROLE_DEFINITIONS)).toHaveLength(15);
    expect(ROLE_DEFINITIONS).not.toHaveProperty('asset-creator');
    expect(ROLE_DEFINITIONS).not.toHaveProperty('vault-creator');
    expect(ROLE_DEFINITIONS).not.toHaveProperty('wrapper-creator');
  });

  it('keeps Vault and permissionless Wrapper creation target-only and performs zero provider or SDK writes', async () => {
    renderPublic();
    expect(within(actionPanel('vault.create')).getByRole('button')).toBeDisabled();
    expect(within(actionPanel('wrapper.create')).getByRole('button')).toBeDisabled();
    expect(actionPanel('vault.create')).toHaveTextContent(/factory mapping.*not available/i);
    expect(actionPanel('wrapper.create')).toHaveTextContent(/legacy deployment requires Governor/i);
    expect(wallet.session.provider.request).not.toHaveBeenCalled();
    expect(sdk.deployWrappedToken).not.toHaveBeenCalled();
  });

  it('registers an Asset through the exact permissionless AssetRegistry tuple without a role lookup', async () => {
    renderPublic();
    const panel = await submit('asset.register', {
      assetMetadata: JSON.stringify({ metadataHash: `0x${'11'.repeat(32)}`, name: 'Asset Seven', symbol: 'SEV', decimals: 6 }),
    });
    await waitFor(() => expect(sdk.registerAsset).toHaveBeenCalledWith(`0x${'11'.repeat(32)}`, 'Asset Seven', 'SEV', 6n));
    expect(panel).toHaveTextContent(/Action submitted/i);
  });

  it.each([
    ['request.deposit', { tranche: 'cash', assets: '1.25', owner: account }, 'requestDeposit', ['cash', 1_250_000n, account]],
    ['request.deposit.claim', { tranche: 'cash', requestId: '4', receiver: other }, 'claimDeposit', ['cash', 4n, other]],
    ['request.redeem', { tranche: 'lp', shares: '1.25', owner: account }, 'requestRedeem', ['lp', 1_250_000_000_000_000_000n, account]],
    ['request.redeem.claim', { tranche: 'lp', requestId: '4', receiver: other }, 'claimRedeem', ['lp', 4n, other]],
    ['request.cancel', { tranche: 'note', requestId: '4' }, 'cancelRequest', ['note', 4n]],
    ['request.refund.claim', { tranche: 'note', requestId: '4' }, 'claimRefund', ['note', 4n]],
    ['wrapper.wrap', { assetId: '7', amount: '1.25', to: other }, 'wrap', [7n, 1_250_000n, other]],
    ['wrapper.unwrap', { assetId: '7', amount: '1.25', to: other }, 'unwrap', [7n, 1_250_000_000_000_000_000n, other]],
  ])('executes %s through the exact current SDK argument order', async (actionId, values, sdkMethod, expected) => {
    renderPublic();
    await submit(actionId, values);
    await waitFor(() => expect(sdk[sdkMethod]).toHaveBeenCalledOnce());
    expect(sdk[sdkMethod].mock.calls[0].slice(0, -1)).toEqual(expected);
    expect(sdk[sdkMethod].mock.calls[0].at(-1)).toEqual(expect.objectContaining({ getAddress: expect.any(Function) }));
  });

  it('validates the exact tranche set and canonical positive request IDs', () => {
    expect(validateActionInput('request.cancel', { tranche: 'cash', requestId: '4' })).toEqual({ tranche: 'cash', requestId: 4n });
    for (const tranche of ['', 'Cash', 'senior', '3']) {
      expect(() => validateActionInput('request.cancel', { tranche, requestId: '4' })).toThrow();
    }
    for (const requestId of ['0', '00', '004', '-1', '1.5', (1n << 256n).toString()]) {
      expect(() => validateActionInput('request.cancel', { tranche: 'cash', requestId })).toThrow();
    }
  });

  it.each([
    ['request.cancel', { tranche: 'cash', requestId: '004' }],
    ['wrapper.wrap', { assetId: '007', amount: '1', to: other }],
    ['request.deposit', { tranche: 'cash', assets: '1', owner: '0x123' }],
    ['request.deposit', { tranche: 'cash', assets: '1', owner: zeroAddress }],
    ['request.deposit.claim', { tranche: 'cash', requestId: '4', receiver: zeroAddress }],
    ['wrapper.wrap', { assetId: '7', amount: '1', to: zeroAddress }],
    ['wrapper.unwrap', { assetId: '7', amount: '1', to: '0x123' }],
  ])('rejects noncanonical public object input for %s before wallet, signer, transaction, or write work', async (actionId, values) => {
    const store = createTransactionStore({ storage: null });
    renderPublic(store);
    wallet.session.provider.request.mockClear();
    fill(actionPanel(actionId), values);
    await userEvent.click(within(actionPanel(actionId)).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(actionPanel(actionId)).toHaveTextContent(/could not be submitted/i));
    expect(wallet.session.provider.request).not.toHaveBeenCalled();
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(store.get()).toHaveLength(0);
    expect(sdk.cancelRequest).not.toHaveBeenCalled();
    expect(sdk.wrap).not.toHaveBeenCalled();
  });

  it.each(requestBoundaryCases)('$label performs zero provider, signer, transaction, and corresponding SDK work', async ({ actionId, sdkMethod, values }) => {
    const store = createTransactionStore({ storage: null });
    renderPublic(store);
    wallet.session.provider.request.mockClear();
    fill(actionPanel(actionId), values);
    await userEvent.click(within(actionPanel(actionId)).getByRole('button', { name: 'Execute action' }));
    if (values.tranche === 'senior') {
      expect(actionPanel(actionId).querySelector('[name="tranche"]')).toHaveAttribute('aria-invalid', 'true');
    } else {
      await waitFor(() => expect(actionPanel(actionId)).toHaveTextContent(/could not be submitted/i));
    }

    expect(wallet.session.provider.request).not.toHaveBeenCalled();
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(store.get()).toHaveLength(0);
    expect(sdk[sdkMethod]).not.toHaveBeenCalled();
  });

  it.each([
    ['request.deposit', { tranche: 'cash', assets: '1', owner: account }, { product: 3, cycle: 0, pause: 1, cycleNumber: 4n }, 'requestDeposit'],
    ['request.redeem', { tranche: 'cash', shares: '1', owner: account }, { product: 1, cycle: 0, pause: 0, cycleNumber: 4n }, 'requestRedeem'],
  ])('fails %s closed on live pause or lifecycle mismatch before signer and write', async (actionId, input, state, sdkMethod) => {
    sdk.getStateContext.mockResolvedValue(state);
    renderPublic();
    await submit(actionId, input);
    await waitFor(() => expect(actionPanel(actionId)).toHaveTextContent(/could not be submitted/i));
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk[sdkMethod]).not.toHaveBeenCalled();
  });

  it('fails cancellation closed when the request is absent from both current queues', async () => {
    sdk.queue.isInQueue.mockResolvedValue(false);
    renderPublic();
    await submit('request.cancel', { tranche: 'cash', requestId: '4' });
    await waitFor(() => expect(actionPanel('request.cancel')).toHaveTextContent(/could not be submitted/i));
    expect(sdk.queue.isInQueue).toHaveBeenCalledTimes(2);
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.cancelRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['missing underlying', [0, zeroAddress, wrappedToken, false, other, false], false],
    ['missing wrapped token', [0, underlying, zeroAddress, false, other, false], false],
    ['wrong mode', [1, underlying, wrappedToken, false, other, false], false],
    ['asset paused', [0, underlying, wrappedToken, false, other, true], false],
    ['protocol paused', [0, underlying, wrappedToken, false, other, false], true],
  ])('fails wrap closed with zero signer/write work when PSM config is %s', async (_label, config, globallyPaused) => {
    sdk.reserve.assetConfig.mockResolvedValue(config);
    sdk.reserve.globalPaused.mockResolvedValue(globallyPaused);
    renderPublic();
    await submit('wrapper.wrap', { assetId: '7', amount: '1', to: other });
    await waitFor(() => expect(actionPanel('wrapper.wrap')).toHaveTextContent(/could not be submitted/i));
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.wrap).not.toHaveBeenCalled();
  });

  it('requires a full live WrappedAsset balance when partial unwrap is disabled', async () => {
    sdk.reserve.assetConfig.mockResolvedValue([0, underlying, wrappedToken, false, other, false]);
    sdk.wrapped.balanceOf.mockResolvedValue(500_000_000n);
    renderPublic();
    await submit('wrapper.unwrap', { assetId: '7', amount: '1.25', to: other });
    await waitFor(() => expect(actionPanel('wrapper.unwrap')).toHaveTextContent(/could not be submitted/i));
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.unwrap).not.toHaveBeenCalled();
  });

  it.each([
    ['disconnected', { address: null, chainId: null, provider: null }],
    ['wrong network', { address: account, chainId: 1, provider: { request: vi.fn() } }],
  ])('does no SDK or RPC work while %s', async (_label, session) => {
    wallet.session = session;
    renderPublic();
    expect(createReadSdk).not.toHaveBeenCalled();
    expect(within(actionPanel('asset.register')).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    if (session.provider) expect(session.provider.request).not.toHaveBeenCalled();
    expect(sdk.registerAsset).not.toHaveBeenCalled();
  });

  it('rejects an account/signer race before the SDK write', async () => {
    wallet.session.provider.request.mockImplementation(async ({ method }) => method === 'eth_chainId' ? '0x61' : method === 'eth_accounts' ? [other] : null);
    renderPublic();
    await submit('asset.register', {
      assetMetadata: JSON.stringify({ metadataHash: `0x${'11'.repeat(32)}`, name: 'Asset Seven', symbol: 'SEV', decimals: 6 }),
    });
    await waitFor(() => expect(actionPanel('asset.register')).toHaveTextContent(/could not be submitted/i));
    expect(sdk.registerAsset).not.toHaveBeenCalled();
  });

  it('invalidates an older same-identity operation before it can reach signer or write work', async () => {
    let releaseFirstChain;
    let chainCalls = 0;
    wallet.session.provider.request.mockImplementation(({ method }) => {
      if (method === 'eth_chainId' && ++chainCalls === 1) return new Promise(resolve => { releaseFirstChain = resolve; });
      if (method === 'eth_chainId') return Promise.resolve('0x61');
      if (method === 'eth_accounts') return Promise.resolve([account]);
      return Promise.resolve(null);
    });
    renderPublic();
    const panel = actionPanel('asset.register');
    fill(panel, { assetMetadata: JSON.stringify({ metadataHash: `0x${'11'.repeat(32)}`, name: 'Asset Seven', symbol: 'SEV', decimals: 6 }) });
    const form = panel.querySelector('form');
    fireEvent.submit(form);
    await waitFor(() => expect(releaseFirstChain).toBeTypeOf('function'));
    fireEvent.submit(form);
    await waitFor(() => expect(sdk.registerAsset).toHaveBeenCalledOnce());
    releaseFirstChain('0x61');
    await waitFor(() => expect(within(panel).getByText(/could not be submitted/i)).toBeInTheDocument());
    expect(sdk.registerAsset).toHaveBeenCalledOnce();
    expect(getWriteSigner).toHaveBeenCalledOnce();
  });

  it('invalidates operation A while its adapter is awaiting Vault registration and lets same-identity B write once', async () => {
    const held = deferred();
    const started = deferred();
    let registrationReads = 0;
    sdk.isVaultRegistered.mockImplementation(() => {
      registrationReads += 1;
      if (registrationReads === 7) {
        started.resolve();
        return held.promise;
      }
      return Promise.resolve(true);
    });
    const store = createTransactionStore({ storage: null });
    renderPublic(store);
    const panel = actionPanel('request.deposit');
    fill(panel, { tranche: 'cash', assets: '1.25', owner: account });
    const form = panel.querySelector('form');

    fireEvent.submit(form);
    await started.promise;
    expect(store.get()[0]?.status).toBe('awaitingWallet');
    fireEvent.submit(form);
    await waitFor(() => expect(sdk.requestDeposit).toHaveBeenCalledOnce());
    held.resolve(true);

    await waitFor(() => expect(store.get()[0]?.status).toBe('failed'));
    expect(store.get()[0]?.txHash).toBeUndefined();
    expect(sdk.requestDeposit).toHaveBeenCalledOnce();
  });

  it('rejects operation A when the chain changes during its adapter Queue read', async () => {
    const held = deferred();
    const started = deferred();
    let queueReads = 0;
    let liveChain = '0x61';
    wallet.session.provider.request.mockImplementation(async ({ method }) => {
      if (method === 'eth_chainId') return liveChain;
      if (method === 'eth_accounts') return [account];
      return null;
    });
    sdk.queue.isInQueue.mockImplementation(() => {
      queueReads += 1;
      if (queueReads === 9) {
        started.resolve();
        return held.promise;
      }
      return Promise.resolve(true);
    });
    const store = createTransactionStore({ storage: null });
    renderPublic(store);

    const pending = submit('request.cancel', { tranche: 'cash', requestId: '4' });
    await started.promise;
    expect(store.get()[0]?.status).toBe('awaitingWallet');
    liveChain = '0x1';
    held.resolve(true);
    await pending;

    await waitFor(() => expect(store.get()[0]?.status).toBe('failed'));
    expect(store.get()[0]?.txHash).toBeUndefined();
    expect(sdk.cancelRequest).not.toHaveBeenCalled();
  });

  it('rejects operation A when the account changes after page verification during its adapter ReservePSM preflight', async () => {
    const held = deferred();
    const started = deferred();
    let liveAccount = account;
    let accountReads = 0;
    let currentAdapterEntered = false;
    let earlierPageAccountVerificationCompleted = false;
    let heldCurrentAdapterConfig = false;
    wallet.session.provider.request.mockImplementation(async ({ method }) => {
      if (method === 'eth_chainId') return '0x61';
      if (method === 'eth_accounts') {
        accountReads += 1;
        return [liveAccount];
      }
      return null;
    });
    currentAdapterTestHooks.decorate = adapter => ({
      ...adapter,
      execute(actionId, input, executionControl) {
        if (actionId === 'wrapper.wrap') {
          currentAdapterEntered = true;
          earlierPageAccountVerificationCompleted = accountReads >= 2;
        }
        return adapter.execute(actionId, input, executionControl);
      },
    });
    sdk.reserve.assetConfig.mockImplementation(() => {
      if (currentAdapterEntered && !heldCurrentAdapterConfig) {
        heldCurrentAdapterConfig = true;
        started.resolve();
        return held.promise;
      }
      return Promise.resolve([0, underlying, wrappedToken, true, other, false]);
    });
    const store = createTransactionStore({ storage: null });
    renderPublic(store);

    const pending = submit('wrapper.wrap', { assetId: '7', amount: '1.25', to: other });
    await started.promise;
    expect(earlierPageAccountVerificationCompleted).toBe(true);
    expect(accountReads).toBeGreaterThanOrEqual(2);
    expect(store.get()[0]?.status).toBe('awaitingWallet');
    liveAccount = other;
    held.resolve([0, underlying, wrappedToken, true, other, false]);
    await pending;

    await waitFor(() => expect(store.get()[0]?.status).toBe('failed'));
    expect(store.get()[0]?.txHash).toBeUndefined();
    expect(sdk.wrap).not.toHaveBeenCalled();
  });

  it('invalidates operation A while its adapter is awaiting WrappedAsset balance and lets same-identity B write once', async () => {
    const held = deferred();
    const started = deferred();
    let balanceReads = 0;
    sdk.wrapped.balanceOf.mockImplementation(() => {
      balanceReads += 1;
      if (balanceReads === 3) {
        started.resolve();
        return held.promise;
      }
      return Promise.resolve(5_000_000_000_000_000_000n);
    });
    const store = createTransactionStore({ storage: null });
    renderPublic(store);
    const panel = actionPanel('wrapper.unwrap');
    fill(panel, { assetId: '7', amount: '1.25', to: other });
    const form = panel.querySelector('form');

    fireEvent.submit(form);
    await started.promise;
    expect(store.get()[0]?.status).toBe('awaitingWallet');
    fireEvent.submit(form);
    await waitFor(() => expect(sdk.unwrap).toHaveBeenCalledOnce());
    held.resolve(5_000_000_000_000_000_000n);

    await waitFor(() => expect(store.get()[0]?.status).toBe('failed'));
    expect(store.get()[0]?.txHash).toBeUndefined();
    expect(sdk.unwrap).toHaveBeenCalledOnce();
  });
});
