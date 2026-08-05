import { describe, expect, it } from 'vitest';
import { BrowserProvider, Interface } from 'ethers';
import { getAbi } from '../../integrations/hypertessera/upstream/abis';
import { HyperTesseraSDK } from '../../integrations/hypertessera/upstream/sdk';
import { getDeployment } from '../config/deployments';
import { validateActionInput } from './validators';
import { createAmountDecimalsResolver, createReadSdk, createWriteSdk, getSdkDeploymentBinding } from './createSdk';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

function createEip1193Provider() {
  return {
    async request({ method }) {
      if (method === 'eth_chainId') return '0x61';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT];
      throw new Error(`Unexpected RPC method: ${method}`);
    },
  };
}

function createDecimalsProvider(deployment) {
  const rwaToken = '0x2222222222222222222222222222222222222222';
  const wrappedAsset = '0x3333333333333333333333333333333333333333';
  const bridgeAsset = '0x4444444444444444444444444444444444444444';
  const vaultAsset = '0x5555555555555555555555555555555555555555';
  const interfaces = {
    assetRegistry: new Interface(getAbi('AssetRegistry')),
    reservePsm: new Interface(getAbi('ReservePSM')),
    liquidityAdapter: new Interface(getAbi('LiquidityAdapter')),
    rwaToken: new Interface(getAbi('RWAToken')),
    wrappedAsset: new Interface(getAbi('WrappedAsset')),
    earnVault: new Interface(getAbi('EarnVault')),
  };
  const provider = {
    async request({ method, params }) {
      if (method === 'eth_chainId') return '0x61';
      if (method !== 'eth_call') throw new Error(`Unexpected RPC method: ${method}`);
      const { to, data } = params[0];
      const address = to.toLowerCase();
      if (address === deployment.addresses.assetRegistry.toLowerCase()) {
        expect(data.slice(0, 10)).toBe(interfaces.assetRegistry.getFunction('getAsset').selector);
        return interfaces.assetRegistry.encodeFunctionResult('getAsset', [[`0x${'11'.repeat(32)}`, rwaToken, true, 1n, ACCOUNT]]);
      }
      if (address === deployment.addresses.reservePSM.toLowerCase()) {
        if (data.slice(0, 10) === interfaces.reservePsm.getFunction('assetConfig').selector) {
          return interfaces.reservePsm.encodeFunctionResult('assetConfig', [0, rwaToken, wrappedAsset, true, ACCOUNT, false]);
        }
        expect(data.slice(0, 10)).toBe(interfaces.reservePsm.getFunction('wrappedTokenOf').selector);
        return interfaces.reservePsm.encodeFunctionResult('wrappedTokenOf', [wrappedAsset]);
      }
      if (address === deployment.addresses.lpAdapter.toLowerCase()) {
        expect(data.slice(0, 10)).toBe(interfaces.liquidityAdapter.getFunction('asset').selector);
        return interfaces.liquidityAdapter.encodeFunctionResult('asset', [bridgeAsset]);
      }
      if ([deployment.addresses.cashVault, deployment.addresses.noteVault].map(value => value.toLowerCase()).includes(address)) {
        const fn = data.slice(0, 10) === interfaces.earnVault.getFunction('usdt').selector ? 'usdt' : 'decimals';
        return interfaces.earnVault.encodeFunctionResult(fn, fn === 'usdt' ? [vaultAsset] : [18]);
      }
      if (address === rwaToken.toLowerCase()) {
        expect(data.slice(0, 10)).toBe(interfaces.rwaToken.getFunction('decimals').selector);
        return interfaces.rwaToken.encodeFunctionResult('decimals', [6]);
      }
      if (address === wrappedAsset.toLowerCase()) {
        expect(data.slice(0, 10)).toBe(interfaces.wrappedAsset.getFunction('decimals').selector);
        return interfaces.wrappedAsset.encodeFunctionResult('decimals', [18]);
      }
      if (address === bridgeAsset.toLowerCase()) {
        expect(data.slice(0, 10)).toBe(interfaces.rwaToken.getFunction('decimals').selector);
        return interfaces.rwaToken.encodeFunctionResult('decimals', [18]);
      }
      if (address === vaultAsset.toLowerCase()) {
        expect(data.slice(0, 10)).toBe(interfaces.rwaToken.getFunction('decimals').selector);
        return interfaces.rwaToken.encodeFunctionResult('decimals', [6]);
      }
      throw new Error(`Unexpected eth_call target: ${to}`);
    },
  };
  return { provider, rwaToken, wrappedAsset, bridgeAsset, vaultAsset };
}

