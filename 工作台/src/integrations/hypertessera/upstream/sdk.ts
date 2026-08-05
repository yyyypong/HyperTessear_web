import { Contract, keccak256, type Provider, type Signer, type ContractRunner } from "ethers";
import { getAbi, type ContractName } from './abis';
import {
  ProductState,
  CycleState,
  PauseState,
  Tranche,
  QueueType,
  AssetMode,
  type Address,
  type Hex,
  type StateContext,
  type NAVData,
  type AssetInfo,
  type SettlementInstruction,
} from './types';

/** Every on-chain address the SDK needs, keyed by module (development-plan.md §2 module map). */
export interface HyperTesseraAddresses {
  hyperAccessControl: Address;
  stateManager: Address;
  navOracle: Address;
  mintBurnController: Address;
  assetRegistry: Address;
  reservePSM: Address;
  poRRegistry: Address;
  queue: Address;
  revenuePool: Address;
  unifiedPool: Address;
  settlement: Address;
  vaultFactory: Address;
  adapterFactory: Address;
  liquidityBridge: Address;
  cashVault: Address;
  noteVault: Address;
  lpVault: Address;
  cashAdapter: Address;
  noteAdapter: Address;
  lpAdapter: Address;
}

/** keccak256 of raw document bytes — used for `AssetRegistry.metadataHash` and `PoRRegistry.documentHash`. */
export function computeDocumentHash(documentBytes: Uint8Array): Hex {
  return keccak256(documentBytes) as Hex;
}

export type TrancheKey = "cash" | "note" | "lp";

const TRANCHE_ENUM: Record<TrancheKey, Tranche> = {
  cash: Tranche.Cash,
  note: Tranche.Note,
  lp: Tranche.LP,
};

/**
 * HyperTessera Earn TypeScript SDK (development-plan.md §3.1.2 W1 read/write methods, extended
 * through W2-W4 for the full on-chain surface). Wraps read-only view calls and role-gated writes;
 * callers supply their own signer for anything mutating (KeeperBot / SettlementOperator / Issuer /
 * Token Agent per the role table in development-plan.md §3.1.1).
 */
export class HyperTesseraSDK {
  readonly addresses: HyperTesseraAddresses;
  private readonly runner: ContractRunner;
  private readonly contractCache = new Map<string, Contract>();

  constructor(addresses: HyperTesseraAddresses, runner: ContractRunner) {
    this.addresses = addresses;
    this.runner = runner;
  }

  /** Returns a typed ethers Contract for any deployed module — full ABI access beyond the curated methods below. */
  getContract(name: ContractName, address: Address, runner: ContractRunner = this.runner): Contract {
    const key = `${name}:${address}:${runner === this.runner ? "default" : "custom"}`;
    if (runner === this.runner) {
      const cached = this.contractCache.get(key);
      if (cached) return cached;
    }
    const contract = new Contract(address, getAbi(name), runner);
    if (runner === this.runner) this.contractCache.set(key, contract);
    return contract;
  }

  // ---------------------------------------------------------------------
  // Module contract getters
  // ---------------------------------------------------------------------

  get hyperAccessControl(): Contract {
    return this.getContract("HyperAccessControl", this.addresses.hyperAccessControl);
  }
  get stateManager(): Contract {
    return this.getContract("StateManager", this.addresses.stateManager);
  }
  get navOracle(): Contract {
    return this.getContract("NAVOracle", this.addresses.navOracle);
  }
  get mintBurnController(): Contract {
    return this.getContract("MintBurnController", this.addresses.mintBurnController);
  }
  get assetRegistry(): Contract {
    return this.getContract("AssetRegistry", this.addresses.assetRegistry);
  }
  get reservePSM(): Contract {
    return this.getContract("ReservePSM", this.addresses.reservePSM);
  }
  get poRRegistry(): Contract {
    return this.getContract("PoRRegistry", this.addresses.poRRegistry);
  }
  get queue(): Contract {
    return this.getContract("Queue", this.addresses.queue);
  }
  get revenuePool(): Contract {
    return this.getContract("RevenuePool", this.addresses.revenuePool);
  }
  get unifiedPool(): Contract {
    return this.getContract("UnifiedPool", this.addresses.unifiedPool);
  }
  get settlement(): Contract {
    return this.getContract("Settlement", this.addresses.settlement);
  }
  get vaultFactory(): Contract {
    return this.getContract("VaultFactory", this.addresses.vaultFactory);
  }
  get adapterFactory(): Contract {
    return this.getContract("AdapterFactory", this.addresses.adapterFactory);
  }
  get liquidityBridge(): Contract {
    return this.getContract("LiquidityBridge", this.addresses.liquidityBridge);
  }

