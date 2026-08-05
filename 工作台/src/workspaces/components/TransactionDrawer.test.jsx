import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../i18n';
import App from '../../App';
import { getDeployment } from '../config/deployments';
import { createTransactionStore, TransactionProvider } from '../core/transactionStore';
import TransactionDrawer from './TransactionDrawer';
import ActivityPage from '../pages/ActivityPage';

function makeStore() {
  let time = 0;
  const store = createTransactionStore({ storage: null, now: () => ++time });
  const id = state => store.prepare(`action.${state}`, { vault: 'safe', signature: 'do-not-show', instruction: 'do-not-show' });
  const prepared = id('prepared');
  const awaiting = id('awaiting'); store.awaitingWallet(awaiting);
  const submitted = id('submitted'); store.awaitingWallet(submitted); store.submitted(submitted, '0xabc123');
  const confirmed = id('confirmed'); store.awaitingWallet(confirmed); store.submitted(confirmed, '0xdef456'); store.confirmed(confirmed, { hash: '0xdef456' });
  const signed = id('signed'); store.signed(signed, { digest: '0xdigest' });
  const rejected = id('rejected'); store.awaitingWallet(rejected); store.rejected(rejected, { code: 'walletRejected', messageKey: 'workspaces.errors.walletRejected' });
  const failed = id('failed'); store.failed(failed, { code: 'failed', messageKey: 'workspaces.errors.failed' });
  return store;
}

function announceProvider(provider) {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'activity-wallet', rdns: 'activity.wallet', name: 'Activity Wallet', icon: '' }, provider },
  }));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

beforeEach(() => localStorage.setItem('hyt.locale', 'en'));

describe('TransactionDrawer and activity', () => {
  it('renders all sanitized transaction statuses without signatures or instruction payloads', () => {
    const store = makeStore();
    render(<LocaleProvider><TransactionProvider store={store}><TransactionDrawer open onClose={() => {}} explorerUrl="https://scan.example" /></TransactionProvider></LocaleProvider>);

    ['Prepared', 'Awaiting wallet confirmation', 'Submitted', 'Confirmed', 'Signed', 'Rejected in wallet', 'Failed'].forEach(status => expect(screen.getByText(status)).toBeInTheDocument());
    expect(screen.queryByText('do-not-show')).not.toBeInTheDocument();
    expect(screen.queryByText('0xdigest')).not.toBeInTheDocument();
  });

  it('derives explorer links from the supplied deployment explorer URL', () => {
    const store = makeStore();
    render(<LocaleProvider><TransactionProvider store={store}><TransactionDrawer open onClose={() => {}} explorerUrl="https://scan.example/base/" /></TransactionProvider></LocaleProvider>);

    expect(screen.getAllByRole('link', { name: 'View in explorer' }).find(link => link.getAttribute('href')?.endsWith('/tx/0xabc123'))).toHaveAttribute('href', 'https://scan.example/base/tx/0xabc123');
  });

  it('redacts malicious transaction input at the real drawer display boundary', () => {
    const entries = [{ id: 'unsafe', actionId: 'vault.pause', status: 'submitted', input: { vault: 'safe', signature: 'expose-signature', instruction: 'expose-instruction', calldata: 'expose-calldata', unknown: 'expose-unknown', nested: { calldata: 'expose-nested' } } }];
    const maliciousStore = {
      get: () => entries,
      subscribe: () => () => {},
    };
    render(<LocaleProvider><TransactionProvider store={maliciousStore}><TransactionDrawer open onClose={() => {}} /></TransactionProvider></LocaleProvider>);

    expect(screen.getByText('vault: safe')).toBeInTheDocument();
    ['expose-signature', 'expose-instruction', 'expose-calldata', 'expose-unknown', 'expose-nested'].forEach(secret => expect(screen.queryByText(secret)).not.toBeInTheDocument());
  });

  it('closes with Escape and returns focus to its trigger', () => {
    const store = makeStore();
    function Probe() {
      const [open, setOpen] = React.useState(false);
      return <TransactionProvider store={store}><button type="button" onClick={() => setOpen(true)}>Activity</button><TransactionDrawer open={open} onClose={() => setOpen(false)} /></TransactionProvider>;
    }
    render(<LocaleProvider><Probe /></LocaleProvider>);
    const trigger = screen.getByRole('button', { name: 'Activity' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('shares the workspace provider with the real activity route', () => {
    sessionStorage.setItem('hypertessera.workspace.transactions', JSON.stringify([{ id: 'seed', actionId: 'vault.pause', status: 'submitted', txHash: '0xroute' }]));
    window.history.pushState({}, '', '/workspaces/activity');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('vault.pause')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('uses the connected deployment explorer on the real activity route', async () => {
    const user = userEvent.setup();
    const provider = {
      request: async ({ method }) => {
        if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return '0x61';
        throw new Error(`Unexpected RPC method: ${method}`);
      },
    };
    sessionStorage.setItem('hypertessera.workspace.transactions', JSON.stringify([{ id: 'activity-hash', actionId: 'vault.pause', status: 'submitted', txHash: '0xactivity' }]));
    localStorage.setItem('ht.wallet.v1', JSON.stringify({ rdns: 'activity.wallet' }));
    window.history.pushState({}, '', '/workspaces/activity');
    render(<App />);
    act(() => announceProvider(provider));

    await user.click(await screen.findByRole('button', { name: 'Open transaction activity (1)' }));
    expect(await screen.findByRole('link', { name: 'View in explorer' })).toHaveAttribute('href', `${getDeployment(97).explorerUrl}/tx/0xactivity`);
  });

  it('omits explorer links safely on an unsupported connected chain', async () => {
    const user = userEvent.setup();
    const request = vi.fn(async ({ method }) => {
      if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return '0x1';
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    sessionStorage.setItem('hypertessera.workspace.transactions', JSON.stringify([{ id: 'unsupported-hash', actionId: 'vault.pause', status: 'submitted', txHash: '0xunsupported' }]));
    localStorage.setItem('ht.wallet.v1', JSON.stringify({ rdns: 'activity.wallet' }));
    window.history.pushState({}, '', '/workspaces/activity');
    render(<App />);
    act(() => announceProvider({ request }));

    await waitFor(() => expect(request).toHaveBeenCalledWith({ method: 'eth_chainId' }));
    await user.click(screen.getByRole('button', { name: 'Open transaction activity (1)' }));
    expect(screen.queryByRole('link', { name: 'View in explorer' })).not.toBeInTheDocument();
  });
});
