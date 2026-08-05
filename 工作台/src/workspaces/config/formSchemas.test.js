import { describe, expect, it } from 'vitest';
import { FORM_SCHEMAS } from './formSchemas';

const fieldsOf = actionId => FORM_SCHEMAS[actionId].fields;
const namesOf = actionId => fieldsOf(actionId).map(field => field.name);

describe('current escape-hatch form schemas', () => {
  it('exposes only ABI arguments and lets the deployment bind ABI/address pairs', () => {
    expect(namesOf('vault.fees.set')).toEqual(['vault', 'feeBps', 'recipient']);
    expect(namesOf('vault.orders.manage')).toEqual(['vault', 'adapter', 'operation', 'order']);
    expect(namesOf('claim.record')).toEqual(['vault', 'owner', 'requestId', 'assets', 'kind']);
    expect(namesOf('adapter.deal-data.update')).toEqual(['adapter', 'dealId', 'newValue']);
  });

  it('uses ABI-compatible module and operation variants', () => {
    const module = fieldsOf('protocol.modules.pause').find(field => field.name === 'module');
    expect(module).toMatchObject({ type: 'integer', validation: { messageKey: 'workspaces.forms.validation.range', min: 0, max: 255 } });
    expect(fieldsOf('vault.orders.manage').find(field => field.name === 'operation')?.options).toEqual(['buy', 'sell', 'rebalance']);
    expect(fieldsOf('vault.order.cancel').find(field => field.name === 'operation')?.options).toEqual(['buy', 'sell', 'rebalance']);
    expect(namesOf('vault.allocator.freeze')).toContain('paused');
    expect(namesOf('vault.pause')).toContain('reason');
  });

  it('does not expose ABI selectors, arbitrary system contract addresses, or unused legacy inputs', () => {
    const forbidden = ['vaultContractName', 'adapterContractName', 'claimRegistry', 'allocator', 'minOut', 'slippageBps', 'rebalancePlan', 'settlementData', 'destinationChainId', 'deactivationReason', 'navToleranceBps', 'bridgeChainId'];
    for (const actionId of ['vault.fees.set', 'vault.orders.manage', 'vault.data-policy.set', 'vault.order.cancel', 'vault.allocator.freeze', 'vault.buy', 'vault.sell', 'vault.rebalance', 'vault.deal.clear', 'request.mark-refundable', 'claim.record', 'adapter.deal-data.update']) {
      expect(namesOf(actionId).filter(name => forbidden.includes(name))).toEqual([]);
    }
    expect(namesOf('psm.protocol.pause')).not.toContain('psm');
    expect(namesOf('asset.deactivate')).toEqual(['assetId']);
    expect(namesOf('vault.bridge')).toEqual(['vault', 'adapter', 'amount']);
    expect(namesOf('wrapper.signer.set')).toEqual(['assetId', 'authorizedSigner']);
    expect(namesOf('wrapper.asset.pause')).toEqual(['assetId', 'paused']);
  });
});
