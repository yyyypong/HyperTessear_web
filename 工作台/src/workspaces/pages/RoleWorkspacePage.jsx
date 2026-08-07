import { useEffect, useMemo, useRef, useState } from 'react';
import { getAddress, getBytes, id } from 'ethers';
import { useParams } from 'react-router-dom';
import { CycleState, ModuleId, ProductState } from '../../integrations/hypertessera/upstream/types';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ActionAccordionItem from '../components/ActionAccordionItem';
import StatGrid from '../components/StatGrid';
import { getDeployment } from '../config/deployments';
import { getActionDefinition, getRoleDefinition } from '../config/roleDefinitions';
import { executeAction, executeSignatureAction } from '../core/actionExecutors';
import { resolveCapability } from '../core/capabilityResolver';
import { CAPABILITY_STATES } from '../core/capabilityStates';
import { createAmountDecimalsResolver, createReadSdk } from '../core/createSdk';
import { ATTESTATION_SCHEME, buildEnvelopeAttestationDigest, createSignatureEnvelope, ENVELOPE_SCHEME, serializeSignatureEnvelope, toRelayerSubmission, validateSettlementEnvelopeSet, validateSignatureEnvelope } from '../core/signatureExchange';
import { createSignatureCapabilityAdapter, isBuiltInSignatureAction } from '../core/signaturePayloads';
import { useTransactions } from '../core/transactionStore';
import { validateActionInput } from '../core/validators';
import { getWriteSigner } from '../core/walletRunner';
import { loadPoolOverview, loadRoleOverview, loadSettlementOverview, loadVaultOverview, loadVaultRoleOverview } from '../core/workspaceQueries';
import { createDemoAdapter, createDemoAmountDecimalsResolver, createDemoReadSdk, createDemoSigner, isDemoWallet, toDemoRelayerSubmission, validateDemoRelayerSource } from '../core/demoLayer';
import { createCurrentAdapter } from '../sdk/currentAdapter';

const DEPLOYMENT_CHAIN_ID = 97;
const OPERATIONAL_ROLES = new Set([
  'governor', 'vault-owner', 'curator', 'guardian', 'allocator', 'settlement-operator', 'keeper',
  'asset-owner', 'token-agent', 'proof-publisher', 'wrapper-controller', 'nav-signer',
  'adapter-data-provider', 'psm-authorized-signer', 'relayer',
]);
const ROLE_IDS = Object.freeze({
  governor: id('GOVERNOR_ROLE'),
  // The current deployment gates vault-owner administrative calls with the
  // global Governor role, so the vault-owner workspace authenticates against it.
  'vault-owner': id('GOVERNOR_ROLE'),
  curator: id('CURATOR_ROLE'),
  guardian: id('GUARDIAN_ROLE'),
  allocator: id('ALLOCATOR_ROLE'),
  keeper: id('KEEPER_ROLE'),
  'asset-owner': id('ISSUER_ROLE'),
  'token-agent': id('TOKEN_AGENT_ROLE'),
  'proof-publisher': id('DATA_PROVIDER_ROLE'),
  'wrapper-controller': id('GOVERNOR_ROLE'),
  'adapter-data-provider': id('DATA_PROVIDER_ROLE'),
});
/**
 * Roles appointed on the vault itself rather than granted protocol-wide. Their
 * membership is resolved per vault so the answer stays correct on both the
 * deployed (global grants) and target (vault-local appointments) contracts.
 */
const VAULT_LOCAL_ROLES = new Set(['vault-owner', 'curator', 'guardian', 'allocator', 'keeper']);
const MODULE_NAMES = Object.freeze(['Cash vault', 'Note vault', 'LP vault', 'Settlement', 'NAV oracle', 'PSM pool', 'Tokenization', 'Reward', 'Claim registry']);
const PAUSE_MANAGEMENT = new Set(['protocol.modules.pause', 'psm.protocol.pause', 'vault.pause', 'wrapper.asset.pause']);
const DANGEROUS_ACTIONS = new Set(['governor.members.manage', 'protocol.modules.pause', 'psm.protocol.pause', 'vault.pause', 'vault.owner.transfer', 'vault.timelock.cancel', 'vault.roles.set', 'vault.settlement.configure', 'vault.modules.bind', 'vault.adapters.configure', 'nav.signer.manage', 'revenue.treasury.set']);

function canonicalAddress(value) {
  try { return getAddress(value); } catch {
    // Demo / mock objects use mixed-case addresses without a valid checksum;
    // a well-formed 20-byte hex string still identifies the object.
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      try { return getAddress(value.toLowerCase()); } catch { return null; }
    }
    return null;
  }
}

function canonicalAssetId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  try {
    const assetId = BigInt(value);
    return assetId < (1n << 256n) ? value : null;
  } catch { return null; }
}

function isZeroAddress(value) {
  return canonicalAddress(value) === '0x0000000000000000000000000000000000000000';
}

function wrapperConfigured(assetData) {
  return Boolean(assetData && ((!isZeroAddress(assetData.wrappedToken) && canonicalAddress(assetData.wrappedToken))
    || (!isZeroAddress(assetData.psmConfig?.wrappedToken) && canonicalAddress(assetData.psmConfig?.wrappedToken))));
}

function configuredVault(deployment, vault) {
  const selected = canonicalAddress(vault);
  if (!selected) return false;
  return ['cashVault', 'noteVault', 'lpVault'].some(name => canonicalAddress(deployment.addresses[name]) === selected);
}

