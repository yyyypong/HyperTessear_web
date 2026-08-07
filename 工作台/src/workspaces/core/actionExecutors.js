import { getAddress, getBytes, verifyMessage } from 'ethers';
import { getActionDefinition } from '../config/roleDefinitions';
import { resolveCapability } from './capabilityResolver';
import { mapContractError } from './contractErrors';
import { getSdkDeploymentBinding } from './createSdk';
import { normalizeObjectContext } from './objectContext';
import { buildLegacyNavDigest, buildLegacyPsmDigest, buildSettlementDigest, isBuiltInSignatureAction } from './signaturePayloads';
import { actionRequiresAmountDecimals, validateActionInput, ValidationError } from './validators';

function actionFor(action) {
  const result = typeof action === 'string' ? getActionDefinition(action) : action;
  if (!result?.id) throw new ValidationError('unknownAction', 'actionId');
  return result;
}
function equalAddress(left, right) { try { return getAddress(left) === getAddress(right); } catch { return false; } }
async function available(action, capabilityContext, adapter) {
  const capability = await resolveCapability({ ...capabilityContext, adapter }, action);
  if (capability.state !== 'available') throw Object.assign(new Error(capability.reasonKey), { capability });
  return capability;
}

export async function executeAction({ action: suppliedAction, rawInput, capabilityContext, adapter, signer, transactions, executionControl }) {
  const action = actionFor(suppliedAction);
  if (isBuiltInSignatureAction(action.id)) throw new ValidationError('signatureActionRequiresOfflineExecutor', 'actionId');
  await available(action, capabilityContext, adapter);
  const input = validateActionInput(action.id, rawInput, await validationOptions(action, capabilityContext, rawInput));
  assertActionObjectBinding(action, input, capabilityContext);
  const pendingId = transactions.prepare(action.id, input);
  try {
    transactions.awaitingWallet(pendingId);
    const adapterInput = { ...input, signer };
    const result = executionControl === undefined
      ? await adapter.execute(action.id, adapterInput)
      : await adapter.execute(action.id, adapterInput, executionControl);
    const transaction = result && typeof result.wait === 'function' ? result : null;
    transactions.submitted(pendingId, transaction?.hash ?? result?.hash ?? result?.transactionHash ?? null);
    const receipt = transaction ? await transaction.wait() : result;
    transactions.confirmed(pendingId, receipt);
    return receipt;
  } catch (error) {
    const mapped = mapContractError(error);
    if (mapped.code === 'walletRejected') transactions.rejected(pendingId, mapped);
    else transactions.failed(pendingId, mapped);
    throw error;
  }
}

function bindingMatches(field, inputValue, selectedValue) {
  if (['vault', 'adapter', 'wrapper'].includes(field)) return equalAddress(inputValue, selectedValue);
  try { return BigInt(inputValue) === BigInt(selectedValue); } catch { return false; }
}

function selectedObjectContext(context) {
  return normalizeObjectContext(context?.objectContext ?? context?.object ?? context?.route ?? context);
}

function assertActionObjectBinding(action, input, context) {
  const selected = selectedObjectContext(context);
  const required = action.scope === 'vault' ? ['vault']
    : action.scope === 'asset' ? ['assetId']
      : action.scope === 'wrapper' ? [selected.assetId !== undefined ? 'assetId' : 'wrapper']
        : action.scope === 'adapter' ? ['adapter']
          : Object.keys(selected).filter(field => Object.hasOwn(input, field));
  for (const field of required) {
    if (selected[field] === undefined || input[field] === undefined || !bindingMatches(field, input[field], selected[field])) {
      throw new ValidationError(field === 'vault' ? 'vaultMismatch' : 'objectMismatch', field);
    }
  }
  return selected;
}

async function validationOptions(action, capabilityContext, rawInput, now) {
  if (!actionRequiresAmountDecimals(action.id)) return { now };
  const resolver = capabilityContext?.getAmountDecimals ?? capabilityContext?.getAssetDecimals;
  if (typeof resolver !== 'function') throw new ValidationError('amountDecimalsRequired', 'amount');
  const object = selectedObjectContext(capabilityContext);
  const resolved = await resolver({ actionId: action.id, action, object, rawInput, deployment: capabilityContext?.deployment });
  const amountDecimals = typeof resolved === 'bigint' || typeof resolved === 'string' ? Number(resolved) : resolved;
  return { now, amountDecimals };
}

