import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { Wallet } from 'ethers';
import { LocaleProvider } from '../../i18n';
import { createTransactionStore, TransactionProvider } from '../core/transactionStore';
import { ROLE_DEFINITIONS } from '../config/roleDefinitions';
import { getWriteSigner } from '../core/walletRunner';
import RoleWorkspacePage from './RoleWorkspacePage';

let wallet;
let sdk;
const createReadSdk = vi.fn(() => sdk);

vi.mock('../../wallet', () => ({ useWallet: () => wallet }));
vi.mock('../core/createSdk', async importOriginal => ({
  ...await importOriginal(),
  createReadSdk: (...args) => createReadSdk(...args),
  createAmountDecimalsResolver: () => async () => 18,
  getSdkDeploymentBinding: value => value === sdk ? { chainId: 97, settlement: addresses.settlement, reservePSM: addresses.reservePSM, lpAdapter: addresses.lpAdapter } : null,
}));
vi.mock('../core/walletRunner', async importOriginal => ({ ...await importOriginal(), getWriteSigner: vi.fn() }));

const addresses = {
  cashVault: '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea', noteVault: '0xf95F69488393d73D0cDbFB40e6D6B3494b832242', lpVault: '0x6AAAaAe6c30997D7c36E4297b0e44B3eC6126335',
  cashAdapter: '0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4', noteAdapter: '0x7ddFB27c9AC47265Fd861A092050c0041A54067c', lpAdapter: '0xeEdBb2E9Baae30f450a9D2Ce35286d7CcF132ba1',
  hyperAccessControl: '0x9bbefE25f656732015969778dF26e104D2394Bb8', stateManager: '0x2a9bb2053dD14b36652f1F6Bc2511b3Eb31b1DCd', reservePSM: '0x67D10e814B57E381cE020697eF14CCDf922Dd654', settlement: '0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c',
  claimRegistry: '0x3333333333333333333333333333333333333333',
};
const accountA = '0x2222222222222222222222222222222222222222';
const accountB = '0x4444444444444444444444444444444444444444';
const unconfiguredVault = '0x5555555555555555555555555555555555555555';

function makeSdk({ product = 0, cycle = 0, pause = 0 } = {}) {
  const contract = name => name === 'StateManager'
    ? { modulePaused: vi.fn().mockResolvedValue(false) }
    : name === 'ReservePSM' ? { globalPaused: vi.fn().mockResolvedValue(false) } : {};
  return {
    addresses,
    isVaultRegistered: vi.fn().mockResolvedValue(true), isVaultActive: vi.fn().mockResolvedValue(pause === 0),
    getStateContext: vi.fn().mockResolvedValue({ product, cycle, pause, cycleNumber: 8n }),
    getNAV: vi.fn().mockResolvedValue({ nav: 1_000_000n, dataTimestamp: 1n, updatedAt: 2n }), isNAVFresh: vi.fn().mockResolvedValue(true),
    isOperator: vi.fn().mockResolvedValue(true), threshold: vi.fn().mockResolvedValue(2n), hasRole: vi.fn().mockResolvedValue(true),
    pending: vi.fn().mockResolvedValue(1n), availableToDistribute: vi.fn().mockResolvedValue(2n), totalPending: vi.fn().mockResolvedValue(3n),
    getContract: vi.fn(contract),
    openSubscription: vi.fn().mockResolvedValue({ hash: '0xopen', status: 1 }), finalizeSubscription: vi.fn().mockResolvedValue({ hash: '0xfinalize', status: 1 }), startCycleCalculation: vi.fn().mockResolvedValue({ hash: '0xcalculate', status: 1 }), enterFinalSettlement: vi.fn().mockResolvedValue({ hash: '0xsettle', status: 1 }), enterMaturing: vi.fn().mockResolvedValue({ hash: '0xmature', status: 1 }), enterClaiming: vi.fn().mockResolvedValue({ hash: '0xclaim', status: 1 }), closeProduct: vi.fn().mockResolvedValue({ hash: '0xclose', status: 1 }),
    hashInstruction: vi.fn().mockResolvedValue(`0x${'33'.repeat(32)}`), submitBatch: vi.fn(),
  };
}

function roleTree(roleId, object = addresses.cashVault, store) {
  const role = ROLE_DEFINITIONS[roleId];
  const path = role.path.replace(':vault', object).replace(':assetId', object).replace(':adapter', object);
  return (
    <LocaleProvider><TransactionProvider store={store}><MemoryRouter initialEntries={[path]}><Routes>
      <Route path={role.path} element={<RoleWorkspacePage roleId={roleId} />} />
    </Routes></MemoryRouter></TransactionProvider></LocaleProvider>
  );
}

