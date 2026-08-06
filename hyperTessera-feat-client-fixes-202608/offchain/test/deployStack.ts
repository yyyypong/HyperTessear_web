import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Contract, type JsonRpcProvider, type Signer, type Wallet } from "ethers";
import { getAbi } from "../src/abis.js";
import type { HyperTesseraAddresses } from "../src/sdk.js";

/**
 * Full W1-W5 local deploy for the integration suite.
 *
 * Rather than re-implementing the deployment topology in TypeScript (which silently drifts from the
 * Solidity every time the constructor/wiring surface changes), this drives the *actual* delivery
 * scripts — `script/Deploy.s.sol`'s `Deploy` -> `DeployW3` -> `DeployW4` — via `forge script
 * --broadcast`, exactly as `offchain/scripts/local/deploy.ts` does for the local devnet. Those
 * scripts are covered by the `forge test` suite and used for real deployments, so they cannot drift.
 *
 * CONCURRENCY: `forge script --broadcast` writes its output to the repo-root-relative paths
 * `control-panel/deployments{,-w3,-w4}.json` regardless of which anvil port it targets. The
 * integration test files therefore MUST NOT run in parallel — `package.json`'s `test:integration`
 * enforces this with `vitest run --no-file-parallelism`. Don't drop that flag.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

function readJson(relPath: string) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf-8"));
}

/**
 * `forge` auto-loads the repo `.env` (which holds a real testnet deployer key), so every invocation
 * passes an explicit `TEST_PK` to pin the broadcaster to the caller's `governor` wallet.
 */
function forgeScript(contract: string, rpcUrl: string, pk: string, env: Record<string, string>): Promise<void> {
  // Deliberately async (not execFileSync): the test's anvil is spawned with a piped stdout, and a
  // synchronous child would block this process's event loop for the whole deploy — the pipe would
  // fill, anvil would block on write, stop mining, and forge would report dropped transactions.
  return new Promise((resolve, reject) => {
    const child = spawn(
      "forge",
      ["script", "script/Deploy.s.sol", "--tc", contract, "--rpc-url", rpcUrl, "--broadcast"],
      { cwd: REPO_ROOT, env: { ...process.env, TEST_PK: pk, ...env }, stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`forge script --tc ${contract} exited with code ${code}`)),
    );
  });
}

/** MockUSDT (declared inline in Deploy.s.sol) — only the members the tests actually use. */
const USDT_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

export interface DeployedStack {
  addresses: HyperTesseraAddresses;
  usdt: Contract;
  governor: Signer;
  operator1: Signer;
  operator2: Signer;
}

const DAY = 86400;