function boundChainId(capabilityContext, signingContext) {
  const expected = capabilityContext?.deployment?.chainId ?? capabilityContext?.chainId;
  const selected = signingContext?.chainId ?? capabilityContext?.chainId;
  if (expected === undefined || selected === undefined || BigInt(expected) !== BigInt(selected)) throw new ValidationError('crossChainPayload', 'chainId');
  return BigInt(expected);
}

function assertSignatureContext(actionId, capabilityContext, signingContext) {
  const chainId = boundChainId(capabilityContext, signingContext);
  if (actionId === 'psm.authorization.sign') {
    const reservePsm = capabilityContext?.deployment?.addresses?.reservePSM;
    if (!reservePsm) throw new ValidationError('unsupportedDeployment', 'reservePsm');
    if (signingContext.reservePsm !== undefined && !equalAddress(signingContext.reservePsm, reservePsm)) throw new ValidationError('contractMismatch', 'reservePsm');
    return { chainId, reservePsm };
  }
  if (actionId === 'settlement.instruction.sign') {
    const sdkBinding = getSdkDeploymentBinding(signingContext.sdk);
    const configuredSettlement = capabilityContext?.deployment?.addresses?.settlement;
    if (!sdkBinding || !configuredSettlement || Number(sdkBinding.chainId) !== Number(chainId)
      || !equalAddress(sdkBinding.settlement, configuredSettlement)) throw new ValidationError('contractMismatch', 'settlement');
  }
  return { chainId };
}

async function buildLegacySignature(actionId, input, signingContext, binding) {
  if (actionId === 'nav.sign') {
    const digest = buildLegacyNavDigest(input);
    return { digest, signature: await signingContext.signer.signMessage(getBytes(digest)) };
  }
  if (actionId === 'psm.authorization.sign') {
    const digest = buildLegacyPsmDigest({ ...input, reservePsm: binding.reservePsm, chainId: binding.chainId });
    return { digest, signature: await signingContext.signer.signMessage(getBytes(digest)) };
  }
  if (actionId === 'settlement.instruction.sign') {
    const digest = await buildSettlementDigest({ sdk: signingContext.sdk, instruction: input.instruction, vault: input.vault, chainId: binding.chainId, selectedChainId: binding.chainId, deadline: input.deadline, now: signingContext.now });
    return { digest, signature: await signingContext.signer.signMessage(getBytes(digest)) };
  }
  throw new ValidationError('unsupportedSignatureAction', 'actionId');
}

export async function executeSignatureAction({ action: suppliedAction, rawInput, capabilityContext, adapter, signer, transactions, signingContext = {} }) {
  const action = actionFor(suppliedAction);
  if (!isBuiltInSignatureAction(action.id)) throw new ValidationError('unsupportedSignatureAction', 'actionId');
  await available(action, capabilityContext, adapter);
  const input = validateActionInput(action.id, rawInput, await validationOptions(action, capabilityContext, rawInput, signingContext.now));
  assertActionObjectBinding(action, input, capabilityContext);
  const signatureBinding = assertSignatureContext(action.id, capabilityContext, signingContext);
  const pendingId = transactions.prepare(action.id, input);
  try {
    transactions.awaitingWallet(pendingId);
    const result = await buildLegacySignature(action.id, input, { ...signingContext, signer }, signatureBinding);
    const demo = signer?._demo === true;
    if (!demo && typeof signer?.getAddress === 'function'
      && !equalAddress(verifyMessage(getBytes(result.digest), result.signature), await signer.getAddress())) {
      throw new ValidationError('recoveredSignerMismatch', 'signer');
    }
    transactions.signed(pendingId, result);
    return demo ? { ...result, simulated: true } : result;
  } catch (error) {
    const mapped = mapContractError(error);
    if (mapped.code === 'walletRejected') transactions.rejected(pendingId, mapped);
    else transactions.failed(pendingId, mapped);
    throw error;
  }
}
