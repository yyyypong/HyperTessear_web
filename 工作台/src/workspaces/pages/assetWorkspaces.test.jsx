import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LocaleProvider } from '../../i18n';
import { ROLE_DEFINITIONS } from '../config/roleDefinitions';
import { createTransactionStore, TransactionProvider } from '../core/transactionStore';
import { getWriteSigner } from '../core/walletRunner';
import RoleWorkspacePage from './RoleWorkspacePage';

let wallet;
let sdk;
const createReadSdk = vi.fn(() => sdk);
vi.mock('../../wallet', () => ({ useWallet: () => wallet }));
vi.mock('../core/createSdk', async importOriginal => ({
  ...await importOriginal(), createReadSdk: (...args) => createReadSdk(...args),
  createAmountDecimalsResolver: () => async () => 6,
  getSdkDeploymentBinding: value => value === sdk ? { chainId: 97, settlement: addresses.settlement, reservePSM: addresses.reservePSM, lpAdapter: addresses.lpAdapter } : null,
}));
vi.mock('../core/walletRunner', async importOriginal => ({ ...await importOriginal(), getWriteSigner: vi.fn() }));

const account = '0x2222222222222222222222222222222222222222';
const other = '0x4444444444444444444444444444444444444444';
const token = '0x5555555555555555555555555555555555555555';
const addresses = {
  assetRegistry: '0x50222D8849f44F90fCd911fC5f36387Db8EAD429', mintBurnController: '0x563f4C2e62B4917860a4435Da0bF6615648aF28e',
  poRRegistry: '0x581A7604f9429fF52fa378f2548c28B817e68d17', reservePSM: '0x67D10e814B57E381cE020697eF14CCDf922Dd654',
  settlement: '0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c', lpAdapter: '0xeEdBb2E9Baae30f450a9D2Ce35286d7CcF132ba1',
  cashAdapter: '0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4',
};

function makeSdk(overrides = {}) {
  const reserve = { globalPaused: vi.fn().mockResolvedValue(false), assetConfig: vi.fn().mockResolvedValue([0, other, other, true, account, false]) };
  const mintRequests = vi.fn().mockResolvedValue([7n, 1_000_000n, other, false, false]);
  const burnRequests = vi.fn().mockResolvedValue([7n, 1_000_000n, other, false, false]);
  const mintBurn = { mintRequests, burnRequests };
  const publishReserveProof = vi.fn().mockResolvedValue({ hash: '0xproof', status: 1 });
  const poR = { getFunction: vi.fn(() => publishReserveProof) };
  const updateDealData = vi.fn().mockResolvedValue({ hash: '0xadapter', status: 1 });
  const firstPeriodAdapter = { getFunction: vi.fn(() => updateDealData) };
  return {
    addresses,
    getAssetInfo: vi.fn().mockResolvedValue({ metadataHash: `0x${'11'.repeat(32)}`, token, active: true, registeredAt: 10n, owner: account }),
    wrappedTokenOf: vi.fn().mockResolvedValue(other), hasRole: vi.fn().mockResolvedValue(true),
    getContract: vi.fn(name => name === 'ReservePSM' ? reserve
      : name === 'RWAToken' ? { decimals: vi.fn().mockResolvedValue(6) }
        : name === 'MintBurnController' ? mintBurn
          : name === 'PoRRegistry' ? poR
            : name === 'FirstPeriodAdapter' ? firstPeriodAdapter : {}),
    initiateMint: vi.fn().mockResolvedValue({ hash: '0xmint', status: 1 }), initiateBurn: vi.fn(), approveMint: vi.fn(), approveBurn: vi.fn(),
    deployWrappedToken: vi.fn(),
    reserve, mintRequests, burnRequests, publishReserveProof, updateDealData,
    ...overrides,
  };
}

