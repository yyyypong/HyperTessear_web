import { getAddress, isHexString, parseUnits } from 'ethers';
import { FORM_SCHEMAS } from '../config/formSchemas';

const UINT256_MAX = (1n << 256n) - 1n;
const MAX_TEXT_LENGTH = 4096;
const MAX_JSON_SOURCE_LENGTH = 16_384;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 1_000;
const SIGNATURE_BYTES = 65;
const SIGNATURE_FIELDS = Object.freeze({
  'mint.initiate': new Set(['issuerSig']),
  'burn.initiate': new Set(['issuerSig']),
  'mint.approve': new Set(['tokenAgentSig']),
  'burn.approve': new Set(['tokenAgentSig']),
  'nav.update.submit': new Set(['sig']),
  'psm.authorization.submit': new Set(['signature']),
});

export class ValidationError extends Error {
  constructor(code, field, message = code) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    if (field) this.field = field;
  }
}

const invalid = (code, field) => { throw new ValidationError(code, field); };
const isBlank = value => value === undefined || value === null || value === '';
const nowSeconds = now => now === undefined ? BigInt(Math.floor(Date.now() / 1000)) : toInteger(now, 'now', 'invalidDate');

function toInteger(value, field, code = 'invalidInteger') {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) invalid(code, field);
  if (typeof value !== 'bigint' && typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) invalid(code, field);
  let result;
  try { result = BigInt(value); } catch { invalid(code, field); }
  if (result < 0n || result > UINT256_MAX) invalid(code, field);
  return result;
}

function toDate(value, field) {
  if (typeof value === 'bigint' || (typeof value === 'string' && /^\d+$/.test(value))) return toInteger(value, field, 'invalidDate');
  if (typeof value !== 'string' || !value.trim()) invalid('invalidDate', field);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0 || !Number.isSafeInteger(Math.floor(timestamp / 1000))) invalid('invalidDate', field);
  return BigInt(Math.floor(timestamp / 1000));
}

function boundedJson(value, field, budget = { nodes: 0 }, depth = 0) {
  if (depth > MAX_JSON_DEPTH) invalid('jsonTooDeep', field);
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) invalid('jsonTooLarge', field);
  if (value === null || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) invalid('invalidJsonNumber', field);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_LENGTH) invalid('jsonTooLarge', field);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) invalid('jsonTooLarge', field);
    return value.map(item => boundedJson(item, field, budget, depth + 1));
  }
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('invalidJson', field);
  const entries = Object.entries(value);
  if (entries.length > 100) invalid('jsonTooLarge', field);
  return Object.fromEntries(entries.map(([name, item]) => {
    if (name.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(name)) invalid('invalidJson', field);
    return [name, boundedJson(item, field, budget, depth + 1)];
  }));
}

