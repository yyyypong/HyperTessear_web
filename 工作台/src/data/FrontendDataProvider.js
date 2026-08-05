/**
 * Stable frontend data interface.
 * Pages must not import mock files directly — go through AccessContext,
 * which holds the active FrontendDataProvider implementation.
 */

export class FrontendDataProvider {
  getSupportedNetworks() {
    throw new Error('Not implemented');
  }

  async getAccessSnapshot(_address) {
    throw new Error('Not implemented');
  }

  async getGovernorNetworks(_address) {
    throw new Error('Not implemented');
  }

  async getTokenAgentNetworks(_address) {
    throw new Error('Not implemented');
  }

  async getVaultsForAddress(_address, _networkId) {
    throw new Error('Not implemented');
  }

  async getVaultRoles(_address, _networkId, _vaultAddress) {
    throw new Error('Not implemented');
  }

  async getIssuerAssets(_address, _networkId) {
    throw new Error('Not implemented');
  }

  async getNavProviderAssets(_address, _networkId) {
    throw new Error('Not implemented');
  }

  async getWrappedAssets(_address, _networkId) {
    throw new Error('Not implemented');
  }

  async getWrappedRoles(_address, _networkId, _wrappedAssetId) {
    throw new Error('Not implemented');
  }
}
