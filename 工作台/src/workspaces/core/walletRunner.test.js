import { describe, expect, it, vi } from 'vitest';
import { createBrowserProvider, getWriteSigner, requestChain } from './walletRunner';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

function createEip1193Provider({ switchError } = {}) {
  const request = vi.fn(async ({ method }) => {
    if (method === 'eth_chainId') return '0x61';
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT];
    if (method === 'wallet_switchEthereumChain') {
      if (switchError) throw switchError;
      return null;
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  });

  return { request };
}

describe('wallet runner', () => {
  it('creates an ethers signer for the connected account', async () => {
    const wallet = createEip1193Provider();

    const signer = await getWriteSigner(wallet);

    expect(await signer.getAddress()).toBe(ACCOUNT);
    expect(wallet.request).toHaveBeenCalledWith({ method: 'eth_accounts', params: [] });
  });

  it('rejects absent wallet providers before creating a BrowserProvider', () => {
    expect(() => createBrowserProvider(null)).toThrow('walletRequired');
  });

  it('rejects absent wallet providers before requesting a chain switch', async () => {
    await expect(requestChain(null, 97)).rejects.toThrow('walletRequired');
  });

  it('asks the wallet to switch to BNB testnet with hexadecimal chain id', async () => {
    const wallet = createEip1193Provider();

    await requestChain(wallet, 97);

    expect(wallet.request).toHaveBeenLastCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x61' }],
    });
  });

  it('rethrows user rejection unchanged so the error mapper can identify it', async () => {
    const rejected = Object.assign(new Error('User rejected request'), { code: 4001 });
    const wallet = createEip1193Provider({ switchError: rejected });

    await expect(requestChain(wallet, 97)).rejects.toBe(rejected);
  });
});
