import { formatUnits, getAddress, getBytes, isHexString, keccak256, toUtf8Bytes, verifyMessage } from 'ethers';
import { buildLegacyNavDigest } from './signaturePayloads';
import { validateSettlementInstruction, ValidationError } from './validators';

export const ENVELOPE_SCHEME = 'legacy-contract-signature+eip191-envelope-attestation-v1';
export const ATTESTATION_SCHEME = 'eip191-canonical-envelope-v1';

const V1_KEYS = Object.freeze(['version', 'kind', 'chainId', 'verifyingContract', 'scope', 'payload', 'signature', 'signer', 'createdAt']);
const V2_KEYS = Object.freeze([...V1_KEYS, 'scheme', 'attestation']);
const ATTESTATION_KEYS = Object.freeze(['scheme', 'signature', 'signer']);
const KINDS = new Set(['nav', 'psm', 'settlement']);
const MAX_SOURCE_LENGTH = 64 * 1024;

const invalid = (code, field) => { throw new ValidationError(code, field); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const uintString = (value, field, { positive = false } = {}) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) invalid('invalidInteger', field);
  const result = BigInt(value);
  if (result >= (1n << 256n) || (positive && result === 0n)) invalid('invalidInteger', field);
  return value;
};
const address = (value, field) => {
  try { return getAddress(value); } catch { invalid('invalidAddress', field); }
};
const bytes = (value, size, field) => {
  if (typeof value !== 'string' || !isHexString(value, size)) invalid(size === 32 ? 'invalidBytes32' : 'invalidSignature', field);
  return value;
};
const jsonSafe = value => {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
};

function normalizeScope(kind, supplied) {
  if (kind === 'psm') {
    if (!exactKeys(supplied, ['assetId'])) invalid('objectMismatch', 'scope');
    return { assetId: uintString(supplied.assetId, 'assetId', { positive: true }) };
  }
  if (!exactKeys(supplied, ['vault'])) invalid('objectMismatch', 'scope');
  return { vault: address(supplied.vault, 'vault') };
}

function assertCanonicalInstruction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalidSettlementInstruction', 'instruction');
  uintString(value.cycleNumber, 'cycleNumber');
  uintString(value.validUntil, 'validUntil');
  if (!Array.isArray(value.vaultSettlements)) invalid('invalidSettlementInstruction', 'instruction');
  for (const item of value.vaultSettlements) {
    uintString(item?.distribution?.amount, 'amount');
    if (!Array.isArray(item?.depositRequestIds) || !Array.isArray(item?.redeemRequestIds)) invalid('invalidSettlementInstruction', 'instruction');
    for (const id of item.depositRequestIds) uintString(id, 'depositRequestIds');
    for (const id of item.redeemRequestIds) uintString(id, 'redeemRequestIds');
  }
}

function normalizeInstruction(value) {
  assertCanonicalInstruction(value);
  return jsonSafe(validateSettlementInstruction(value));
}

function normalizePayload(kind, supplied, scope) {
  if (kind === 'nav') {
    if (!exactKeys(supplied, ['vault', 'nav', 'dataTimestamp', 'nonce', 'deadline'])) invalid('invalidSignaturePayload', 'payload');
    const payload = {
      vault: address(supplied.vault, 'vault'), nav: uintString(supplied.nav, 'nav'),
      dataTimestamp: uintString(supplied.dataTimestamp, 'dataTimestamp'), nonce: uintString(supplied.nonce, 'nonce'),
      deadline: supplied.deadline === null ? null : uintString(supplied.deadline, 'deadline'),
    };
    if (payload.vault !== scope.vault || payload.nonce !== payload.dataTimestamp || payload.deadline !== null) invalid('objectMismatch', 'payload');
    return payload;
  }
  if (kind === 'psm') {
    if (!exactKeys(supplied, ['assetId', 'amount', 'decimals', 'to', 'nonce', 'expiry', 'deadline', 'documentId'])) invalid('invalidSignaturePayload', 'payload');
    const decimals = Number(supplied.decimals);
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) invalid('invalidDecimals', 'decimals');
    const payload = {
      assetId: uintString(supplied.assetId, 'assetId', { positive: true }), amount: uintString(supplied.amount, 'amount'), decimals,
      to: address(supplied.to, 'to'), nonce: uintString(supplied.nonce, 'nonce'),
      expiry: uintString(supplied.expiry, 'expiry'), deadline: uintString(supplied.deadline, 'deadline'),
      documentId: bytes(supplied.documentId, 32, 'documentId'),
    };
    if (payload.assetId !== scope.assetId || payload.deadline !== payload.expiry) invalid('objectMismatch', 'payload');
    return payload;
  }
  if (!exactKeys(supplied, ['instruction', 'nonce', 'deadline'])) invalid('invalidSignaturePayload', 'payload');
  const instruction = normalizeInstruction(supplied.instruction);
  const payload = { instruction, nonce: uintString(supplied.nonce, 'nonce'), deadline: uintString(supplied.deadline, 'deadline') };
  if (address(instruction.vaultSettlements[0].distribution.vault, 'vault') !== scope.vault
    || payload.nonce !== instruction.cycleNumber || payload.deadline !== instruction.validUntil) invalid('objectMismatch', 'payload');
  return payload;
}

