import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Wallet, getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { LocaleProvider } from '../../i18n';
import { CycleState, ModuleId } from '../../integrations/hypertessera/upstream/types';
import { ROLE_DEFINITIONS } from '../config/roleDefinitions';
import { createTransactionStore, TransactionProvider } from '../core/transactionStore';
import { getWriteSigner } from '../core/walletRunner';
import { buildLegacyNavDigest, buildLegacyPsmDigest } from '../core/signaturePayloads';
import RoleWorkspacePage from './RoleWorkspacePage';

let wallet;
let sdk;
let navigateWorkspace;
const createReadSdk = vi.fn(() => sdk);
vi.mock('../../wallet', () => ({ useWallet: () => wallet }));
vi.mock('../core/createSdk', async importOriginal => ({
  ...await importOriginal(), createReadSdk: (...args) => createReadSdk(...args), createAmountDecimalsResolver: () => async () => 6,
  getSdkDeploymentBinding: value => value === sdk ? { chainId: 97, settlement: addresses.settlement, reservePSM: addresses.reservePSM, lpAdapter: addresses.lpAdapter } : null,
}));
vi.mock('../core/walletRunner', async importOriginal => ({ ...await importOriginal(), getWriteSigner: vi.fn() }));

const ENVELOPE_SCHEME = 'legacy-contract-signature+eip191-envelope-attestation-v1';
const ATTESTATION_SCHEME = 'eip191-canonical-envelope-v1';
const signingWallet = new Wallet('0x59c6995e998f97a5a0044976f094538a3e2f7a0d5bbfeb7e4b7a5b0525fbd3a5');
const secondSigner = new Wallet('0x8b3a350cf5c34c9194ca3a545d0f4f2ad7f69f4258c2b76e6f8f9a8c6e6a4f01');
const vault = '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea';
const to = '0x2222222222222222222222222222222222222222';
const zero = '0x0000000000000000000000000000000000000000';
const createdAt = '2026-07-31T00:00:00.000Z';
const settlementDigest = `0x${'33'.repeat(32)}`;
const addresses = {
  cashVault: vault, noteVault: '0xf95F69488393d73D0cDbFB40e6D6B3494b832242', lpVault: '0x6AAAaAe6c30997D7c36E4297b0e44B3eC6126335',
  cashAdapter: '0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4', noteAdapter: '0x7ddFB27c9AC47265Fd861A092050c0041A54067c', lpAdapter: '0xeEdBb2E9Baae30f450a9D2Ce35286d7CcF132ba1',
  stateManager: '0x2a9bb2053dD14b36652f1F6Bc2511b3Eb31b1DCd', navOracle: '0x009F0F9507E4e3Fda5159e85fa2f6c19875A3154',
  reservePSM: '0x67D10e814B57E381cE020697eF14CCDf922Dd654', settlement: '0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c',
};

function makeSdk() {
  const reserve = {
    globalPaused: vi.fn().mockResolvedValue(false), wrappedTokenOf: vi.fn().mockResolvedValue(to), usedNonce: vi.fn().mockResolvedValue(false),
    assetConfig: vi.fn().mockResolvedValue([1, zero, to, false, signingWallet.address, false]),
  };
  const nav = { authorizedSigner: vi.fn().mockResolvedValue(signingWallet.address) };
  const stateManager = { modulePaused: vi.fn().mockResolvedValue(false) };
  return {
    addresses, reserve, nav, stateManager,
    isVaultRegistered: vi.fn().mockResolvedValue(true), isVaultActive: vi.fn().mockResolvedValue(true),
    getStateContext: vi.fn().mockResolvedValue({ product: 3, cycle: CycleState.CALCULATING, pause: 0, cycleNumber: 3n }),
    getNAV: vi.fn().mockResolvedValue({ nav: 1_000_000n, dataTimestamp: 10n, updatedAt: 11n }), isNAVFresh: vi.fn().mockResolvedValue(true),
    isOperator: vi.fn().mockResolvedValue(true), threshold: vi.fn().mockResolvedValue(1n), hasRole: vi.fn().mockResolvedValue(true),
    pending: vi.fn().mockResolvedValue(0n), availableToDistribute: vi.fn().mockResolvedValue(0n), totalPending: vi.fn().mockResolvedValue(0n),
    getAssetInfo: vi.fn().mockResolvedValue({ metadataHash: `0x${'11'.repeat(32)}`, token: to, active: true, registeredAt: 1n, owner: signingWallet.address }),
    getContract: vi.fn(name => name === 'ReservePSM' ? reserve : name === 'NAVOracle' ? nav
      : name === 'StateManager' ? stateManager : name === 'RWAToken' || name === 'WrappedAsset' ? { decimals: vi.fn().mockResolvedValue(6) } : {}),
    hashInstruction: vi.fn().mockResolvedValue(settlementDigest), isExecuted: vi.fn().mockResolvedValue(false),
    updateNAV: vi.fn().mockResolvedValue({ status: 1 }), mintWithAuthorization: vi.fn().mockResolvedValue({ status: 1 }), submitBatch: vi.fn().mockResolvedValue({ status: 1 }),
  };
}