function bindManifestVaults(baseAdapter, deployment, { demo = false } = {}) {
  if (!baseAdapter) return null;
  const allowed = (actionId, input) => demo
    || getActionDefinition(actionId)?.scope !== 'vault'
    || configuredVault(deployment, input?.vault);
  return {
    supports(actionId, input) { return allowed(actionId, input) && baseAdapter.supports(actionId, input); },
    async execute(actionId, input) {
      if (!allowed(actionId, input)) throw new Error('Workspace action unavailable');
      return baseAdapter.execute(actionId, input);
    },
    readSdk: baseAdapter.readSdk,
  };
}

function routeObject(role, params, t) {
  if (role.scope === 'vault') return { field: 'vault', label: t.workspaces.ui.vault, value: params.vault };
  if (role.scope === 'asset') return { field: 'assetId', label: t.workspaces.ui.asset, value: params.assetId };
  if (role.scope === 'wrapper') return { field: 'assetId', label: t.workspaces.ui.asset, value: params.assetId };
  if (role.scope === 'adapter') return { field: 'adapter', label: t.workspaces.ui.adapter, value: params.adapter };
  return null;
}

function keeperStateAllows(actionId, state) {
  if (!state) return false;
  if (actionId === 'lifecycle.open-subscription') return state.product === ProductState.CONFIGURING;
  if (actionId === 'lifecycle.finalize-subscription') return state.product === ProductState.SUBSCRIBING;
  if (actionId === 'lifecycle.start-calculation') return state.product === ProductState.OPERATING && state.cycle === CycleState.ACCEPTING;
  if (actionId === 'lifecycle.enter-final-settlement') return state.product === ProductState.OPERATING;
  if (actionId === 'lifecycle.enter-maturing') return state.product === ProductState.SETTLING;
  if (actionId === 'lifecycle.enter-claiming') return state.product === ProductState.MATURING;
  if (actionId === 'lifecycle.close-product') return state.product === ProductState.CLAIMING;
  // Maintenance is deliberately stricter than the lifecycle transition map.
  if (actionId === 'request.mark-refundable') return state.product === ProductState.FUNDING_FAILED;
  if (actionId === 'claim.record') return state.product === ProductState.CLAIMING;
  return false;
}

function display(value, t) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? t.workspaces.ui.yes : t.workspaces.ui.no;
  return value ?? t.workspaces.ui.valueUnavailable;
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function reserveConfig(raw) {
  if (!raw) return null;
  return {
    mode: raw.mode ?? raw[0], underlyingToken: raw.underlyingToken ?? raw[1], wrappedToken: raw.wrappedToken ?? raw[2],
    allowPartialUnwrap: raw.allowPartialUnwrap ?? raw[3], authorizedSigner: raw.authorizedSigner ?? raw[4], paused: raw.paused ?? raw[5],
  };
}

async function loadAssetOverview({ sdk, assetId, includePsm = false, signal }) {
  try {
    abortIfNeeded(signal);
    const asset = await sdk.getAssetInfo(BigInt(assetId));
    abortIfNeeded(signal);
    const wrappedToken = typeof sdk.wrappedTokenOf === 'function' ? await sdk.wrappedTokenOf(BigInt(assetId)) : null;
    abortIfNeeded(signal);
    let psmConfig = null;
    let psmPaused = false;
    if (includePsm) {
      const psm = sdk.getContract('ReservePSM', sdk.addresses?.reservePSM);
      const [rawConfig, globalPaused] = await Promise.all([psm.assetConfig(BigInt(assetId)), psm.globalPaused()]);
      psmConfig = reserveConfig(rawConfig);
      psmPaused = globalPaused === true;
    }
    abortIfNeeded(signal);
    return { status: 'success', data: { asset, wrappedToken, psmConfig, psmPaused }, error: null };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { status: 'error', data: null, error: { code: 'assetOverviewUnavailable', messageKey: 'workspaces.errors.assetOverviewUnavailable' } };
  }
}

async function loadNavSigner({ sdk, vault, signal }) {
  try {
    abortIfNeeded(signal);
    const [signer, modulePaused] = await Promise.all([
      sdk.getContract('NAVOracle', sdk.addresses?.navOracle).authorizedSigner(vault),
      sdk.getContract('StateManager', sdk.addresses?.stateManager).modulePaused(ModuleId.NAV_ORACLE),
    ]);
    abortIfNeeded(signal);
    return { status: 'success', data: { signer, modulePaused }, error: null };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { status: 'error', data: null, error: { code: 'navSignerUnavailable', messageKey: 'workspaces.errors.navSignerUnavailable' } };
  }
}

function actionTarget(actionId, deployment, object) {
  if (object?.vault) return object.vault;
  if (actionId === 'governor.members.manage') return deployment.addresses.hyperAccessControl;
  if (actionId === 'protocol.modules.pause') return deployment.addresses.stateManager;
  if (actionId === 'psm.protocol.pause') return deployment.addresses.reservePSM;
  if (actionId === 'revenue.treasury.set') return deployment.addresses.revenuePool;
  if (actionId === 'vault.settlement.configure') return deployment.addresses.settlement;
  if (actionId === 'nav.signer.manage') return deployment.addresses.navOracle;
  return null;
}