function parseSource(source) {
  if (typeof source !== 'string') return source;
  if (source.length > MAX_SOURCE_LENGTH) invalid('signatureEnvelopeTooLarge', 'envelope');
  try { return JSON.parse(source); } catch { invalid('invalidSignatureEnvelope', 'envelope'); }
}

function normalizeBase(value) {
  if (!Number.isSafeInteger(value.chainId) || value.chainId <= 0) invalid('crossChainPayload', 'chainId');
  const created = new Date(value.createdAt);
  if (typeof value.createdAt !== 'string' || Number.isNaN(created.getTime()) || created.toISOString() !== value.createdAt) invalid('invalidDate', 'createdAt');
  const scope = normalizeScope(value.kind, value.scope);
  return {
    version: value.version,
    ...(value.version === 2 ? { scheme: ENVELOPE_SCHEME } : {}),
    kind: value.kind,
    chainId: value.chainId,
    verifyingContract: address(value.verifyingContract, 'verifyingContract'),
    scope,
    payload: normalizePayload(value.kind, value.payload, scope),
    signature: bytes(value.signature, 65, 'signature'),
    signer: address(value.signer, 'signer'),
    createdAt: value.createdAt,
  };
}

function normalizeEnvelope(source) {
  const value = parseSource(source);
  if (!value || !KINDS.has(value.kind)) invalid('invalidSignatureEnvelope', 'envelope');
  if (value.version === 1) {
    if (!exactKeys(value, V1_KEYS)) invalid('invalidSignatureEnvelope', 'envelope');
    return normalizeBase(value);
  }
  if (value.version !== 2 || value.scheme !== ENVELOPE_SCHEME || !exactKeys(value, V2_KEYS)) invalid('invalidSignatureEnvelope', 'envelope');
  if (!exactKeys(value.attestation, ATTESTATION_KEYS) || value.attestation.scheme !== ATTESTATION_SCHEME) invalid('invalidAttestation', 'attestation');
  return {
    ...normalizeBase(value),
    attestation: {
      scheme: ATTESTATION_SCHEME,
      signature: bytes(value.attestation.signature, 65, 'attestation.signature'),
      signer: address(value.attestation.signer, 'attestation.signer'),
    },
  };
}

export function createSignatureEnvelope(value) {
  return normalizeEnvelope(jsonSafe(value));
}

export function serializeSignatureEnvelope(envelope) {
  return JSON.stringify(normalizeEnvelope(envelope), null, 2);
}

function attestedFields(envelope) {
  return {
    version: envelope.version,
    scheme: envelope.scheme,
    kind: envelope.kind,
    chainId: envelope.chainId,
    verifyingContract: envelope.verifyingContract,
    scope: envelope.scope,
    payload: envelope.payload,
    signature: envelope.signature,
    signer: envelope.signer,
    createdAt: envelope.createdAt,
  };
}

export function buildEnvelopeAttestationDigest(draft) {
  const normalized = normalizeBase({ ...jsonSafe(draft), version: 2 });
  return keccak256(toUtf8Bytes(JSON.stringify(attestedFields(normalized))));
}

function sameScope(left, right) {
  if (!right || Object.keys(left).length !== Object.keys(right).length) return false;
  if (left.vault) return address(right.vault, 'vault') === left.vault;
  return uintString(right.assetId, 'assetId', { positive: true }) === left.assetId;
}

async function digestFor(envelope, expected) {
  if (envelope.kind === 'nav') return buildLegacyNavDigest(envelope.payload);
  if (envelope.kind === 'psm') {
    if (expected.psmDigestIncludesDocumentId !== true || typeof expected.hashPsm !== 'function') invalid('unsupportedContractSignature', 'signature');
    if (!Number.isSafeInteger(expected.liveDecimals) || expected.liveDecimals !== envelope.payload.decimals) invalid('psmDecimalsMismatch', 'decimals');
    return bytes(await expected.hashPsm(envelope.payload), 32, 'digest');
  }
  if (typeof expected.hashSettlement !== 'function') invalid('unsupportedSettlementHasher', 'payload');
  return bytes(await expected.hashSettlement(envelope.payload.instruction), 32, 'digest');
}

