import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JsonRpcProvider, Contract } from "ethers";
import { getAbi } from "../../src/abis.js";
import { deriveWallet, ROLE_INDEX } from "./wallets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const GOVERNOR_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account 0

function readJson(relPath: string) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf-8"));
}

/**
 * Deploys the full W1-W4 stack to a running local anvil node by driving the actual delivery
 * scripts (`script/Deploy.s.sol`'s `Deploy` -> `DeployW3` -> `DeployW4`) via `forge script
 * --broadcast`, then does the one remaining piece of Curator-owned wiring the scripts
 * deliberately leave out (`LiquidityAdapter.setBridgeTarget` — see `DeployW4`'s doc comment).
 *
 * Reuses `Deploy.s.sol`'s own role convention (`ANVIL_1..ANVIL_7`, see `_grantDemoRoles`) rather
 * than inventing a parallel one — see `scripts/local/wallets.ts` for the full role -> account map,
 * extended with dedicated Settlement operator + investor accounts.
 *
 * Requires anvil already running (`anvil --port 8545`) and `TEST_PK`/`PRIVATE_KEY` NOT set in the
 * environment (forge auto-loads `.env`, which holds the real BNB testnet deployer key — this
 * script always passes an explicit `TEST_PK` override to force the anvil default account).
 */
function forgeScript(contract: string, env: Record<string, string>) {
  execFileSync(
    "forge",
    ["script", "script/Deploy.s.sol", "--tc", contract, "--rpc-url", RPC_URL, "--broadcast"],
    { cwd: REPO_ROOT, env: { ...process.env, TEST_PK: GOVERNOR_PK, ...env }, stdio: "inherit" },
  );
}

