import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { requestChain } from '../workspaces/core/walletRunner';
import { DEMO_WALLETS } from '../data/mockAccessData';
import { getNetworkByChainId } from '../config/networks';

/* ----------------------------------------------------------------
   Wallet connection, dependency-free.

   Discovery uses EIP-6963: every modern wallet (MetaMask, OKX, Rabby,
   Coinbase, Trust, Phantom EVM…) announces itself on the window, which
   sidesteps the old window.ethereum single-slot conflict where whichever
   extension loaded last won. A legacy window.ethereum fallback covers
   older builds.

   The connection is deliberately read-only: we request accounts and the
   chain, never a signature and never a transaction.
   ---------------------------------------------------------------- */

const WalletCtx = createContext(null);
export const useWallet = () => useContext(WalletCtx);

const STORAGE_KEY = 'ht.wallet.v1';
const DEMO_STORAGE_KEY = 'ht.wallet.demo.v1';

const CHAIN_NAMES = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  11155111: 'Sepolia',
};

export function chainName(id) {
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export function truncateAddress(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

const DEMO_PROVIDER_INFO = {
  uuid: 'hypertessera-demo-wallet',
  name: 'HyperTessera Demo Wallet',
  icon: '',
  rdns: 'com.hypertessera.demo',
};

/* Best-effort label for a legacy window.ethereum that never announced
   itself via 6963. */
function legacyProvider() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  const eth = window.ethereum;
  if (Array.isArray(eth.providers) && eth.providers.length) {
    // Multi-injected window without 6963 support: surface each provider
    // by its own flag rather than the outer proxy.
    return eth.providers.map((p, i) => ({
      info: {
        uuid: `legacy-${i}`,
        rdns: `legacy.${i}`,
        name: guessName(p),
        icon: '',
      },
      provider: p,
    }));
  }
  return [{
    info: { uuid: 'legacy', rdns: 'legacy', name: guessName(eth), icon: '' },
    provider: eth,
  }];
}

function guessName(p) {
  if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
  if (p.isRabby) return 'Rabby';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return null; // caller falls back to a generic label
}

function useProviderDiscovery() {
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    const onAnnounce = (event) => {
      const detail = event.detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      setProviders(prev => (
        prev.some(p => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail]
      ));
    };

    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Give announcements a tick to land before deciding the legacy path is
    // all there is — 6963 wallets respond synchronously, but a slow frame
    // should not cost the user their preferred wallet's own entry.
    const timer = setTimeout(() => {
      setProviders(prev => (prev.length ? prev : (legacyProvider() ?? [])));
    }, 250);

    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(timer);
    };
  }, []);

  return providers;
}

