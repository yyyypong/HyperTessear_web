import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { InterfaceAbi } from "ethers";

// Single source of truth: control-panel/abis.json, regenerated from forge build artifacts via
// control-panel/build-abis.sh. Module E consumes the same ABIs the control panel does, so the two
// never drift (development-plan.md §2.5 "W4 -> W5: All ABI surfaces ... must be frozen").
const __dirname = dirname(fileURLToPath(import.meta.url));
const ABIS_PATH = join(__dirname, "..", "..", "control-panel", "abis.json");

export type ContractName =
  | "HyperAccessControl"
  | "VaultTimelock"
  | "AdapterRegistry"
  | "AssetRegistry"
  | "RWAToken"
  | "NAVOracle"
  | "MintBurnController"
  | "StubStateManager"
  | "PoRRegistry"
  | "ReservePSM"
  | "WrappedAsset"
  | "Queue"
  | "RevenuePool"
  | "UnifiedPool"
  | "StateManager"
  | "EarnVault"
  | "LiquidityEarnVault"
  | "LiquidityBridge"
  | "VaultFactory"
  | "Settlement"
  | "AdapterFactory"
  | "FirstPeriodAdapter"
  | "LiquidityAdapter"
  | "RWAAdapter";

let cache: Record<string, InterfaceAbi> | undefined;

function loadAll(): Record<string, InterfaceAbi> {
  if (!cache) {
    cache = JSON.parse(readFileSync(ABIS_PATH, "utf-8"));
  }
  return cache!;
}

export function getAbi(name: ContractName): InterfaceAbi {
  const all = loadAll();
  const abi = all[name];
  if (!abi) throw new Error(`No ABI found for contract "${name}" in ${ABIS_PATH}`);
  return abi;
}
