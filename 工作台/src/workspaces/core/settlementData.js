import { formatUnits, ZeroAddress } from 'ethers';
import { QueueType } from '../../integrations/hypertessera/upstream/types';
import { equalAddress } from './onchainLists';

/** Event lookback window for queue / settlement history (~50 days on BSC). */
const LOOKBACK = 1_500_000n;

async function fromBlock(runner) {
  try {
    const head = await runner.getBlockNumber();
    const start = BigInt(head) - LOOKBACK;
    return start > 0n ? Number(start) : 0;
  } catch { return 0; }
}

function settlementContract(sdk) {
  return sdk.settlement ?? sdk.getContract('Settlement', sdk.addresses?.settlement);
}

/**
 * Which Settlement generation the deployment exposes. The deployed contract
 * keeps one global operator set (addOperator / threshold() / OperatorAdded),
 * while the target contract keys operators, threshold and final-settlement
 * confirmation by vault. Everything downstream branches on this.
 */
export function settlementShape(sdk) {
  const settlement = settlementContract(sdk);
  const has = name => {
    try { return Boolean(settlement.interface.getFunction(name)); } catch { return false; }
  };
  const perVault = has('setOperator');
  return {
    perVault,
    canConfirmFinalSettlement: has('confirmFinalSettlement'),
    // Legacy uses a public operators(uint256) array; target only emits events.
    enumerable: has('operators'),
    ownerGate: perVault ? 'vaultOwner' : 'governor',
  };
}

/**
 * The operator set and threshold for this vault. On the global (deployed)
 * contract the same set governs every vault, which is surfaced as-is rather
 * than pretending the appointment is vault-scoped.
 */
async function readOperatorSet(sdk, vault, account) {
  const settlement = settlementContract(sdk);
  const shape = settlementShape(sdk);

  const threshold = await (shape.perVault ? settlement.threshold(vault) : settlement.threshold())
    .then(Number)
    .catch(() => null);

  const mine = await (shape.perVault ? settlement.isOperator(vault, account) : settlement.isOperator(account))
    .then(value => value === true)
    .catch(() => false);

  const operators = shape.enumerable
    ? await readOperatorArray(settlement)
    : await readOperatorEvents(settlement, vault);

  return { threshold, operators, mine, shape };
}

/** Walks the public operators(uint256) array until it runs out of entries. */
async function readOperatorArray(settlement) {
  const operators = [];
  for (let i = 0; i < 50; i += 1) {
    try {
      const operator = await settlement.operators(i);
      if (!operator || operator === ZeroAddress) break;
      operators.push(operator);
    } catch { break; }
  }
  return operators;
}

/** Reconstructs the set from OperatorSet events (target contract shape). */
async function readOperatorEvents(settlement, vault) {
  try {
    const start = await fromBlock(settlement.runner);
    const logs = await settlement.queryFilter(settlement.filters.OperatorSet(vault), start, 'latest');
    const latest = new Map();
    for (const log of logs) {
      const operator = log.args?.operator ?? log.args?.[1];
      const approved = log.args?.approved ?? log.args?.[2];
      if (operator) latest.set(operator.toLowerCase(), { operator, approved: approved === true });
    }
    return [...latest.values()].filter(entry => entry.approved).map(entry => entry.operator);
  } catch { return []; }
}

/** Executed settlement batches for the history table. */
async function readHistory(sdk) {
  const settlement = settlementContract(sdk);
  try {
    const start = await fromBlock(settlement.runner);
    const logs = await settlement.queryFilter(settlement.filters.SettlementExecuted(), start, 'latest');
    return logs.slice(-25).reverse().map(log => ({
      batchHash: log.args?.batchHash ?? log.args?.[0] ?? null,
      cycleNumber: Number(log.args?.cycleNumber ?? log.args?.[1] ?? 0),
      timestamp: Number(log.args?.timestamp ?? log.args?.[2] ?? 0),
      txHash: log.transactionHash,
    }));
  } catch { return []; }
}

/**
 * Pending FIFO requests. Vault request events give the ordered candidates and
 * Queue.isInQueue filters out the ones already settled or cancelled.
 */
async function readQueue(sdk, vault, queueType) {
  const contract = sdk.getContract('EarnVault', vault);
  const filter = queueType === QueueType.DEPOSIT
    ? contract.filters.DepositRequested()
    : contract.filters.RedeemRequested();
  let logs = [];
  try {
    const start = await fromBlock(contract.runner);
    logs = await contract.queryFilter(filter, start, 'latest');
  } catch { return []; }

  const candidates = logs.map(log => ({
    requestId: BigInt(log.args?.requestId ?? log.args?.[0] ?? 0),
    owner: log.args?.owner ?? log.args?.[1] ?? ZeroAddress,
    amount: BigInt(log.args?.assets ?? log.args?.shares ?? log.args?.[2] ?? 0),
  }));
  const pending = await Promise.all(candidates.map(async (row) => {
    try { return await sdk.isInQueue(vault, queueType, row.requestId) ? row : null; } catch { return null; }
  }));
  return pending.filter(Boolean);
}

/**
 * Everything the Settlement Operator workspace shows: cycle context, both FIFO
 * queues, UnifiedPool capacity, the operator set and past batches.
 */
export async function loadSettlementWorkspace({ sdk, vault, account }) {
  const [state, nav, available, totalPending, deposits, redeems, operatorSet, history] = await Promise.all([
    sdk.getStateContext(vault).catch(() => null),
    sdk.getNAV(vault).catch(() => null),
    sdk.availableToDistribute(vault).catch(() => null),
    sdk.totalPending().catch(() => null),
    readQueue(sdk, vault, QueueType.DEPOSIT),
    readQueue(sdk, vault, QueueType.REDEEM),
    readOperatorSet(sdk, vault, account),
    readHistory(sdk),
  ]);

  const depositTotal = deposits.reduce((sum, row) => sum + row.amount, 0n);
  const redeemTotal = redeems.reduce((sum, row) => sum + row.amount, 0n);
  const net = redeemTotal > depositTotal ? redeemTotal - depositTotal : 0n;
  const distribution = available != null && available < net ? available : net;

  return {
    state,
    nav: nav && nav.nav > 0n ? formatUnits(nav.nav, 6) : null,
    available,
    totalPending,
    deposits,
    redeems,
    depositTotal,
    redeemTotal,
    net,
    distribution,
    operatorSet,
    history,
  };
}

/**
 * The SettlementInstruction the operator signs: a FIFO prefix of each queue
 * plus the netted distribution, bound to the vault's current cycle. The
 * deployed contract takes bare request-id arrays; the target contract takes
 * RequestSettlement structs that also carry the per-request amount.
 */
export function buildInstruction({ vault, state, deposits, redeems, distribution, validUntil, perVault = false }) {
  const vaultSettlement = perVault
    ? {
      distribution: { vault, amount: distribution },
      deposits: deposits.map(row => ({ requestId: row.requestId, amount: row.amount })),
      redeems: redeems.map(row => ({ requestId: row.requestId, amount: row.amount })),
    }
    : {
      distribution: { vault, amount: distribution },
      depositRequestIds: deposits.map(row => row.requestId),
      redeemRequestIds: redeems.map(row => row.requestId),
    };
  return {
    vaultSettlements: [vaultSettlement],
    cycleNumber: state?.cycleNumber ?? 0n,
    validUntil,
  };
}

export function isVaultOwnerOf(vaultRow, account) {
  return equalAddress(vaultRow?.deployer, account);
}