function NavigationCapture() {
  navigateWorkspace = useNavigate();
  return null;
}

function roleUi(roleId, object, store) {
  const role = ROLE_DEFINITIONS[roleId];
  const path = role.path.replace(':vault', object ?? vault).replace(':assetId', object ?? '7').replace(':adapter', object ?? addresses.cashAdapter);
  return <LocaleProvider><TransactionProvider store={store}><MemoryRouter initialEntries={[path]}>
    <NavigationCapture />
    <Routes><Route path={role.path} element={<RoleWorkspacePage roleId={roleId} />} /></Routes>
  </MemoryRouter></TransactionProvider></LocaleProvider>;
}

function renderRole(roleId, object, store) {
  const view = render(roleUi(roleId, object, store));
  return { ...view, rerenderRole: () => view.rerender(roleUi(roleId, object, store)) };
}

async function expandAction(actionId) {
  const host = screen.getAllByTestId('workspace-action').find(node => node.dataset.actionId === actionId);
  expect(host).toBeTruthy();
  const summary = host.querySelector('.ws-accordion-item__summary');
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
  return within(host).getByTestId(`workspace-action-${actionId}`);
}

async function expandRelayerImport() {
  const summary = screen.getByRole('button', { name: 'Validated signature import' });
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
}

async function expandSignatureExport() {
  const summary = screen.getByRole('button', { name: 'Signed payload handoff' });
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
}

function attestationDigest(draft) {
  return keccak256(toUtf8Bytes(JSON.stringify({
    version: draft.version, scheme: draft.scheme, kind: draft.kind, chainId: draft.chainId,
    verifyingContract: draft.verifyingContract, scope: draft.scope, payload: draft.payload,
    signature: draft.signature, signer: draft.signer, createdAt: draft.createdAt,
  })));
}

async function attachAttestation(draft, signer = signingWallet) {
  return {
    ...draft,
    attestation: { scheme: ATTESTATION_SCHEME, signature: await signer.signMessage(getBytes(attestationDigest(draft))), signer: signer.address },
  };
}

async function makeNavEnvelope({ dataTimestamp = '1785369600', nav = '1500000', chainId = 97, verifyingContract = addresses.navOracle } = {}) {
  const payload = { vault, nav, dataTimestamp, nonce: dataTimestamp, deadline: null };
  const signature = await signingWallet.signMessage(getBytes(buildLegacyNavDigest(payload)));
  return attachAttestation({
    version: 2, scheme: ENVELOPE_SCHEME, kind: 'nav', chainId, verifyingContract, scope: { vault }, payload,
    signature, signer: signingWallet.address, createdAt,
  });
}

function settlementInstruction(validUntil = '1893456000') {
  return { vaultSettlements: [{ distribution: { vault, amount: '1' }, depositRequestIds: [], redeemRequestIds: [] }], cycleNumber: '3', validUntil };
}

