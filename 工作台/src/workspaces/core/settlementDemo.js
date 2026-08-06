import { DEMO_VAULT_A } from './onchainLists';

const E6 = 10n ** 6n;

const DEMO_OPERATORS = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x8888888888888888888888888888888888888888',
];

function usdt(units) {
  return BigInt(units) * E6;
}

/**
 * Demo counterpart of loadSettlementWorkspace: a fully populated batch so a
 * simulated Settlement Operator can walk every panel without onchain data.
 */
export function demoSettlementWorkspace(vault, account) {
  const deposits = [
    { requestId: 1041n, owner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: usdt(120_000) },
    { requestId: 1042n, owner: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', amount: usdt(65_500) },
    { requestId: 1045n, owner: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', amount: usdt(18_000) },
  ];
  const redeems = [
    { requestId: 2033n, owner: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', amount: usdt(240_000) },
    { requestId: 2034n, owner: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', amount: usdt(55_000) },
  ];
  const depositTotal = deposits.reduce((sum, row) => sum + row.amount, 0n);
  const redeemTotal = redeems.reduce((sum, row) => sum + row.amount, 0n);
  const net = redeemTotal > depositTotal ? redeemTotal - depositTotal : 0n;
  const available = usdt(400_000);
  const distribution = available < net ? available : net;

  return {
    state: { product: 2, cycle: 1, pause: 0, cycleNumber: 7n },
    nav: vault === DEMO_VAULT_A ? '1.210000' : '0.980000',
    available,
    totalPending: usdt(1_250_000),
    deposits,
    redeems,
    depositTotal,
    redeemTotal,
    net,
    distribution,
    operatorSet: {
      threshold: 2,
      operators: DEMO_OPERATORS,
      mine: DEMO_OPERATORS.some(op => op.toLowerCase() === (account || '').toLowerCase()),
      // Demo previews the target contract, so every panel is exercised.
      shape: { perVault: true, canConfirmFinalSettlement: true, enumerable: false, ownerGate: 'vaultOwner' },
    },
    history: [
      { batchHash: `0x${'1a'.repeat(32)}`, cycleNumber: 6, timestamp: 1754100000, txHash: `0x${'2b'.repeat(32)}` },
      { batchHash: `0x${'3c'.repeat(32)}`, cycleNumber: 5, timestamp: 1753500000, txHash: `0x${'4d'.repeat(32)}` },
    ],
  };
}