export function WalletProvider({ children }) {
  const providers = useProviderDiscovery();
  const [session, setSession] = useState(null); // { address, chainId, info, provider }
  const [connecting, setConnecting] = useState(null); // uuid being connected
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  /* ---- silent reconnect: restore the last wallet without a popup ---- */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    // A demo session restores immediately; it never depends on extensions.
    let demoSaved = null;
    try { demoSaved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY)); } catch { /* ignore */ }
    if (demoSaved && !sessionRef.current) {
      restored.current = true;
      const address = typeof demoSaved === 'string' ? demoSaved : demoSaved.address;
      const chainId = typeof demoSaved === 'string' ? 1 : (demoSaved.chainId ?? 1);
      setSession({ address, chainId, info: DEMO_PROVIDER_INFO, provider: null });
      setIsDemo(true);
      return;
    }
    if (restored.current || !providers.length) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* ignore */ }
    if (!saved?.rdns) return;

    const detail = providers.find(p => p.info.rdns === saved.rdns || p.info.uuid === saved.rdns);
    if (!detail) return;
    restored.current = true;

    detail.provider.request({ method: 'eth_accounts' })
      .then(async (accounts) => {
        if (!accounts?.length || sessionRef.current) return;
        const chainId = await detail.provider.request({ method: 'eth_chainId' }).catch(() => null);
        setSession({
          address: accounts[0],
          chainId: chainId ? Number(chainId) : null,
          info: detail.info,
          provider: detail.provider,
        });
      })
      .catch(() => { /* wallet locked or revoked — stay disconnected */ });
  }, [providers]);

  /* ---- follow the wallet's own state: account / network switches ---- */
  useEffect(() => {
    if (!session?.provider?.on) return undefined;
    const { provider } = session;

    const onAccounts = (accounts) => {
      if (!accounts?.length) {
        setSession(null);
        localStorage.removeItem(STORAGE_KEY);
      } else {
        setSession(s => (s ? { ...s, address: accounts[0] } : s));
      }
    };
    const onChain = (chainId) => {
      setSession(s => (s ? { ...s, chainId: Number(chainId) } : s));
    };

    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [session?.provider]);

  const connectWithProvider = useCallback(async (detail) => {
    setError(null);
    setConnecting(detail.info.uuid);
    try {
      const accounts = await detail.provider.request({ method: 'eth_requestAccounts' });
      if (!accounts?.length) return;
      const chainId = await detail.provider.request({ method: 'eth_chainId' }).catch(() => null);
      setSession({
        address: accounts[0],
        chainId: chainId ? Number(chainId) : null,
        info: detail.info,
        provider: detail.provider,
      });
      setIsDemo(false);
      localStorage.removeItem(DEMO_STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rdns: detail.info.rdns ?? detail.info.uuid }));
      setModalOpen(false);
    } catch (e) {
      // 4001 is the user declining in the wallet UI; anything else is an
      // actual fault, but both read the same to the person looking at it.
      setError(e?.code === 4001 ? 'rejected' : 'rejected');
    } finally {
      setConnecting(null);
    }
  }, []);

  /* jett semantics: connect() picks a wallet by itself — the single or
     preferred provider when one is announced, otherwise it opens the
     sheet (which also lists the demo wallets). Callers may still pass a
     specific provider detail, as the wallet sheet does. */
  const connect = useCallback(async (detail) => {
    if (detail?.provider) return connectWithProvider(detail);
    if (providers.length >= 1) {
      const preferred = providers.find(p => p.info.rdns?.includes('metamask')) || providers[0];
      return connectWithProvider(preferred);
    }
    setError(null);
    setModalOpen(true);
    return undefined;
  }, [providers, connectWithProvider]);

  const connectDemo = useCallback((address, chainIdOverride = 1) => {
    setError(null);
    setSession({
      address: address.toLowerCase(),
      chainId: Number(chainIdOverride),
      info: DEMO_PROVIDER_INFO,
      provider: null,
    });
    setIsDemo(true);
    setDemoOpen(false);
    setModalOpen(false);
    localStorage.removeItem(STORAGE_KEY);
    try {
      localStorage.setItem(
        DEMO_STORAGE_KEY,
        JSON.stringify({ address: address.toLowerCase(), chainId: Number(chainIdOverride) }),
      );
    } catch { /* ignore */ }
  }, []);

  const disconnect = useCallback(() => {
    const provider = sessionRef.current?.provider;
    setSession(null);
    setIsDemo(false);
    setDemoOpen(false);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEMO_STORAGE_KEY);
    // Not every wallet implements revokePermissions; the session above is
    // already gone either way, so a refusal is silent.
    provider?.request?.({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    }).catch(() => {});
  }, []);

  const switchChain = useCallback(async (chainId) => {
    // Demo wallet: no extension to ask, just move the local chain state.
    if (sessionRef.current && !sessionRef.current.provider) {
      const next = Number(chainId);
      setSession(s => (s ? { ...s, chainId: next } : s));
      try {
        localStorage.setItem(
          DEMO_STORAGE_KEY,
          JSON.stringify({ address: sessionRef.current.address, chainId: next }),
        );
      } catch { /* ignore */ }
      return;
    }
    await requestChain(sessionRef.current?.provider, chainId);
  }, []);

  const value = useMemo(() => ({
    providers,
    session,
    connecting,
    error,
    modalOpen,
    openModal: () => { setError(null); setModalOpen(true); },
    closeModal: () => setModalOpen(false),
    connect,
    disconnect,
    switchChain,
    // jett flat API (role / gate / workspace layers consume this)
    address: session?.address ?? null,
    chainId: session?.chainId ?? null,
    walletNetwork: session?.chainId != null ? getNetworkByChainId(session.chainId) : null,
    connected: Boolean(session?.address),
    shortAddress: session?.address ? truncateAddress(session.address) : '',
    isDemo,
    demoWallets: DEMO_WALLETS,
    demoOpen,
    setDemoOpen: (v) => {
      setDemoOpen(v);
      // The wallet sheet hosts the demo rows, so opening the demo picker
      // means opening the sheet.
      if (v) { setError(null); setModalOpen(true); }
    },
    connectDemo,
    connectWithProvider,
  }), [
    providers, session, connecting, error, modalOpen, isDemo, demoOpen,
    connect, disconnect, switchChain, connectDemo, connectWithProvider,
  ]);

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}