function parseJson(value, field) {
  if (typeof value === 'string') {
    if (value.length > MAX_JSON_SOURCE_LENGTH) invalid('jsonTooLarge', field);
    try { return boundedJson(JSON.parse(value), field); } catch (error) {
      if (error instanceof ValidationError) throw error;
      invalid('invalidJson', field);
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalidJson', field);
  return boundedJson(value, field);
}

function parseAssetMetadata(value, field) {
  if (typeof value === 'string') value = parseJson(value, field);
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('invalidAssetMetadata', field);
  const keys = Object.keys(value);
  const expected = ['metadataHash', 'name', 'symbol', 'decimals'];
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) invalid('invalidAssetMetadata', field);
  if (typeof value.metadataHash !== 'string' || !isHexString(value.metadataHash, 32)) invalid('invalidAssetMetadata', field);
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const symbol = typeof value.symbol === 'string' ? value.symbol.trim() : '';
  if (!name || name.length > 128 || !symbol || symbol.length > 32) invalid('invalidAssetMetadata', field);
  let decimals;
  try { decimals = toInteger(value.decimals, field); } catch { invalid('invalidAssetMetadata', field); }
  if (decimals > 255n) invalid('invalidAssetMetadata', field);
  return { metadataHash: value.metadataHash, name, symbol, decimals };
}

function exactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function settlementUint(value, field) {
  try { return toInteger(value, field, 'invalidSettlementInstruction'); } catch { invalid('invalidSettlementInstruction', field); }
}

export function validateSettlementInstruction(value, field = 'instruction') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, ['vaultSettlements', 'cycleNumber', 'validUntil'])) invalid('invalidSettlementInstruction', field);
  if (!Array.isArray(value.vaultSettlements) || value.vaultSettlements.length === 0 || value.vaultSettlements.length > 100) invalid('invalidSettlementInstruction', field);
  const seenVaults = new Set();
  const vaultSettlements = value.vaultSettlements.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !exactKeys(item, ['distribution', 'depositRequestIds', 'redeemRequestIds'])) invalid('invalidSettlementInstruction', field);
    const distribution = item.distribution;
    if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution) || !exactKeys(distribution, ['vault', 'amount'])) invalid('invalidSettlementInstruction', field);
    let normalizedVault;
    try { normalizedVault = getAddress(distribution.vault); } catch { invalid('invalidSettlementInstruction', field); }
    if (seenVaults.has(normalizedVault)) invalid('duplicateVaultSettlement', field);
    seenVaults.add(normalizedVault);
    if (!Array.isArray(item.depositRequestIds) || !Array.isArray(item.redeemRequestIds)) invalid('invalidSettlementInstruction', field);
    return {
      distribution: { vault: normalizedVault, amount: settlementUint(distribution.amount, field) },
      depositRequestIds: item.depositRequestIds.map(id => settlementUint(id, field)),
      redeemRequestIds: item.redeemRequestIds.map(id => settlementUint(id, field)),
    };
  });
  return {
    vaultSettlements,
    cycleNumber: settlementUint(value.cycleNumber, field),
    validUntil: settlementUint(value.validUntil, field),
  };
}

function amountDecimals(definition, options, field) {
  const value = definition.decimals === 'asset' ? options.amountDecimals : definition.decimals;
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) invalid(definition.decimals === 'asset' ? 'amountDecimalsRequired' : 'invalidDecimals', field);
  return value;
}

function parseField(actionId, definition, value, now, parserOptions) {
  const { name: field, type, validation = {}, options: selectOptions = [] } = definition;
  if (definition.canonicalPositiveUint === true) {
    if ((typeof value === 'string' && !/^[1-9]\d*$/.test(value))
      || ((typeof value === 'number' || typeof value === 'bigint') && value <= 0)) invalid('invalidInteger', field);
  }
  let parsed;
  if (type === 'address') {
    if (typeof value !== 'string') invalid('invalidAddress', field);
    try { parsed = getAddress(value); } catch { invalid('invalidAddress', field); }
  } else if (type === 'amount') {
    // Raw form amounts are decimal strings; normalized bigint values are returned to SDK adapters.
    if (typeof value !== 'string') invalid('invalidAmount', field);
    try { parsed = parseUnits(value, amountDecimals(definition, parserOptions, field)); } catch (error) {
      if (error instanceof ValidationError) throw error;
      invalid('invalidAmount', field);
    }
    if (parsed < 0n || parsed > UINT256_MAX) invalid('invalidAmount', field);
  } else if (type === 'bigint' || type === 'integer') {
    parsed = toInteger(value, field);
  } else if (type === 'datetime') {
    parsed = toDate(value, field);
  } else if (type === 'bytes') {
    if (typeof value !== 'string' || !isHexString(value) || value.length < 4) invalid('invalidBytes', field);
    if (SIGNATURE_FIELDS[actionId]?.has(field) && !isHexString(value, SIGNATURE_BYTES)) invalid('invalidSignature', field);
    parsed = value;
  } else if (type === 'bytes32') {
    if (typeof value !== 'string' || !isHexString(value, 32)) invalid('invalidBytes32', field);
    parsed = value;
  } else if (type === 'bytes-array') {
    if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !isHexString(item) || item.length < 4)) invalid('invalidBytesArray', field);
    if (actionId === 'settlement.batch.submit' && field === 'signatures' && value.some(item => !isHexString(item, SIGNATURE_BYTES))) invalid('invalidSignature', field);
    parsed = [...value];
  } else if (type === 'json') {
    parsed = parseJson(value, field);
  } else if (type === 'select') {
    if (typeof value !== 'string' || !selectOptions.includes(value)) invalid('invalidSelect', field);
    parsed = value;
  } else if (type === 'boolean') {
    if (typeof value === 'boolean') parsed = value;
    else if (value === 'true' || value === 'false') parsed = value === 'true';
    else invalid('invalidBoolean', field);
  } else if (type === 'text') {
    if (typeof value !== 'string') invalid('invalidText', field);
    parsed = value.trim();
    if (!parsed) invalid('invalidText', field);
    if (parsed.length > MAX_TEXT_LENGTH) invalid('tooLong', field);
  } else {
    invalid('unsupportedParser', field);
  }

  const kind = validation.messageKey?.split('.').at(-1);
  if ((kind === 'positive' && parsed <= 0n) || (kind === 'nonNegative' && parsed < 0n)) invalid(type === 'amount' ? 'invalidAmount' : 'invalidInteger', field);
  if (kind === 'range' && (parsed < BigInt(validation.min) || parsed > BigInt(validation.max))) invalid('outOfRange', field);
  if (kind === 'future' && parsed <= now) invalid('deadlineExpired', field);
  if (kind === 'pastOrPresent' && parsed > now) invalid('futureDate', field);
  if (kind === 'minLength' && parsed.length < validation.minLength) invalid('tooShort', field);
  if (kind === 'url') {
    try { const url = new URL(parsed); if (!/^https?:$/.test(url.protocol)) invalid('invalidUrl', field); } catch { invalid('invalidUrl', field); }
  }
  return parsed;
}