describe('SDK runners', () => {
  it('creates the read SDK with the selected deployment and a BrowserProvider runner', () => {
    const deployment = getDeployment(97);
    const sdk = createReadSdk(deployment, createEip1193Provider());

    expect(sdk).toBeInstanceOf(HyperTesseraSDK);
    expect(sdk.addresses).toBe(deployment.addresses);
    expect(sdk.getContract('Settlement', deployment.addresses.settlement).runner).toBeInstanceOf(BrowserProvider);
    expect(getSdkDeploymentBinding(sdk)).toMatchObject({ chainId: 97, settlement: deployment.addresses.settlement });
    expect(getSdkDeploymentBinding({ addresses: deployment.addresses })).toBeNull();
  });

  it('creates a separate write SDK with the connected signer runner', async () => {
    const deployment = getDeployment(97);
    const sdk = await createWriteSdk(deployment, createEip1193Provider());

    expect(sdk).toBeInstanceOf(HyperTesseraSDK);
    expect(await sdk.getContract('Settlement', deployment.addresses.settlement).runner.getAddress()).toBe(ACCOUNT);
  });

  it('resolves action-aware decimals through real vendored ABI names and SDK contracts', async () => {
    const deployment = getDeployment(97);
    const { provider, rwaToken, wrappedAsset, bridgeAsset } = createDecimalsProvider(deployment);
    const sdk = createReadSdk(deployment, provider);
    expect(() => sdk.getContract('RWAToken', rwaToken).interface.getFunction('decimals')).not.toThrow();
    expect(() => sdk.getContract('WrappedAsset', wrappedAsset).interface.getFunction('decimals')).not.toThrow();
    expect(() => sdk.getContract('LiquidityAdapter', deployment.addresses.lpAdapter).interface.getFunction('asset')).not.toThrow();
    expect(() => sdk.getContract('RWAToken', bridgeAsset).interface.getFunction('decimals')).not.toThrow();

    const resolveDecimals = createAmountDecimalsResolver(sdk);
    const mintDecimals = await resolveDecimals({ actionId: 'mint.initiate', object: { assetId: '7' }, rawInput: {} });
    const psmDecimals = await resolveDecimals({ actionId: 'psm.authorization.sign', object: { assetId: '7' }, rawInput: {} });
    const bridgeDecimals = await resolveDecimals({
      actionId: 'vault.bridge', object: { vault: deployment.addresses.lpVault },
      rawInput: { adapter: deployment.addresses.lpAdapter },
    });
    const wrapDecimals = await resolveDecimals({ actionId: 'wrapper.wrap', object: {}, rawInput: { assetId: '7' } });
    const unwrapDecimals = await resolveDecimals({ actionId: 'wrapper.unwrap', object: {}, rawInput: { assetId: '7' } });
    const depositDecimals = await resolveDecimals({ actionId: 'request.deposit', object: {}, rawInput: { tranche: 'cash' } });
    const redeemDecimals = await resolveDecimals({ actionId: 'request.redeem', object: {}, rawInput: { tranche: 'note' } });
    expect({ mintDecimals, psmDecimals, bridgeDecimals, wrapDecimals, unwrapDecimals, depositDecimals, redeemDecimals }).toEqual({
      mintDecimals: 6, psmDecimals: 18, bridgeDecimals: 18, wrapDecimals: 6, unwrapDecimals: 18, depositDecimals: 6, redeemDecimals: 18,
    });
    await expect(resolveDecimals({
      actionId: 'vault.bridge', object: { vault: deployment.addresses.lpVault },
      rawInput: { adapter: deployment.addresses.cashAdapter },
    })).rejects.toThrow('Unconfigured liquidity adapter');

    const signature = `0x${'55'.repeat(65)}`;
    expect(validateActionInput('mint.initiate', {
      assetId: '7', amount: '1.25', to: ACCOUNT, issuerSig: signature,
    }, { amountDecimals: mintDecimals }).amount).toBe(1_250_000n);
    expect(validateActionInput('psm.authorization.submit', {
      assetId: '7', amount: '1.25', to: ACCOUNT, nonce: '1', expiry: '2030-01-01T00:00:00Z',
      signature, documentId: `0x${'66'.repeat(32)}`,
    }, { now: 1_700_000_000n, amountDecimals: psmDecimals }).amount).toBe(1_250_000_000_000_000_000n);
    expect(validateActionInput('vault.bridge', {
      vault: deployment.addresses.lpVault, adapter: deployment.addresses.lpAdapter, amount: '1.25',
    }, { amountDecimals: bridgeDecimals }).amount).toBe(1_250_000_000_000_000_000n);
    expect(() => createAmountDecimalsResolver({ getAssetInfo() {} })).toThrow('deployment-bound SDK');
  });
});
