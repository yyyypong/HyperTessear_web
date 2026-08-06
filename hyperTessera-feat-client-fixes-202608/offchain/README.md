# @hypertessera/offchain — Module E

TypeScript SDK, `OnChainEventIndexer`, `KeeperBot`, and `SettlementOperator` for HyperTessera Earn
(development-plan.md §2.5 W5, §3.5). This is the off-chain layer the Company operates after
delivery (§5.6) to run the deployed W1–W4 contracts.

## Layout

| File | Component |
|---|---|
| `src/types.ts` | Shared enums/types mirroring `src/libs/Types.sol` |
| `src/abis.ts` | ABI loader — reads `control-panel/abis.json` (single source of truth, regenerated via `control-panel/build-abis.sh`) |
| `src/sdk.ts` | `HyperTesseraSDK` — typed contract access + curated read/write methods (development-plan.md §3.1.2 and extensions through W4) |
| `src/indexer.ts` | `OnChainEventIndexer` — event subscription, FIFO queue + pending-deposit reconstruction, `getClearingList`/`getPendingDeposits` |
| `src/keeperBot.ts` | `KeeperBot` — drives ProductState/CycleState transitions, NAV freshness + Reserve PSM lag alerts, retry with backoff |
| `src/settlementOperator.ts` | `SettlementOperator` — assembles `SettlementInstruction`, collects M-of-N signatures, submits + retries |

## Usage

```bash
npm install
npm run build       # emit dist/
npm run typecheck
npm test            # fast unit tests (no chain)
npm run test:integration   # spins up a real anvil node, deploys the full W1-W4 stack, exercises
                            # the full subscription cycle end to end (development-plan.md §3.5)
npm run test:all
```

The integration test (`test/e2e.integration.test.ts`) requires `anvil` (Foundry) on `PATH`. It
deploys the full contract stack from the `out/` build artifacts (`test/deployStack.ts` — mirrors
`test/DeployW4.t.sol`'s wiring in TypeScript) and drives: `requestDeposit` → `KeeperBot`
(`SUBSCRIBING` → `OPERATING` → `CALCULATING`) → `SettlementOperator` (`submitBatch`) →
`claimDeposit`, then checks the indexer's pending-deposit view before and after settlement.

## Notes

- All reward/LP-yield/bonus/redemption math is computed off-chain by the Company (development-plan.md
  §3.5, §5.1) — this package only assembles the schema and drives the on-chain calls; it does not
  compute settlement amounts itself.
- The event whitelist this indexer subscribes to is the Developer-proposed starting list in
  `docs/module-e-event-whitelist-proposal.md` — see that doc for the full event surface and
  Company review status.