  /** Vault contract for a tranche — Cash/Note use `EarnVault`, LP uses `LiquidityEarnVault`. */
  vault(tranche: TrancheKey): Contract {
    const address =
      tranche === "cash" ? this.addresses.cashVault : tranche === "note" ? this.addresses.noteVault : this.addresses.lpVault;
    const abiName: ContractName = tranche === "lp" ? "LiquidityEarnVault" : "EarnVault";
    return this.getContract(abiName, address);
  }

  /** Adapter contract for a tranche — Cash/Note use `FirstPeriodAdapter`, LP uses `LiquidityAdapter`. */
  adapter(tranche: TrancheKey): Contract {
    const address =
      tranche === "cash" ? this.addresses.cashAdapter : tranche === "note" ? this.addresses.noteAdapter : this.addresses.lpAdapter;
    const abiName: ContractName = tranche === "lp" ? "LiquidityAdapter" : "FirstPeriodAdapter";
    return this.getContract(abiName, address);
  }

  vaultAddress(tranche: TrancheKey): Address {
    return tranche === "cash" ? this.addresses.cashVault : tranche === "note" ? this.addresses.noteVault : this.addresses.lpVault;
  }

  // ---------------------------------------------------------------------
  // Module A — read methods (development-plan.md §3.1.2)
  // ---------------------------------------------------------------------

  async getStateContext(vault: Address): Promise<StateContext> {
    const raw = await this.stateManager.getState(vault);
    return {
      product: Number(raw.product) as ProductState,
      cycle: Number(raw.cycle) as CycleState,
      pause: Number(raw.pause) as PauseState,
      cycleNumber: BigInt(raw.currentCycleNumber),
    };
  }

  async isVaultRegistered(vault: Address): Promise<boolean> {
    return this.stateManager.isVaultRegistered(vault);
  }

  async isVaultActive(vault: Address): Promise<boolean> {
    const pause: bigint = await this.stateManager.getPauseState(vault);
    return Number(pause) === PauseState.ACTIVE;
  }

  async hasRole(role: Hex, account: Address): Promise<boolean> {
    return this.hyperAccessControl.hasRole(role, account);
  }

  async getNAV(vault: Address): Promise<NAVData> {
    const raw = await this.navOracle.getNavData(vault);
    return { nav: BigInt(raw.nav), dataTimestamp: BigInt(raw.dataTimestamp), updatedAt: BigInt(raw.updatedAt) };
  }

  async isNAVFresh(vault: Address): Promise<boolean> {
    return this.navOracle.isNAVFresh(vault);
  }

  async getRWABalance(rwaToken: Address, account: Address): Promise<bigint> {
    const token = this.getContract("RWAToken", rwaToken);
    return BigInt(await token.balanceOf(account));
  }

  async getRWATotalSupply(rwaToken: Address): Promise<bigint> {
    const token = this.getContract("RWAToken", rwaToken);
    return BigInt(await token.totalSupply());
  }

  async getAssetInfo(assetId: bigint): Promise<AssetInfo> {
    const raw = await this.assetRegistry.getAsset(assetId);
    return {
      metadataHash: raw.metadataHash,
      token: raw.token,
      active: raw.active,
      registeredAt: BigInt(raw.registeredAt),
      owner: raw.owner,
    };
  }

  // ---------------------------------------------------------------------
  // Module A — write methods (development-plan.md §3.1.2 — KeeperBot uses these)
  // ---------------------------------------------------------------------

  async openSubscription(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("openSubscription")(vault);
    return tx.wait();
  }
  async finalizeSubscription(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("finalizeSubscription")(vault);
    return tx.wait();
  }
  async startCycleCalculation(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("startCycleCalculation")(vault);
    return tx.wait();
  }
  async enterFinalSettlement(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("enterFinalSettlement")(vault);
    return tx.wait();
  }
  async enterMaturing(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("enterMaturing")(vault);
    return tx.wait();
  }
  async enterClaiming(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("enterClaiming")(vault);
    return tx.wait();
  }
  async closeProduct(vault: Address, signer: Signer) {
    const tx = await this.stateManager.connect(signer).getFunction("closeProduct")(vault);
    return tx.wait();
  }

  /** NAV signing service uses this. */
  async updateNAV(vault: Address, nav: bigint, dataTimestamp: bigint, sig: Hex, signer: Signer) {
    const tx = await this.navOracle.connect(signer).getFunction("updateNAV")(vault, nav, dataTimestamp, sig);
    return tx.wait();
  }

