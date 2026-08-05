import { describe, expect, it } from 'vitest';
import { normalizeObjectContext, resolveCapability } from './capabilityResolver';

const vault = '0x0000000000000000000000000000000000000001';
const wallet = '0x0000000000000000000000000000000000000002';
const legacyAction = {
  id: 'vault.fees.set',
  scope: 'vault',
  capability: {
    legacy: { state: 'available', adapterMethod: 'BaseVault.setPerformanceFeeBps', requiredModules: ['EarnVault'] },
    target: { state: 'targetOnly', adapterMethod: null, requiredModules: ['VaultFeeController'] },
  },
};

function context(overrides = {}) {
  return {
    wallet,
    chainId: 97,
    deployment: { chainId: 97, profile: 'legacy' },
    object: { vault },
    adapter: { supports: () => true },
    isPaused: async () => false,
    isValidState: async () => true,
    isAuthorized: async () => true,
    ...overrides,
  };
}

describe('resolveCapability', () => {
  it('uses the required fail-closed precedence order', async () => {
    const result = await resolveCapability(context({
      wallet: null,
      chainId: 1,
      deployment: { chainId: 97, profile: 'legacy', supported: false },
      object: null,
      adapter: { supports: () => false },
      isPaused: async () => true,
      isValidState: async () => false,
      isAuthorized: async () => false,
    }), legacyAction);

    expect(result).toMatchObject({ state: 'walletRequired', reasonKey: 'workspaces.capabilities.walletRequired' });
  });

  it('returns targetOnly from the real capability profile before adapter or authorization checks', async () => {
    const result = await resolveCapability(context({
      adapter: { supports: () => { throw new Error('must not inspect target-only adapter'); } },
      isAuthorized: async () => { throw new Error('must not authorize target-only action'); },
    }), { ...legacyAction, capability: { ...legacyAction.capability, legacy: { state: 'targetOnly', adapterMethod: null, requiredModules: ['VaultRoles'] } } });

    expect(result).toEqual({
      state: 'targetOnly',
      reasonKey: 'workspaces.capabilities.targetOnly',
      detail: { actionId: 'vault.fees.set', requiredMethod: null, requiredModule: 'VaultRoles' },
    });
  });

  it('classifies a missing deployment manifest as unsupportedDeployment before a network comparison', async () => {
    const result = await resolveCapability(context({ deployment: null, chainId: 1 }), legacyAction);
    expect(result).toMatchObject({ state: 'unsupportedDeployment', detail: { check: 'deployment' } });
  });

  it('classifies an unknown deployment profile as unsupportedDeployment before a network comparison', async () => {
    const result = await resolveCapability(context({ deployment: { chainId: 97, profile: 'unknown' }, chainId: 1 }), legacyAction);
    expect(result).toMatchObject({ state: 'unsupportedDeployment', detail: { check: 'deployment' } });
  });

  it.each([
    ['missing', undefined],
    ['rejected', async () => { throw new Error('RPC unavailable'); }],
    ['non-boolean', async () => 'unknown'],
  ])('fails closed when the required pause hook is %s', async (_label, isPaused) => {
    const result = await resolveCapability(context({ isPaused }), legacyAction);
    expect(result).toMatchObject({ state: 'unsupportedDeployment', detail: { check: 'pause' } });
  });

  it.each([
    ['missing', undefined],
    ['rejected', async () => { throw new Error('RPC unavailable'); }],
    ['non-boolean', async () => null],
  ])('fails closed when the required state hook is %s', async (_label, isValidState) => {
    const result = await resolveCapability(context({ isValidState }), legacyAction);
    expect(result).toMatchObject({ state: 'unsupportedDeployment', detail: { check: 'state' } });
  });

  it.each([
    ['paused', { isPaused: async () => true }],
    ['invalidState', { isValidState: async () => false }],
    ['unauthorized', { isAuthorized: async () => false }],
  ])('returns %s before an absent adapter method', async (state, overrides) => {
    const result = await resolveCapability(context({
      adapter: { supports: () => false },
      ...overrides,
    }), legacyAction);
    expect(result.state).toBe(state);
  });

  it('returns unsupportedDeployment only after available safety checks find no adapter method', async () => {
    const result = await resolveCapability(context({ adapter: { supports: () => false } }), legacyAction);
    expect(result).toMatchObject({ state: 'unsupportedDeployment', detail: { check: 'adapter' } });
  });

  it.each([
    ['wrongNetwork', { chainId: 1 }],
    ['unsupportedDeployment', { deployment: { chainId: 97, profile: 'legacy', supported: false } }],
    ['objectRequired', { object: {} }],
    ['paused', { isPaused: async () => true }],
    ['invalidState', { isValidState: async () => false }],
    ['unauthorized', { isAuthorized: async () => false }],
  ])('returns %s at its precedence position', async (state, overrides) => {
    const result = await resolveCapability(context(overrides), legacyAction);
    expect(result.state).toBe(state);
    expect(result.reasonKey).toBe(`workspaces.capabilities.${state}`);
  });

  it('does not require a business role check for a permissionless relayer action', async () => {
    const result = await resolveCapability(context({
      object: null,
      isAuthorized: undefined,
    }), {
      id: 'settlement.batch.submit',
      scope: 'permissionless',
      capability: { legacy: { state: 'available', adapterMethod: 'submitBatch', requiredModules: ['Settlement'] } },
    });
    expect(result.state).toBe('available');
  });

  it('fails closed as unauthorized when a non-permissionless legacy action has no authorization hook', async () => {
    const result = await resolveCapability(context({ isAuthorized: undefined }), legacyAction);
    expect(result).toMatchObject({ state: 'unauthorized', detail: { actionId: 'vault.fees.set', check: 'authorization' } });
  });

  it('normalizes route params without inventing missing identifiers', () => {
    expect(normalizeObjectContext({ params: { vault, assetId: '7', adapter: '0xabc' } })).toEqual({ vault, assetId: '7', adapter: '0xabc' });
    expect(normalizeObjectContext({ params: { vault: '', assetId: null } })).toEqual({});
  });

  it('requires assetId for asset scope even when a wrapper route value is present', async () => {
    const result = await resolveCapability(context({ object: { wrapper: '0xwrapper' } }), {
      ...legacyAction,
      id: 'asset.metadata.update',
      scope: 'asset',
    });
    expect(result.state).toBe('objectRequired');
  });

  it('allows permissionless asset registration without a pre-existing asset or business authorization', async () => {
    const result = await resolveCapability(context({ object: null, isAuthorized: undefined }), {
      id: 'asset.register',
      scope: 'permissionless',
      capability: { legacy: { state: 'available', adapterMethod: 'AssetRegistry.registerAsset', requiredModules: ['AssetRegistry'] } },
    });
    expect(result.state).toBe('available');
  });
});