export function actionRequiresAmountDecimals(actionId) {
  return FORM_SCHEMAS[actionId]?.fields?.some(definition => definition.type === 'amount' && definition.decimals === 'asset') === true;
}

export function validateActionInput(actionId, rawInput, { now, amountDecimals: dynamicAmountDecimals } = {}) {
  const schema = FORM_SCHEMAS[actionId];
  if (!schema) invalid('unknownAction', 'actionId');
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) invalid('invalidInput');
  const fields = new Map(schema.fields.map(field => [field.name, field]));
  for (const field of Object.keys(rawInput)) if (!fields.has(field)) invalid('unknownField', field);
  const output = {};
  const current = nowSeconds(now);
  for (const definition of schema.fields) {
    const value = rawInput[definition.name];
    if (isBlank(value)) {
      if (definition.required !== false) invalid('required', definition.name);
      continue;
    }
    if (actionId === 'asset.register' && definition.name === 'assetMetadata') output[definition.name] = parseAssetMetadata(value, definition.name);
    else {
      output[definition.name] = parseField(actionId, definition, value, current, { amountDecimals: dynamicAmountDecimals });
      if (definition.name === 'instruction' && ['settlement.instruction.sign', 'settlement.batch.submit'].includes(actionId)) {
        output[definition.name] = validateSettlementInstruction(output[definition.name], definition.name);
      }
    }
  }
  if (actionId === 'vault.fees.set' && (Object.hasOwn(output, 'feeBps') === Object.hasOwn(output, 'recipient'))) invalid('exactlyOneFeeInput', 'feeBps');
  if (actionId === 'vault.pause') {
    if (output.paused && output.reason === undefined) invalid('pauseReasonRequired', 'reason');
    if (!output.paused && output.reason !== undefined) invalid('pauseReasonUnexpected', 'reason');
  }
  if (['settlement.instruction.sign', 'settlement.batch.submit'].includes(actionId)) {
    if (!output.instruction.vaultSettlements.every(item => item.distribution.vault === output.vault)) invalid('vaultMismatch', 'instruction');
    if (actionId === 'settlement.instruction.sign' && output.instruction.validUntil !== output.deadline) invalid('deadlineMismatch', 'deadline');
  }
  return output;
}
