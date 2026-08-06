import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wallet, getBytes } from 'ethers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ROLE_DEFINITIONS } from './config/roleDefinitions';
import { getDeployment } from './config/deployments';
import '../styles/workspaces.css';

let sdk;
const createReadSdk = vi.fn(() => sdk);

vi.mock('./core/createSdk', async importOriginal => ({
  ...await importOriginal(),
  createReadSdk: (...args) => createReadSdk(...args),
  createAmountDecimalsResolver: () => async () => 18,
}));

const deployment = getDeployment(97);
const vault = deployment.addresses.cashVault;
const adapter = deployment.addresses.cashAdapter;
const wallet = new Wallet('0x59c6995e998f97a5a0044976f094538a3e2f7a0d5bbfeb7e4b7a5b0525fbd3a5');
const txHash = `0x${'ab'.repeat(32)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class ProviderDouble {
  constructor({ account = wallet.address, chainId = 97 } = {}) {
    this.account = account;
    this.chainId = chainId;
    this.isMetaMask = true;
    this.listeners = new Map();
    this.request = vi.fn(this.#request.bind(this));
  }

  async #request({ method, params }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return this.account ? [this.account] : [];
    if (method === 'eth_chainId') return `0x${this.chainId.toString(16)}`;
    if (method === 'wallet_switchEthereumChain') {
      this.chainId = Number(params?.[0]?.chainId);
      this.emit('chainChanged', params?.[0]?.chainId);
      return null;
    }
    if (method === 'personal_sign') {
      const message = params?.find(value => typeof value === 'string' && value.startsWith('0x') && value.length !== 42);
      return wallet.signMessage(getBytes(message));
    }
    if (method === 'wallet_revokePermissions') return null;
    throw new Error(`Unexpected RPC method: ${method}`);
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event, value) {
    this.listeners.get(event)?.forEach(listener => listener(value));
  }
}

function makeSdk({ authorized = true, product = 0, cycle = 0, pause = 0, openSubscription } = {}) {
  const stateManager = { modulePaused: vi.fn().mockResolvedValue(false) };
  const reservePsm = { globalPaused: vi.fn().mockResolvedValue(false) };
  const navOracle = { authorizedSigner: vi.fn().mockResolvedValue(wallet.address) };
  return {
    addresses: deployment.addresses,
    isVaultRegistered: vi.fn().mockResolvedValue(true),
    isVaultActive: vi.fn().mockResolvedValue(true),
    getStateContext: vi.fn().mockResolvedValue({ product, cycle, pause, cycleNumber: 8n }),
    getNAV: vi.fn().mockResolvedValue({ nav: 1_000_000n, dataTimestamp: 1n, updatedAt: 2n }),
    isNAVFresh: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(authorized),
    isOperator: vi.fn().mockResolvedValue(authorized),
    threshold: vi.fn().mockResolvedValue(1n),
    pending: vi.fn().mockResolvedValue(1n),
    availableToDistribute: vi.fn().mockResolvedValue(2n),
    totalPending: vi.fn().mockResolvedValue(3n),
    getContract: vi.fn(name => {
      if (name === 'StateManager') return stateManager;
      if (name === 'ReservePSM') return reservePsm;
      if (name === 'NAVOracle') return navOracle;
      return {};
    }),
    openSubscription: openSubscription ?? vi.fn().mockResolvedValue({ hash: txHash, wait: vi.fn().mockResolvedValue({ hash: txHash, status: 1 }) }),
    finalizeSubscription: vi.fn(),
    startCycleCalculation: vi.fn(),
    enterFinalSettlement: vi.fn(),
    enterMaturing: vi.fn(),
    enterClaiming: vi.fn(),
    closeProduct: vi.fn(),
  };
}

function announce(provider) {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: {
      info: { uuid: 'integration-wallet', rdns: 'integration.wallet', name: 'Integration Wallet', icon: '' },
      provider,
    },
  }));
}

async function connect(provider) {
  Object.defineProperty(window, 'ethereum', { configurable: true, writable: true, value: provider });
  await act(async () => new Promise(resolve => setTimeout(resolve, 275)));
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
  const metamask = await screen.findByText('MetaMask');
  expect(metamask.closest('button')).not.toBeNull();
  await userEvent.click(metamask.closest('button'));
  await waitFor(() => expect(screen.getByLabelText('Workspace context')).toHaveTextContent('MetaMask'));
}

function go(path) {
  act(() => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

function setMedia({ width = 1440, reducedMotion = false } = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(query => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : width <= 959,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

function renderApp(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
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

async function expandRelayerImport() {
  const summary = screen.getByRole('button', { name: 'Validated signature import' });
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
}

async function expandSignatureExport() {
  const summary = screen.getByRole('button', { name: 'Signed payload handoff' });
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
}

async function fillKeeperAndExecute() {
  const panel = await expandAction('lifecycle.open-subscription');
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
  await userEvent.type(within(panel).getByLabelText('Vault address'), vault);
  await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
  return panel;
}

beforeEach(() => {
  localStorage.setItem('hyt.locale', 'en');
  setMedia();
  sdk = makeSdk();
  createReadSdk.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState({}, '', '/');
  Reflect.deleteProperty(window, 'ethereum');
  vi.clearAllMocks();
});

describe('role workspace delivery integration', () => {
  it('connects on chain 97, executes Keeper through the real adapter/executor, renders transaction progress, and keeps Vault Owner target-only', async () => {
    const provider = new ProviderDouble();
    const sendGate = deferred();
    const receiptGate = deferred();
    sdk = makeSdk({
      openSubscription: vi.fn(() => sendGate.promise),
    });
    sessionStorage.setItem('hypertessera.workspace.transactions', JSON.stringify([
      { id: 'prepared-integration', actionId: 'lifecycle.open-subscription', status: 'prepared', input: { vault } },
      { id: 'awaiting-integration', actionId: 'lifecycle.open-subscription', status: 'awaitingWallet', input: { vault } },
      { id: 'submitted-integration', actionId: 'lifecycle.open-subscription', status: 'submitted', input: { vault }, txHash },
    ]));
    renderApp('/workspaces');

    await connect(provider);
    const context = screen.getByLabelText('Workspace context');
    expect(context).toHaveTextContent('NetworkBNB Smart Chain Testnet');
    expect(context).toHaveTextContent('DeploymentBNB Smart Chain Testnet · Legacy Compatible');

    await userEvent.type(screen.getByLabelText('Vault address'), vault);
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'keeper');
    await userEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(await screen.findByRole('heading', { name: 'Keeper' })).toBeInTheDocument();
    const openPanel = await expandAction('lifecycle.open-subscription');
    expect(within(openPanel).getByText('Legacy Compatible')).toBeInTheDocument();

    await fillKeeperAndExecute();
    await waitFor(() => expect(sdk.openSubscription).toHaveBeenCalledOnce());
    const persistedTransactions = () => JSON.parse(sessionStorage.getItem('hypertessera.workspace.transactions'));
    let liveTransaction;
    await waitFor(() => {
      liveTransaction = persistedTransactions().find(entry => !entry.id.endsWith('-integration'));
      expect(liveTransaction?.status).toBe('awaitingWallet');
    });

    const transaction = { hash: txHash, wait: vi.fn(() => receiptGate.promise) };
    await act(async () => {
      sendGate.resolve(transaction);
      await Promise.resolve();
    });
    await waitFor(() => {
      liveTransaction = persistedTransactions().find(entry => entry.id === liveTransaction.id);
      expect(liveTransaction?.status).toBe('submitted');
    });
    await act(async () => {
      receiptGate.resolve({ hash: txHash, status: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      liveTransaction = persistedTransactions().find(entry => entry.id === liveTransaction.id);
      expect(liveTransaction?.status).toBe('confirmed');
    });
    expect(within(await expandAction('lifecycle.open-subscription')).getByText('Action submitted.')).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('navigation', { name: 'Workspace roles' })).getByRole('link', { name: 'Activity' }));
    const activity = await screen.findByRole('list', { name: 'Recent workspace activity' });
    expect(within(activity).getByText('Prepared')).toBeInTheDocument();
    expect(within(activity).getByText('Awaiting wallet confirmation')).toBeInTheDocument();
    expect(within(activity).getByText('Submitted')).toBeInTheDocument();
    expect(within(activity).getByText('Confirmed')).toBeInTheDocument();

    expect(sdk.openSubscription).toHaveBeenCalledWith(vault, expect.objectContaining({ getAddress: expect.any(Function) }));
    expect(transaction.wait).toHaveBeenCalledOnce();

    go(`/workspaces/vault-owner/${vault}`);
    expect(await screen.findByRole('heading', { name: 'Vault Owner' })).toBeInTheDocument();
    const targetOnly = await expandAction('vault.roles.set');
    expect(within(targetOnly).getAllByText('Target').length).toBeGreaterThan(0);
    expect(within(targetOnly).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    expect(provider.request.mock.calls.filter(([request]) => request.method === 'eth_sendTransaction')).toHaveLength(0);
  });

  it('keeps the exact 15 administrative roles separate from public creator and user functions, and renders every route', async () => {
    const expectedRoles = [
      'governor', 'vault-owner', 'curator', 'guardian', 'allocator', 'settlement-operator', 'keeper',
      'asset-owner', 'token-agent', 'proof-publisher', 'wrapper-controller', 'nav-signer',
      'adapter-data-provider', 'psm-authorized-signer', 'relayer',
    ];
    expect(Object.keys(ROLE_DEFINITIONS)).toEqual(expectedRoles);
    expect(Object.keys(ROLE_DEFINITIONS)).not.toEqual(expect.arrayContaining(['vault-creator', 'asset-creator', 'wrapper-creator']));
    renderApp('/workspaces');

    const roleNav = screen.getByRole('navigation', { name: 'Workspace roles' });
    expect(within(roleNav).getAllByRole('link')).toHaveLength(18);
    const expectedTitles = {
      governor: 'Governor', 'vault-owner': 'Vault Owner', curator: 'Curator', guardian: 'Guardian', allocator: 'Allocator',
      'settlement-operator': 'Settlement Operator', keeper: 'Keeper', 'asset-owner': 'Asset Owner / Issuer',
      'token-agent': 'Token Agent', 'proof-publisher': 'Proof Publisher', 'wrapper-controller': 'Wrapper Controller',
      'nav-signer': 'NAV Signer', 'adapter-data-provider': 'Adapter Data Provider',
      'psm-authorized-signer': 'PSM Authorized Signer', relayer: 'Relayer',
    };
    for (const roleId of expectedRoles) {
      const role = ROLE_DEFINITIONS[roleId];
      const path = role.path.replace(':vault', vault).replace(':assetId', '7').replace(':adapter', adapter);
      go(path);
      expect(await screen.findByRole('heading', { name: expectedTitles[roleId] })).toBeInTheDocument();
    }

    go('/workspaces/public');
    expect(await screen.findByRole('heading', { name: 'Public workspace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Public creation functions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Regular user operations' })).toBeInTheDocument();
    ['Asset Creator', 'Vault Creator', 'Wrapper Creator'].forEach(name => expect(screen.getByRole('heading', { name })).toBeInTheDocument());
  });

  it('reserves the fixed light header height across the workspace root, sidebar, and transaction drawer', () => {
    renderApp('/workspaces');
    Object.defineProperty(window, 'scrollY', { writable: true, configurable: true, value: 50 });
    fireEvent.scroll(window);

    expect(document.querySelector('.lnav')).toHaveClass('lnav--light');
    expect(document.querySelector('.pagefade')).toHaveClass('pagefade--workspace');
    const rules = [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules]; } catch { return []; }
    });
    const rule = selector => rules.find(candidate => candidate.selectorText === selector)?.style;
    expect(rule('.ht-workspaces')?.getPropertyValue('padding-top')).toBe('var(--hdr-h)');
    expect(rule('.pagefade--workspace')?.getPropertyValue('animation')).toBe('none');
    expect(rule('.ht-workspaces .ws-sidebar')?.getPropertyValue('top')).toBe('var(--hdr-h)');
    expect(rule('.ht-workspaces .ws-sidebar')?.getPropertyValue('height')).toBe('calc(100dvh - var(--hdr-h))');
    expect(rule('.ht-workspaces .ws-transaction-drawer')?.getPropertyValue('top')).toBe('calc(var(--hdr-h) + 16px)');
    expect(rule('.ht-workspaces .ws-transaction-drawer')?.getPropertyValue('max-height')).toBe('calc(100dvh - var(--hdr-h) - 32px)');
  });

  it('marks only Overview active without an object and only the matching parameterized role active with an object', async () => {
    renderApp('/workspaces');
    const currentNames = () => within(screen.getByRole('navigation', { name: 'Workspace roles' }))
      .getAllByRole('link')
      .filter(link => link.getAttribute('aria-current') === 'page')
      .map(link => link.textContent.trim());

    expect(currentNames()).toEqual(['Overview']);
    go(`/workspaces/keeper/${vault}`);
    expect(await screen.findByRole('heading', { name: 'Keeper' })).toBeInTheDocument();
    expect(currentNames()).toEqual(['Keeper']);
    go('/workspaces/wrapper-controller/7');
    expect(await screen.findByRole('heading', { name: 'Wrapper Controller' })).toBeInTheDocument();
    expect(currentNames()).toEqual(['Wrapper Controller']);
  });

  it('fails closed for disconnected, wrong-network, unauthorized, and target-only states without wallet writes', async () => {
    const provider = new ProviderDouble({ chainId: 1 });
    renderApp(`/workspaces/keeper/${vault}`);
    let panel = await expandAction('lifecycle.open-subscription');
    expect(within(panel).getByText('Wallet required')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();

    await connect(provider);
    await waitFor(() => expect(within(panel).getByText('Wrong network')).toBeInTheDocument());
    expect(createReadSdk).not.toHaveBeenCalled();

    sdk.hasRole.mockResolvedValue(false);
    act(() => {
      provider.chainId = 97;
      provider.emit('chainChanged', '0x61');
    });
    await waitFor(() => expect(within(panel).getByText('Unauthorized')).toBeInTheDocument());
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();

    go(`/workspaces/vault-owner/${vault}`);
    panel = await expandAction('vault.timelock.manage');
    expect(within(panel).getByRole('status')).toHaveTextContent('Requires target contract / SDK');
    expect(within(panel).getByRole('button', { name: 'Execute action' })).toBeDisabled();
    expect(provider.request.mock.calls.filter(([request]) => request.method === 'eth_sendTransaction')).toHaveLength(0);
  });

  it('records wallet rejection as rejected and does not misreport it as submitted', async () => {
    const rejection = Object.assign(new Error('User rejected'), { code: 4001 });
    sdk = makeSdk({ openSubscription: vi.fn().mockRejectedValue(rejection) });
    const provider = new ProviderDouble();
    renderApp(`/workspaces/keeper/${vault}`);
    await connect(provider);

    const panel = await fillKeeperAndExecute();
    await waitFor(() => expect(within(panel).getByText('Action could not be submitted.')).toBeInTheDocument());
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Workspace roles' })).getByRole('link', { name: 'Activity' }));
    expect(await screen.findByText('Rejected in wallet')).toBeInTheDocument();
    expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
    expect(provider.request.mock.calls.filter(([request]) => request.method === 'eth_sendTransaction')).toHaveLength(0);
  });

  it('signs, explicitly exports, and validates a v2 NAV handoff before Relayer submission is enabled', async () => {
    const provider = new ProviderDouble();
    renderApp(`/workspaces/nav-signer/${vault}`);
    await connect(provider);

    const panel = await expandAction('nav.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="vault"]'), vault);
    await userEvent.type(panel.querySelector('input[name="nav"]'), '1.5');
    fireEvent.change(panel.querySelector('input[name="dataTimestamp"]'), { target: { value: '2026-07-31T10:00' } });
    await userEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));

    expect(await within(panel).findByText('Payload signed.')).toBeInTheDocument();
    await expandSignatureExport();
    await userEvent.click(screen.getByRole('button', { name: 'Export signed payload' }));
    const exported = screen.getByLabelText('Exported signed payload').value;
    expect(JSON.parse(exported)).toMatchObject({ version: 2, kind: 'nav', chainId: 97, scope: { vault } });
    expect(provider.request.mock.calls.filter(([request]) => request.method === 'personal_sign')).toHaveLength(2);

    go('/workspaces/relayer');
    await expandRelayerImport();
    const input = await screen.findByLabelText('Signed payload import');
    fireEvent.change(input, { target: { value: exported } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    expect(await screen.findByText('Validated nav payload for chain 97.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit imported NAV' })).toBeEnabled();
  });
});

describe('workspace accessibility integration', () => {
  it('moves focus into the mobile drawer and restores it on Escape without claiming a real-browser width check', async () => {
    setMedia({ width: 390 });
    renderApp('/workspaces');
    const trigger = screen.getByRole('button', { name: 'Open workspace navigation' });
    expect(document.querySelector('.ht-workspaces')).toHaveAttribute('data-mobile', 'true');
    expect(trigger.parentElement).toHaveClass('ws-mobile-nav-bar');
    await userEvent.click(trigger);
    expect(document.querySelector('.ws-sidebar__close')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(document.getElementById('workspace-sidebar')).toHaveAttribute('inert');
  });

  it('ships a scoped prefers-reduced-motion override for workspace transitions and animations', () => {
    setMedia({ reducedMotion: true });
    renderApp('/workspaces');
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const mediaRules = [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules]; } catch { return []; }
    }).filter(rule => rule.conditionText?.includes('prefers-reduced-motion'));
    expect(mediaRules.some(rule => [...rule.cssRules].some(child => child.selectorText?.includes('.ht-workspaces *')))).toBe(true);
  });
});