  /** Issuer / Token Agent use these. */
  async initiateMint(assetId: bigint, amount: bigint, to: Address, issuerSig: Hex, signer: Signer) {
    const tx = await this.mintBurnController.connect(signer).getFunction("initiateMint")(assetId, amount, to, issuerSig);
    const receipt = await tx.wait();
    return { txHash: receipt.hash as Hex, nonce: this.mintBurnController.interface.parseLog(receipt.logs[0])!.args.nonce as bigint };
  }
  async approveMint(nonce: bigint, tokenAgentSig: Hex, signer: Signer) {
    const tx = await this.mintBurnController.connect(signer).getFunction("approveMint")(nonce, tokenAgentSig);
    return tx.wait();
  }
  async initiateBurn(assetId: bigint, amount: bigint, from: Address, issuerSig: Hex, signer: Signer) {
    const tx = await this.mintBurnController.connect(signer).getFunction("initiateBurn")(assetId, amount, from, issuerSig);
    const receipt = await tx.wait();
    return { txHash: receipt.hash as Hex, nonce: this.mintBurnController.interface.parseLog(receipt.logs[0])!.args.nonce as bigint };
  }
  async approveBurn(nonce: bigint, tokenAgentSig: Hex, signer: Signer) {
    const tx = await this.mintBurnController.connect(signer).getFunction("approveBurn")(nonce, tokenAgentSig);
    return tx.wait();
  }

  // ---------------------------------------------------------------------
  // Module C — Settlement (development-plan.md §3.4.2, consumed by SettlementOperator)
  // ---------------------------------------------------------------------

  async hashInstruction(instruction: SettlementInstruction): Promise<Hex> {
    return this.settlement.hashInstruction(instructionToTuple(instruction));
  }

  async isOperator(account: Address): Promise<boolean> {
    return this.settlement.isOperator(account);
  }

  async threshold(): Promise<bigint> {
    return BigInt(await this.settlement.threshold());
  }

  async isExecuted(batchHash: Hex): Promise<boolean> {
    return this.settlement.executed(batchHash);
  }

  async submitBatch(instruction: SettlementInstruction, signatures: Hex[], signer: Signer) {
    const tx = await this.settlement
      .connect(signer)
      .getFunction("submitBatch")(instructionToTuple(instruction), signatures);
    return tx.wait();
  }

  // ---------------------------------------------------------------------
  // Module C — UnifiedPool (Issuer / Operator funding paths; net settlement conversion, §8)
  // ---------------------------------------------------------------------

  async pending(vault: Address): Promise<bigint> {
    return BigInt(await this.unifiedPool.pending(vault));
  }

  async totalPending(): Promise<bigint> {
    return BigInt(await this.unifiedPool.totalPending());
  }

  async availableToDistribute(vault: Address): Promise<bigint> {
    return BigInt(await this.unifiedPool.availableToDistribute(vault));
  }

  /** Full amount credited — no automatic fee deduction under net settlement. */
  async repayInterest(vault: Address, amount: bigint, signer: Signer) {
    const tx = await this.unifiedPool.connect(signer).getFunction("repayInterest")(vault, amount);
    return tx.wait();
  }

  async repayInterestBatch(vaults: Address[], amounts: bigint[], signer: Signer) {
    const tx = await this.unifiedPool.connect(signer).getFunction("repayInterestBatch")(vaults, amounts);
    return tx.wait();
  }

  async repayPrincipal(vault: Address, amount: bigint, signer: Signer) {
    const tx = await this.unifiedPool.connect(signer).getFunction("repayPrincipal")(vault, amount);
    return tx.wait();
  }

  async receiveNotePrincipal(targetVault: Address, amount: bigint, signer: Signer) {
    const tx = await this.unifiedPool.connect(signer).getFunction("receiveNotePrincipal")(targetVault, amount);
    return tx.wait();
  }

  async addTrancheVault(tranche: TrancheKey, vault: Address, signer: Signer) {
    const tx = await this.unifiedPool.connect(signer).getFunction("addTrancheVault")(TRANCHE_ENUM[tranche], vault);
    return tx.wait();
  }

  async operatorTransfer(recipient: Address, amount: bigint, referenceId: Hex, signer: Signer) {
    const tx = await this.unifiedPool.connect(signer).getFunction("operatorTransfer")(recipient, amount, referenceId);
    return tx.wait();
  }

  async operatorTransferToRevenuePool(revenuePool: Address, amount: bigint, referenceId: Hex, signer: Signer) {
    const tx = await this.unifiedPool
      .connect(signer)
      .getFunction("operatorTransferToRevenuePool")(revenuePool, amount, referenceId);
    return tx.wait();
  }

  // ---------------------------------------------------------------------
  // Module D — ReservePSM (Token Custody Mode / Document Proof Mode, §8)
  // ---------------------------------------------------------------------