function renderRole(roleId, object = addresses.cashVault, store) {
  return render(roleTree(roleId, object, store));
}

async function expandAction(actionId) {
  const host = screen.getAllByTestId('workspace-action').find(node => node.dataset.actionId === actionId);
  expect(host).toBeTruthy();
  const summary = host.querySelector('.ws-accordion-item__summary');
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
  return within(host).getByTestId(`workspace-action-${actionId}`);
}

async function executeKeeper(actionId = 'lifecycle.open-subscription') {
  const panel = await expandAction(actionId);
  const vaultInput = within(panel).getByLabelText(/Vault/i);
  await userEvent.clear(vaultInput);
  await userEvent.type(vaultInput, addresses.cashVault);
  await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
}

const expected = {
  governor: ['governor.members.manage', 'protocol.modules.pause', 'psm.protocol.pause', 'revenue.treasury.set'],
  'vault-owner': ['vault.roles.set', 'vault.settlement.configure', 'vault.modules.bind', 'vault.adapters.configure', 'vault.timelock.manage', 'vault.owner.transfer'],
  curator: ['vault.fees.set', 'vault.adapters.manage', 'vault.orders.manage', 'vault.data-policy.set'],
  guardian: ['vault.pause', 'vault.order.cancel', 'vault.allocator.freeze', 'vault.timelock.cancel'],
  allocator: ['vault.buy', 'vault.sell', 'vault.rebalance', 'vault.deal.clear', 'vault.bridge'],
  'settlement-operator': ['settlement.instruction.sign'],
  keeper: ['lifecycle.open-subscription', 'lifecycle.finalize-subscription', 'lifecycle.start-calculation', 'lifecycle.enter-final-settlement', 'lifecycle.enter-maturing', 'lifecycle.enter-claiming', 'lifecycle.close-product', 'request.mark-refundable', 'claim.record'],
};

beforeEach(() => {
  localStorage.setItem('hyt.locale', 'en');
  createReadSdk.mockClear();
  sdk = makeSdk();
  const provider = { request: vi.fn(async ({ method }) => method === 'eth_chainId' ? '0x61' : method === 'eth_accounts' ? [wallet.session.address] : null) };
  wallet = { session: { address: accountA, chainId: 97, provider }, switchChain: vi.fn() };
  vi.mocked(getWriteSigner).mockReset().mockResolvedValue({ getAddress: async () => wallet.session.address });
});
afterEach(cleanup);