function renderRole(roleId, assetId = '7', store) {
  const role = ROLE_DEFINITIONS[roleId];
  const path = role.path.replace(':assetId', assetId).replace(':adapter', assetId);
  return render(<LocaleProvider><TransactionProvider store={store}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path={role.path} element={<RoleWorkspacePage roleId={roleId} />} />
  </Routes></MemoryRouter></TransactionProvider></LocaleProvider>);
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

beforeEach(() => {
  localStorage.setItem('hyt.locale', 'en');
  sdk = makeSdk();
  createReadSdk.mockClear();
  const provider = { request: vi.fn(async ({ method }) => method === 'eth_chainId' ? '0x61' : method === 'eth_accounts' ? [account] : null) };
  wallet = { session: { address: account, chainId: 97, provider }, switchChain: vi.fn() };
  vi.mocked(getWriteSigner).mockReset().mockResolvedValue({ getAddress: async () => account });
});
afterEach(cleanup);

describe('asset workspaces', () => {
  it('shows Asset Owner metadata and only its registered management and mint/burn initiation actions', async () => {
    renderRole('asset-owner');
    expect(await screen.findByText('Asset owner')).toBeInTheDocument();
    expect(screen.getByText(account)).toBeInTheDocument();
    expect(screen.getByText('Asset token')).toBeInTheDocument();
    expect(screen.getByText(token)).toBeInTheDocument();
    const ids = screen.getAllByTestId('workspace-action').map(node => node.dataset.actionId);
    expect(ids).toEqual(['asset.register', 'asset.metadata.update', 'asset.owner.transfer', 'asset.deactivate', 'asset.roles.set', 'mint.initiate', 'burn.initiate']);
    expect(screen.queryByTestId('workspace-action-mint.approve')).not.toBeInTheDocument();
  });

  it('executes mint initiation only after a fresh issuer-role and signer check', async () => {
    renderRole('asset-owner');
    const panel = await expandAction('mint.initiate');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="assetId"]'), '7');
    await userEvent.type(panel.querySelector('input[name="amount"]'), '1.25');
    await userEvent.type(panel.querySelector('input[name="to"]'), other);
    await userEvent.type(panel.querySelector('input[name="issuerSig"]'), `0x${'55'.repeat(65)}`);
    await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(sdk.initiateMint).toHaveBeenCalledOnce());
    expect(sdk.hasRole).toHaveBeenCalledWith(expect.any(String), account);
    expect(sdk.initiateMint.mock.calls[0].slice(0, 4)).toEqual([7n, 1_250_000n, other, `0x${'55'.repeat(65)}`]);
  });

  it('keeps registration permissionless while ISSUER_ROLE-gated mint and burn initiation stay disabled', async () => {
    sdk = makeSdk({
      hasRole: vi.fn().mockResolvedValue(false),
    });
    renderRole('asset-owner');
    const registerPanel = await expandAction('asset.register');
    await waitFor(() => expect(within(registerPanel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    const mintPanel = await expandAction('mint.initiate');
    expect(within(mintPanel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    const burnPanel = await expandAction('burn.initiate');
    expect(within(burnPanel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
  });

  it('limits Token Agent to mint and burn approvals', async () => {
    renderRole('token-agent');
    await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(2));
    expect(screen.getAllByTestId('workspace-action').map(node => node.dataset.actionId)).toEqual(['mint.approve', 'burn.approve']);
    expect(screen.queryByTestId('workspace-action-mint.initiate')).not.toBeInTheDocument();
  });

  it.each([
    ['mint.approve', 'approveMint', 'mintRequests'],
    ['burn.approve', 'approveBurn', 'burnRequests'],
  ])('executes %s only after binding the live request tuple to route asset 7', async (actionId, sdkMethod, requestMethod) => {
    renderRole('token-agent');
    const panel = await expandAction(actionId);
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="assetId"]'), '7');
    await userEvent.type(panel.querySelector('input[name="nonce"]'), '3');
    await userEvent.type(panel.querySelector('input[name="tokenAgentSig"]'), `0x${'66'.repeat(65)}`);
    await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(sdk[sdkMethod]).toHaveBeenCalledWith(3n, `0x${'66'.repeat(65)}`, expect.anything()));
    expect(sdk[requestMethod]).toHaveBeenCalledWith(3n);
  });

  it('rejects a Token Agent nonce belonging to another asset before signer, write, or transaction-store work', async () => {
    sdk = makeSdk();
    sdk.mintRequests.mockResolvedValue([8n, 1_000_000n, other, false, false]);
    const store = createTransactionStore({ storage: null });
    renderRole('token-agent', '7', store);
    const panel = await expandAction('mint.approve');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="assetId"]'), '7');
    await userEvent.type(panel.querySelector('input[name="nonce"]'), '3');
    await userEvent.type(panel.querySelector('input[name="tokenAgentSig"]'), `0x${'66'.repeat(65)}`);
    await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(within(panel).getByText(/could not be submitted/i)).toBeInTheDocument());
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.approveMint).not.toHaveBeenCalled();
    expect(store.get()).toHaveLength(0);
  });

  it('fails Proof Publisher closed when the reviewed PoR module binding is absent', async () => {
    sdk = makeSdk({ addresses: { ...addresses, poRRegistry: undefined } });
    renderRole('proof-publisher');
    const panel = await expandAction('proof.publish');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled());
    expect(sdk.getContract).not.toHaveBeenCalledWith('PoRRegistry', expect.anything(), expect.anything());
  });

  it('publishes an exact proof tuple through the reviewed PoR ABI method', async () => {
    renderRole('proof-publisher');
    const panel = await expandAction('proof.publish');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    const proofHash = `0x${'77'.repeat(32)}`;
    await userEvent.type(panel.querySelector('input[name="assetId"]'), '7');
    await userEvent.type(panel.querySelector('input[name="proofHash"]'), proofHash);
    await userEvent.type(panel.querySelector('input[name="documentUri"]'), 'https://example.com/proof/7');
    await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(sdk.publishReserveProof).toHaveBeenCalledWith(7n, proofHash, 'https://example.com/proof/7'));
  });

  it('enables Wrapper deploy only when the current SDK exposes the reviewed method', async () => {
    sdk.reserve.assetConfig.mockResolvedValue([0, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', false, '0x0000000000000000000000000000000000000000', false]);
    sdk.wrappedTokenOf.mockResolvedValue('0x0000000000000000000000000000000000000000');
    renderRole('wrapper-controller');
    const enabledPanel = await expandAction('wrapper.deploy');
    await waitFor(() => expect(within(enabledPanel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    cleanup();
    sdk = makeSdk({ deployWrappedToken: undefined });
    renderRole('wrapper-controller');
    const disabledPanel = await expandAction('wrapper.deploy');
    await waitFor(() => expect(within(disabledPanel).getByRole('button', { name: 'Execute action' })).toBeDisabled());
  });

  it('deploys an unconfigured Wrapper with the exact SDK argument order and signer', async () => {
    sdk.reserve.assetConfig.mockResolvedValue([0, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', false, '0x0000000000000000000000000000000000000000', false]);
    sdk.wrappedTokenOf.mockResolvedValue('0x0000000000000000000000000000000000000000');
    renderRole('wrapper-controller');
    const panel = await expandAction('wrapper.deploy');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="assetId"]'), '7');
    await userEvent.selectOptions(panel.querySelector('select[name="mode"]'), 'token-custody');
    await userEvent.type(panel.querySelector('input[name="underlyingToken"]'), token);
    await userEvent.type(panel.querySelector('input[name="name"]'), 'Wrapped Seven');
    await userEvent.type(panel.querySelector('input[name="symbol"]'), 'WSEV');
    await userEvent.type(panel.querySelector('input[name="decimals"]'), '6');
    await userEvent.selectOptions(panel.querySelector('select[name="allowPartialUnwrap"]'), 'false');
    await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(sdk.deployWrappedToken).toHaveBeenCalledWith(7n, 0, token, 'Wrapped Seven', 'WSEV', 6n, false, expect.anything()));
  });

  it('keeps Wrapper unpause enabled while the selected configured asset is paused', async () => {
    sdk.reserve.assetConfig.mockResolvedValue([1, other, token, false, account, true]);
    renderRole('wrapper-controller');
    const panel = await expandAction('wrapper.asset.pause');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
  });

  it('disables deploy for a configured Wrapper and signer configuration for TOKEN_CUSTODY mode', async () => {
    sdk.reserve.assetConfig.mockResolvedValue([0, other, token, true, '0x0000000000000000000000000000000000000000', false]);
    renderRole('wrapper-controller');
    const deployPanel = await expandAction('wrapper.deploy');
    await waitFor(() => expect(within(deployPanel).getByRole('button', { name: 'Execute action' })).toBeDisabled());
    const signerPanel = await expandAction('wrapper.signer.set');
    expect(within(signerPanel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
  });

  it('lets the Adapter Data Provider update only the selected configured adapter through the SDK adapter', async () => {
    renderRole('adapter-data-provider', addresses.cashAdapter);
    const panel = await expandAction('adapter.deal-data.update');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="adapter"]'), addresses.cashAdapter);
    await userEvent.type(panel.querySelector('input[name="dealId"]'), '3');
    await userEvent.type(panel.querySelector('input[name="newValue"]'), '4');
    await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
    await waitFor(() => expect(sdk.updateDealData).toHaveBeenCalledWith(3n, 4n));
    expect(sdk.getContract).toHaveBeenCalledWith('FirstPeriodAdapter', addresses.cashAdapter, expect.anything());
  });

  it.each([
    '-1', '0', '00', '007', '+7', encodeURIComponent(' 7'), '1.5', 'asset-seven', (1n << 256n).toString(),
  ])('rejects malformed or noncanonical asset id %s before creating an SDK or issuing RPC', async assetId => {
    renderRole('asset-owner', assetId);
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid asset/i);
    expect(createReadSdk).not.toHaveBeenCalled();
    expect(sdk.getAssetInfo).not.toHaveBeenCalled();
    expect(wallet.session.provider.request).not.toHaveBeenCalled();
  });
});