function cachedHooks({ roleId, snapshot, account, demo = false }) {
  const vaultData = snapshot?.vault?.status === 'success' ? snapshot.vault.data : null;
  const roleData = snapshot?.roles?.status === 'success' ? snapshot.roles.data : null;
  const settlementData = snapshot?.settlement?.status === 'success' ? snapshot.settlement.data : null;
  const assetData = snapshot?.asset?.status === 'success' ? snapshot.asset.data : null;
  const navSigner = snapshot?.navSigner?.status === 'success' ? snapshot.navSigner.data.signer : null;
  const navModulePaused = snapshot?.navSigner?.status === 'success' ? snapshot.navSigner.data.modulePaused : null;
  return {
    isPaused: async ({ action }) => {
      if (PAUSE_MANAGEMENT.has(action.id)) return false;
      if (roleId === 'nav-signer' && action.id === 'nav.sign') {
        if (typeof navModulePaused !== 'boolean') throw new Error('NAV module state unavailable');
        return navModulePaused;
      }
      if (['wrapper', 'asset'].includes(action.scope) && ['wrapper-controller', 'psm-authorized-signer'].includes(roleId)) {
        if (!assetData?.psmConfig) throw new Error('PSM state unavailable');
        return assetData.psmPaused || assetData.psmConfig.paused === true;
      }
      if (action.scope !== 'vault') return false;
      if (!vaultData) throw new Error('vault state unavailable');
      return Number(vaultData.state.pause) !== 0;
    },
    isValidState: async ({ action }) => {
      if (action.id === 'asset.register' || action.scope === 'permissionless') return true;
      if (action.scope === 'wrapper') {
        if (!assetData?.asset?.active || !assetData.psmConfig) return false;
        const configured = wrapperConfigured(assetData);
        if (action.id === 'wrapper.deploy') return !configured;
        if (action.id === 'wrapper.signer.set') return configured && Number(assetData.psmConfig.mode) === 1;
        if (action.id === 'wrapper.asset.pause') return configured;
      }
      if (action.scope === 'asset') return Boolean(assetData?.asset?.active);
      if (action.scope === 'adapter') return true;
      if (action.scope !== 'vault') {
        if (roleId === 'governor' && !roleData) throw new Error('protocol state unavailable');
        return true;
      }
      if (!vaultData) throw new Error('vault state unavailable');
      if (!vaultData.registered) return false;
      return roleId === 'keeper' ? (demo || keeperStateAllows(action.id, vaultData.state)) : true;
    },
    isAuthorized: async ({ action }) => {
      if (roleId === 'asset-owner') {
        if (['asset.register', 'mint.initiate', 'burn.initiate'].includes(action.id)) return roleData?.roles?.[roleId] === true;
        return canonicalAddress(assetData?.asset?.owner) === canonicalAddress(account);
      }
      if (roleId === 'settlement-operator') {
        if (!settlementData) throw new Error('settlement authorization unavailable');
        return settlementData.operator === true;
      }
      if (roleId === 'nav-signer') return canonicalAddress(navSigner) === canonicalAddress(account);
      if (roleId === 'psm-authorized-signer') return canonicalAddress(assetData?.psmConfig?.authorizedSigner) === canonicalAddress(account);
      if (!roleData) throw new Error('role authorization unavailable');
      return roleData.roles?.[roleId] === true;
    },
  };
}

async function loadSnapshot({ sdk, roleId, account, vault, assetId, signal }) {
  const work = {};
  if (vault) work.vault = loadVaultOverview({ sdk, vault, signal });
  if (assetId !== undefined) work.asset = loadAssetOverview({ sdk, assetId, includePsm: ['wrapper-controller', 'psm-authorized-signer'].includes(roleId), signal });
  if (roleId === 'governor') work.roles = loadRoleOverview({ sdk, account, roleIds: ROLE_IDS, signal });
  else if (VAULT_LOCAL_ROLES.has(roleId) && vault) work.roles = loadVaultRoleOverview({ sdk, account, vault, signal });
  else if (ROLE_IDS[roleId]) work.roles = loadRoleOverview({ sdk, account, roleIds: { [roleId]: ROLE_IDS[roleId] }, moduleIds: [], signal });
  if (roleId === 'settlement-operator') work.settlement = loadSettlementOverview({ sdk, account, vault, signal });
  if (roleId === 'nav-signer' && vault) work.navSigner = loadNavSigner({ sdk, vault, signal });
  if (vault && ['allocator', 'settlement-operator', 'keeper'].includes(roleId)) work.pool = loadPoolOverview({ sdk, vault, signal });
  const entries = await Promise.all(Object.entries(work).map(async ([key, request]) => [key, await request]));
  return Object.fromEntries(entries);
}

function statsFor(roleId, snapshot, t) {
  const s = t.workspaces.stats;
  const items = [];
  const vault = snapshot?.vault?.data;
  if (vault) items.push(
    { label: s.registered, value: display(vault.registered, t) },
    { label: s.active, value: display(vault.active, t) },
    { label: s.productState, value: display(vault.state.product, t) },
    { label: s.cycleState, value: display(vault.state.cycle, t) },
    { label: s.cycle, value: display(vault.state.cycleNumber, t) },
    { label: s.nav, value: display(vault.nav.nav, t) },
    { label: s.navFresh, value: display(vault.navFresh, t) },
  );
  const pool = snapshot?.pool?.data;
  if (pool) items.push({ label: s.poolPending, value: display(pool.pending, t) }, { label: s.available, value: display(pool.available, t) }, { label: s.totalPending, value: display(pool.totalPending, t) });
  const settlement = snapshot?.settlement?.data;
  if (settlement) items.push({ label: s.settlementOperator, value: display(settlement.operator, t) }, { label: s.signatureThreshold, value: display(settlement.threshold, t) });
  const roles = snapshot?.roles?.data;
  if (roles) {
    Object.entries(roles.roles).forEach(([name, member]) => items.push({ label: s.roleLabel.replace('{name}', name), value: display(member, t) }));
    if (roleId === 'governor') {
      Object.entries(roles.modulesPaused).forEach(([moduleId, paused]) => items.push({
        label: MODULE_NAMES[Number(moduleId)] ?? s.moduleFallback.replace('{id}', moduleId),
        value: paused ? s.paused : s.statusActive,
      }));
      items.push({ label: s.protocolPsm, value: roles.psmPaused ? s.paused : s.statusActive });
    }
  }
  const asset = snapshot?.asset?.data;
  if (asset) {
    items.push(
      { label: s.assetOwner, value: display(asset.asset.owner, t) },
      { label: s.assetToken, value: display(asset.asset.token, t) },
      { label: s.active, value: display(asset.asset.active, t) },
      { label: s.metadataHash, value: display(asset.asset.metadataHash, t) },
      { label: s.registeredAt, value: display(asset.asset.registeredAt, t) },
      { label: s.wrappedToken, value: display(asset.wrappedToken, t) },
    );
    if (asset.psmConfig) items.push(
      { label: s.psmSigner, value: display(asset.psmConfig.authorizedSigner, t) },
      { label: s.psmAssetPaused, value: display(asset.psmConfig.paused, t) },
    );
  }
  const signer = snapshot?.navSigner?.data?.signer;
  if (signer) items.push({ label: s.navAuthorizedSigner, value: signer });
  return items;
}

