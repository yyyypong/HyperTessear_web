export const CAPABILITY_STATES = Object.freeze({
  AVAILABLE: 'available',
  READ_ONLY: 'readOnly',
  UNAUTHORIZED: 'unauthorized',
  WRONG_NETWORK: 'wrongNetwork',
  WALLET_REQUIRED: 'walletRequired',
  OBJECT_REQUIRED: 'objectRequired',
  TARGET_ONLY: 'targetOnly',
  PAUSED: 'paused',
  INVALID_STATE: 'invalidState',
  UNSUPPORTED_DEPLOYMENT: 'unsupportedDeployment',
});

export function isActionEnabled(state) {
  return state === CAPABILITY_STATES.AVAILABLE;
}
