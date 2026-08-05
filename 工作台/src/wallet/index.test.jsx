import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletProvider, useWallet } from './index';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

function WalletProbe() {
  const { providers, connect, session, switchChain } = useWallet();

  return (
    <>
      <button onClick={() => connect(providers[0])} disabled={!providers[0]}>Connect</button>
      {session && <button onClick={() => switchChain(97)}>Switch network</button>}
    </>
  );
}

function announceProvider(provider) {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: {
      info: { uuid: 'test-wallet', rdns: 'test.wallet', name: 'Test Wallet', icon: '' },
      provider,
    },
  }));
}

afterEach(() => localStorage.clear());

describe('WalletProvider', () => {
  it('switches the connected EIP-1193 wallet to the requested chain', async () => {
    const request = vi.fn(async ({ method }) => {
      if (method === 'eth_requestAccounts') return [ACCOUNT];
      if (method === 'eth_chainId') return '0x61';
      if (method === 'wallet_switchEthereumChain') return null;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const user = userEvent.setup();

    render(<WalletProvider><WalletProbe /></WalletProvider>);
    act(() => announceProvider({ request }));
    await user.click(await screen.findByRole('button', { name: 'Connect' }));
    await user.click(await screen.findByRole('button', { name: 'Switch network' }));

    await waitFor(() => expect(request).toHaveBeenLastCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x61' }],
    }));
  });
});