function signaturePayload(actionId, input, decimals) {
  if (actionId === 'nav.sign') return {
    vault: input.vault, nav: input.nav, dataTimestamp: input.dataTimestamp,
    nonce: input.dataTimestamp, deadline: null,
  };
  if (actionId === 'psm.authorization.sign') return {
    assetId: input.assetId, amount: input.amount, decimals, to: input.to, nonce: input.nonce,
    expiry: input.expiry, deadline: input.expiry, documentId: input.documentId,
  };
  return { instruction: input.instruction, nonce: input.instruction.cycleNumber, deadline: input.instruction.validUntil };
}

function signatureKind(actionId) {
  if (actionId === 'nav.sign') return 'nav';
  if (actionId === 'psm.authorization.sign') return 'psm';
  return 'settlement';
}

function signatureContract(actionId, deployment) {
  if (actionId === 'nav.sign') return deployment.addresses.navOracle;
  if (actionId === 'psm.authorization.sign') return deployment.addresses.reservePSM;
  return deployment.addresses.settlement;
}

function relayerSubmitLabel(kind, t) {
  if (kind === 'nav') return t.workspaces.page.submitImportedNav;
  if (kind === 'psm') return t.workspaces.page.submitImportedPsm;
  return t.workspaces.page.submitImportedSettlement;
}

function requestField(request, name, index) {
  return request?.[name] ?? request?.[index];
}

async function preflightApprovalRequest(sdk, actionId, input, routeAssetId) {
  const controller = sdk.getContract('MintBurnController', sdk.addresses?.mintBurnController);
  const getter = actionId === 'mint.approve' ? 'mintRequests' : 'burnRequests';
  const request = await controller[getter](input.nonce);
  let bound = false;
  try {
    bound = BigInt(requestField(request, 'assetId', 0)) === BigInt(routeAssetId)
      && BigInt(requestField(request, 'assetId', 0)) === BigInt(input.assetId)
      && BigInt(requestField(request, 'amount', 1)) > 0n;
  } catch { bound = false; }
  if (!bound || requestField(request, 'approved', 3) === true || requestField(request, 'executed', 4) === true) {
    throw new Error('Approval request unavailable');
  }
}