async function makeSettlementEnvelope(signer = signingWallet) {
  const instruction = settlementInstruction();
  const signature = await signer.signMessage(getBytes(settlementDigest));
  return attachAttestation({
    version: 2, scheme: ENVELOPE_SCHEME, kind: 'settlement', chainId: 97, verifyingContract: addresses.settlement,
    scope: { vault }, payload: { instruction, nonce: '3', deadline: instruction.validUntil },
    signature, signer: signer.address, createdAt,
  }, signer);
}

async function makeUnsafePsmEnvelope(document = `0x${'44'.repeat(32)}`) {
  const payload = { assetId: '7', amount: '1250000', decimals: 6, to, nonce: '9', expiry: '1893456000', deadline: '1893456000', documentId: document };
  const signature = await signingWallet.signMessage(getBytes(buildLegacyPsmDigest({ ...payload, reservePsm: addresses.reservePSM, chainId: 97 })));
  return { version: 1, kind: 'psm', chainId: 97, verifyingContract: addresses.reservePSM, scope: { assetId: '7' }, payload, signature, signer: signingWallet.address, createdAt };
}

async function signNavAndExport() {
  renderRole('nav-signer', vault);
  const panel = await expandAction('nav.sign');
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
  await userEvent.type(panel.querySelector('input[name="vault"]'), vault);
  await userEvent.type(panel.querySelector('input[name="nav"]'), '1.5');
  fireEvent.change(panel.querySelector('input[name="dataTimestamp"]'), { target: { value: '2026-07-30T00:00' } });
  await userEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));
  await expandSignatureExport();
  await userEvent.click(await screen.findByRole('button', { name: 'Export signed payload' }));
  return JSON.parse(screen.getByLabelText('Exported signed payload').value);
}

beforeEach(() => {
  localStorage.setItem('hyt.locale', 'en');
  sdk = makeSdk();
  createReadSdk.mockClear();
  navigateWorkspace = null;
  const provider = { request: vi.fn(async ({ method }) => method === 'eth_chainId' ? '0x61' : method === 'eth_accounts' ? [signingWallet.address] : null) };
  wallet = { session: { address: signingWallet.address, chainId: 97, provider }, switchChain: vi.fn() };
  const signer = { getAddress: vi.fn(async () => signingWallet.address), signMessage: vi.fn(message => signingWallet.signMessage(message)) };
  vi.mocked(getWriteSigner).mockReset().mockResolvedValue(signer);
});
afterEach(cleanup);