export async function deployFullStack(signers: {
  governor: Signer;
  operator1: Signer;
  operator2: Signer;
}): Promise<DeployedStack> {
  const { governor, operator1, operator2 } = signers;
  const governorAddr = await governor.getAddress();
  const pk = (governor as Wallet).privateKey;
  if (!pk) throw new Error("deployFullStack requires `governor` to be an ethers Wallet (needs .privateKey for TEST_PK)");
  // The tests each run their own anvil on a different port; recover that port's URL from the
  // provider the caller's wallets are connected to rather than hardcoding one.
  // `_getConnection()` is internal-by-convention (underscore-prefixed) but is a *typed* public
  // member of ethers v6's JsonRpcProvider, and v6 exposes no non-underscore alternative for
  // reading a provider's URL back. Kept as a typed cast rather than `as any` so that a future
  // ethers rename/removal fails `npm run typecheck` instead of silently yielding
  // `--rpc-url undefined`.
  const rpcUrl: string = (governor.provider as JsonRpcProvider)._getConnection().url;

  // --- Stage 1: Deploy (governance, asset infra/Module D, settlement infra, demo assets) ---
  await forgeScript("Deploy", rpcUrl, pk, {});
  const stage1 = readJson("control-panel/deployments.json").addresses;

  // --- Stage 2: DeployW3 (real StateManager, NAVOracle, Queue, VaultFactory, the 3 vaults) ---
  await forgeScript("DeployW3", rpcUrl, pk, {
    HYPER_ACCESS_CONTROL: stage1.HyperAccessControl,
    UNIFIED_POOL: stage1.UnifiedPool,
    USDT: stage1.MockUSDT,
    PROTOCOL_FEE_CONFIG: stage1.ProtocolFeeConfig,
  });
  const stage2 = readJson("control-panel/deployments-w3.json").addresses;

  // --- Stage 3: DeployW4 (Settlement + per-vault operator sets, AdapterFactory + 3 adapters) ---
  await forgeScript("DeployW4", rpcUrl, pk, {
    HYPER_ACCESS_CONTROL: stage1.HyperAccessControl,
    STATE_MANAGER: stage2.StateManager,
    QUEUE: stage2.Queue,
    UNIFIED_POOL: stage1.UnifiedPool,
    USDT: stage1.MockUSDT,
    CASH_VAULT: stage2.CashVault,
    NOTE_VAULT: stage2.NoteVault,
    LP_VAULT: stage2.LPVault,
    SETTLEMENT_OPERATORS: `${await operator1.getAddress()},${await operator2.getAddress()}`,
    SETTLEMENT_THRESHOLD: "1",
    DATA_PROVIDER_SIGNER: governorAddr,
  });
  const stage3 = readJson("control-panel/deployments-w4.json").addresses;

  // DeployW3 already grants `governor` both Keeper and Curator on every vault (see
  // Deploy.s.sol `_grantVaultLocalRoles`), which is all the 3 test files need — they use
  // `governor` as the sole privileged caller.

  // ProductParams are deliberately not set by any deploy script (they're per-product business
  // config). Subscription opens now and ends in 3s, cycle duration 2s — fast enough for tests.
  const now = Math.floor(Date.now() / 1000);
  const productParams = {
    subscriptionStart: 0,
    subscriptionEnd: now + 3,
    subscriptionCap: 10_000_000_000_000n,
    walletSubscriptionCap: 10_000_000_000_000n,
    minRaiseAmount: 0,
    firstCycleStart: now,
    cycleDuration: 2,
    maturityTimestamp: now + 365 * DAY,
    claimingStart: now + 366 * DAY,
    claimingEnd: now + 367 * DAY,
    feeParams: 0,
  };
  const sm = new Contract(stage2.StateManager, getAbi("StateManager"), governor);
  for (const v of [stage2.CashVault, stage2.NoteVault, stage2.LPVault]) {
    await (await sm.setProductParams(v, productParams)).wait();
  }

  const addresses: HyperTesseraAddresses = {
    hyperAccessControl: stage1.HyperAccessControl,
    stateManager: stage2.StateManager,
    // The real per-vault NAVOracle from DeployW3 (stage 1's is the standalone Module D stub).
    navOracle: stage2.NAVOracle,
    mintBurnController: stage1.MintBurnController,
    assetRegistry: stage1.AssetRegistry,
    reservePSM: stage1.ReservePSM,
    poRRegistry: stage1.PoRRegistry,
    queue: stage2.Queue,
    revenuePool: stage1.RevenuePool,
    unifiedPool: stage1.UnifiedPool,
    settlement: stage3.Settlement,
    vaultFactory: stage2.VaultFactory,
    adapterFactory: stage3.AdapterFactory,
    liquidityBridge: stage2.LiquidityBridge,
    cashVault: stage2.CashVault,
    noteVault: stage2.NoteVault,
    lpVault: stage2.LPVault,
    cashAdapter: stage3.CashAdapter,
    noteAdapter: stage3.NoteAdapter,
    lpAdapter: stage3.LPAdapter,
  };

  const usdt = new Contract(stage1.MockUSDT, USDT_ABI, governor);

  return { addresses, usdt, governor, operator1, operator2 };
}