export default function RoleWorkspacePage({ roleId, vault, assetId, adapterOverride }) {
  const role = getRoleDefinition(roleId);
  const params = useParams();
  const { t } = useI18n();
  const wallet = useWallet();
  const transactions = useTransactions();
  const demo = isDemoWallet(wallet);
  const deployment = getDeployment(DEPLOYMENT_CHAIN_ID);
  const mergedParams = {
    ...params,
    vault: vault ?? params.vault,
    assetId: assetId ?? params.assetId,
    adapter: adapterOverride ?? params.adapter,
  };
  const selected = routeObject(role, mergedParams, t);
  const canonicalObject = selected?.field === 'vault' || selected?.field === 'adapter'
    ? canonicalAddress(selected.value)
    : selected?.field === 'assetId' ? canonicalAssetId(selected.value) : selected?.value;
  const invalidObject = Boolean(selected && !canonicalObject);
  const object = canonicalObject ? { [selected.field]: canonicalObject } : {};
  const title = role ? t.workspaces.roles[role.id].title : roleId;
  const actions = role.actions.map(getActionDefinition);
  const operational = OPERATIONAL_ROLES.has(roleId);

  const sdkResult = useMemo(() => {
    if (!operational || invalidObject) return { sdk: null, error: null };
    const chainOk = demo || Number(wallet.session?.chainId) === deployment.chainId;
    if (!chainOk || (!demo && !wallet.session?.provider)) return { sdk: null, error: null };
    if (demo) return { sdk: createDemoReadSdk(deployment), error: null };
    try { return { sdk: createReadSdk(deployment, wallet.session.provider), error: null }; }
    catch { return { sdk: null, error: t.workspaces.page.deploymentInitFailed }; }
  }, [deployment, demo, invalidObject, operational, wallet.session?.provider, wallet.session?.chainId, t]);
  const readSdk = sdkResult.sdk;
  const adapter = useMemo(() => readSdk ? bindManifestVaults(
    createSignatureCapabilityAdapter(demo
      ? createDemoAdapter(deployment)
      : createCurrentAdapter({ readSdk, writeSdk: readSdk })),
    deployment,
    { demo },
  ) : null, [deployment, demo, readSdk]);
  const getAmountDecimals = useMemo(() => demo
    ? createDemoAmountDecimalsResolver()
    : readSdk ? createAmountDecimalsResolver(readSdk) : null, [demo, readSdk]);
  const identityKey = `${canonicalAddress(wallet.session?.address)?.toLowerCase() ?? 'disconnected'}|${Number(wallet.session?.chainId) || 'no-chain'}|${roleId}|${canonicalObject ?? 'no-object'}|${deployment.chainId}:${deployment.profile}:${deployment.sourceCommit}`;
  const identityRef = useRef(identityKey);
  const signingGenerationRef = useRef(0);
  const importGenerationRef = useRef(0);
  const submissionGenerationRef = useRef(0);
  identityRef.current = identityKey;
  const [snapshotState, setSnapshotState] = useState({ identityKey: null, sdk: null, data: null });
  const [capabilityState, setCapabilityState] = useState({ identityKey: null, sdk: null, data: {} });
  const [signedEnvelope, setSignedEnvelope] = useState(null);
  const [exportedEnvelope, setExportedEnvelope] = useState('');
  const [importSource, setImportSource] = useState('');
  const [validatedImport, setValidatedImport] = useState(null);
  const [importStatus, setImportStatus] = useState('');
  const [openActionId, setOpenActionId] = useState(null);
  const [relayerImportOpen, setRelayerImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const toggleAction = (actionId) => setOpenActionId(current => (current === actionId ? null : actionId));
  const snapshot = snapshotState.identityKey === identityKey && snapshotState.sdk === readSdk ? snapshotState.data : null;
  const capabilities = capabilityState.identityKey === identityKey && capabilityState.sdk === readSdk ? capabilityState.data : {};

  useEffect(() => {
    const controller = new AbortController();
    setSnapshotState({ identityKey, sdk: readSdk, data: null });
    if (!readSdk) return () => controller.abort();
    loadSnapshot({ sdk: readSdk, roleId, account: wallet.session.address, vault: object.vault, assetId: object.assetId, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSnapshotState({ identityKey, sdk: readSdk, data: result }); })
      .catch(error => { if (error?.name !== 'AbortError' && !controller.signal.aborted) setSnapshotState({ identityKey, sdk: readSdk, data: { error: true } }); });
    return () => controller.abort();
  }, [identityKey, readSdk, roleId, wallet.session?.address, object.vault, object.assetId]);

  useEffect(() => {
    signingGenerationRef.current += 1;
    importGenerationRef.current += 1;
    submissionGenerationRef.current += 1;
    setSignedEnvelope(null);
    setExportedEnvelope('');
    setImportSource('');
    setValidatedImport(null);
    setImportStatus('');
  }, [identityKey]);

  useEffect(() => {
    let current = true;
    const hooks = cachedHooks({ roleId, snapshot, account: wallet.session?.address, demo });
    Promise.all(actions.map(async action => {
      const result = await resolveCapability({ wallet: wallet.session, chainId: wallet.session?.chainId, deployment, object, adapter, ...hooks }, action);
      if (result.state === 'targetOnly') {
        result.detail = {
          ...result.detail,
          requiredMethod: action.capability?.target?.targetAdapterMethod ?? result.detail?.requiredMethod,
          requiredModule: action.capability?.target?.requiredModules?.[0] ?? result.detail?.requiredModule,
        };
      }
      if (roleId === 'keeper' && result.state === 'available') result.detail = { ...result.detail, stateEligible: true };
      if (result.state === 'unauthorized') result.detail = { ...result.detail, connectedAddress: wallet.session?.address };
      return [action.id, result];
    })).then(entries => { if (current) setCapabilityState({ identityKey, sdk: readSdk, data: Object.fromEntries(entries) }); });
    return () => { current = false; };
  }, [adapter, deployment, identityKey, readSdk, roleId, snapshot, wallet.session, object.vault, object.assetId, object.adapter]);

  const freshContext = async (action, rawInput, currentChainId, currentAccount, executionObject = object) => {
    const freshAdapter = adapter && {
      ...adapter,
      supports: (actionId, context) => adapter.supports(actionId, {
        ...context,
        ...(rawInput?.adapter ? { adapter: rawInput.adapter } : {}),
        ...(rawInput?.wrapper ? { wrapper: rawInput.wrapper } : {}),
      }),
    };
    const ensureChain = () => {
      if (Number(currentChainId) !== deployment.chainId || !readSdk) throw new Error('wrong network');
    };
    let freshAsset;
    const currentAsset = async () => {
      if (freshAsset) return freshAsset.data;
      ensureChain();
      freshAsset = await loadAssetOverview({
        sdk: readSdk, assetId: executionObject.assetId,
        includePsm: ['wrapper-controller', 'psm-authorized-signer'].includes(roleId),
      });
      if (freshAsset.status !== 'success') throw new Error('asset state unavailable');
      return freshAsset.data;
    };
    const hooks = {
      isPaused: async ({ action: checked }) => {
        if (PAUSE_MANAGEMENT.has(checked.id)) return false;
        if (roleId === 'nav-signer' && checked.id === 'nav.sign') {
          ensureChain();
          return readSdk.getContract('StateManager', deployment.addresses.stateManager).modulePaused(ModuleId.NAV_ORACLE);
        }
        if (['wrapper', 'asset'].includes(checked.scope) && ['wrapper-controller', 'psm-authorized-signer'].includes(roleId)) {
          const data = await currentAsset();
          if (!data.psmConfig) throw new Error('PSM state unavailable');
          return data.psmPaused || data.psmConfig.paused === true;
        }
        if (checked.scope !== 'vault') return false;
        ensureChain();
        const result = await loadVaultOverview({ sdk: readSdk, vault: executionObject.vault });
        if (result.status !== 'success') throw new Error('vault state unavailable');
        return Number(result.data.state.pause) !== 0;
      },
      isValidState: async ({ action: checked }) => {
        if (checked.id === 'asset.register' || checked.scope === 'permissionless') return true;
        if (checked.scope === 'wrapper') {
          const data = await currentAsset();
          if (!data.asset.active || !data.psmConfig) return false;
          const configured = wrapperConfigured(data);
          if (checked.id === 'wrapper.deploy') return !configured;
          if (checked.id === 'wrapper.signer.set') return configured && Number(data.psmConfig.mode) === 1;
          if (checked.id === 'wrapper.asset.pause') return configured;
        }
        if (checked.scope === 'asset') return Boolean((await currentAsset()).asset.active);
        if (checked.scope === 'adapter') return true;
        if (checked.scope !== 'vault') return true;
        ensureChain();
        const result = await loadVaultOverview({ sdk: readSdk, vault: executionObject.vault });
        if (result.status !== 'success') throw new Error('vault state unavailable');
        return result.data.registered && (roleId !== 'keeper' || demo || keeperStateAllows(checked.id, result.data.state));
      },
      isAuthorized: async ({ action: checked }) => {
        ensureChain();
        if (roleId === 'settlement-operator') {
          const result = await loadSettlementOverview({ sdk: readSdk, account: currentAccount });
          if (result.status !== 'success') throw new Error('settlement authorization unavailable');
          return result.data.operator;
        }
        if (roleId === 'asset-owner') {
          if (!['asset.register', 'mint.initiate', 'burn.initiate'].includes(checked.id)) return canonicalAddress((await currentAsset()).asset.owner) === currentAccount;
        }
        if (roleId === 'nav-signer') {
          const signer = await readSdk.getContract('NAVOracle', deployment.addresses.navOracle).authorizedSigner(executionObject.vault);
          return canonicalAddress(signer) === currentAccount;
        }
        if (roleId === 'psm-authorized-signer') return canonicalAddress((await currentAsset()).psmConfig?.authorizedSigner) === currentAccount;
        const result = await loadRoleOverview({ sdk: readSdk, account: currentAccount, roleIds: { [roleId]: ROLE_IDS[roleId] }, moduleIds: [] });
        if (result.status !== 'success') throw new Error('role authorization unavailable');
        return result.data.roles[roleId] === true;
      },
    };
    const boundDecimals = getAmountDecimals && (request => getAmountDecimals({ ...request, object: executionObject }));
    return { wallet: { ...wallet.session, address: currentAccount }, chainId: currentChainId, deployment, object: executionObject, adapter: freshAdapter, getAmountDecimals: boundDecimals, ...hooks };
  };

  const onExecute = async (actionId, rawInput, executionObject = object, operation = {}) => {
    const expectedIdentity = identityKey;
    const action = getActionDefinition(actionId);
    const signingGeneration = isBuiltInSignatureAction(actionId) ? ++signingGenerationRef.current : null;
    const assertCurrent = () => {
      if (identityRef.current !== expectedIdentity) throw new Error('Workspace identity changed');
      if (signingGeneration !== null && signingGenerationRef.current !== signingGeneration) throw new Error('Workspace signing operation changed');
      operation.assertCurrent?.();
    };
    if (!demo && action.scope === 'vault' && !configuredVault(deployment, executionObject.vault)) throw new Error('Workspace action unavailable');
    const rawChainId = demo ? '0x61' : await wallet.session.provider.request({ method: 'eth_chainId' });
    assertCurrent();
    const currentChainId = Number(rawChainId);
    const accounts = demo ? [wallet.session.address] : await wallet.session.provider.request({ method: 'eth_accounts' });
    assertCurrent();
    const currentAccount = canonicalAddress(accounts?.[0]);
    if (!currentAccount) throw new Error('Workspace account unavailable');
    const capabilityContext = await freshContext(action, rawInput, currentChainId, currentAccount, executionObject);
    assertCurrent();
    const capability = await resolveCapability(capabilityContext, action);
    assertCurrent();
    if (capability.state !== 'available') throw Object.assign(new Error(capability.reasonKey), { capability });
    if (!demo && ['mint.approve', 'burn.approve'].includes(actionId)) {
      const normalized = validateActionInput(actionId, rawInput);
      await preflightApprovalRequest(readSdk, actionId, normalized, executionObject.assetId);
      assertCurrent();
    }
    if (typeof operation.beforeSigner === 'function') {
      await operation.beforeSigner();
      assertCurrent();
    }
    const signer = demo
      ? createDemoSigner(wallet.session.address)
      : await getWriteSigner(wallet.session.provider);
    assertCurrent();
    const resolvedSignerAddress = await signer?.getAddress?.();
    assertCurrent();
    const signerAddress = canonicalAddress(resolvedSignerAddress);
    if (!signerAddress || signerAddress !== currentAccount) throw new Error('Workspace signer unavailable');
    const options = { action, rawInput, capabilityContext, adapter: capabilityContext.adapter, signer, transactions };
    if (!isBuiltInSignatureAction(actionId)) {
      const executionResult = await executeAction(options);
      assertCurrent();
      return executionResult;
    }
    const result = await executeSignatureAction({ ...options, signingContext: { sdk: readSdk, chainId: currentChainId } });
    assertCurrent();
    let decimals;
    if (actionId === 'psm.authorization.sign') {
      decimals = await capabilityContext.getAmountDecimals({ actionId, action, object: executionObject, rawInput, deployment });
      assertCurrent();
    }
    const normalized = validateActionInput(actionId, rawInput, { amountDecimals: decimals });
    const draft = {
      version: 2, scheme: ENVELOPE_SCHEME,
      kind: signatureKind(actionId), chainId: currentChainId, verifyingContract: signatureContract(actionId, deployment),
      scope: actionId === 'psm.authorization.sign' ? { assetId: executionObject.assetId } : { vault: executionObject.vault },
      payload: signaturePayload(actionId, normalized, decimals), signature: result.signature, signer: signerAddress,
      createdAt: new Date().toISOString(),
    };
    const attestationSignature = await signer.signMessage(getBytes(buildEnvelopeAttestationDigest(draft)));
    assertCurrent();
    setSignedEnvelope(createSignatureEnvelope({
      ...draft,
      attestation: { scheme: ATTESTATION_SCHEME, signature: attestationSignature, signer: signerAddress },
    }));
    setExportedEnvelope('');
    return result;
  };

  const validateRelayerSource = async (source, assertCurrent = () => {}) => {
    assertCurrent();
    if (demo) return validateDemoRelayerSource(source);
    if (!readSdk || Number(wallet.session?.chainId) !== deployment.chainId || typeof source !== 'string' || source.length > 64 * 1024) throw new Error('Signature import unavailable');
    let candidate;
    try { candidate = JSON.parse(source); } catch { throw new Error('Invalid signature import'); }
    const candidates = Array.isArray(candidate) ? candidate : [candidate];
    if (!candidates.length || candidates.length > 100) throw new Error('Invalid signature import');
    const kind = candidates[0]?.kind;
    if (candidates.some(item => item?.kind !== kind) || (kind !== 'settlement' && candidates.length !== 1)) throw new Error('Mixed signature kinds');
    const contract = kind === 'nav' ? deployment.addresses.navOracle
      : kind === 'psm' ? deployment.addresses.reservePSM
        : kind === 'settlement' ? deployment.addresses.settlement : null;
    if (!contract) throw new Error('Unsupported signature kind');
    const candidateScope = candidates[0].scope;
    if (kind === 'psm') {
      if (canonicalAssetId(String(candidateScope?.assetId ?? '')) === null) throw new Error('Invalid asset scope');
    } else if (!configuredVault(deployment, candidateScope?.vault)) throw new Error('Unconfigured vault scope');
    const psm = kind === 'psm' ? readSdk.getContract('ReservePSM', deployment.addresses.reservePSM) : null;
    const expected = {
      chainId: deployment.chainId,
      verifyingContract: contract,
      scope: candidateScope,
      hashSettlement: async instruction => {
        const digest = await readSdk.hashInstruction(instruction);
        assertCurrent();
        return digest;
      },
      isNonceUsed: async ({ kind, scope, nonce, envelope: checked }) => {
        if (kind === 'psm') {
          const used = await psm.usedNonce(BigInt(scope.assetId), nonce);
          assertCurrent();
          return used;
        }
        if (kind === 'nav') {
          const nav = await readSdk.getNAV(scope.vault);
          assertCurrent();
          return nav.dataTimestamp >= nonce;
        }
        const digest = await readSdk.hashInstruction(checked.payload.instruction);
        assertCurrent();
        const executed = await readSdk.isExecuted(digest);
        assertCurrent();
        return executed;
      },
    };
    let result;
    if (kind === 'settlement') {
      const threshold = await readSdk.threshold();
      assertCurrent();
      result = await validateSettlementEnvelopeSet(candidates, { ...expected, threshold });
    } else {
      result = await validateSignatureEnvelope(candidates[0], expected);
    }
    assertCurrent();
    const envelopes = Array.isArray(result) ? result : [result];
    const envelope = envelopes[0];
    if (kind === 'nav') {
      const navPaused = await readSdk.getContract('StateManager', deployment.addresses.stateManager).modulePaused(ModuleId.NAV_ORACLE);
      assertCurrent();
      if (navPaused === true) throw new Error('NAV module paused');
      const authorized = await readSdk.getContract('NAVOracle', deployment.addresses.navOracle).authorizedSigner(envelope.scope.vault);
      assertCurrent();
      if (canonicalAddress(authorized) !== canonicalAddress(envelope.signer)) throw new Error('Unauthorized NAV signer');
    } else if (kind === 'psm') {
      const config = reserveConfig(await psm.assetConfig(BigInt(envelope.scope.assetId)));
      assertCurrent();
      if (canonicalAddress(config?.authorizedSigner) !== canonicalAddress(envelope.signer)) throw new Error('Unauthorized PSM signer');
    } else {
      for (const item of envelopes) {
        const operator = await readSdk.isOperator(item.signer);
        assertCurrent();
        if (operator !== true) throw new Error('Unauthorized settlement signer');
      }
      for (const settlement of envelope.payload.instruction.vaultSettlements) {
        const settlementVault = settlement.distribution.vault;
        if (!configuredVault(deployment, settlementVault)) throw new Error('Unconfigured settlement vault');
        const state = await readSdk.getStateContext(settlementVault);
        assertCurrent();
        if (Number(state.cycle) !== CycleState.CALCULATING
          || BigInt(state.cycleNumber) !== BigInt(envelope.payload.instruction.cycleNumber)) throw new Error('Stale settlement cycle');
      }
    }
    return kind === 'settlement' ? envelopes : envelope;
  };

  const validateImport = async () => {
    const expectedIdentity = identityKey;
    const generation = ++importGenerationRef.current;
    const source = importSource;
    const isCurrent = () => identityRef.current === expectedIdentity && importGenerationRef.current === generation;
    const assertCurrent = () => { if (!isCurrent()) throw new Error('Workspace import operation changed'); };
    setValidatedImport(null);
    setImportStatus(t.workspaces.page.importValidating);
    try {
      const envelope = await validateRelayerSource(source, assertCurrent);
      assertCurrent();
      setValidatedImport(envelope);
      const first = Array.isArray(envelope) ? envelope[0] : envelope;
      setImportStatus(t.workspaces.page.importValidated.replace('{kind}', first.kind).replace('{chainId}', String(first.chainId)));
    } catch {
      if (!isCurrent()) return;
      setImportStatus(t.workspaces.page.importCouldNotValidate);
    }
  };

  const submitImport = async () => {
    if (!validatedImport) return;
    const expectedIdentity = identityKey;
    const generation = ++submissionGenerationRef.current;
    const source = importSource;
    const isCurrent = () => identityRef.current === expectedIdentity && submissionGenerationRef.current === generation;
    const assertCurrent = () => { if (!isCurrent()) throw new Error('Workspace submission operation changed'); };
    setImportStatus(t.workspaces.page.importRevalidating);
    try {
      const envelope = await validateRelayerSource(source, assertCurrent);
      assertCurrent();
      const submission = demo ? toDemoRelayerSubmission(envelope) : toRelayerSubmission(envelope);
      assertCurrent();
      await onExecute(submission.actionId, submission.rawInput, submission.scope, {
        assertCurrent,
        beforeSigner: () => validateRelayerSource(source, assertCurrent),
      });
      assertCurrent();
      setImportStatus(t.workspaces.page.importSubmitted);
    } catch {
      if (!isCurrent()) return;
      setValidatedImport(null);
      setImportStatus(t.workspaces.page.importCouldNotSubmit);
    }
  };

  if (!operational) {
    return <section className="ws-page ws-role-page"><p className="ws-eyebrow">{t.workspaces.page.eyebrow}</p><h1>{title}</h1><p>{t.workspaces.page.notAvailable}</p></section>;
  }

  const queryError = snapshot && (snapshot.error || Object.values(snapshot).some(value => value?.status === 'error'));
  return (
    <section className="ws-page ws-role-page">
      <p className="ws-eyebrow">{t.workspaces.page.eyebrow}</p>
      <h1>{title}</h1>
      <p>{t.workspaces.roles[role.id].description}</p>
      {selected && canonicalObject && <p className="ws-object-scope"><strong>{selected.label}</strong><code>{canonicalObject}</code></p>}
      {invalidObject && <p className="ws-workspace-error" role="alert">{t.workspaces.page.invalidObjectRoute.replace('{label}', selected.label.toLowerCase())}</p>}
      {sdkResult.error && <p className="ws-workspace-error" role="alert">{sdkResult.error}</p>}
      {queryError && <p className="ws-workspace-error" role="alert">{t.workspaces.page.chainDataFailed}</p>}
      {actions.some(action => PAUSE_MANAGEMENT.has(action.id)) && <p className="ws-pause-exception">{t.workspaces.page.pauseException}</p>}
      {!invalidObject && <StatGrid items={statsFor(roleId, snapshot, t)} />}
      {roleId === 'relayer' && !invalidObject && (
        <section className="ws-signature-exchange" aria-labelledby="signature-import-title">
          <button
            type="button"
            className="ws-accordion-item__summary"
            aria-expanded={relayerImportOpen}
            onClick={() => setRelayerImportOpen(open => !open)}
          >
            <span className="ws-accordion-item__title" id="signature-import-title">{t.workspaces.page.signatureImportTitle}</span>
            <span className="ws-accordion-item__chevron" aria-hidden="true">{relayerImportOpen ? '▾' : '▸'}</span>
          </button>
          {relayerImportOpen && (
            <>
              <p>{t.workspaces.page.signatureImportBody}</p>
              <label htmlFor="signed-payload-import">{t.workspaces.page.signedPayloadImport}</label>
              <textarea id="signed-payload-import" rows="10" value={importSource} onChange={event => {
                importGenerationRef.current += 1;
                setImportSource(event.target.value);
                setValidatedImport(null);
                setImportStatus('');
              }} />
              <button type="button" onClick={validateImport} disabled={!readSdk || !importSource.trim()}>{t.workspaces.page.validateSignedPayload}</button>
              {importStatus && <p className="ws-action-panel__outcome" role={importStatus === t.workspaces.page.importCouldNotValidate || importStatus === t.workspaces.page.importCouldNotSubmit ? 'alert' : 'status'}>{importStatus}</p>}
              {validatedImport && <button type="button" onClick={submitImport}>{relayerSubmitLabel(Array.isArray(validatedImport) ? validatedImport[0].kind : validatedImport.kind, t)}</button>}
            </>
          )}
        </section>
      )}
      {!invalidObject && (
        <div className="ws-action-list">
          {actions.map(action => (
            <ActionAccordionItem
              key={action.id}
              action={action}
              open={openActionId === action.id}
              onToggle={toggleAction}
              capability={
                roleId === 'relayer' && action.id !== 'vault.timelock.execute'
                  ? { ...capabilities[action.id], state: CAPABILITY_STATES.READ_ONLY }
                  : capabilities[action.id]
              }
              onExecute={onExecute}
              onSwitchNetwork={() => wallet.switchChain(deployment.chainId)}
              context={selected && canonicalObject ? [{ label: selected.label, value: canonicalObject }] : []}
              dangerous={DANGEROUS_ACTIONS.has(action.id)}
              targetAddress={actionTarget(action.id, deployment, object)}
            />
          ))}
        </div>
      )}
      {signedEnvelope && roleId !== 'relayer' && (
        <section className="ws-signature-exchange" aria-labelledby="signature-export-title">
          <button
            type="button"
            className="ws-accordion-item__summary"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen(open => !open)}
          >
            <span className="ws-accordion-item__title" id="signature-export-title">{t.workspaces.page.signatureExportTitle}</span>
            <span className="ws-accordion-item__chevron" aria-hidden="true">{exportOpen ? '▾' : '▸'}</span>
          </button>
          {exportOpen && (
            <>
              <p>{t.workspaces.page.signatureExportBody}</p>
              {signedEnvelope.kind === 'nav' && <p>{t.workspaces.page.navExportNote}</p>}
              {signedEnvelope.kind === 'settlement' && <p>{t.workspaces.page.settlementExportNote}</p>}
              <button type="button" onClick={() => setExportedEnvelope(serializeSignatureEnvelope(signedEnvelope))}>{t.workspaces.page.exportSignedPayload}</button>
              {exportedEnvelope && <label>{t.workspaces.page.exportedSignedPayload}<textarea readOnly rows="12" value={exportedEnvelope} /></label>}
            </>
          )}
        </section>
      )}
    </section>
  );
}