function validateAttestation(envelope) {
  if (envelope.version !== 2) invalid('insecureLegacyEnvelope', 'version');
  let recovered;
  try { recovered = verifyMessage(getBytes(buildEnvelopeAttestationDigest(envelope)), envelope.attestation.signature); }
  catch { invalid('invalidAttestation', 'attestation'); }
  if (recovered !== envelope.attestation.signer || recovered !== envelope.signer) invalid('invalidAttestation', 'attestation');
}

export async function validateSignatureEnvelope(source, expected = {}) {
  const envelope = normalizeEnvelope(source);
  if (Number(expected.chainId) !== envelope.chainId) invalid('crossChainPayload', 'chainId');
  if (address(expected.verifyingContract, 'verifyingContract') !== envelope.verifyingContract) invalid('contractMismatch', 'verifyingContract');
  if (!sameScope(envelope.scope, expected.scope)) invalid('objectMismatch', 'scope');
  const now = expected.now === undefined ? BigInt(Math.floor(Date.now() / 1000)) : BigInt(expected.now);
  if (envelope.kind !== 'nav' && BigInt(envelope.payload.deadline) <= now) invalid('deadlineExpired', 'deadline');
  if (envelope.kind === 'psm' && expected.psmDigestIncludesDocumentId !== true) invalid('unsupportedContractSignature', 'signature');
  const digest = await digestFor(envelope, expected);
  let recovered;
  try { recovered = verifyMessage(getBytes(digest), envelope.signature); } catch { invalid('invalidSignature', 'signature'); }
  if (recovered !== envelope.signer) invalid('recoveredSignerMismatch', 'signer');
  validateAttestation(envelope);
  if (typeof expected.isNonceUsed === 'function') {
    const used = await expected.isNonceUsed({ kind: envelope.kind, scope: envelope.scope, nonce: BigInt(envelope.payload.nonce), envelope });
    if (used) invalid('nonceAlreadyUsed', 'nonce');
  }
  return envelope;
}

function settlementSet(source) {
  const parsed = parseSource(source);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.length === 0 || values.length > 100) invalid('invalidSignatureEnvelope', 'envelope');
  const envelopes = values.map(normalizeEnvelope);
  if (envelopes.some(envelope => envelope.kind !== 'settlement')) invalid('invalidSignatureEnvelope', 'kind');
  const first = envelopes[0];
  const batch = JSON.stringify(first.payload);
  const signers = new Set();
  for (const envelope of envelopes) {
    if (envelope.chainId !== first.chainId) invalid('crossChainPayload', 'chainId');
    if (envelope.verifyingContract !== first.verifyingContract) invalid('contractMismatch', 'verifyingContract');
    if (!sameScope(first.scope, envelope.scope)) invalid('objectMismatch', 'scope');
    if (JSON.stringify(envelope.payload) !== batch) invalid('settlementBatchMismatch', 'payload');
    const key = envelope.signer.toLowerCase();
    if (signers.has(key)) invalid('duplicateSigner', 'signer');
    signers.add(key);
  }
  return envelopes;
}

export async function validateSettlementEnvelopeSet(source, expected = {}) {
  const envelopes = settlementSet(source);
  const threshold = BigInt(expected.threshold ?? 1);
  if (threshold <= 0n) invalid('insecureSettlementThreshold', 'signatures');
  if (BigInt(envelopes.length) < threshold) invalid('signatureThresholdNotMet', 'signatures');
  const validated = [];
  for (const envelope of envelopes) validated.push(await validateSignatureEnvelope(envelope, expected));
  return validated;
}

export function toRelayerSubmission(source) {
  if (Array.isArray(source)) {
    const envelopes = settlementSet(source);
    for (const envelope of envelopes) validateAttestation(envelope);
    const first = envelopes[0];
    return {
      actionId: 'settlement.batch.submit', scope: first.scope,
      rawInput: { vault: first.scope.vault, instruction: first.payload.instruction, signatures: envelopes.map(envelope => envelope.signature) },
    };
  }
  const envelope = normalizeEnvelope(source);
  if (envelope.kind !== 'psm') validateAttestation(envelope);
  if (envelope.kind === 'nav') return {
    actionId: 'nav.update.submit', scope: envelope.scope,
    rawInput: { vault: envelope.scope.vault, nav: formatUnits(envelope.payload.nav, 6), dataTimestamp: envelope.payload.dataTimestamp, sig: envelope.signature },
  };
  if (envelope.kind === 'psm') invalid('unsupportedContractSignature', 'signature');
  return {
    actionId: 'settlement.batch.submit', scope: envelope.scope,
    rawInput: { vault: envelope.scope.vault, instruction: envelope.payload.instruction, signatures: [envelope.signature] },
  };
}
