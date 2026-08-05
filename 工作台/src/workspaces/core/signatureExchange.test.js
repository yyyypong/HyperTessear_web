import { Wallet, getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { buildLegacyNavDigest, buildLegacyPsmDigest } from './signaturePayloads';
import {
  createSignatureEnvelope,
  serializeSignatureEnvelope,
  toRelayerSubmission,
  validateSettlementEnvelopeSet,
  validateSignatureEnvelope,
} from './signatureExchange';

const ENVELOPE_SCHEME = 'legacy-contract-signature+eip191-envelope-attestation-v1';
const ATTESTATION_SCHEME = 'eip191-canonical-envelope-v1';
const signer = new Wallet('0x59c6995e998f97a5a0044976f094538a3e2f7a0d5bbfeb7e4b7a5b0525fbd3a5');
const secondSigner = new Wallet('0x8b3a350cf5c34c9194ca3a545d0f4f2ad7f69f4258c2b76e6f8f9a8c6e6a4f01');
const navOracle = '0x009F0F9507E4e3Fda5159e85fa2f6c19875A3154';
const reservePsm = '0x67D10e814B57E381cE020697eF14CCDf922Dd654';
const settlement = '0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c';
const foreignContract = '0x1111111111111111111111111111111111111111';
const vault = '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea';
const to = '0x2222222222222222222222222222222222222222';
const documentId = `0x${'44'.repeat(32)}`;
const createdAt = '2026-07-31T00:00:00.000Z';
const settlementDigest = `0x${'33'.repeat(32)}`;

function attestationDigest(draft) {
  return keccak256(toUtf8Bytes(JSON.stringify({
    version: draft.version,
    scheme: draft.scheme,
    kind: draft.kind,
    chainId: draft.chainId,
    verifyingContract: draft.verifyingContract,
    scope: draft.scope,
    payload: draft.payload,
    signature: draft.signature,
    signer: draft.signer,
    createdAt: draft.createdAt,
  })));
}

async function attachAttestation(draft, wallet = signer) {
  return {
    ...draft,
    attestation: {
      scheme: ATTESTATION_SCHEME,
      signature: await wallet.signMessage(getBytes(attestationDigest(draft))),
      signer: wallet.address,
    },
  };
}

async function navEnvelope({ wallet = signer, chainId = 97, verifyingContract = navOracle, nav = '1500000', dataTimestamp = '1900' } = {}) {
  const payload = { vault, nav, dataTimestamp, nonce: dataTimestamp, deadline: null };
  const signature = await wallet.signMessage(getBytes(buildLegacyNavDigest(payload)));
  return attachAttestation({
    version: 2, scheme: ENVELOPE_SCHEME, kind: 'nav', chainId, verifyingContract,
    scope: { vault }, payload, signature, signer: wallet.address, createdAt,
  }, wallet);
}

async function settlementEnvelope(wallet = signer, overrides = {}) {
  const validUntil = '2000';
  const instruction = {
    vaultSettlements: [{ distribution: { vault, amount: '3' }, depositRequestIds: [], redeemRequestIds: [] }],
    cycleNumber: '4', validUntil,
  };
  const signature = await wallet.signMessage(getBytes(settlementDigest));
  return attachAttestation({
    version: 2, scheme: ENVELOPE_SCHEME, kind: 'settlement', chainId: 97, verifyingContract: settlement,
    scope: { vault }, payload: { instruction, nonce: '4', deadline: validUntil },
    signature, signer: wallet.address, createdAt, ...overrides,
  }, wallet);
}

async function legacyPsmEnvelope(overrides = {}) {
  const { payload: payloadOverrides = {}, ...envelopeOverrides } = overrides;
  const payload = {
    assetId: '7', amount: '1250000', decimals: 6, to, nonce: '9', expiry: '2000', deadline: '2000', documentId,
    ...payloadOverrides,
  };
  const signature = await signer.signMessage(getBytes(buildLegacyPsmDigest({ ...payload, reservePsm, chainId: 97 })));
  return {
    version: 1, kind: 'psm', chainId: 97, verifyingContract: reservePsm, scope: { assetId: '7' }, payload,
    signature, signer: signer.address, createdAt, ...envelopeOverrides,
  };
}

describe('signature exchange security boundary', () => {
  it('accepts and serializes a v2 NAV handoff only when the same signer attests the complete legacy envelope', async () => {
    const envelope = await navEnvelope();
    const expected = { chainId: 97, verifyingContract: navOracle, scope: { vault }, now: 1950n, isNonceUsed: vi.fn().mockResolvedValue(false) };
    await expect(validateSignatureEnvelope(envelope, expected)).resolves.toEqual(envelope);
    expect(JSON.parse(serializeSignatureEnvelope(envelope))).toEqual(envelope);
    expect(envelope.attestation.signer).toBe(envelope.signer);
  });

  it.each(['nav', 'settlement'])('rejects insecure legacy v1 %s imports even when the contract signature is valid', async kind => {
    const secure = kind === 'nav' ? await navEnvelope() : await settlementEnvelope();
    const { scheme: _scheme, attestation: _attestation, ...legacy } = secure;
    const v1 = { ...legacy, version: 1 };
    const expected = {
      chainId: 97, verifyingContract: kind === 'nav' ? navOracle : settlement, scope: { vault }, now: 1950n,
      hashSettlement: vi.fn().mockResolvedValue(settlementDigest), isNonceUsed: vi.fn().mockResolvedValue(false),
    };
    await expect(validateSignatureEnvelope(v1, expected)).rejects.toMatchObject({ code: 'insecureLegacyEnvelope' });
  });

  it('rejects cross-domain metadata rewriting that leaves the valid legacy NAV signature unchanged', async () => {
    const foreign = await navEnvelope({ chainId: 56, verifyingContract: foreignContract });
    const rewritten = { ...foreign, chainId: 97, verifyingContract: navOracle };
    await expect(validateSignatureEnvelope(rewritten, {
      chainId: 97, verifyingContract: navOracle, scope: { vault }, now: 1950n, isNonceUsed: async () => false,
    })).rejects.toMatchObject({ code: 'invalidAttestation' });
  });

  it('rejects any attested field mutation and an attestation made by a different signer', async () => {
    const envelope = await navEnvelope();
    const expected = { chainId: 97, verifyingContract: navOracle, scope: { vault }, now: 1950n, isNonceUsed: async () => false };
    await expect(validateSignatureEnvelope({ ...envelope, createdAt: '2026-07-31T00:00:01.000Z' }, expected))
      .rejects.toMatchObject({ code: 'invalidAttestation' });
    await expect(validateSignatureEnvelope({ ...envelope, attestation: { ...envelope.attestation, signer: secondSigner.address } }, expected))
      .rejects.toMatchObject({ code: 'invalidAttestation' });
  });

  it('fails legacy PSM closed because documentId is absent from the deployed digest', async () => {
    const envelope = await legacyPsmEnvelope();
    const mutated = { ...envelope, payload: { ...envelope.payload, documentId: `0x${'55'.repeat(32)}` } };
    const expected = { chainId: 97, verifyingContract: reservePsm, scope: { assetId: '7' }, now: 1900n, isNonceUsed: async () => false };
    await expect(validateSignatureEnvelope(envelope, expected)).rejects.toMatchObject({ code: 'unsupportedContractSignature' });
    await expect(validateSignatureEnvelope(mutated, expected)).rejects.toMatchObject({ code: 'unsupportedContractSignature' });
    expect(() => toRelayerSubmission(mutated)).toThrow(expect.objectContaining({ code: 'unsupportedContractSignature' }));
  });

  it('requires live target-profile decimals before any future document-bound PSM digest is hashed', async () => {
    const envelope = await legacyPsmEnvelope({ payload: { decimals: 18 } });
    const hashPsm = vi.fn().mockResolvedValue(`0x${'66'.repeat(32)}`);
    await expect(validateSignatureEnvelope(envelope, {
      chainId: 97, verifyingContract: reservePsm, scope: { assetId: '7' }, now: 1900n,
      psmDigestIncludesDocumentId: true, hashPsm, liveDecimals: 6, isNonceUsed: async () => false,
    })).rejects.toMatchObject({ code: 'psmDecimalsMismatch' });
    expect(hashPsm).not.toHaveBeenCalled();
  });

  it.each([
    ['leading-zero scope', envelope => ({ ...envelope, scope: { assetId: '007' } })],
    ['JSON-number scope', envelope => ({ ...envelope, scope: { assetId: 7 } })],
    ['zero asset', envelope => ({ ...envelope, scope: { assetId: '0' }, payload: { ...envelope.payload, assetId: '0' } })],
    ['leading-zero nonce', envelope => ({ ...envelope, payload: { ...envelope.payload, nonce: '09' } })],
    ['JSON-number amount', envelope => ({ ...envelope, payload: { ...envelope.payload, amount: 1250000 } })],
  ])('rejects noncanonical imported uint256 fields: %s', async (_label, mutate) => {
    const envelope = await legacyPsmEnvelope();
    expect(() => createSignatureEnvelope(mutate(envelope))).toThrow(expect.objectContaining({ name: 'ValidationError' }));
  });

  it('rejects JSON-number uint256 fields inside NAV and Settlement payloads', async () => {
    const nav = await navEnvelope();
    expect(() => createSignatureEnvelope({ ...nav, payload: { ...nav.payload, nav: 1500000 } }))
      .toThrow(expect.objectContaining({ code: 'invalidInteger' }));
    const batch = await settlementEnvelope();
    const numeric = {
      ...batch,
      payload: {
        ...batch.payload,
        instruction: {
          ...batch.payload.instruction,
          cycleNumber: 4,
        },
      },
    };
    expect(() => createSignatureEnvelope(numeric)).toThrow(expect.objectContaining({ code: 'invalidInteger' }));
  });

  it('rejects extra envelope keys instead of allowing ambiguous signed data', async () => {
    const envelope = await navEnvelope();
    await expect(validateSignatureEnvelope({ ...envelope, extra: true }, {
      chainId: 97, verifyingContract: navOracle, scope: { vault }, now: 1950n, isNonceUsed: async () => false,
    })).rejects.toMatchObject({ code: 'invalidSignatureEnvelope' });
  });

  it('aggregates only v2-attested unique operators for one exact Settlement batch and submits only legacy signatures', async () => {
    const first = await settlementEnvelope(signer);
    const second = await settlementEnvelope(secondSigner);
    const expected = {
      chainId: 97, verifyingContract: settlement, scope: { vault }, now: 1900n, threshold: 2n,
      hashSettlement: vi.fn().mockResolvedValue(settlementDigest), isNonceUsed: vi.fn().mockResolvedValue(false),
    };
    const envelopes = await validateSettlementEnvelopeSet([first, second], expected);
    expect(toRelayerSubmission(envelopes)).toEqual({
      actionId: 'settlement.batch.submit', scope: { vault },
      rawInput: { vault, instruction: first.payload.instruction, signatures: [first.signature, second.signature] },
    });
    expect(toRelayerSubmission(envelopes).rawInput.signatures).not.toContain(first.attestation.signature);
    await expect(validateSettlementEnvelopeSet([first, first], expected)).rejects.toMatchObject({ code: 'duplicateSigner' });
  });

  it('treats live Settlement threshold zero as an insecure unsupported deployment', async () => {
    await expect(validateSettlementEnvelopeSet([await settlementEnvelope()], {
      chainId: 97, verifyingContract: settlement, scope: { vault }, now: 1900n, threshold: 0n,
      hashSettlement: vi.fn().mockResolvedValue(settlementDigest), isNonceUsed: vi.fn().mockResolvedValue(false),
    })).rejects.toMatchObject({ code: 'insecureSettlementThreshold' });
  });
});