describe('RoleWorkspacePage', () => {
  it.each(Object.entries(expected))('renders the exact %s action set from the registry', async (roleId, actionIds) => {
    renderRole(roleId);
    expect(screen.getByRole('heading', { name: roleId === 'vault-owner' ? 'Vault Owner' : roleId === 'settlement-operator' ? 'Settlement Operator' : roleId[0].toUpperCase() + roleId.slice(1) })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(actionIds.length));
    expect(screen.getAllByTestId('workspace-action').map(node => node.dataset.actionId)).toEqual(actionIds);
    if (roleId !== 'governor') expect(screen.getAllByText(addresses.cashVault).length).toBeGreaterThan(0);
  });

  it('labels target-only actions with the missing target module while preserving legacy badges', async () => {
    renderRole('curator');
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(expected.curator.length));
    const target = await expandAction('vault.adapters.manage');
    expect(within(target).getByText((_, node) => node.classList?.contains('ws-action-panel__detail') && node.textContent.includes('module: AdapterRegistry'))).toBeInTheDocument();
    expect(within(target).getByText('manageVaultAdapter')).toBeInTheDocument();
    expect(target.querySelector('.ws-support-badge')).toHaveTextContent('Target');
    const legacy = await expandAction('vault.fees.set');
    expect(within(legacy).getByText('Legacy Compatible')).toBeInTheDocument();
    expect(legacy.querySelector('.ws-support-badge')).toHaveTextContent('Legacy Compatible');
  });

  it('enables only the keeper transition allowed by the current product and cycle state', async () => {
    sdk = makeSdk({ product: 0, cycle: 0 });
    renderRole('keeper');
    const openPanel = await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(within(openPanel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    const finalizePanel = await expandAction('lifecycle.finalize-subscription');
    await waitFor(() => expect(within(finalizePanel).getByRole('button', { name: 'Execute action' })).toBeDisabled());
  });

  it.each([
    [0, 0, ['lifecycle.open-subscription']],
    [1, 0, ['lifecycle.finalize-subscription']],
    [2, 0, ['request.mark-refundable']],
    [3, 0, ['lifecycle.start-calculation', 'lifecycle.enter-final-settlement']],
    [3, 1, ['lifecycle.enter-final-settlement']],
    [4, 0, ['lifecycle.enter-maturing']],
    [5, 0, ['lifecycle.enter-claiming']],
    [6, 0, ['lifecycle.close-product', 'claim.record']],
    [7, 0, []],
  ])('uses the exact keeper enum gates for product %s and cycle %s', async (product, cycle, enabled) => {
    sdk = makeSdk({ product, cycle });
    renderRole('keeper');
    const actionIds = expected.keeper;
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(actionIds.length));
    for (const actionId of actionIds) {
      const panel = await expandAction(actionId);
      const button = within(panel).getByRole('button', { name: 'Execute action' });
      if (enabled.includes(actionId)) expect(button).toBeEnabled();
      else expect(button).toBeDisabled();
    }
  });

  it('presents an enum-allowed Keeper transition as state-eligible with final preconditions left onchain', async () => {
    renderRole('keeper');
    const open = await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(within(open).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    expect(within(open).getByRole('status')).toHaveTextContent('State-eligible');
    expect(within(open).getByText(/timestamp and other preconditions are validated onchain at execution/i)).toBeInTheDocument();
  });

  it('renders settlement signing only and never the batch submit action', async () => {
    renderRole('settlement-operator');
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(1));
    expect(screen.queryByTestId('workspace-action-settlement.batch.submit')).not.toBeInTheDocument();
    const panel = await expandAction('settlement.instruction.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
  });

  it('does not create an SDK or read RPC for malformed vault routes', () => {
    renderRole('keeper', 'not-an-address');
    expect(screen.getByRole('heading', { name: 'Keeper' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i);
    expect(createReadSdk).not.toHaveBeenCalled();
    expect(sdk.getStateContext).not.toHaveBeenCalled();
  });

  it('does not create an SDK or read RPC on the wrong network but offers chain switching', async () => {
    wallet.session.chainId = 1;
    renderRole('keeper');
    expect(createReadSdk).not.toHaveBeenCalled();
    expect(sdk.getStateContext).not.toHaveBeenCalled();
    const panel = await expandAction('lifecycle.open-subscription');
    const switchButton = within(panel).getByRole('button', { name: 'Switch network' });
    switchButton.click();
    expect(wallet.switchChain).toHaveBeenCalledWith(97);
  });

  it('keeps every action disabled while the wallet is disconnected', async () => {
    wallet = { session: null, switchChain: vi.fn(), openModal: vi.fn() };
    renderRole('keeper');

    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(expected.keeper.length));
    for (const actionId of expected.keeper) {
      const panel = await expandAction(actionId);
      expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    }
    expect(createReadSdk).not.toHaveBeenCalled();
    expect(getWriteSigner).not.toHaveBeenCalled();
  });

  it('keeps a Task 10 role localized while rejecting a malformed route before any action or SDK read', () => {
    renderRole('nav-signer', 'malformed-legacy-sample');
    expect(screen.getByRole('heading', { name: 'NAV Signer' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid vault/i);
    expect(screen.queryByTestId('workspace-action')).not.toBeInTheDocument();
    expect(createReadSdk).not.toHaveBeenCalled();
  });

  it('keeps target-only controls disabled without invoking an execution boundary', async () => {
    renderRole('vault-owner');
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(expected['vault-owner'].length));
    const panel = await expandAction('vault.owner.transfer');
    const button = within(panel).getByRole('button', { name: 'Execute action' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(sdk.openSubscription).not.toHaveBeenCalled();
  });

  it('keeps a registered but unconfigured vault read-only before signer or SDK execution', async () => {
    renderRole('keeper', unconfiguredVault);
    const lifecycleActions = expected.keeper.slice(0, 7);
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(expected.keeper.length));
    for (const actionId of lifecycleActions) {
      const panel = await expandAction(actionId);
      expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    }
    const openPanel = await expandAction('lifecycle.open-subscription');
    fireEvent.submit(within(openPanel).getByRole('button', { name: 'Execute action' }).closest('form'));
    expect(getWriteSigner).not.toHaveBeenCalled();
    lifecycleActions.forEach((_, index) => {
      const method = ['openSubscription', 'finalizeSubscription', 'startCycleCalculation', 'enterFinalSettlement', 'enterMaturing', 'enterClaiming', 'closeProduct'][index];
      expect(sdk[method]).not.toHaveBeenCalled();
    });
  });

  it('authorizes the provider current account and fails before signer when it is no longer authorized', async () => {
    renderRole('keeper');
    const open = await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(within(open).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    sdk.hasRole.mockImplementation(async (_role, account) => account.toLowerCase() === accountA.toLowerCase());
    wallet.session.provider.request.mockImplementation(async ({ method }) => method === 'eth_chainId' ? '0x61' : method === 'eth_accounts' ? [accountB] : null);

    await executeKeeper();
    await waitFor(() => expect(sdk.hasRole).toHaveBeenCalledWith(expect.any(String), accountB));
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.openSubscription).not.toHaveBeenCalled();
  });

  it('rejects a signer whose canonical address differs from the freshly authorized provider account', async () => {
    renderRole('keeper');
    const open = await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(within(open).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    vi.mocked(getWriteSigner).mockResolvedValue({ getAddress: async () => accountB });

    await executeKeeper();
    await waitFor(() => expect(getWriteSigner).toHaveBeenCalledOnce());
    expect(sdk.openSubscription).not.toHaveBeenCalled();
  });

  it('executes a configured Keeper transition only with the freshly bound provider account and signer', async () => {
    const signer = { getAddress: vi.fn().mockResolvedValue(accountA) };
    vi.mocked(getWriteSigner).mockResolvedValue(signer);
    renderRole('keeper');
    const open = await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(within(open).getByRole('button', { name: 'Execute action' })).toBeEnabled());

    await executeKeeper();

    await waitFor(() => expect(within(open).getByText('Action submitted.')).toBeInTheDocument());
    expect(wallet.session.provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' });
    expect(signer.getAddress).toHaveBeenCalledOnce();
    expect(sdk.openSubscription).toHaveBeenCalledWith(addresses.cashVault, signer);
  });

  it('refreshes live chain, state and authorization before requesting a signer', async () => {
    renderRole('keeper');
    await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled());

    sdk.getStateContext.mockResolvedValue({ product: 1, cycle: 0, pause: 0, cycleNumber: 8n });
    await executeKeeper();
    await waitFor(() => expect(sdk.getStateContext.mock.calls.length).toBeGreaterThan(1));
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.openSubscription).not.toHaveBeenCalled();

    sdk.getStateContext.mockResolvedValue({ product: 0, cycle: 0, pause: 0, cycleNumber: 8n });
    sdk.hasRole.mockResolvedValue(false);
    await executeKeeper();
    expect(getWriteSigner).not.toHaveBeenCalled();

    sdk.hasRole.mockResolvedValue(true);
    wallet.session.provider.request.mockImplementation(async ({ method }) => method === 'eth_chainId' ? '0x1' : method === 'eth_accounts' ? [accountA] : null);
    await executeKeeper();
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.openSubscription).not.toHaveBeenCalled();
  });

  it('signs a settlement payload to terminal signed state without submitting a batch', async () => {
    const signer = new Wallet('0x59c6995e998f97a5a0044976f094538a3e2f7a0d5bbfeb7e4b7a5b0525fbd3a5');
    wallet.session.address = signer.address;
    vi.mocked(getWriteSigner).mockResolvedValue(signer);
    const store = createTransactionStore({ storage: null });
    renderRole('settlement-operator', addresses.cashVault, store);
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(1));
    const panel = await expandAction('settlement.instruction.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
    const deadline = '2030-01-01T00:00';
    const instruction = {
      vaultSettlements: [{ distribution: { vault: addresses.cashVault, amount: '1' }, depositRequestIds: [], redeemRequestIds: [] }],
      cycleNumber: '1', validUntil: String(Math.floor(new Date(deadline).getTime() / 1000)),
    };
    await userEvent.type(panel.querySelector('input[name="vault"]'), addresses.cashVault);
    fireEvent.change(panel.querySelector('textarea[name="instruction"]'), { target: { value: JSON.stringify(instruction) } });
    fireEvent.change(panel.querySelector('input[name="deadline"]'), { target: { value: deadline } });
    await userEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));

    await waitFor(() => expect(within(panel).getByText('Payload signed.')).toBeInTheDocument());
    expect(store.get().at(-1)).toMatchObject({ actionId: 'settlement.instruction.sign', status: 'signed' });
    expect(sdk.submitBatch).not.toHaveBeenCalled();
  });

  it('documents why pause-management remains operable while a vault is paused', () => {
    renderRole('guardian');
    expect(screen.getByText(/remain operable so an authorized role can unpause/i)).toBeInTheDocument();
  });

  it('ignores an older vault request after the route object changes', async () => {
    let releaseOld;
    const oldRegistration = new Promise(resolve => { releaseOld = resolve; });
    sdk.isVaultRegistered = vi.fn(vault => vault === addresses.cashVault ? oldRegistration : Promise.resolve(true));
    sdk.getStateContext = vi.fn(vault => Promise.resolve({ product: vault === addresses.cashVault ? 0 : 3, cycle: 0, pause: 0, cycleNumber: 8n }));
    const router = createMemoryRouter([{
      path: ROLE_DEFINITIONS.keeper.path,
      element: <RoleWorkspacePage roleId="keeper" />,
    }], { initialEntries: [`/workspaces/keeper/${addresses.cashVault}`] });
    render(<LocaleProvider><TransactionProvider><RouterProvider router={router} /></TransactionProvider></LocaleProvider>);

    await act(() => router.navigate(`/workspaces/keeper/${addresses.noteVault}`));
    await waitFor(() => expect(screen.getByText('Product state').parentElement.querySelector('dd')).toHaveTextContent('3'));
    await act(async () => { releaseOld(true); await oldRegistration; });
    expect(screen.getByText('Product state').parentElement.querySelector('dd')).toHaveTextContent('3');
  });

  it('does not render the prior account capability while replacement authorization is pending', async () => {
    const view = renderRole('keeper');
    await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled());
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    sdk.hasRole.mockImplementation((_role, account) => account.toLowerCase() === accountB.toLowerCase() ? pending : Promise.resolve(true));
    wallet = { ...wallet, session: { ...wallet.session, address: accountB } };

    view.rerender(roleTree('keeper'));
    const panel = await expandAction('lifecycle.open-subscription');
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    release(false);
  });

  it('does not render the prior chain capability after the wallet chain changes', async () => {
    const view = renderRole('keeper');
    await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled());
    wallet = { ...wallet, session: { ...wallet.session, chainId: 1 } };

    view.rerender(roleTree('keeper'));
    const panel = await expandAction('lifecycle.open-subscription');
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
  });

  it('does not render the prior role snapshot when the role changes', async () => {
    const tree = roleId => (
      <LocaleProvider><TransactionProvider><MemoryRouter initialEntries={[`/workspaces/keeper/${addresses.cashVault}`]}><Routes>
        <Route path="/workspaces/keeper/:vault" element={<RoleWorkspacePage roleId={roleId} />} />
      </Routes></MemoryRouter></TransactionProvider></LocaleProvider>
    );
    const view = render(tree('keeper'));
    await waitFor(() => expect(screen.getByText('keeper role')).toBeInTheDocument());
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    sdk.hasRole.mockReturnValue(pending);

    view.rerender(tree('curator'));
    expect(screen.queryByText('keeper role')).not.toBeInTheDocument();
    const panel = await expandAction('vault.fees.set');
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    release(false);
  });

  it('does not render the prior object capability while replacement vault state is pending', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    sdk.isVaultRegistered.mockImplementation(vault => vault === addresses.noteVault ? pending : Promise.resolve(true));
    const router = createMemoryRouter([{
      path: ROLE_DEFINITIONS.keeper.path,
      element: <RoleWorkspacePage roleId="keeper" />,
    }], { initialEntries: [`/workspaces/keeper/${addresses.cashVault}`] });
    render(<LocaleProvider><TransactionProvider><RouterProvider router={router} /></TransactionProvider></LocaleProvider>);
    await expandAction('lifecycle.open-subscription');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Execute action' })).toBeEnabled());

    await act(() => router.navigate(`/workspaces/keeper/${addresses.noteVault}`));
    const panel = await expandAction('lifecycle.open-subscription');
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    release(true);
  });

  it('keeps action forms collapsed until a summary is opened and only one panel open', async () => {
    renderRole('governor');
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(4));
    expect(screen.queryByRole('button', { name: 'Execute action' })).not.toBeInTheDocument();
    await expandAction('protocol.modules.pause');
    expect(screen.getAllByRole('button', { name: 'Execute action' })).toHaveLength(1);
    await expandAction('psm.protocol.pause');
    expect(screen.getAllByRole('button', { name: 'Execute action' })).toHaveLength(1);
  });
});
