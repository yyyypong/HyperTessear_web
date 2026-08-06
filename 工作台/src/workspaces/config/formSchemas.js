const field = (name, type, { validation = 'required', validationMeta = {}, ...options } = {}) => ({
  name,
  type,
  required: true,
  labelKey: `workspaces.forms.fields.${name}.label`,
  descriptionKey: `workspaces.forms.fields.${name}.description`,
  validation: {
    messageKey: `workspaces.forms.validation.${validation}`,
    ...validationMeta,
  },
  ...options,
});

const vault = () => field('vault', 'address');
const asset = () => field('assetId', 'bigint', { validation: 'positive', canonicalPositiveUint: true });
const account = () => field('account', 'address');
const action = () => field('operation', 'select', { options: ['grant', 'revoke', 'pause', 'unpause', 'set', 'replace'] });
// Asset/token amounts use a chain-read decimal count supplied at validation time.
const amount = () => field('amount', 'amount', { decimals: 'asset', validation: 'positive', validationMeta: { min: '1' } });
const requestId = () => field('requestId', 'bigint', { validation: 'positive', validationMeta: { min: '1' }, canonicalPositiveUint: true });
const tranche = () => field('tranche', 'select', { options: ['cash', 'note', 'lp'] });
const deadline = () => field('deadline', 'datetime', { validation: 'future' });
const expiry = () => field('expiry', 'datetime', { validation: 'future' });

/**
 * Parser-facing schemas for every role action. Target-only schemas remain
 * deliberate interfaces: the UI can explain their future input shape without
 * constructing calldata until a matching adapter is installed.
 */
