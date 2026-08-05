export function mapContractError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === '4001' || code === 'ACTION_REJECTED') return { code: 'walletRejected', messageKey: 'workspaces.errors.walletRejected' };
  if (code === 'CALL_EXCEPTION') return { code: 'contractReverted', messageKey: 'workspaces.errors.contractReverted' };
  if (code === 'INSUFFICIENT_FUNDS') return { code: 'insufficientFunds', messageKey: 'workspaces.errors.insufficientFunds' };
  if (code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'TIMEOUT') return { code: 'networkError', messageKey: 'workspaces.errors.networkError' };
  return { code: 'contractError', messageKey: 'workspaces.errors.contractError' };
}
