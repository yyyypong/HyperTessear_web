import { CAPABILITY_STATES } from '../core/capabilityStates';

const legacy = (adapterMethod, requiredModules) => ({
  state: adapterMethod ? CAPABILITY_STATES.AVAILABLE : CAPABILITY_STATES.TARGET_ONLY,
  badge: adapterMethod ? 'legacyCompatible' : 'target',
  adapterMethod: adapterMethod ?? null,
  requiredModules,
});

const target = (targetAdapterMethod, requiredModules) => ({
  state: CAPABILITY_STATES.TARGET_ONLY,
  badge: 'target',
  adapterMethod: null,
  targetAdapterMethod,
  requiredModules,
});

const role = (id, path, scope, actions) => ({
  id,
  path,
  scope,
  titleKey: `workspaces.roles.${id}.title`,
  descriptionKey: `workspaces.roles.${id}.description`,
  actions,
});

const action = (id, scope, legacyMethod, legacyModules, targetMethod, targetModules) => ({
  id,
  scope,
  titleKey: `workspaces.actions.${id.replaceAll('.', '-')}.title`,
  descriptionKey: `workspaces.actions.${id.replaceAll('.', '-')}.description`,
  schemaId: id,
  capability: {
    legacy: legacy(legacyMethod, legacyModules),
    target: target(targetMethod, targetModules),
  },
});

/** The 15 administrative identities from the approved role model. */
export const ROLE_DEFINITIONS = Object.freeze({
  governor: role('governor', '/workspaces/governor', 'protocol', ['governor.members.manage', 'protocol.modules.pause', 'psm.protocol.pause', 'revenue.treasury.set']),
  'vault-owner': role('vault-owner', '/workspaces/vault-owner/:vault', 'vault', ['vault.roles.set', 'vault.settlement.configure', 'vault.modules.bind', 'vault.adapters.configure', 'vault.timelock.manage', 'vault.owner.transfer']),
  curator: role('curator', '/workspaces/curator/:vault', 'vault', ['vault.fees.set', 'vault.adapters.manage', 'vault.orders.manage', 'vault.data-policy.set']),
  guardian: role('guardian', '/workspaces/guardian/:vault', 'vault', ['vault.pause', 'vault.order.cancel', 'vault.allocator.freeze', 'vault.timelock.cancel']),
  allocator: role('allocator', '/workspaces/allocator/:vault', 'vault', ['vault.buy', 'vault.sell', 'vault.rebalance', 'vault.deal.clear', 'vault.bridge']),
  'settlement-operator': role('settlement-operator', '/workspaces/settlement-operator/:vault', 'vault', ['settlement.instruction.sign']),
  keeper: role('keeper', '/workspaces/keeper/:vault', 'vault', ['lifecycle.open-subscription', 'lifecycle.finalize-subscription', 'lifecycle.start-calculation', 'lifecycle.enter-final-settlement', 'lifecycle.enter-maturing', 'lifecycle.enter-claiming', 'lifecycle.close-product', 'request.mark-refundable', 'claim.record']),
  'asset-owner': role('asset-owner', '/workspaces/asset-owner/:assetId', 'asset', ['asset.register', 'asset.metadata.update', 'asset.owner.transfer', 'asset.deactivate', 'asset.roles.set', 'mint.initiate', 'burn.initiate']),
  'token-agent': role('token-agent', '/workspaces/token-agent/:assetId', 'asset', ['mint.approve', 'burn.approve']),
  'proof-publisher': role('proof-publisher', '/workspaces/proof-publisher/:assetId', 'asset', ['proof.publish']),
  'wrapper-controller': role('wrapper-controller', '/workspaces/wrapper-controller/:assetId', 'wrapper', ['wrapper.deploy', 'wrapper.signer.set', 'wrapper.asset.pause']),
  'nav-signer': role('nav-signer', '/workspaces/nav-signer/:vault', 'vault', ['nav.sign']),
  'adapter-data-provider': role('adapter-data-provider', '/workspaces/adapter-data-provider/:adapter', 'adapter', ['adapter.deal-data.update']),
  'psm-authorized-signer': role('psm-authorized-signer', '/workspaces/psm-authorized-signer/:assetId', 'asset', ['psm.authorization.sign']),
  relayer: role('relayer', '/workspaces/relayer', 'permissionless', ['settlement.batch.submit', 'nav.update.submit', 'psm.authorization.submit', 'vault.timelock.execute']),
});

