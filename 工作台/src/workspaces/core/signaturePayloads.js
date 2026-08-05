import { AbiCoder, getAddress, getBytes, keccak256, solidityPackedKeccak256 } from 'ethers';
import { validateSettlementInstruction, ValidationError } from './validators';

const invalid = (code, field) => { throw new ValidationError(code, field); };
const equalAddress = (left, right) => {
  try { return getAddress(left) === getAddress(right); } catch { return false; }
};

export function buildLegacyNavDigest({ vault, nav, dataTimestamp }) {
  return solidityPackedKeccak256(['address', 'uint256', 'uint256'], [getAddress(vault), BigInt(nav), BigInt(dataTimestamp)]);
}

export function buildLegacyPsmDigest({ assetId, amount, to, nonce, expiry, reservePsm, chainId }) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'address', 'uint256', 'uint256', 'address', 'uint256'],
    [BigInt(assetId), BigInt(amount), getAddress(to), BigInt(nonce), BigInt(expiry), getAddress(reservePsm), BigInt(chainId)],
  ));
}

export async function buildSettlementDigest({ sdk, instruction, vault, chainId, selectedChainId = chainId, deadline, now = BigInt(Math.floor(Date.now() / 1000)) }) {
  const normalizedInstruction = validateSettlementInstruction(instruction);
  if (BigInt(chainId) !== BigInt(selectedChainId)) invalid('crossChainPayload', 'chainId');
  if (normalizedInstruction.vaultSettlements.length !== 1
    || !normalizedInstruction.vaultSettlements.every(item => equalAddress(item.distribution.vault, vault))) invalid('vaultMismatch', 'vault');
  if (normalizedInstruction.validUntil !== BigInt(deadline)) invalid('deadlineMismatch', 'deadline');
  if (normalizedInstruction.validUntil <= BigInt(now)) invalid('deadlineExpired', 'deadline');
  if (!sdk || typeof sdk.hashInstruction !== 'function') invalid('unsupportedSettlementHasher', 'instruction');
  return sdk.hashInstruction(normalizedInstruction);
}

export function buildTargetTypedData() {
  return { supported: false, code: 'targetTypedDataUnsupported', reasonKey: 'workspaces.signatures.targetTypedDataUnsupported' };
}

export async function signLegacyNavDigest(signer, payload) {
  return signer.signMessage(getBytes(buildLegacyNavDigest(payload)));
}

export async function signLegacyPsmDigest(signer, payload) {
  return signer.signMessage(getBytes(buildLegacyPsmDigest(payload)));
}

export async function signSettlementDigest(signer, payload) {
  const digest = await buildSettlementDigest(payload);
  return { digest, signature: await signer.signMessage(getBytes(digest)) };
}

const BUILT_IN_SIGNATURE_ACTIONS = new Set(['nav.sign', 'psm.authorization.sign', 'settlement.instruction.sign']);

export function isBuiltInSignatureAction(actionId) {
  return BUILT_IN_SIGNATURE_ACTIONS.has(actionId);
}

/** Advertises the built-in offline executor without creating a second signing boundary. */
export function createSignatureCapabilityAdapter(adapter) {
  return {
    supports(actionId, input) { return isBuiltInSignatureAction(actionId) ? true : adapter?.supports?.(actionId, input) === true; },
    async execute(actionId, input) {
      if (isBuiltInSignatureAction(actionId)) throw new ValidationError('signatureActionRequiresOfflineExecutor', 'actionId');
      return adapter?.execute?.(actionId, input);
    },
  };
}