  async deployWrappedToken(
    assetId: bigint,
    mode: AssetMode,
    underlyingToken: Address,
    name: string,
    symbol: string,
    decimals: number,
    allowPartialUnwrap: boolean,
    signer: Signer,
  ) {
    const tx = await this.reservePSM
      .connect(signer)
      .getFunction("deployWrappedToken")(assetId, mode, underlyingToken, name, symbol, decimals, allowPartialUnwrap);
    return tx.wait();
  }

  /** Token Custody Mode: locks the underlying 1:1 and mints wrapped tokens to `to`. */
  async wrap(assetId: bigint, amount: bigint, to: Address, signer: Signer) {
    const tx = await this.reservePSM.connect(signer).getFunction("wrap")(assetId, amount, to);
    return tx.wait();
  }

  /** Document Proof Mode: signature-authorized mint, no on-chain token custody. */
  async mintWithAuthorization(
    assetId: bigint,
    amount: bigint,
    to: Address,
    nonce: bigint,
    expiry: bigint,
    signature: Hex,
    documentId: Hex,
    signer: Signer,
  ) {
    const tx = await this.reservePSM
      .connect(signer)
      .getFunction("mintWithAuthorization")(assetId, amount, to, nonce, expiry, signature, documentId);
    return tx.wait();
  }

  /** Unified unwrap entry — Token Custody releases the underlying 1:1; Document Proof only emits ReleaseRequested. */
  async unwrap(assetId: bigint, amount: bigint, to: Address, signer: Signer) {
    const tx = await this.reservePSM.connect(signer).getFunction("unwrap")(assetId, amount, to);
    return tx.wait();
  }

  async wrappedTokenOf(assetId: bigint): Promise<Address> {
    return this.reservePSM.wrappedTokenOf(assetId);
  }

  // ---------------------------------------------------------------------
  // Module C — Queue (dual FIFO; also see OnChainEventIndexer.getClearingList) (§8)
  // ---------------------------------------------------------------------

  async queueDepth(vault: Address, queueType: QueueType): Promise<bigint> {
    return BigInt(await this.queue.depth(vault, queueType));
  }

  async isInQueue(vault: Address, queueType: QueueType, requestId: bigint): Promise<boolean> {
    return this.queue.isInQueue(vault, queueType, requestId);
  }

  // ---------------------------------------------------------------------
  // Module B — Vault deposit/redeem lifecycle (ERC-7540 async; per-tranche)
  // ---------------------------------------------------------------------

  async requestDeposit(tranche: TrancheKey, assets: bigint, owner: Address, signer: Signer): Promise<bigint> {
    const tx = await this.vault(tranche).connect(signer).getFunction("requestDeposit")(assets, owner);
    const receipt = await tx.wait();
    return parseRequestId(this.vault(tranche), receipt, "DepositRequested");
  }

  async claimDeposit(tranche: TrancheKey, requestId: bigint, receiver: Address, signer: Signer) {
    const tx = await this.vault(tranche).connect(signer).getFunction("claimDeposit")(requestId, receiver);
    return tx.wait();
  }

  async requestRedeem(tranche: TrancheKey, shares: bigint, owner: Address, signer: Signer): Promise<bigint> {
    const tx = await this.vault(tranche).connect(signer).getFunction("requestRedeem")(shares, owner);
    const receipt = await tx.wait();
    return parseRequestId(this.vault(tranche), receipt, "RedeemRequested");
  }

  async claimRedeem(tranche: TrancheKey, requestId: bigint, receiver: Address, signer: Signer) {
    const tx = await this.vault(tranche).connect(signer).getFunction("claimRedeem")(requestId, receiver);
    return tx.wait();
  }

  async cancelRequest(tranche: TrancheKey, requestId: bigint, signer: Signer) {
    const tx = await this.vault(tranche).connect(signer).getFunction("cancelRequest")(requestId);
    return tx.wait();
  }

  async claimRefund(tranche: TrancheKey, requestId: bigint, signer: Signer) {
    const tx = await this.vault(tranche).connect(signer).getFunction("claimRefund")(requestId);
    return tx.wait();
  }
}

function instructionToTuple(instruction: SettlementInstruction) {
  return {
    vaultSettlements: instruction.vaultSettlements.map((vs) => ({
      distribution: vs.distribution,
      depositRequestIds: vs.depositRequestIds,
      redeemRequestIds: vs.redeemRequestIds,
    })),
    cycleNumber: instruction.cycleNumber,
    validUntil: instruction.validUntil,
  };
}

async function parseRequestId(contract: Contract, receipt: { logs: readonly { topics: readonly string[]; data: string }[] }, eventName: string): Promise<bigint> {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log as { topics: string[]; data: string });
      if (parsed?.name === eventName) return BigInt(parsed.args.requestId);
    } catch {
      // not a log this interface recognizes — skip
    }
  }
  throw new Error(`${eventName} not found in transaction receipt`);
}

export type { Provider, Signer };
