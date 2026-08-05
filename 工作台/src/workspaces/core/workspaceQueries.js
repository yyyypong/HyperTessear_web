const MODULE_IDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8]);

function aborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason?.name === 'AbortError') throw signal.reason;
  throw new DOMException('The workspace request was aborted.', 'AbortError');
}

function timestamp(now) {
  const value = typeof now === 'function' ? now() : now;
  return value === undefined ? Date.now() : value;
}

function safeError(code, now) {
  return {
    status: 'error',
    data: null,
    error: { code, messageKey: `workspaces.errors.${code}` },
    refreshedAt: timestamp(now),
  };
}

async function load(code, { signal, now }, reader) {
  try {
    aborted(signal);
    const data = await reader();
    aborted(signal);
    return { status: 'success', data, error: null, refreshedAt: timestamp(now) };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    aborted(signal);
    return safeError(code, now);
  }
}

export function loadVaultOverview({ sdk, vault, signal, now } = {}) {
  return load('vaultOverviewUnavailable', { signal, now }, async () => {
    const [registered, active, state, nav, navFresh] = await Promise.all([
      sdk.isVaultRegistered(vault),
      sdk.isVaultActive(vault),
      sdk.getStateContext(vault),
      sdk.getNAV(vault),
      sdk.isNAVFresh(vault),
    ]);
    return { registered, active, state, nav, navFresh };
  });
}

export function loadSettlementOverview({ sdk, account, signal, now } = {}) {
  return load('settlementOverviewUnavailable', { signal, now }, async () => {
    const [operator, threshold] = await Promise.all([sdk.isOperator(account), sdk.threshold()]);
    return { operator, threshold };
  });
}

export function loadRoleOverview({ sdk, account, roleIds = {}, moduleIds = MODULE_IDS, signal, now } = {}) {
  return load('roleOverviewUnavailable', { signal, now }, async () => {
    const entries = Object.entries(roleIds);
    const stateManager = sdk.getContract('StateManager', sdk.addresses?.stateManager);
    const reservePsm = sdk.getContract('ReservePSM', sdk.addresses?.reservePSM);
    const [roleValues, pauseValues, psmPaused] = await Promise.all([
      Promise.all(entries.map(([, roleId]) => sdk.hasRole(roleId, account))),
      Promise.all(moduleIds.map(moduleId => stateManager.modulePaused(moduleId))),
      reservePsm.globalPaused(),
    ]);
    return {
      roles: Object.fromEntries(entries.map(([name], index) => [name, roleValues[index]])),
      modulesPaused: Object.fromEntries(moduleIds.map((moduleId, index) => [moduleId, pauseValues[index]])),
      psmPaused,
    };
  });
}

export function loadPoolOverview({ sdk, vault, signal, now } = {}) {
  return load('poolOverviewUnavailable', { signal, now }, async () => {
    const [pending, available, totalPending] = await Promise.all([
      sdk.pending(vault),
      sdk.availableToDistribute(vault),
      sdk.totalPending(),
    ]);
    return { pending, available, totalPending };
  });
}
