import { CAPABILITY_STATES } from './capabilityStates';
import { hasRequiredObject, normalizeObjectContext } from './objectContext';

export { normalizeObjectContext } from './objectContext';

const detailFor = (action, profile, extra = {}) => ({
  actionId: action?.id,
  requiredMethod: profile?.adapterMethod ?? null,
  requiredModule: profile?.requiredModules?.[0] ?? null,
  ...extra,
});

const capability = (state, action, profile, extra) => ({
  state,
  reasonKey: `workspaces.capabilities.${state}`,
  detail: detailFor(action, profile, extra),
});

function profileFor(action, deployment) {
  const profile = deployment?.profile;
  if (action?.capability?.[profile]) return action.capability[profile];
  // Older callers may still supply the Task 5 sample shape. It cannot
  // override the registry capability profile when the latter is present.
  if (action?.support && profile) {
    const adapterMethod = action.support[profile];
    return { state: adapterMethod ? CAPABILITY_STATES.AVAILABLE : CAPABILITY_STATES.TARGET_ONLY, adapterMethod, requiredModules: [] };
  }
  return null;
}

async function runCheck(context, names, action, object) {
  for (const name of names) {
    const hook = context?.[name];
    if (typeof hook === 'function') {
      try {
        return { present: true, value: await hook({ action, object, wallet: context.wallet, deployment: context.deployment }) };
      } catch {
        return { present: true, failed: true };
      }
    }
  }
  return { present: false };
}

/** Resolve UI capability from wallet, deployment, current chain facts and authorization hooks. */
export async function resolveCapability(context, action) {
  const deployment = context?.deployment;
  const profile = profileFor(action, deployment);
  const object = normalizeObjectContext(context?.objectContext ?? context?.object ?? context?.route);

  if (!context?.wallet) return capability(CAPABILITY_STATES.WALLET_REQUIRED, action, profile);
  if (!deployment) return capability(CAPABILITY_STATES.UNSUPPORTED_DEPLOYMENT, action, profile, { check: 'deployment' });
  if (deployment.supported === false || deployment.compatible === false || deployment.abiVersionCompatible === false || !profile) {
    return capability(CAPABILITY_STATES.UNSUPPORTED_DEPLOYMENT, action, profile, { check: 'deployment' });
  }
  if (Number(context.chainId) !== Number(deployment.chainId)) return capability(CAPABILITY_STATES.WRONG_NETWORK, action, profile);
  if (!hasRequiredObject(action?.scope, object)) return capability(CAPABILITY_STATES.OBJECT_REQUIRED, action, profile);
  if (profile.state === CAPABILITY_STATES.TARGET_ONLY || !profile.adapterMethod) {
    return capability(CAPABILITY_STATES.TARGET_ONLY, action, profile);
  }
  const paused = await runCheck(context, ['isPaused', 'checkPaused'], action, object);
  if (!paused.present || paused.failed || typeof paused.value !== 'boolean') return capability(CAPABILITY_STATES.UNSUPPORTED_DEPLOYMENT, action, profile, { check: 'pause' });
  if (paused.value) return capability(CAPABILITY_STATES.PAUSED, action, profile);

  const validState = await runCheck(context, ['isValidState', 'checkState'], action, object);
  if (!validState.present || validState.failed || typeof validState.value !== 'boolean') return capability(CAPABILITY_STATES.UNSUPPORTED_DEPLOYMENT, action, profile, { check: 'state' });
  if (!validState.value) return capability(CAPABILITY_STATES.INVALID_STATE, action, profile);

  if (action?.scope !== 'permissionless') {
    const authorized = await runCheck(context, ['isAuthorized', 'checkAuthorization'], action, object);
    if (!authorized.present || authorized.failed || authorized.value !== true) return capability(CAPABILITY_STATES.UNAUTHORIZED, action, profile, { check: 'authorization' });
  }
  if (typeof context?.adapter?.supports !== 'function' || context.adapter.supports(action.id, { ...object, deployment }) !== true) {
    return capability(CAPABILITY_STATES.UNSUPPORTED_DEPLOYMENT, action, profile, { check: 'adapter' });
  }
  return capability(CAPABILITY_STATES.AVAILABLE, action, profile);
}
