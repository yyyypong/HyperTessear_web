import { describe, expect, test } from 'vitest';
import { validateActionInput, ValidationError } from './validators';

const vault = '0x52908400098527886E0F7030069857D2E4169EE7';
const account = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const signature = `0x${'11'.repeat(65)}`;
const instruction = {
  vaultSettlements: [{
    distribution: { vault, amount: '1000000' },
    depositRequestIds: ['1'],
    redeemRequestIds: ['2'],
  }],
  cycleNumber: '3',
  validUntil: '1893456000',
};

describe('validateActionInput', () => {
  test('normalizes every parser type without losing integer precision', () => {
    expect(validateActionInput('wrapper.deploy', {
      assetId: '900719925474099312345', mode: 'document-proof', underlyingToken: account,
      name: 'Asset', symbol: 'AST', decimals: '18', allowPartialUnwrap: false,
    })).toEqual({
      assetId: 900719925474099312345n, mode: 'document-proof', underlyingToken: account,
      name: 'Asset', symbol: 'AST', decimals: 18n, allowPartialUnwrap: false,
    });
  });

  test.each([
    ['invalidAddress', 'to', 'mint.initiate', { assetId: '1', amount: '1', to: '0x123', issuerSig: '0x12' }],
    ['invalidAmount', 'amount', 'mint.initiate', { assetId: '1', amount: '-1', to: account, issuerSig: '0x12' }],
    ['invalidAmount', 'amount', 'mint.initiate', { assetId: '1', amount: '1.0000000000000000001', to: account, issuerSig: '0x12' }],
    ['invalidBytes32', 'documentId', 'psm.authorization.sign', { assetId: '1', amount: '1', to: account, documentId: '0x12', nonce: '0', expiry: '2030-01-01T00:00:00Z' }],
    ['invalidJson', 'instruction', 'settlement.instruction.sign', { vault, instruction: '{bad', deadline: '2030-01-01T00:00:00Z' }],
    ['invalidBytesArray', 'signatures', 'settlement.batch.submit', { vault, instruction, signatures: [] }],
  ])('rejects %s on %s', (code, field, actionId, input) => {
    expect(() => validateActionInput(actionId, input, { now: 1_700_000_000n, amountDecimals: 18 })).toThrow(expect.objectContaining({ code, field }));
  });

  test('rejects past deadline and unknown action fields', () => {
    expect(() => validateActionInput('settlement.instruction.sign', {
      vault,
      instruction: { ...instruction, validUntil: '1577836800' },
      deadline: '2020-01-01T00:00:00Z',
    }, { now: 1_700_000_000n }))
      .toThrow(expect.objectContaining({ code: 'deadlineExpired', field: 'deadline' }));
    expect(() => validateActionInput('nav.sign', { vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z', surprise: true }))
      .toThrow(expect.objectContaining({ code: 'unknownField', field: 'surprise' }));
  });

  test('honors the exactly-one fee input condition', () => {
    expect(validateActionInput('vault.fees.set', { vault, feeBps: '100' })).toEqual({ vault, feeBps: 100n });
    for (const input of [{ vault }, { vault, feeBps: '100', recipient: account }]) {
      expect(() => validateActionInput('vault.fees.set', input)).toThrow(expect.objectContaining({ code: 'exactlyOneFeeInput' }));
    }
  });

  test('rejects unsafe JavaScript numbers before amount conversion', () => {
    expect(() => validateActionInput('mint.initiate', {
      assetId: '1', amount: Number.MAX_SAFE_INTEGER + 1, to: account, issuerSig: '0x12',
    }, { amountDecimals: 18 })).toThrow(expect.objectContaining({ code: 'invalidAmount', field: 'amount' }));
  });

  test('validates and normalizes the exact AssetRegistry.registerAsset metadata tuple', () => {
    const metadataHash = `0x${'11'.repeat(32)}`;
    expect(validateActionInput('asset.register', {
      assetMetadata: { metadataHash, name: ' Treasury Note ', symbol: ' TNOTE ', decimals: '6' },
    })).toEqual({ assetMetadata: { metadataHash, name: 'Treasury Note', symbol: 'TNOTE', decimals: 6n } });
    expect(validateActionInput('asset.register', {
      assetMetadata: JSON.stringify({ metadataHash, name: 'Treasury Note', symbol: 'TNOTE', decimals: 6 }),
    })).toEqual({ assetMetadata: { metadataHash, name: 'Treasury Note', symbol: 'TNOTE', decimals: 6n } });

    for (const assetMetadata of [
      { name: 'Missing hash', symbol: 'MISS', decimals: 18 },
      { metadataHash, name: '', symbol: 'EMPTY', decimals: 18 },
      { metadataHash, name: 'Bad decimals', symbol: 'BAD', decimals: 256 },
      { metadataHash, name: 'Unknown', symbol: 'UNK', decimals: 18, owner: account },
    ]) {
      expect(() => validateActionInput('asset.register', { assetMetadata }))
        .toThrow(expect.objectContaining({ field: 'assetMetadata' }));
    }
  });

  test('bounds free-form text and JSON inputs', () => {
    expect(() => validateActionInput('proof.publish', {
      assetId: '1', proofHash: `0x${'22'.repeat(32)}`, documentUri: `https://example.com/${'a'.repeat(5000)}`,
    })).toThrow(expect.objectContaining({ code: 'tooLong', field: 'documentUri' }));
    expect(() => validateActionInput('settlement.instruction.sign', {
      vault, instruction: { payload: 'x'.repeat(20_000) }, deadline: '2030-01-01T00:00:00Z',
    }, { now: 1_700_000_000n })).toThrow(expect.objectContaining({ code: 'jsonTooLarge', field: 'instruction' }));
    expect(() => validateActionInput('settlement.instruction.sign', {
      vault, instruction: JSON.stringify({ payload: 'x'.repeat(5000) }), deadline: '2030-01-01T00:00:00Z',
    }, { now: 1_700_000_000n })).toThrow(expect.objectContaining({ code: 'jsonTooLarge', field: 'instruction' }));
  });

  test('uses fixed six-decimal NAV units and requires authoritative decimals for asset amounts', () => {
    const navInput = validateActionInput('nav.sign', {
      vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z',
    }, { now: 1_700_000_000n });
    expect(navInput.nav).toBe(1_000_000n);

    expect(validateActionInput('psm.authorization.sign', {
      assetId: '7', amount: '1.25', to: account, documentId: `0x${'22'.repeat(32)}`, nonce: '1', expiry: '2030-01-01T00:00:00Z',
    }, { now: 1_700_000_000n, amountDecimals: 6 }).amount).toBe(1_250_000n);
    expect(() => validateActionInput('psm.authorization.sign', {
      assetId: '7', amount: '1.25', to: account, documentId: `0x${'22'.repeat(32)}`, nonce: '1', expiry: '2030-01-01T00:00:00Z',
    }, { now: 1_700_000_000n })).toThrow(expect.objectContaining({ code: 'amountDecimalsRequired', field: 'amount' }));
  });

  test('strictly validates the complete SettlementInstruction ABI shape', () => {
    const result = validateActionInput('settlement.instruction.sign', {
      vault, instruction, deadline: '2030-01-01T00:00:00Z',
    }, { now: 1_700_000_000n });
    expect(result.instruction).toEqual({
      vaultSettlements: [{ distribution: { vault, amount: 1_000_000n }, depositRequestIds: [1n], redeemRequestIds: [2n] }],
      cycleNumber: 3n,
      validUntil: 1_893_456_000n,
    });

    for (const malformed of [
      { ...instruction, cycleNumber: undefined },
      { ...instruction, extra: true },
      { ...instruction, vaultSettlements: [{ distribution: { vault: '0x123', amount: '1' }, depositRequestIds: [], redeemRequestIds: [] }] },
      { ...instruction, vaultSettlements: [{ distribution: { vault, amount: '-1' }, depositRequestIds: [], redeemRequestIds: [] }] },
      { ...instruction, vaultSettlements: [{ distribution: { vault, amount: '1' }, depositRequestIds: ['x'], redeemRequestIds: [] }] },
      { ...instruction, vaultSettlements: [instruction.vaultSettlements[0], instruction.vaultSettlements[0]] },
    ]) {
      expect(() => validateActionInput('settlement.instruction.sign', {
        vault, instruction: malformed, deadline: '2030-01-01T00:00:00Z',
      }, { now: 1_700_000_000n })).toThrow(expect.objectContaining({ field: 'instruction' }));
    }
  });

  test('enforces pause reason conditions and exact ECDSA signature lengths', () => {
    expect(() => validateActionInput('vault.pause', { vault, paused: true }))
      .toThrow(expect.objectContaining({ code: 'pauseReasonRequired', field: 'reason' }));
    expect(() => validateActionInput('vault.pause', { vault, paused: false, reason: '1' }))
      .toThrow(expect.objectContaining({ code: 'pauseReasonUnexpected', field: 'reason' }));
    expect(validateActionInput('vault.pause', { vault, paused: true, reason: '1' })).toMatchObject({ paused: true, reason: 1n });

    expect(() => validateActionInput('nav.update.submit', {
      vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z', sig: '0x12',
    }, { now: 1_700_000_000n })).toThrow(expect.objectContaining({ code: 'invalidSignature', field: 'sig' }));
    expect(validateActionInput('nav.update.submit', {
      vault, nav: '1', dataTimestamp: '2020-01-01T00:00:00Z', sig: signature,
    }, { now: 1_700_000_000n }).sig).toBe(signature);
    expect(() => validateActionInput('settlement.batch.submit', { vault, instruction, signatures: ['0x12'] }))
      .toThrow(expect.objectContaining({ code: 'invalidSignature', field: 'signatures' }));
  });

  test('exposes a stable validation error class', () => {
    expect(() => validateActionInput('missing.action', {})).toThrow(ValidationError);
    try { validateActionInput('missing.action', {}); } catch (error) {
      expect(error).toMatchObject({ code: 'unknownAction' });
    }
  });
});
