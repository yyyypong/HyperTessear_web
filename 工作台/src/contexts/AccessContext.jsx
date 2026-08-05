import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { defaultDataProvider } from '../data/MockDataProvider';
import { useWallet } from '../wallet';
import { useNetwork } from './NetworkContext';

const AccessContext = createContext(null);

/**
 * Role / object access state sourced from FrontendDataProvider.
 * Reloads on wallet or network change; clears on disconnect.
 */
export function AccessProvider({ children, dataProvider = defaultDataProvider }) {
  const { address, connected } = useWallet();
  const { selectedNetworkId } = useNetwork();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  const [selectedVault, setSelectedVault] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [selectedWrappedAsset, setSelectedWrappedAsset] = useState(null);
  const [selectedRole, setSelectedRole] = useState(null);

  const clearManagementState = useCallback(() => {
    setSelectedVault(null);
    setSelectedAsset(null);
    setSelectedWrappedAsset(null);
    setSelectedRole(null);
  }, []);

  const reload = useCallback(async () => {
    if (!connected || !address) {
      setSnapshot(null);
      clearManagementState();
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await dataProvider.getAccessSnapshot(address);
      setSnapshot(snap);
    } catch (err) {
      setError(err?.message || 'Failed to load access data');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [connected, address, dataProvider, clearManagementState]);

  // Wallet change → re-run role recognition.
  useEffect(() => {
    reload();
  }, [reload]);

  // Network change → clear object / role / unsubmitted form state.
  useEffect(() => {
    clearManagementState();
  }, [selectedNetworkId, clearManagementState]);

  // Disconnect → clear everything.
  useEffect(() => {
    if (!connected) {
      setSnapshot(null);
      clearManagementState();
    }
  }, [connected, clearManagementState]);

  const governorNetworks = snapshot?.governorNetworks || [];
  const tokenAgentNetworks = snapshot?.tokenAgentNetworks || [];
  const isGovernor = governorNetworks.includes(selectedNetworkId)
    || governorNetworks.length > 0;
  const isGovernorOnSelected = governorNetworks.includes(selectedNetworkId);
  const isTokenAgentOnSelected = tokenAgentNetworks.includes(selectedNetworkId);

  const vaults = useMemo(
    () => snapshot?.vaults?.[selectedNetworkId] || [],
    [snapshot, selectedNetworkId],
  );
  const issuerAssets = useMemo(
    () => snapshot?.issuerAssets?.[selectedNetworkId] || [],
    [snapshot, selectedNetworkId],
  );
  const navAssets = useMemo(
    () => snapshot?.navAssets?.[selectedNetworkId] || [],
    [snapshot, selectedNetworkId],
  );
  const wrappedAssets = useMemo(
    () => snapshot?.wrappedAssets?.[selectedNetworkId] || [],
    [snapshot, selectedNetworkId],
  );

  const value = useMemo(() => ({
    dataProvider,
    loading,
    error,
    snapshot,
    reload,
    clearManagementState,

    governorNetworks,
    tokenAgentNetworks,
    isGovernor,
    isGovernorOnSelected,
    isTokenAgentOnSelected,

    vaults,
    issuerAssets,
    navAssets,
    wrappedAssets,

    selectedVault,
    setSelectedVault,
    selectedAsset,
    setSelectedAsset,
    selectedWrappedAsset,
    setSelectedWrappedAsset,
    selectedRole,
    setSelectedRole,
  }), [
    dataProvider, loading, error, snapshot, reload, clearManagementState,
    governorNetworks, tokenAgentNetworks, isGovernor, isGovernorOnSelected,
    isTokenAgentOnSelected, vaults, issuerAssets, navAssets, wrappedAssets,
    selectedVault, selectedAsset, selectedWrappedAsset, selectedRole,
  ]);

  return (
    <AccessContext.Provider value={value}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error('useAccess must be used within AccessProvider');
  return ctx;
}
