import { describe, expect, it } from 'vitest';
import en from '../../i18n/en';
import zhCN from '../../i18n/zh-CN';
import { CAPABILITY_STATES } from '../core/capabilityStates';
import { FORM_SCHEMAS } from './formSchemas';
import {
  ACTION_DEFINITIONS,
  ROLE_DEFINITIONS,
  getActionDefinition,
  getRoleDefinition,
} from './roleDefinitions';

const REQUIRED_ROLES = [
  'governor',
  'vault-owner',
  'curator',
  'guardian',
  'allocator',
  'settlement-operator',
  'keeper',
  'asset-owner',
  'token-agent',
  'proof-publisher',
  'wrapper-controller',
  'nav-signer',
  'adapter-data-provider',
  'psm-authorized-signer',
  'relayer',
];

const REQUIRED_ACTIONS_BY_ROLE = {
  governor: ['governor.members.manage', 'protocol.modules.pause', 'psm.protocol.pause', 'revenue.treasury.set', 'nav.signer.manage', 'protocol.fee.config', 'revenue.withdraw', 'revenue.withdraw.token', 'revenue.sources.manage', 'nav.deviation.set'],
  'vault-owner': ['vault.roles.set', 'vault.settlement.configure', 'vault.modules.bind', 'vault.adapters.configure', 'vault.timelock.manage', 'vault.owner.transfer'],
  curator: ['vault.fees.set', 'vault.adapters.manage', 'vault.orders.manage', 'vault.data-policy.set', 'request.mark-refundable', 'claim.record', 'vault.evict-deposit'],
  guardian: ['vault.pause', 'vault.order.cancel', 'vault.allocator.freeze', 'vault.timelock.cancel'],
  allocator: ['vault.buy', 'vault.sell', 'vault.rebalance', 'vault.deal.clear', 'vault.bridge'],
  'settlement-operator': ['settlement.instruction.sign', 'settlement.return-principal'],
  keeper: ['lifecycle.open-subscription', 'lifecycle.finalize-subscription', 'lifecycle.start-calculation', 'lifecycle.enter-final-settlement', 'lifecycle.enter-maturing', 'lifecycle.enter-claiming', 'lifecycle.close-product'],
  'asset-owner': ['asset.register', 'asset.metadata.update', 'asset.owner.transfer', 'asset.deactivate', 'asset.roles.set', 'mint.initiate', 'burn.initiate'],
  'token-agent': ['mint.approve', 'burn.approve'],
  'proof-publisher': ['proof.publish'],
  'wrapper-controller': ['wrapper.deploy', 'wrapper.signer.set', 'wrapper.asset.pause'],
  'nav-signer': ['nav.sign'],
  'adapter-data-provider': ['adapter.deal-data.update'],
  'psm-authorized-signer': ['psm.authorization.sign'],
  relayer: ['settlement.batch.submit', 'nav.update.submit', 'psm.authorization.submit', 'vault.timelock.execute'],
};

const CURRENT_GET_CONTRACT_MAPPINGS = {
  'governor.members.manage': 'HyperAccessControl.grantRole/revokeRole',
  'protocol.modules.pause': 'StateManager.pauseModule/unpauseModule',
  'psm.protocol.pause': 'ReservePSM.pause/unpause',
  'revenue.treasury.set': 'RevenuePool.setYieldStrategy',
  'revenue.withdraw': 'RevenuePool.withdraw',
  'revenue.sources.manage': 'RevenuePool.addAuthorizedSource/removeAuthorizedSource',
  'nav.signer.manage': 'NAVOracle.addAuthorizedSigner/removeAuthorizedSigner',
  'vault.roles.set': 'BaseVault.setOperator',
  'vault.settlement.configure': 'Settlement.addOperator/removeOperator/setThreshold',
  'vault.modules.bind': 'BaseVault.setSettlement/setUnifiedPool/setGate; NAVOracle.addAuthorizedSigner',
  'vault.adapters.configure': 'BaseVault.addAdapter/removeAdapter',
  'vault.adapters.manage': 'BaseVault.addAdapter/removeAdapter',
  'vault.fees.set': 'BaseVault.setPerformanceFeeBps/setPerformanceFeeRecipient',
  'vault.orders.manage': 'BaseAdapter.createBuyOrder/createSellOrder/createRebalanceOrder',
  'vault.data-policy.set': 'BaseAdapter.setStalenessWindow',
  'vault.pause': 'StateManager.pause',
  'vault.order.cancel': 'BaseAdapter.cancelBuyOrder/cancelSellOrder/cancelRebalanceOrder',
  'vault.allocator.freeze': 'BaseAdapter.freezeAllocator/unfreezeAllocator',
  'vault.buy': 'BaseAdapter.executeBuy',
  'vault.sell': 'BaseAdapter.executeSell',
  'vault.rebalance': 'BaseAdapter.executeRebalance',
  'vault.deal.clear': 'BaseAdapter.clearDealValue',
  'vault.bridge': 'LiquidityAdapter.bridgeToCash',
  'request.mark-refundable': 'BaseVault.markRefundable',
  'claim.record': 'ClaimRegistry.recordClaim',
  'asset.register': 'AssetRegistry.registerAsset',
  'asset.metadata.update': 'AssetRegistry.updateMetadataHash',
  'asset.owner.transfer': 'AssetRegistry.transferAssetOwnership',
  'asset.deactivate': 'AssetRegistry.deactivateAsset',
  'proof.publish': 'PoRRegistry.publishReserveProof',
  'wrapper.signer.set': 'ReservePSM.setAuthorizedSigner',
  'wrapper.asset.pause': 'ReservePSM.pauseAsset/unpauseAsset',
  'adapter.deal-data.update': 'BaseAdapter.updateDealData',
};

