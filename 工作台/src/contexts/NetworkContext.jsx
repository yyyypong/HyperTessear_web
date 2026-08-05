import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_NETWORK_ID,
  SUPPORTED_NETWORKS,
  getNetworkById,
} from '../config/networks';
import { useWallet } from '../wallet';

const NetworkContext = createContext(null);
const STORAGE_KEY = 'hyt.selectedNetwork';

/**
 * Global business-network selection (not encoded in the URL).
 * Clears dependent management selections when the network changes —
 * AccessContext listens via onNetworkChange / selectedNetworkId.
 */
export function NetworkProvider({ children }) {
  const { connected, chainId, walletNetwork, switchChain } = useWallet();

  const [selectedNetworkId, setSelectedNetworkIdState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && getNetworkById(saved)) return saved;
    } catch { /* ignore */ }
    return DEFAULT_NETWORK_ID;
  });

  const selectedNetwork = useMemo(
    () => getNetworkById(selectedNetworkId) || SUPPORTED_NETWORKS[0],
    [selectedNetworkId],
  );

  const walletMatches = Boolean(
    connected
    && walletNetwork
    && walletNetwork.id === selectedNetworkId,
  );

  const mismatch = Boolean(connected && chainId != null && !walletMatches);

  const setSelectedNetworkId = useCallback((id) => {
    if (!getNetworkById(id)) return;
    setSelectedNetworkIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  const requestWalletSwitch = useCallback(async () => {
    if (!selectedNetwork) return;
    await switchChain(selectedNetwork.chainId);
  }, [selectedNetwork, switchChain]);

  // When wallet connects on a supported chain, align business network once.
  useEffect(() => {
    if (connected && walletNetwork) {
      setSelectedNetworkIdState(prev => {
        if (prev === walletNetwork.id) return prev;
        // Only auto-align if user has not explicitly chosen yet this session
        // — keep explicit selection; do not overwrite on every render.
        return prev;
      });
    }
  }, [connected, walletNetwork]);

  const value = useMemo(() => ({
    supportedNetworks: SUPPORTED_NETWORKS,
    selectedNetworkId,
    selectedNetwork,
    setSelectedNetworkId,
    walletMatches,
    mismatch,
    requestWalletSwitch,
  }), [
    selectedNetworkId, selectedNetwork, setSelectedNetworkId,
    walletMatches, mismatch, requestWalletSwitch,
  ]);

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}