async function main() {
  // --- Stage 1: Deploy (Module A partial, Module D, settlement infra, demo assets) ---
  forgeScript("Deploy", {});
  const stage1 = readJson("control-panel/deployments.json");

  // --- Stage 2: DeployW3 (real StateManager, real per-vault NAVOracle + Queue, VaultFactory, 3 vaults) ---
  forgeScript("DeployW3", {
    HYPER_ACCESS_CONTROL: stage1.addresses.HyperAccessControl,
    UNIFIED_POOL: stage1.addresses.UnifiedPool,
    USDT: stage1.addresses.MockUSDT,
    PROTOCOL_FEE_CONFIG: stage1.addresses.ProtocolFeeConfig,
  });
  const stage2 = readJson("control-panel/deployments-w3.json");

  // --- Stage 3: DeployW4 (Settlement, AdapterFactory + 3 adapters) ---
  const provider = new JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  const settlementOperator1 = deriveWallet(ROLE_INDEX.settlementOperator1, provider);
  const settlementOperator2 = deriveWallet(ROLE_INDEX.settlementOperator2, provider);
  const dataProvider = deriveWallet(ROLE_INDEX.dataProvider, provider);

  forgeScript("DeployW4", {
    HYPER_ACCESS_CONTROL: stage1.addresses.HyperAccessControl,
    STATE_MANAGER: stage2.addresses.StateManager,
    QUEUE: stage2.addresses.Queue,
    UNIFIED_POOL: stage1.addresses.UnifiedPool,
    USDT: stage1.addresses.MockUSDT,
    CASH_VAULT: stage2.addresses.CashVault,
    NOTE_VAULT: stage2.addresses.NoteVault,
    LP_VAULT: stage2.addresses.LPVault,
    SETTLEMENT_OPERATORS: `${settlementOperator1.address},${settlementOperator2.address}`,
    SETTLEMENT_THRESHOLD: "2",
    DATA_PROVIDER_SIGNER: dataProvider.address,
  });
  const stage3 = readJson("control-panel/deployments-w4.json");

  // --- Vault-local role wiring ---
  // DeployW3 bootstraps each Vault with `governor` as Owner and explicitly grants it Keeper (see
  // Deploy.s.sol's `_grantVaultLocalRoles`, which calls `setKeeper(governor, true)` — Owner no
  // longer implicitly inherits Keeper); DeployW3/DeployW4 also set `governor` as Curator so their
  // own governor-broadcast Curator-gated bootstrap calls (addAdapter/setAdapter, setDataProvider)
  // succeed. Now that bootstrap is done, delegate Curator/Guardian/Allocator (Owner-gated setters,
  // so `governor` can still call them) to the dedicated Anvil persona wallets, matching the
  // ROLE_INDEX convention the rest of this local devnet (and runTestPlan.ts) expects.
  const governor = deriveWallet(ROLE_INDEX.governor, provider);
  const curator = deriveWallet(ROLE_INDEX.curator, provider);
  const guardian = deriveWallet(ROLE_INDEX.guardian, provider);
  const baseVaultAbi = getAbi("EarnVault"); // BaseVault role setters — shared by EarnVault/LiquidityEarnVault
  for (const vaultAddr of [stage2.addresses.CashVault, stage2.addresses.NoteVault, stage2.addresses.LPVault]) {
    const vault = new Contract(vaultAddr, baseVaultAbi, governor);
    await (await vault.setCurator(curator.address)).wait();
    await (await vault.setGuardian(guardian.address)).wait();
    await (await vault.setAllocator(curator.address)).wait(); // same wallet as Curator, per the old convention
  }

  // --- UnifiedPool.receiveVaultPrincipal wiring ---
  // UnifiedPool is deployed in Stage 1 against StubStateManager (Deploy.s.sol's `stub` — Module D's
  // standalone testing scaffold, immutable once UnifiedPool.initialize() runs), which is a
  // different contract instance from the real StateManager the three demo Vaults register into in
  // Stage 2 (DeployW3). UnifiedPool.receiveVaultPrincipal (Task 4) checks
  // `sm.registeredVaults(msg.sender)` against that StubStateManager, so without this step every
  // real Vault's `returnPrincipalToPool` call reverts with `UnregisteredVault` even though the Vault
  // is registered in the real StateManager. StubStateManager.setRegistered is a permissionless
  // testing-scaffold setter for exactly this — mark all three real Vaults registered there too.
  const stub = new Contract(stage1.addresses.StubStateManager, getAbi("StubStateManager"), governor);
  for (const vaultAddr of [stage2.addresses.CashVault, stage2.addresses.NoteVault, stage2.addresses.LPVault]) {
    await (await stub.setRegistered(vaultAddr, true)).wait();
  }

  // --- Final wiring: Curator sets the LP adapter's bridge target (deliberately not in DeployW4) ---
  const lpAdapter = new Contract(stage3.addresses.LPAdapter, getAbi("LiquidityAdapter"), curator);
  await (await lpAdapter.setBridgeTarget(stage2.addresses.LiquidityBridge, stage2.addresses.CashVault)).wait();

  // Fund the one investor account anvil doesn't pre-fund by default (mnemonic index 11).
  const investor2 = deriveWallet(ROLE_INDEX.investor2, provider);
  if ((await provider.getBalance(investor2.address)) === 0n) {
    await (await governor.sendTransaction({ to: investor2.address, value: 10n ** 19n })).wait();
  }

  const addresses = {
    hyperAccessControl: stage1.addresses.HyperAccessControl,
    stateManager: stage2.addresses.StateManager,
    navOracle: stage2.addresses.NAVOracle,
    mintBurnController: stage1.addresses.MintBurnController,
    assetRegistry: stage1.addresses.AssetRegistry,
    reservePSM: stage1.addresses.ReservePSM,
    poRRegistry: stage1.addresses.PoRRegistry,
    queue: stage2.addresses.Queue,
    revenuePool: stage1.addresses.RevenuePool,
    unifiedPool: stage1.addresses.UnifiedPool,
    settlement: stage3.addresses.Settlement,
    vaultFactory: stage2.addresses.VaultFactory,
    adapterFactory: stage3.addresses.AdapterFactory,
    liquidityBridge: stage2.addresses.LiquidityBridge,
    cashVault: stage2.addresses.CashVault,
    noteVault: stage2.addresses.NoteVault,
    lpVault: stage2.addresses.LPVault,
    cashAdapter: stage3.addresses.CashAdapter,
    noteAdapter: stage3.addresses.NoteAdapter,
    lpAdapter: stage3.addresses.LPAdapter,
    usdt: stage1.addresses.MockUSDT,
    assetRegistryModuleD: {
      note:
        "Module D (AssetRegistry/MintBurnController/ReservePSM/PoRRegistry/NAVOracle-stub) is deployed " +
        "standalone against StubStateManager, matching the confirmed 'D Asset Infra standalone module' " +
        "design (development-plan.md §7). It is NOT wired to the real vaults above — see TEST_PLAN.md.",
      stubStateManager: stage1.addresses.StubStateManager,
      navOracleStub: stage1.addresses.NAVOracle,
      demoRwaAdapter: stage1.addresses.RWAAdapter,
      sToken: stage1.addresses.SToken,
      jToken: stage1.addresses.JToken,
      sTokenAssetId: 1,
      jTokenAssetId: 2,
    },
    chainId: 31337,
    rpcUrl: RPC_URL,
  };

  writeFileSync(join(__dirname, "..", "..", "local", "addresses.json"), JSON.stringify(addresses, null, 2) + "\n");
  console.log("Wrote offchain/local/addresses.json");

  // Rewrite the control panel's config.js with all three stages merged. W1's own writer only
  // knows its own addresses, so without this the panel's StateManager/Vault/VaultTimelock/
  // AdapterRegistry/Settlement/Adapter sections render "— not loaded —" when served from file://
  // (where the deployments-w3/w4 fetch fallback in boot() can't run).
  const merged = {
    addresses: { ...stage1.addresses, ...stage2.addresses, ...stage3.addresses },
    chainId: 31337,
    roles: (stage1 as { roles?: Record<string, string> }).roles ?? {},
  };
  writeFileSync(
    join(REPO_ROOT, "control-panel", "config.js"),
    `window.HT_DEPLOYMENTS = ${JSON.stringify(merged)};\n`,
  );
  console.log("Wrote control-panel/config.js (stages 1+2+3 merged)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