const DIRECT_CURRENT_ACTIONS = [
  'settlement.instruction.sign', 'lifecycle.open-subscription', 'lifecycle.finalize-subscription',
  'lifecycle.start-calculation', 'lifecycle.enter-final-settlement', 'lifecycle.enter-maturing',
  'lifecycle.enter-claiming', 'lifecycle.close-product', 'mint.initiate', 'burn.initiate',
  'mint.approve', 'burn.approve', 'wrapper.deploy', 'nav.sign', 'psm.authorization.sign',
  'settlement.batch.submit', 'nav.update.submit', 'psm.authorization.submit',
];

function valueAt(object, dottedKey) {
  return dottedKey.split('.').reduce((value, key) => value?.[key], object);
}

describe('role registry', () => {
  it('covers every boss-document identity exactly once with its exact action group', () => {
    expect(Object.keys(ROLE_DEFINITIONS).sort()).toEqual(REQUIRED_ROLES.sort());
    for (const [roleId, expectedActions] of Object.entries(REQUIRED_ACTIONS_BY_ROLE)) {
      expect(ROLE_DEFINITIONS[roleId].actions).toEqual(expectedActions);
    }
  });

  it('resolves each role and action by its stable id', () => {
    expect(getRoleDefinition('vault-owner')?.path).toBe('/workspaces/vault-owner/:vault');
    expect(getRoleDefinition('creator')).toBeUndefined();
    expect(getActionDefinition('settlement.batch.submit')?.scope).toBe('permissionless');
    expect(getActionDefinition('asset.register')?.scope).toBe('permissionless');
    expect(getActionDefinition('missing.action')).toBeUndefined();
  });

  it('gives every action an explicit schema, scope, profile capability and translation metadata', () => {
    const actionIdsInRoles = Object.values(ROLE_DEFINITIONS).flatMap(role => role.actions);
    expect(new Set(actionIdsInRoles).size).toBe(actionIdsInRoles.length);

    for (const [actionId, action] of Object.entries(ACTION_DEFINITIONS)) {
      expect(action.id).toBe(actionId);
      expect(['protocol', 'vault', 'asset', 'wrapper', 'adapter', 'permissionless']).toContain(action.scope);
      expect(action.schemaId).toBeTruthy();
      expect(FORM_SCHEMAS[action.schemaId]).toBeDefined();
      expect(action.titleKey).toMatch(/^workspaces\.actions\./);
      expect(action.descriptionKey).toMatch(/^workspaces\.actions\./);
      expect(action.capability).toEqual(expect.objectContaining({ legacy: expect.any(Object), target: expect.any(Object) }));

      for (const profile of Object.values(action.capability)) {
        expect(Object.values(CAPABILITY_STATES)).toContain(profile.state);
        expect(['legacyCompatible', 'target']).toContain(profile.badge);
        expect(profile.requiredModules.length).toBeGreaterThan(0);
        if (profile.state === CAPABILITY_STATES.TARGET_ONLY) {
          expect(profile.adapterMethod).toBeNull();
        }
      }
    }
  });

  it('maps every normative getContract action to its executable legacy ABI method', () => {
    expect(Object.keys(CURRENT_GET_CONTRACT_MAPPINGS)).toHaveLength(33);
    for (const [actionId, adapterMethod] of Object.entries(CURRENT_GET_CONTRACT_MAPPINGS)) {
      expect(ACTION_DEFINITIONS[actionId].capability.legacy).toMatchObject({
        state: CAPABILITY_STATES.AVAILABLE,
        badge: 'legacyCompatible',
        adapterMethod,
      });
    }
  });

  it('keeps direct curated and signature actions executable in the legacy profile', () => {
    for (const actionId of DIRECT_CURRENT_ACTIONS) {
      const legacyProfile = ACTION_DEFINITIONS[actionId].capability.legacy;
      expect(legacyProfile.state).toBe(CAPABILITY_STATES.AVAILABLE);
      expect(legacyProfile.badge).toBe('legacyCompatible');
      expect(legacyProfile.adapterMethod).toBeTruthy();
    }
  });

  it('uses target badges when a legacy mapping is deliberately unavailable', () => {
    // These stay fail-closed on the current deployment: the manifest has no
    // ProtocolTimelock address, BaseVault exposes no ownership transfer, and
    // MintBurnController/PoRRegistry expose no per-asset role setters.
    for (const actionId of ['vault.timelock.manage', 'vault.timelock.cancel', 'vault.timelock.execute', 'vault.owner.transfer', 'asset.roles.set']) {
      expect(ACTION_DEFINITIONS[actionId].capability.legacy).toMatchObject({
        state: CAPABILITY_STATES.TARGET_ONLY,
        badge: 'target',
        adapterMethod: null,
      });
    }
  });

  it('uses parser-oriented form fields with validation metadata', () => {
    const validTypes = ['address', 'amount', 'bigint', 'integer', 'text', 'bytes', 'bytes32', 'bytes-array', 'datetime', 'json', 'select', 'boolean'];
    expect(Object.keys(FORM_SCHEMAS).sort()).toEqual(Object.keys(ACTION_DEFINITIONS).sort());

    for (const schema of Object.values(FORM_SCHEMAS)) {
      expect(schema.id).toBeTruthy();
      expect(schema.fields.length).toBeGreaterThan(0);
      for (const field of schema.fields) {
        expect(validTypes).toContain(field.type);
        expect(field.labelKey).toMatch(/^workspaces\.forms\.fields\./);
        expect(field.validation).toBeDefined();
      }
    }
  });

  it('exposes adapter-critical current input names without an implicit transform', () => {
    const requiredFields = {
      'nav.update.submit': ['vault', 'nav', 'dataTimestamp', 'sig'],
      'wrapper.deploy': ['assetId', 'mode', 'underlyingToken', 'name', 'symbol', 'decimals', 'allowPartialUnwrap'],
      'psm.authorization.sign': ['assetId', 'amount', 'to', 'documentId', 'nonce', 'expiry'],
      'psm.authorization.submit': ['assetId', 'amount', 'to', 'nonce', 'expiry', 'signature', 'documentId'],
    };

    for (const [actionId, fields] of Object.entries(requiredFields)) {
      expect(FORM_SCHEMAS[actionId].fields.map(field => field.name)).toEqual(fields);
    }
  });

  it('provides every registry translation in both locales', () => {
    const keys = [
      ...Object.values(ROLE_DEFINITIONS).flatMap(role => [role.titleKey, role.descriptionKey]),
      ...Object.values(ACTION_DEFINITIONS).flatMap(action => [action.titleKey, action.descriptionKey]),
      ...Object.values(FORM_SCHEMAS).flatMap(schema => schema.fields.flatMap(field => [field.labelKey, field.descriptionKey, field.validation.messageKey])),
      ...Object.values(CAPABILITY_STATES).map(state => `workspaces.capabilities.${state}`),
      'workspaces.badges.legacyCompatible',
      'workspaces.badges.target',
      'workspaces.transaction.prepared',
      'workspaces.transaction.awaitingWallet',
      'workspaces.transaction.submitted',
      'workspaces.transaction.confirmed',
      'workspaces.transaction.signed',
      'workspaces.transaction.rejected',
      'workspaces.transaction.failed',
    ];

    for (const key of keys) {
      expect(valueAt(en, key), `English translation missing: ${key}`).toBeTypeOf('string');
      expect(valueAt(zhCN, key), `Chinese translation missing: ${key}`).toBeTypeOf('string');
    }
  });

  it('describes asset identifiers as positive in both public form locales', () => {
    expect(valueAt(en, 'workspaces.forms.fields.assetId.description')).toBe('The positive onchain asset identifier.');
    expect(valueAt(zhCN, 'workspaces.forms.fields.assetId.description')).toBe('正整数链上资产标识。');
  });
});