/**
 * An action's legacy adapter method is the only executable route in the
 * current deployment. A null legacy method (and every target profile today)
 * is intentionally fail-closed until an adapter advertises the exact method.
 */
export const ACTION_DEFINITIONS = Object.freeze({
  'governor.members.manage': action('governor.members.manage', 'protocol', 'HyperAccessControl.grantRole/revokeRole', ['HyperAccessControl'], 'manageGovernorMembers', ['TargetAccessControl']),
  'protocol.modules.pause': action('protocol.modules.pause', 'protocol', 'StateManager.pauseModule/unpauseModule', ['StateManager'], 'setProtocolModulePaused', ['ProtocolPauseController']),
  'psm.protocol.pause': action('psm.protocol.pause', 'protocol', 'ReservePSM.pause/unpause', ['ReservePSM'], 'setProtocolPsmPaused', ['ReservePSM']),
  'revenue.treasury.set': action('revenue.treasury.set', 'protocol', null, ['RevenuePool'], 'setRevenueTreasury', ['RevenuePool']),
  'vault.roles.set': action('vault.roles.set', 'vault', null, ['Vault'], 'setVaultRole', ['VaultRoles']),
  'vault.settlement.configure': action('vault.settlement.configure', 'vault', null, ['Settlement'], 'configureVaultSettlement', ['VaultSettlementConfig']),
  'vault.modules.bind': action('vault.modules.bind', 'vault', null, ['Vault'], 'bindVaultModules', ['VaultModuleRegistry']),
  'vault.adapters.configure': action('vault.adapters.configure', 'vault', null, ['AdapterRegistry'], 'configureVaultAdapter', ['AdapterRegistry']),
  'vault.timelock.manage': action('vault.timelock.manage', 'vault', null, ['VaultTimelock'], 'manageVaultTimelock', ['VaultTimelock']),
  'vault.owner.transfer': action('vault.owner.transfer', 'vault', null, ['Vault'], 'transferVaultOwner', ['VaultOwnership']),
  'vault.fees.set': action('vault.fees.set', 'vault', 'BaseVault.setPerformanceFeeBps/setPerformanceFeeRecipient', ['BaseVault'], 'setVaultFees', ['VaultFeeController']),
  'vault.adapters.manage': action('vault.adapters.manage', 'vault', null, ['AdapterRegistry'], 'manageVaultAdapter', ['AdapterRegistry']),
  'vault.orders.manage': action('vault.orders.manage', 'vault', 'BaseAdapter.createBuyOrder/createSellOrder/createRebalanceOrder', ['BaseAdapter'], 'manageVaultOrder', ['VaultOrderBook']),
  'vault.data-policy.set': action('vault.data-policy.set', 'vault', 'BaseAdapter.setStalenessWindow', ['BaseAdapter'], 'setVaultDataPolicy', ['VaultDataPolicy']),
  'vault.pause': action('vault.pause', 'vault', 'StateManager.pause', ['StateManager'], 'setVaultPaused', ['VaultPauseController']),
  'vault.order.cancel': action('vault.order.cancel', 'vault', 'BaseAdapter.cancelBuyOrder/cancelSellOrder/cancelRebalanceOrder', ['BaseAdapter'], 'cancelVaultOrder', ['VaultOrderBook']),
  'vault.allocator.freeze': action('vault.allocator.freeze', 'vault', 'BaseAdapter.freezeAllocator/unfreezeAllocator', ['BaseAdapter'], 'freezeVaultAllocator', ['VaultRoles']),
  'vault.timelock.cancel': action('vault.timelock.cancel', 'vault', null, ['VaultTimelock'], 'cancelVaultTimelockOperation', ['VaultTimelock']),
  'vault.buy': action('vault.buy', 'vault', 'BaseAdapter.executeBuy', ['BaseAdapter'], 'executeVaultBuy', ['VaultAllocator']),
  'vault.sell': action('vault.sell', 'vault', 'BaseAdapter.executeSell', ['BaseAdapter'], 'executeVaultSell', ['VaultAllocator']),
  'vault.rebalance': action('vault.rebalance', 'vault', 'BaseAdapter.executeRebalance', ['BaseAdapter'], 'executeVaultRebalance', ['VaultAllocator']),
  'vault.deal.clear': action('vault.deal.clear', 'vault', 'BaseAdapter.clearDealValue', ['BaseAdapter'], 'clearVaultDeal', ['VaultAllocator']),
  'vault.bridge': action('vault.bridge', 'vault', 'LiquidityAdapter.bridgeToCash', ['LiquidityAdapter'], 'bridgeVaultAssets', ['VaultAllocator']),
  'settlement.instruction.sign': action('settlement.instruction.sign', 'vault', 'signSettlementInstruction', ['Settlement'], 'signVaultSettlementInstruction', ['VaultSettlementConfig']),
  'lifecycle.open-subscription': action('lifecycle.open-subscription', 'vault', 'openSubscription', ['StateManager'], 'openSubscription', ['VaultLifecycle']),
  'lifecycle.finalize-subscription': action('lifecycle.finalize-subscription', 'vault', 'finalizeSubscription', ['StateManager'], 'finalizeSubscription', ['VaultLifecycle']),
  'lifecycle.start-calculation': action('lifecycle.start-calculation', 'vault', 'startCycleCalculation', ['StateManager'], 'startCalculation', ['VaultLifecycle']),
  'lifecycle.enter-final-settlement': action('lifecycle.enter-final-settlement', 'vault', 'enterFinalSettlement', ['StateManager'], 'enterFinalSettlement', ['VaultLifecycle']),
  'lifecycle.enter-maturing': action('lifecycle.enter-maturing', 'vault', 'enterMaturing', ['StateManager'], 'enterMaturing', ['VaultLifecycle']),
  'lifecycle.enter-claiming': action('lifecycle.enter-claiming', 'vault', 'enterClaiming', ['StateManager'], 'enterClaiming', ['VaultLifecycle']),
  'lifecycle.close-product': action('lifecycle.close-product', 'vault', 'closeProduct', ['StateManager'], 'closeProduct', ['VaultLifecycle']),
  'request.mark-refundable': action('request.mark-refundable', 'vault', 'BaseVault.markRefundable', ['BaseVault'], 'markRequestRefundable', ['VaultRequestManager']),
  'claim.record': action('claim.record', 'vault', 'ClaimRegistry.recordClaim', ['ClaimRegistry'], 'recordClaim', ['VaultClaimManager']),
  'asset.register': action('asset.register', 'permissionless', 'AssetRegistry.registerAsset', ['AssetRegistry'], 'registerAsset', ['AssetRegistry']),
  'asset.metadata.update': action('asset.metadata.update', 'asset', 'AssetRegistry.updateMetadataHash', ['AssetRegistry'], 'updateAssetMetadata', ['AssetRegistry']),
  'asset.owner.transfer': action('asset.owner.transfer', 'asset', 'AssetRegistry.transferAssetOwnership', ['AssetRegistry'], 'transferAssetOwner', ['AssetRegistry']),
  'asset.deactivate': action('asset.deactivate', 'asset', 'AssetRegistry.deactivateAsset', ['AssetRegistry'], 'deactivateAsset', ['AssetRegistry']),
  'asset.roles.set': action('asset.roles.set', 'asset', null, ['AssetRegistry'], 'setAssetRole', ['AssetRoles']),
  'mint.initiate': action('mint.initiate', 'asset', 'initiateMint', ['MintBurnController'], 'initiateMint', ['MintBurnController']),
  'burn.initiate': action('burn.initiate', 'asset', 'initiateBurn', ['MintBurnController'], 'initiateBurn', ['MintBurnController']),
  'mint.approve': action('mint.approve', 'asset', 'approveMint', ['MintBurnController'], 'approveMint', ['MintBurnController']),
  'burn.approve': action('burn.approve', 'asset', 'approveBurn', ['MintBurnController'], 'approveBurn', ['MintBurnController']),
  'proof.publish': action('proof.publish', 'asset', 'PoRRegistry.publishReserveProof', ['PoRRegistry'], 'publishAssetProof', ['AssetProofRegistry']),
  'wrapper.deploy': action('wrapper.deploy', 'wrapper', 'deployWrappedToken', ['ReservePSM'], 'deployWrapper', ['WrapperFactory']),
  'wrapper.signer.set': action('wrapper.signer.set', 'wrapper', 'ReservePSM.setAuthorizedSigner', ['ReservePSM'], 'setWrapperAuthorizedSigner', ['WrapperController']),
  'wrapper.asset.pause': action('wrapper.asset.pause', 'wrapper', 'ReservePSM.pauseAsset/unpauseAsset', ['ReservePSM'], 'setWrapperAssetPaused', ['WrapperController']),
  'nav.sign': action('nav.sign', 'vault', 'signLegacyNavDigest', ['NAVOracle'], 'signNavUpdate', ['TargetNAVOracle']),
  'adapter.deal-data.update': action('adapter.deal-data.update', 'adapter', 'BaseAdapter.updateDealData', ['BaseAdapter'], 'updateDealData', ['Adapter']),
  'psm.authorization.sign': action('psm.authorization.sign', 'asset', null, ['ReservePSM'], 'signPsmAuthorization', ['ReservePSM']),
  'settlement.batch.submit': action('settlement.batch.submit', 'permissionless', 'submitBatch', ['Settlement'], 'submitSettlementBatch', ['VaultSettlementConfig']),
  'nav.update.submit': action('nav.update.submit', 'permissionless', 'updateNAV', ['NAVOracle'], 'submitNavUpdate', ['TargetNAVOracle']),
  'psm.authorization.submit': action('psm.authorization.submit', 'permissionless', null, ['ReservePSM'], 'submitPsmAuthorization', ['ReservePSM']),
  'vault.timelock.execute': action('vault.timelock.execute', 'permissionless', null, ['VaultTimelock'], 'executeVaultTimelockOperation', ['VaultTimelock']),
  'request.deposit': action('request.deposit', 'permissionless', 'requestDeposit', ['BaseVault'], 'requestDeposit', ['VaultRequestManager']),
  'request.deposit.claim': action('request.deposit.claim', 'permissionless', 'claimDeposit', ['BaseVault'], 'claimDeposit', ['VaultRequestManager']),
  'request.redeem': action('request.redeem', 'permissionless', 'requestRedeem', ['BaseVault'], 'requestRedeem', ['VaultRequestManager']),
  'request.redeem.claim': action('request.redeem.claim', 'permissionless', 'claimRedeem', ['BaseVault'], 'claimRedeem', ['VaultRequestManager']),
  'request.cancel': action('request.cancel', 'permissionless', 'cancelRequest', ['BaseVault'], 'cancelRequest', ['VaultRequestManager']),
  'request.refund.claim': action('request.refund.claim', 'permissionless', 'claimRefund', ['BaseVault'], 'claimRefund', ['VaultRequestManager']),
  'wrapper.wrap': action('wrapper.wrap', 'permissionless', 'wrap', ['ReservePSM'], 'wrap', ['ReservePSM']),
  'wrapper.unwrap': action('wrapper.unwrap', 'permissionless', 'unwrap', ['ReservePSM'], 'unwrap', ['ReservePSM']),
});

export function getRoleDefinition(roleId) {
  return ROLE_DEFINITIONS[roleId];
}

export function getActionDefinition(actionId) {
  return ACTION_DEFINITIONS[actionId];
}
