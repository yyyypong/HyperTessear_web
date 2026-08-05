import { BrowserProvider } from 'ethers';

export function createBrowserProvider(eip1193Provider) {
  if (!eip1193Provider) throw new Error('walletRequired');
  return new BrowserProvider(eip1193Provider);
}

export async function getWriteSigner(eip1193Provider) {
  return createBrowserProvider(eip1193Provider).getSigner();
}

export async function requestChain(eip1193Provider, chainId) {
  if (!eip1193Provider) throw new Error('walletRequired');
  return eip1193Provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${Number(chainId).toString(16)}` }],
  });
}
