import { describe, expect, test, vi } from 'vitest';
import { AbiCoder, Wallet, getBytes, keccak256, solidityPackedKeccak256, verifyMessage } from 'ethers';
import {
  buildLegacyNavDigest,
  buildLegacyPsmDigest,
  buildSettlementDigest,
  buildTargetTypedData,
  createSignatureCapabilityAdapter,
  signLegacyNavDigest,
  signLegacyPsmDigest,
  signSettlementDigest,
} from './signaturePayloads';
import { validateActionInput } from './validators';

const vault = '0x52908400098527886E0F7030069857D2E4169EE7';
const reservePsm = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const otherVault = '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe';
const wallet = new Wallet('0x59c6995e998f97a5a0044976f094538a3e2f7a0d5bbfeb7e4b7a5b0525fbd3a5');

describe('legacy signing payloads', () => {
  test('builds the exact NAV EIP-191 digest and recovers the signing wallet', async () => {
    const digest = buildLegacyNavDigest({ vault, nav: 1230000000000000000n, dataTimestamp: 1_700_000_000n });
    expect(digest).toBe(solidityPackedKeccak256(['address', 'uint256', 'uint256'], [vault, 1230000000000000000n, 1_700_000_000n]));
    const signature = await signLegacyNavDigest(wallet, { vault, nav: 1230000000000000000n, dataTimestamp: 1_700_000_000n });
    expect(verifyMessage(getBytes(digest), signature)).toBe(wallet.address);
  });

  test('builds the exact PSM digest and recovers the signing wallet', async () => {
    const payload = { assetId: 3n, amount: 45n, to: vault, nonce: 9n, expiry: 1_800_000_000n, reservePsm, chainId: 1n };
    const digest = buildLegacyPsmDigest(payload);
    expect(digest).toBe(keccak256(AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256', 'address', 'uint256', 'uint256', 'address', 'uint256'],
      [3n, 45n, vault, 9n, 1_800_000_000n, reservePsm, 1n],
    )));
    const signature = await signLegacyPsmDigest(wallet, payload);
    expect(verifyMessage(getBytes(digest), signature)).toBe(wallet.address);
  });

  test('builds exact PSM digest base units for a non-18-decimal asset', () => {
    const normalized = validateActionInput('psm.authorization.sign', {
      assetId: '3', amount: '1.25', to: vault, documentId: `0x${'44'.repeat(32)}`,
      nonce: '9', expiry: '2030-01-01T00:00:00Z',
    }, { now: 1_700_000_000n, amountDecimals: 6 });
    const digest = buildLegacyPsmDigest({ ...normalized, reservePsm, chainId: 1n });
    expect(normalized.amount).toBe(1_250_000n);
    expect(digest).toBe(keccak256(AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256', 'address', 'uint256', 'uint256', 'address', 'uint256'],
      [3n, 1_250_000n, vault, 9n, normalized.expiry, reservePsm, 1n],
    )));
  });

  test('uses the SDK settlement hash and recovers the signing wallet', async () => {
    const digest = `0x${'33'.repeat(32)}`;
    const instruction = { vaultSettlements: [{ distribution: { vault, amount: 1n }, depositRequestIds: [], redeemRequestIds: [] }], cycleNumber: 1n, validUntil: 1_800_000_000n };
    const result = await signSettlementDigest(wallet, {
      sdk: { hashInstruction: async () => digest }, instruction, vault, chainId: 1n,
      selectedChainId: 1n, deadline: 1_800_000_000n, now: 1n,
    });
    expect(result.digest).toBe(digest);
    expect(verifyMessage(getBytes(digest), result.signature)).toBe(wallet.address);
  });

  test('refuses settlement signatures with a cross-chain, vault, or deadline mismatch', async () => {
    const instruction = { vaultSettlements: [{ distribution: { vault, amount: 1n }, depositRequestIds: [], redeemRequestIds: [] }], cycleNumber: 1n, validUntil: 1_800_000_000n };
    const sdk = { hashInstruction: async () => '0x' + '11'.repeat(32) };
    await expect(buildSettlementDigest({ sdk, instruction, vault, chainId: 1n, selectedChainId: 2n, deadline: 1_800_000_000n, now: 1n })).rejects.toMatchObject({ code: 'crossChainPayload' });
    await expect(buildSettlementDigest({ sdk, instruction, vault: reservePsm, chainId: 1n, selectedChainId: 1n, deadline: 1_800_000_000n, now: 1n })).rejects.toMatchObject({ code: 'vaultMismatch' });
    await expect(buildSettlementDigest({ sdk, instruction, vault, chainId: 1n, selectedChainId: 1n, deadline: 1_700_000_000n, now: 1n })).rejects.toMatchObject({ code: 'deadlineMismatch' });
  });

  test('refuses a settlement instruction mixing the selected vault with a foreign vault', async () => {
    const instruction = {
      vaultSettlements: [
        { distribution: { vault, amount: 1n }, depositRequestIds: [], redeemRequestIds: [] },
        { distribution: { vault: otherVault, amount: 2n }, depositRequestIds: [], redeemRequestIds: [] },
      ],
      cycleNumber: 1n,
      validUntil: 1_800_000_000n,
    };
    const sdk = { hashInstruction: async () => `0x${'11'.repeat(32)}` };
    await expect(buildSettlementDigest({ sdk, instruction, vault, chainId: 1n, deadline: 1_800_000_000n, now: 1n }))
      .rejects.toMatchObject({ code: 'vaultMismatch', field: 'vault' });
  });

  test('refuses malformed settlement structure before calling the hasher', async () => {
    const hashInstruction = vi.fn(async () => `0x${'11'.repeat(32)}`);
    const instruction = {
      vaultSettlements: [{ distribution: { vault, amount: 1n } }],
      validUntil: 1_800_000_000n,
    };
    await expect(buildSettlementDigest({ sdk: { hashInstruction }, instruction, vault, chainId: 1n, deadline: 1_800_000_000n, now: 1n }))
      .rejects.toMatchObject({ code: 'invalidSettlementInstruction', field: 'instruction' });
    expect(hashInstruction).not.toHaveBeenCalled();
  });

  test('only reports target typed data as explicitly unsupported', () => {
    expect(buildTargetTypedData()).toEqual({ supported: false, code: 'targetTypedDataUnsupported', reasonKey: 'workspaces.signatures.targetTypedDataUnsupported' });
  });

  test('advertises only the built-in offline signing path and never exposes it through generic execute', async () => {
    const base = { supports: () => false, execute: () => 'base' };
    const supported = createSignatureCapabilityAdapter(base);
    expect(supported.supports('nav.sign')).toBe(true);
    expect(supported.supports('unknown.sign')).toBe(false);
    await expect(supported.execute('nav.sign', {})).rejects.toMatchObject({ code: 'signatureActionRequiresOfflineExecutor' });
    await expect(supported.execute('unknown.sign', {})).resolves.toBe('base');
  });
});
