// Shared TypeScript types for HyperTessera Module E.
// Enum numeric values mirror src/libs/Types.sol exactly — do not reorder.
// (development-plan.md §3.1.2, §3.3.1)

export type Address = string;
export type Hex = string;

export enum ProductState {
  CONFIGURING = 0,
  SUBSCRIBING = 1,
  FUNDING_FAILED = 2,
  OPERATING = 3,
  SETTLING = 4,
  MATURING = 5,
  CLAIMING = 6,
  CLOSED = 7,
}

export enum CycleState {
  ACCEPTING = 0,
  CALCULATING = 1,
  FULFILLING = 2,
  COMPLETED = 3,
}

export enum PauseState {
  ACTIVE = 0,
  PAUSED_BY_GUARDIAN = 1,
  PAUSED_BY_GOVERNOR = 2,
}

export enum ModuleId {
  CASH_VAULT = 0,
  NOTE_VAULT = 1,
  LP_VAULT = 2,
  SETTLEMENT = 3,
  PSM_POOL = 4,
  TOKENIZATION = 5,
  REWARD = 6,
  CLAIM_REGISTRY = 7,
}

export enum Tranche {
  Cash = 0,
  Note = 1,
  LP = 2,
}

export enum SettlementMode {
  TOKEN_RETURN = 0,
  VALUE_RETURN = 1,
}

/** Queue.sol's dual-FIFO dimension (net settlement conversion, development-plan.md §8). */
export enum QueueType {
  DEPOSIT = 0,
  REDEEM = 1,
}

export enum AssetMode {
  TOKEN_CUSTODY = 0,
  DOCUMENT_PROOF = 1,
}

export interface StateContext {
  product: ProductState;
  cycle: CycleState;
  pause: PauseState;
  cycleNumber: bigint;
}

export interface PriceData {
  price: bigint; // 1e18-scale: value of 1 whole rwaToken, denominated in 1 whole asset unit
  dataTimestamp: bigint;
  updatedAt: bigint;
}

export interface AssetInfo {
  metadataHash: Hex;
  token: Address;
  active: boolean;
  registeredAt: bigint;
  owner: Address;
}

export interface Distribution {
  vault: Address;
  amount: bigint;
}

export interface RequestSettlement {
  requestId: bigint;
  settleAmount: bigint; // assets for a deposit, shares for a redeem
}

/**
 * Net settlement (development-plan.md §8): redeem payouts and share pricing are computed
 * entirely on-chain by BaseVault from its own per-cycle price snapshot — there is no
 * off-chain-supplied redeemAmounts/navSnapshot/lpBonus.
 */
export interface VaultSettlement {
  distribution: Distribution; // distribution.amount == poolDistributedAssets
  deposits: RequestSettlement[];
  redeems: RequestSettlement[];
}

export interface SettlementInstruction {
  vaultSettlements: VaultSettlement[];
  cycleNumber: bigint;
  validUntil: bigint;
}