export const FORM_SCHEMAS = Object.freeze({
  'governor.members.manage': { id: 'governor.members.manage', fields: [action(), account(), field('role', 'bytes32')] },
  'protocol.modules.pause': { id: 'protocol.modules.pause', fields: [field('module', 'integer', { validation: 'range', validationMeta: { min: 0, max: 255 } }), field('paused', 'boolean')] },
  'psm.protocol.pause': { id: 'psm.protocol.pause', fields: [field('paused', 'boolean')] },
  'revenue.treasury.set': { id: 'revenue.treasury.set', fields: [field('treasury', 'address')] },
  'nav.signer.manage': { id: 'nav.signer.manage', fields: [vault(), account(), field('operation', 'select', { options: ['add', 'remove'] })] },

  'vault.roles.set': { id: 'vault.roles.set', fields: [vault(), field('role', 'select', { options: ['curator', 'guardian', 'allocator', 'keeper'] }), account(), field('enabled', 'boolean')] },
  'vault.settlement.configure': { id: 'vault.settlement.configure', fields: [vault(), field('operation', 'select', { options: ['add-operator', 'remove-operator', 'set-threshold'] }), field('account', 'address', { required: false }), field('threshold', 'integer', { required: false, validation: 'positive', validationMeta: { min: 1 } })] },
  'vault.modules.bind': { id: 'vault.modules.bind', fields: [vault(), field('operation', 'select', { options: ['settlement', 'unified-pool', 'gate', 'nav-signer'] }), field('contract', 'address')] },
  'vault.adapters.configure': { id: 'vault.adapters.configure', fields: [vault(), field('adapter', 'address'), field('enabled', 'boolean')] },
  'vault.timelock.manage': { id: 'vault.timelock.manage', fields: [vault(), action(), field('timelockOperation', 'bytes32')] },
  'vault.owner.transfer': { id: 'vault.owner.transfer', fields: [vault(), field('newOwner', 'address')] },

  'vault.fees.set': { id: 'vault.fees.set', fields: [vault(), field('feeBps', 'integer', { required: false, validation: 'range', validationMeta: { min: 0, max: 10000 } }), field('recipient', 'address', { required: false })] },
  'vault.adapters.manage': { id: 'vault.adapters.manage', fields: [vault(), field('adapter', 'address'), field('enabled', 'boolean')] },
  'vault.orders.manage': { id: 'vault.orders.manage', fields: [vault(), field('adapter', 'address'), field('operation', 'select', { options: ['buy', 'sell', 'rebalance'] }), field('order', 'json')] },
  'vault.data-policy.set': { id: 'vault.data-policy.set', fields: [vault(), field('adapter', 'address'), field('maxDataAge', 'integer', { validation: 'positive', validationMeta: { min: 1 } })] },

  'vault.pause': { id: 'vault.pause', fields: [vault(), field('paused', 'boolean'), field('reason', 'integer', { required: false, validation: 'range', validationMeta: { min: 0, max: 255 } })] },
  'vault.order.cancel': { id: 'vault.order.cancel', fields: [vault(), field('adapter', 'address'), field('operation', 'select', { options: ['buy', 'sell', 'rebalance'] }), field('orderId', 'bigint')] },
  'vault.allocator.freeze': { id: 'vault.allocator.freeze', fields: [vault(), field('adapter', 'address'), field('paused', 'boolean')] },
  'vault.timelock.cancel': { id: 'vault.timelock.cancel', fields: [vault(), field('timelockOperation', 'bytes32'), field('impactAcknowledged', 'boolean')] },

  'vault.buy': { id: 'vault.buy', fields: [vault(), field('adapter', 'address'), field('orderId', 'bigint')] },
  'vault.sell': { id: 'vault.sell', fields: [vault(), field('adapter', 'address'), field('orderId', 'bigint')] },
  'vault.rebalance': { id: 'vault.rebalance', fields: [vault(), field('adapter', 'address'), field('orderId', 'bigint')] },
  'vault.deal.clear': { id: 'vault.deal.clear', fields: [vault(), field('adapter', 'address'), field('dealId', 'bigint')] },
  'vault.bridge': { id: 'vault.bridge', fields: [vault(), field('adapter', 'address'), amount()] },

  'settlement.instruction.sign': { id: 'settlement.instruction.sign', fields: [vault(), field('instruction', 'json'), deadline()] },
  'lifecycle.open-subscription': { id: 'lifecycle.open-subscription', fields: [vault()] },
  'lifecycle.finalize-subscription': { id: 'lifecycle.finalize-subscription', fields: [vault()] },
  'lifecycle.start-calculation': { id: 'lifecycle.start-calculation', fields: [vault()] },
  'lifecycle.enter-final-settlement': { id: 'lifecycle.enter-final-settlement', fields: [vault()] },
  'lifecycle.enter-maturing': { id: 'lifecycle.enter-maturing', fields: [vault()] },
  'lifecycle.enter-claiming': { id: 'lifecycle.enter-claiming', fields: [vault()] },
  'lifecycle.close-product': { id: 'lifecycle.close-product', fields: [vault()] },
  'request.mark-refundable': { id: 'request.mark-refundable', fields: [vault(), requestId()] },
  'claim.record': { id: 'claim.record', fields: [vault(), field('owner', 'address'), requestId(), field('assets', 'amount', { decimals: 18, validation: 'positive', validationMeta: { min: '1' } }), field('kind', 'integer', { validation: 'range', validationMeta: { min: 0, max: 255 } })] },

  'asset.register': { id: 'asset.register', fields: [field('assetMetadata', 'json')] },
  'asset.metadata.update': { id: 'asset.metadata.update', fields: [asset(), field('metadataHash', 'bytes32')] },
  'asset.owner.transfer': { id: 'asset.owner.transfer', fields: [asset(), field('newOwner', 'address')] },
  'asset.deactivate': { id: 'asset.deactivate', fields: [asset()] },
  'asset.roles.set': { id: 'asset.roles.set', fields: [asset(), field('role', 'select', { options: ['token-agent', 'proof-publisher'] }), account()] },
  'mint.initiate': { id: 'mint.initiate', fields: [asset(), amount(), field('to', 'address'), field('issuerSig', 'bytes')] },
  'burn.initiate': { id: 'burn.initiate', fields: [asset(), amount(), field('from', 'address'), field('issuerSig', 'bytes')] },
  'mint.approve': { id: 'mint.approve', fields: [asset(), field('nonce', 'bigint', { validation: 'nonNegative' }), field('tokenAgentSig', 'bytes')] },
  'burn.approve': { id: 'burn.approve', fields: [asset(), field('nonce', 'bigint', { validation: 'nonNegative' }), field('tokenAgentSig', 'bytes')] },
  'proof.publish': { id: 'proof.publish', fields: [asset(), field('proofHash', 'bytes32'), field('documentUri', 'text', { validation: 'url' })] },

  'wrapper.deploy': { id: 'wrapper.deploy', fields: [asset(), field('mode', 'select', { options: ['token-custody', 'document-proof'] }), field('underlyingToken', 'address'), field('name', 'text', { validation: 'minLength', validationMeta: { minLength: 1 } }), field('symbol', 'text', { validation: 'minLength', validationMeta: { minLength: 1 } }), field('decimals', 'integer', { validation: 'range', validationMeta: { min: 0, max: 255 } }), field('allowPartialUnwrap', 'boolean')] },
  'wrapper.signer.set': { id: 'wrapper.signer.set', fields: [asset(), field('authorizedSigner', 'address')] },
  'wrapper.asset.pause': { id: 'wrapper.asset.pause', fields: [asset(), field('paused', 'boolean')] },
  'nav.sign': { id: 'nav.sign', fields: [vault(), field('nav', 'amount', { decimals: 6, validation: 'positive' }), field('dataTimestamp', 'datetime', { validation: 'pastOrPresent' })] },
  'adapter.deal-data.update': { id: 'adapter.deal-data.update', fields: [field('adapter', 'address'), field('dealId', 'bigint'), field('newValue', 'bigint')] },
  'psm.authorization.sign': { id: 'psm.authorization.sign', fields: [asset(), amount(), field('to', 'address'), field('documentId', 'bytes32'), field('nonce', 'bigint', { validation: 'nonNegative' }), expiry()] },
  'settlement.batch.submit': { id: 'settlement.batch.submit', fields: [vault(), field('instruction', 'json'), field('signatures', 'bytes-array')] },
  'nav.update.submit': { id: 'nav.update.submit', fields: [vault(), field('nav', 'amount', { decimals: 6, validation: 'positive' }), field('dataTimestamp', 'datetime', { validation: 'pastOrPresent' }), field('sig', 'bytes')] },
  'psm.authorization.submit': { id: 'psm.authorization.submit', fields: [asset(), amount(), field('to', 'address'), field('nonce', 'bigint', { validation: 'nonNegative' }), expiry(), field('signature', 'bytes'), field('documentId', 'bytes32')] },
  'vault.timelock.execute': { id: 'vault.timelock.execute', fields: [vault(), field('timelockOperation', 'bytes32'), field('operationData', 'bytes')] },

  // Permissionless protocol functions. Amount decimals are resolved from the
  // selected live vault/token immediately before execution.
  'request.deposit': { id: 'request.deposit', fields: [tranche(), field('assets', 'amount', { decimals: 'asset', validation: 'positive', validationMeta: { min: '1' } }), field('owner', 'address')] },
  'request.deposit.claim': { id: 'request.deposit.claim', fields: [tranche(), requestId(), field('receiver', 'address')] },
  'request.redeem': { id: 'request.redeem', fields: [tranche(), field('shares', 'amount', { decimals: 'asset', validation: 'positive', validationMeta: { min: '1' } }), field('owner', 'address')] },
  'request.redeem.claim': { id: 'request.redeem.claim', fields: [tranche(), requestId(), field('receiver', 'address')] },
  'request.cancel': { id: 'request.cancel', fields: [tranche(), requestId()] },
  'request.refund.claim': { id: 'request.refund.claim', fields: [tranche(), requestId()] },
  'wrapper.wrap': { id: 'wrapper.wrap', fields: [asset(), amount(), field('to', 'address')] },
  'wrapper.unwrap': { id: 'wrapper.unwrap', fields: [asset(), amount(), field('to', 'address')] },
});