describe('signer and relayer workspaces', () => {
  it('NAV Signer performs the legacy contract signature plus same-signer v2 envelope attestation', async () => {
    const envelope = await signNavAndExport();
    expect(envelope).toMatchObject({
      version: 2, scheme: ENVELOPE_SCHEME, kind: 'nav', chainId: 97, verifyingContract: addresses.navOracle,
      scope: { vault }, signer: signingWallet.address, attestation: { scheme: ATTESTATION_SCHEME, signer: signingWallet.address },
    });
    expect(envelope.payload).toMatchObject({ vault, nav: '1500000', deadline: null });
    expect(vi.mocked(getWriteSigner).mock.results[0].value).toBeDefined();
    const signer = await vi.mocked(getWriteSigner).mock.results[0].value;
    expect(signer.signMessage).toHaveBeenCalledTimes(2);
    expect(sdk.updateNAV).not.toHaveBeenCalled();
  });

  it('marks legacy PSM signing explicitly unavailable because documentId is not authenticated onchain', async () => {
    renderRole('psm-authorized-signer', '7');
    const panel = await expandAction('psm.authorization.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeDisabled());
    expect(screen.getByText(/legacy psm.*document/i)).toBeInTheDocument();
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.mintWithAuthorization).not.toHaveBeenCalled();
  });

  it('Settlement Operator exports a v2 same-operator attestation but never submits the batch', async () => {
    renderRole('settlement-operator', vault);
    const panel = await expandAction('settlement.instruction.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
    const deadline = '2030-01-01T00:00';
    const instruction = settlementInstruction(String(Math.floor(new Date(deadline).getTime() / 1000)));
    await userEvent.type(panel.querySelector('input[name="vault"]'), vault);
    fireEvent.change(panel.querySelector('textarea[name="instruction"]'), { target: { value: JSON.stringify(instruction) } });
    fireEvent.change(panel.querySelector('input[name="deadline"]'), { target: { value: deadline } });
    await userEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));
    await expandSignatureExport();
    await userEvent.click(await screen.findByRole('button', { name: 'Export signed payload' }));
    expect(JSON.parse(screen.getByLabelText('Exported signed payload').value)).toMatchObject({
      version: 2, scheme: ENVELOPE_SCHEME, kind: 'settlement', scope: { vault }, payload: { nonce: '3', deadline: instruction.validUntil },
      attestation: { signer: signingWallet.address },
    });
    expect(sdk.submitBatch).not.toHaveBeenCalled();
  });

  it('uses NAV_ORACLE module pause rather than vault pause for NAV signing', async () => {
    sdk.getStateContext.mockResolvedValue({ product: 3, cycle: 0, pause: 1, cycleNumber: 3n });
    sdk.stateManager.modulePaused.mockResolvedValue(false);
    renderRole('nav-signer', vault);
    const enabledPanel = await expandAction('nav.sign');
    await waitFor(() => expect(within(enabledPanel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
    cleanup();

    sdk = makeSdk();
    sdk.stateManager.modulePaused.mockImplementation(async moduleId => moduleId === ModuleId.NAV_ORACLE);
    renderRole('nav-signer', vault);
    const disabledPanel = await expandAction('nav.sign');
    await waitFor(() => expect(within(disabledPanel).getByRole('button', { name: 'Sign payload' })).toBeDisabled());
  });

  it('Relayer validates a v2 NAV envelope, repeats live preflight, and submits the exact legacy signature only', async () => {
    const envelope = await makeNavEnvelope();
    renderRole('relayer');
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify(envelope) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Submit imported NAV' }));
    await waitFor(() => expect(sdk.updateNAV).toHaveBeenCalledOnce());
    expect(sdk.updateNAV).toHaveBeenCalledWith(vault, 1_500_000n, 1_785_369_600n, envelope.signature, expect.anything());
    expect(sdk.updateNAV.mock.calls[0]).not.toContain(envelope.attestation.signature);
    expect(sdk.stateManager.modulePaused).toHaveBeenCalledWith(ModuleId.NAV_ORACLE);
  });

  it('rejects a correctly signed but non-monotonic NAV reading before write signer or SDK write', async () => {
    const envelope = await makeNavEnvelope({ dataTimestamp: '5' });
    renderRole('relayer');
    vi.mocked(getWriteSigner).mockClear();
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify(envelope) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be validated/i));
    expect(sdk.getNAV).toHaveBeenCalledWith(vault);
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.updateNAV).not.toHaveBeenCalled();
  });

  it('rejects NAV import when the live NAV_ORACLE module is paused', async () => {
    sdk.stateManager.modulePaused.mockImplementation(async moduleId => moduleId === ModuleId.NAV_ORACLE);
    renderRole('relayer');
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify(await makeNavEnvelope()) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be validated/i));
    expect(sdk.stateManager.modulePaused).toHaveBeenCalledWith(ModuleId.NAV_ORACLE);
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.updateNAV).not.toHaveBeenCalled();
  });

  it('rejects all legacy PSM imports, including documentId mutation, before signer or mintWithAuthorization', async () => {
    const envelope = await makeUnsafePsmEnvelope();
    envelope.payload.documentId = `0x${'55'.repeat(32)}`;
    renderRole('relayer');
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify(envelope) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be validated/i));
    expect(screen.queryByRole('button', { name: /Submit imported PSM/i })).not.toBeInTheDocument();
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.mintWithAuthorization).not.toHaveBeenCalled();
  });

  it('Relayer submits a live threshold of exact Settlement envelopes as (instruction, signatures[], signer)', async () => {
    sdk.threshold.mockResolvedValue(2n);
    const envelopes = [await makeSettlementEnvelope(signingWallet), await makeSettlementEnvelope(secondSigner)];
    renderRole('relayer');
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify(envelopes) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Submit imported Settlement batch' }));
    await waitFor(() => expect(sdk.submitBatch).toHaveBeenCalledOnce());
    expect(sdk.submitBatch).toHaveBeenCalledWith(
      expect.objectContaining({ cycleNumber: 3n, validUntil: 1_893_456_000n }),
      envelopes.map(item => item.signature),
      expect.anything(),
    );
    expect(sdk.getStateContext).toHaveBeenCalledWith(vault);
  });

  it('rejects a stale Settlement vault cycle before write signer or submitBatch', async () => {
    sdk.getStateContext.mockResolvedValue({ product: 3, cycle: CycleState.ACCEPTING, pause: 0, cycleNumber: 2n });
    renderRole('relayer');
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify([await makeSettlementEnvelope()]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be validated/i));
    expect(sdk.getStateContext).toHaveBeenCalledWith(vault);
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.submitBatch).not.toHaveBeenCalled();
  });

  it('rejects Settlement threshold zero as an insecure deployment with zero submission', async () => {
    sdk.threshold.mockResolvedValue(0n);
    renderRole('relayer');
    await expandRelayerImport();
    fireEvent.change(screen.getByLabelText('Signed payload import'), { target: { value: JSON.stringify([await makeSettlementEnvelope()]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be validated/i));
    expect(getWriteSigner).not.toHaveBeenCalled();
    expect(sdk.submitBatch).not.toHaveBeenCalled();
  });

  it('does not restore validation A after the import source is replaced with B under the same identity', async () => {
    const envelopeA = await makeNavEnvelope({ nav: '1500000', dataTimestamp: '1785369600' });
    const envelopeB = await makeNavEnvelope({ nav: '2500000', dataTimestamp: '1785369700' });
    let resolveNavA;
    const pendingNavA = new Promise(resolve => { resolveNavA = resolve; });
    sdk.getNAV.mockReturnValueOnce(pendingNavA);
    renderRole('relayer');
    await expandRelayerImport();
    const input = screen.getByLabelText('Signed payload import');
    fireEvent.change(input, { target: { value: JSON.stringify(envelopeA) } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(sdk.getNAV).toHaveBeenCalledWith(vault));

    fireEvent.change(input, { target: { value: JSON.stringify(envelopeB) } });
    expect(screen.queryByRole('button', { name: /Submit imported/i })).not.toBeInTheDocument();
    await act(async () => {
      resolveNavA({ nav: 1_000_000n, dataTimestamp: 10n, updatedAt: 11n });
      await pendingNavA;
    });
    await act(async () => { await Promise.resolve(); });

    expect(input).toHaveValue(JSON.stringify(envelopeB));
    expect(screen.queryByText(/Validated nav payload/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit imported/i })).not.toBeInTheDocument();
  });

  it('keeps signing result B when overlapping sign B resolves before older sign A', async () => {
    const dataTimestamp = BigInt(Math.floor(new Date('2026-07-30T00:00').getTime() / 1000));
    const signatureA = await signingWallet.signMessage(getBytes(buildLegacyNavDigest({ vault, nav: 1_500_000n, dataTimestamp })));
    const signatureB = await signingWallet.signMessage(getBytes(buildLegacyNavDigest({ vault, nav: 2_500_000n, dataTimestamp })));
    let resolveA;
    let resolveB;
    const pendingA = new Promise(resolve => { resolveA = resolve; });
    const pendingB = new Promise(resolve => { resolveB = resolve; });
    let signatureCall = 0;
    const deferredSigner = {
      getAddress: vi.fn(async () => signingWallet.address),
      signMessage: vi.fn(message => {
        signatureCall += 1;
        if (signatureCall === 1) return pendingA;
        if (signatureCall === 2) return pendingB;
        return signingWallet.signMessage(message);
      }),
    };
    vi.mocked(getWriteSigner).mockResolvedValue(deferredSigner);
    renderRole('nav-signer', vault);
    const panel = await expandAction('nav.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
    const navInput = panel.querySelector('input[name="nav"]');
    await userEvent.type(panel.querySelector('input[name="vault"]'), vault);
    await userEvent.type(navInput, '1.5');
    fireEvent.change(panel.querySelector('input[name="dataTimestamp"]'), { target: { value: '2026-07-30T00:00' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));
    await waitFor(() => expect(deferredSigner.signMessage).toHaveBeenCalledTimes(1));

    fireEvent.change(navInput, { target: { value: '2.5' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));
    await waitFor(() => expect(deferredSigner.signMessage).toHaveBeenCalledTimes(2));
    await act(async () => { resolveB(signatureB); await pendingB; });
    await expandSignatureExport();
    await screen.findByRole('button', { name: 'Export signed payload' });
    await act(async () => { resolveA(signatureA); await pendingA; });
    await act(async () => { await Promise.resolve(); });

    await userEvent.click(screen.getByRole('button', { name: 'Export signed payload' }));
    expect(JSON.parse(screen.getByLabelText('Exported signed payload').value).payload.nav).toBe('2500000');
  });

  it.each(['account', 'chain', 'object'])('discards a deferred NAV signing result after %s identity changes', async change => {
    const dataTimestamp = BigInt(Math.floor(new Date('2026-07-30T00:00').getTime() / 1000));
    const legacySignature = await signingWallet.signMessage(getBytes(buildLegacyNavDigest({ vault, nav: 1_500_000n, dataTimestamp })));
    let resolveSignature;
    const pending = new Promise(resolve => { resolveSignature = resolve; });
    const deferredSigner = { getAddress: vi.fn(async () => signingWallet.address), signMessage: vi.fn(() => pending) };
    vi.mocked(getWriteSigner).mockResolvedValue(deferredSigner);
    const view = renderRole('nav-signer', vault);
    const panel = await expandAction('nav.sign');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Sign payload' })).toBeEnabled());
    await userEvent.type(panel.querySelector('input[name="vault"]'), vault);
    await userEvent.type(panel.querySelector('input[name="nav"]'), '1.5');
    fireEvent.change(panel.querySelector('input[name="dataTimestamp"]'), { target: { value: '2026-07-30T00:00' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Sign payload' }));
    await waitFor(() => expect(deferredSigner.signMessage).toHaveBeenCalledOnce());

    if (change === 'account') {
      wallet = { ...wallet, session: { ...wallet.session, address: to } };
      view.rerenderRole();
    } else if (change === 'chain') {
      wallet = { ...wallet, session: { ...wallet.session, chainId: 56 } };
      view.rerenderRole();
    } else {
      await act(async () => navigateWorkspace(`/workspaces/nav-signer/${addresses.noteVault}`));
    }
    await act(async () => { resolveSignature(legacySignature); await pending; });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'Export signed payload' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Exported signed payload')).not.toBeInTheDocument();
  });

  it('clears imported secrets and discards deferred validation after account identity changes', async () => {
    const envelope = await makeNavEnvelope();
    let resolveNav;
    const pendingNav = new Promise(resolve => { resolveNav = resolve; });
    sdk.getNAV.mockReturnValueOnce(pendingNav);
    const view = renderRole('relayer');
    await expandRelayerImport();
    const input = screen.getByLabelText('Signed payload import');
    fireEvent.change(input, { target: { value: JSON.stringify(envelope) } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate signed payload' }));
    await waitFor(() => expect(sdk.getNAV).toHaveBeenCalledWith(vault));
    wallet = { ...wallet, session: { ...wallet.session, address: to } };
    view.rerenderRole();
    await act(async () => { resolveNav({ nav: 1_000_000n, dataTimestamp: 10n, updatedAt: 11n }); await pendingNav; });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText('Signed payload import')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Submit imported/i })).not.toBeInTheDocument();
  });
});
