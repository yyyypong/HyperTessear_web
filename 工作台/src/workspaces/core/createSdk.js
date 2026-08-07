import { HyperTesseraSDK } from '../../integrations/hypertessera/upstream/sdk';
import { getAddress } from 'ethers';
import { createBrowserProvider, getWriteSigner } from './walletRunner';

const deploymentBindings = new WeakMap();

function bindDeployment(sdk, deployment) {
  deploymentBindings.set(sdk, Object.freeze({
    chainId: Number(deployment.chainId),
    profile: deployment.profile ?? 'legacy',
    settlement: deployment.addresses.settlement,
    reservePSM: deployment.addresses.reservePSM,
    lpAdapter: deployment.addresses.lpAdapter,
    cashVault: deployment.addresses.cashVault,
    noteVault: deployment.addresses.noteVault,
    lpVault: deployment.addresses.lpVault,
  }));
  return sdk;
}

export function createReadSdk(deployment, eip1193Provider) {
  return bindDeployment(
    new HyperTesseraSDK(deployment.addresses, createBrowserProvider(eip1193Provider), deployment.profile),
    deployment,
  );
}

export async function createWriteSdk(deployment, eip1193Provider) {
  return bindDeployment(
    new HyperTesseraSDK(deployment.addresses, await getWriteSigner(eip1193Provider), deployment.profile),
    deployment,
  );
}

/** Only SDKs constructed from a deployment manifest in this module receive a binding. */
export function getSdkDeploymentBinding(sdk) {
  return deploymentBindings.get(sdk) ?? sdk?.__htDeploymentBinding ?? null;
}

const RWA_AMOUNT_ACTIONS = new Set(['mint.initiate', 'burn.initiate']);
const PSM_AMOUNT_ACTIONS = new Set(['psm.authorization.sign', 'psm.authorization.submit']);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function configuredToken(value, message) {
  let address;
  try { address = getAddress(value); } catch { throw new Error(message); }
  if (address === ZERO_ADDRESS) throw new Error(message);
  return address;
}

function reserveAssetConfig(raw) {
  return {
    mode: Number(raw?.mode ?? raw?.[0]),
    underlyingToken: raw?.underlyingToken ?? raw?.[1],
    wrappedToken: raw?.wrappedToken ?? raw?.[2],
  };
}

async function readTokenDecimals(sdk, abiName, token) {
  const decimals = Number(await sdk.getContract(abiName, token).decimals());
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid onchain asset decimals');
  return decimals;
}

/** Produces the action-aware, chain-read decimal resolver consumed by amount validation. */
export function createAmountDecimalsResolver(sdk) {
  if (!getSdkDeploymentBinding(sdk)) throw new Error('Asset decimals require a deployment-bound SDK');
  const binding = getSdkDeploymentBinding(sdk);
  return async ({ actionId, object, rawInput } = {}) => {
    if (RWA_AMOUNT_ACTIONS.has(actionId)) {
      if (object?.assetId === undefined) throw new Error('Asset ID is required to resolve decimals');
      const asset = await sdk.getAssetInfo(BigInt(object.assetId));
      return readTokenDecimals(sdk, 'RWAToken', asset.token);
    }
    if (PSM_AMOUNT_ACTIONS.has(actionId)) {
      if (object?.assetId === undefined || !binding.reservePSM) throw new Error('PSM asset binding is required to resolve decimals');
      const wrappedToken = await sdk.getContract('ReservePSM', binding.reservePSM).wrappedTokenOf(BigInt(object.assetId));
      return readTokenDecimals(sdk, 'WrappedAsset', wrappedToken);
    }
    if (actionId === 'wrapper.wrap' || actionId === 'wrapper.unwrap') {
      if (rawInput?.assetId === undefined || !binding.reservePSM) throw new Error('PSM asset binding is required to resolve decimals');
      const rawConfig = await sdk.getContract('ReservePSM', binding.reservePSM).assetConfig(BigInt(rawInput.assetId));
      const config = reserveAssetConfig(rawConfig);
      if (actionId === 'wrapper.wrap') {
        if (config.mode !== 0) throw new Error('Wrapper asset is not configured for token custody');
        return readTokenDecimals(sdk, 'RWAToken', configuredToken(config.underlyingToken, 'Configured underlying token is unavailable'));
      }
      if (config.mode !== 0 && config.mode !== 1) throw new Error('Unsupported PSM asset mode');
      return readTokenDecimals(sdk, 'WrappedAsset', configuredToken(config.wrappedToken, 'Configured wrapped token is unavailable'));
    }
    if (actionId === 'request.deposit' || actionId === 'request.redeem') {
      const key = rawInput?.tranche;
      if (!['cash', 'note', 'lp'].includes(key)) throw new Error('Configured tranche is required to resolve decimals');
      const vault = key === 'cash' ? binding.cashVault : key === 'note' ? binding.noteVault : binding.lpVault;
      if (!vault) throw new Error('Configured tranche is required to resolve decimals');
      const abiName = key === 'lp' ? 'LiquidityEarnVault' : 'EarnVault';
      const vaultContract = sdk.getContract(abiName, vault);
      if (actionId === 'request.redeem') {
        const decimals = Number(await vaultContract.decimals());
        if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid onchain share decimals');
        return decimals;
      }
      const asset = await vaultContract.usdt();
      return readTokenDecimals(sdk, 'RWAToken', asset);
    }
    if (actionId === 'vault.bridge') {
      if (!binding.lpAdapter || rawInput?.adapter === undefined) throw new Error('Liquidity adapter binding is required to resolve decimals');
      let selectedAdapter;
      try { selectedAdapter = getAddress(rawInput.adapter); } catch { throw new Error('Liquidity adapter binding is required to resolve decimals'); }
      if (selectedAdapter !== getAddress(binding.lpAdapter)) throw new Error('Unconfigured liquidity adapter');
      const bridgeToken = await sdk.getContract('LiquidityAdapter', binding.lpAdapter).asset();
      // RWAToken exposes the standard IERC20Metadata decimals() selector and is
      // used here only as the vendored metadata-compatible ABI for any ERC20.
      return readTokenDecimals(sdk, 'RWAToken', bridgeToken);
    }
    throw new Error(`Unsupported amount denomination for action: ${String(actionId)}`);
  };
}

export const createAssetDecimalsResolver = createAmountDecimalsResolver;
