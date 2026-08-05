import { FrontendDataProvider } from './FrontendDataProvider';
import { SUPPORTED_NETWORKS } from '../config/networks';
import { fetchMockAccessSnapshot } from './mockAccessData';

/**
 * Mock implementation of FrontendDataProvider.
 * Swap for OnchainDataProvider later without rewriting pages or routes.
 */
export class MockDataProvider extends FrontendDataProvider {
  getSupportedNetworks() {
    return SUPPORTED_NETWORKS;
  }

  async getAccessSnapshot(address) {
    return fetchMockAccessSnapshot(address);
  }

  async getGovernorNetworks(address) {
    const snap = await this.getAccessSnapshot(address);
    return snap.governorNetworks;
  }

  async getTokenAgentNetworks(address) {
    const snap = await this.getAccessSnapshot(address);
    return snap.tokenAgentNetworks;
  }

  async getVaultsForAddress(address, networkId) {
    const snap = await this.getAccessSnapshot(address);
    return snap.vaults[networkId] || [];
  }

  async getVaultRoles(address, networkId, vaultAddress) {
    const vaults = await this.getVaultsForAddress(address, networkId);
    const vault = vaults.find(
      v => v.address.toLowerCase() === String(vaultAddress).toLowerCase()
        || v.id === vaultAddress,
    );
    return vault?.roles || [];
  }

  async getIssuerAssets(address, networkId) {
    const snap = await this.getAccessSnapshot(address);
    return snap.issuerAssets[networkId] || [];
  }

  async getNavProviderAssets(address, networkId) {
    const snap = await this.getAccessSnapshot(address);
    return snap.navAssets[networkId] || [];
  }

  async getWrappedAssets(address, networkId) {
    const snap = await this.getAccessSnapshot(address);
    return snap.wrappedAssets[networkId] || [];
  }

  async getWrappedRoles(address, networkId, wrappedAssetId) {
    const list = await this.getWrappedAssets(address, networkId);
    const item = list.find(
      w => w.id === wrappedAssetId
        || w.address.toLowerCase() === String(wrappedAssetId).toLowerCase(),
    );
    return item?.roles || [];
  }
}

export const defaultDataProvider = new MockDataProvider();
