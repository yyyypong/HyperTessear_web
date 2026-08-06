import type { Contract, Provider } from "ethers";
import type { HyperTesseraSDK, TrancheKey } from "./sdk.js";
import { QueueType, type Address } from "./types.js";

export interface DepositRecord {
  requestId: bigint;
  owner: Address;
  assets: bigint;
  blockNumber: number;
  settled: boolean;
  claimed: boolean;
  cancelled: boolean;
  refunded: boolean;
}

export interface RedeemRecord {
  requestId: bigint;
  owner: Address;
  shares: bigint;
  slotIndex?: bigint;
  orderHash?: string;
  blockNumber: number;
  dequeued: boolean;
  tombstoned: boolean;
  claimed: boolean;
}

export interface QueueSnapshot {
  depositDepth: bigint;
  redeemDepth: bigint;
}

const TRANCHES: TrancheKey[] = ["cash", "note", "lp"];

/**
 * OnChainEventIndexer (development-plan.md §3.5): subscribes to the W1-W4 event surface
 * (docs/module-e-event-whitelist-proposal.md), maintains an in-memory FIFO/pending-deposit
 * reconstruction per vault, and exposes getClearingList()/getPendingDeposits() for
 * SettlementOperator's off-chain calc input.
 *
 * In-memory only — a production deployment would back this with persistent storage, but the
 * reconstruction logic (the actual deliverable) is storage-agnostic.
 */
export interface NAVRecord {
  price: bigint;
  dataTimestamp: bigint;
  updatedAt: number; // block timestamp of the update, seconds
}

export class OnChainEventIndexer {
  private readonly sdk: HyperTesseraSDK;
  private readonly provider: Provider;
  private readonly deposits = new Map<Address, Map<string, DepositRecord>>();
  private readonly redeems = new Map<Address, Map<string, RedeemRecord>>();
  private readonly navByToken = new Map<Address, NAVRecord>();
  private readonly listeners: Array<{ contract: Contract; event: string; handler: (...args: unknown[]) => void }> = [];

  constructor(sdk: HyperTesseraSDK, provider: Provider) {
    this.sdk = sdk;
    this.provider = provider;
    for (const tranche of TRANCHES) {
      const vault = sdk.vaultAddress(tranche);
      this.deposits.set(vault, new Map());
      this.redeems.set(vault, new Map());
    }
  }

  private depositMap(vault: Address): Map<string, DepositRecord> {
    const m = this.deposits.get(vault);
    if (!m) throw new Error(`Vault ${vault} is not one of the indexed tranches`);
    return m;
  }

  private redeemMap(vault: Address): Map<string, RedeemRecord> {
    const m = this.redeems.get(vault);
    if (!m) throw new Error(`Vault ${vault} is not one of the indexed tranches`);
    return m;
  }

  // -----------------------------------------------------------------------
  // Event handlers (shared by backfill() and start())
  // -----------------------------------------------------------------------

  private onDepositRequested(vault: Address, requestId: bigint, owner: Address, assets: bigint, blockNumber: number) {
    this.depositMap(vault).set(requestId.toString(), {
      requestId,
      owner,
      assets,
      blockNumber,
      settled: false,
      claimed: false,
      cancelled: false,
      refunded: false,
    });
  }

  private onDepositClaimed(vault: Address, requestId: bigint) {
    const rec = this.depositMap(vault).get(requestId.toString());
    if (rec) rec.claimed = true;
  }

  private onRequestCancelled(vault: Address, requestId: bigint) {
    const dep = this.depositMap(vault).get(requestId.toString());
    if (dep) dep.cancelled = true;
    const red = this.redeemMap(vault).get(requestId.toString());
    if (red) red.tombstoned = true;
  }

  private onRefundClaimed(vault: Address, requestId: bigint) {
    const rec = this.depositMap(vault).get(requestId.toString());
    if (rec) rec.refunded = true;
  }

  private onRedeemRequested(vault: Address, requestId: bigint, owner: Address, shares: bigint, blockNumber: number) {
    const existing = this.redeemMap(vault).get(requestId.toString());
    this.redeemMap(vault).set(requestId.toString(), {
      requestId,
      owner,
      shares,
      blockNumber,
      slotIndex: existing?.slotIndex,
      orderHash: existing?.orderHash,
      dequeued: false,
      tombstoned: false,
      claimed: false,
    });
  }

  private onRedeemClaimed(vault: Address, requestId: bigint) {
    const rec = this.redeemMap(vault).get(requestId.toString());
    if (rec) rec.claimed = true;
  }

  private onRedeemQueued(vault: Address, requestId: bigint, slotIndex: bigint, orderHash: string) {
    const rec = this.redeemMap(vault).get(requestId.toString());
    if (rec) {
      rec.slotIndex = slotIndex;
      rec.orderHash = orderHash;
    }
  }

  private onRedeemDequeued(vault: Address, requestId: bigint) {
    const rec = this.redeemMap(vault).get(requestId.toString());
    if (rec) rec.dequeued = true;
  }

  private onRedeemCancelledFromQueue(vault: Address, requestId: bigint) {
    const rec = this.redeemMap(vault).get(requestId.toString());
    if (rec) rec.tombstoned = true;
  }

  // Queue.sol is dual-FIFO (DEPOSIT + REDEEM) as of the net settlement conversion (§8) — this
  // indexer's clearing-list scope is redeem-only, so every handler above filters to
  // QueueType.REDEEM before updating redeem records.

  private onNAVUpdated(rwaToken: Address, price: bigint, dataTimestamp: bigint, updatedAt: number) {
    this.navByToken.set(rwaToken, { price, dataTimestamp, updatedAt });
  }

  /** Decode a Settlement.submitBatch transaction and mark its deposit requestIds as settled. */
  private async onSettlementExecuted(txHash: string) {
    const tx = await this.provider.getTransaction(txHash);
    if (!tx) return;
    const parsed = this.sdk.settlement.interface.parseTransaction({ data: tx.data, value: tx.value });
    if (!parsed || parsed.name !== "submitBatch") return;
    const instruction = parsed.args[0];
    for (const vs of instruction.vaultSettlements) {
      const vaultAddr: Address = vs.distribution.vault;
      const depositMap = this.deposits.get(vaultAddr);
      if (!depositMap) continue;
      for (const d of vs.deposits as { requestId: bigint; settleAmount: bigint }[]) {
        const rec = depositMap.get(d.requestId.toString());
        if (rec) rec.settled = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Historical backfill
  // -----------------------------------------------------------------------

  async backfill(fromBlock: number | bigint = 0, toBlock: number | bigint | "latest" = "latest"): Promise<void> {
    for (const tranche of TRANCHES) {
      const vaultAddr = this.sdk.vaultAddress(tranche);
      const vault = this.sdk.vault(tranche);

      for (const log of await vault.queryFilter(vault.filters.DepositRequested(), fromBlock, toBlock)) {
        const { requestId, owner, assets } = (log as any).args;
        this.onDepositRequested(vaultAddr, BigInt(requestId), owner, BigInt(assets), log.blockNumber);
      }
      for (const log of await vault.queryFilter(vault.filters.DepositClaimed(), fromBlock, toBlock)) {
        this.onDepositClaimed(vaultAddr, BigInt((log as any).args.requestId));
      }
      for (const log of await vault.queryFilter(vault.filters.RequestCancelled(), fromBlock, toBlock)) {
        this.onRequestCancelled(vaultAddr, BigInt((log as any).args.requestId));
      }
      for (const log of await vault.queryFilter(vault.filters.RefundClaimed(), fromBlock, toBlock)) {
        this.onRefundClaimed(vaultAddr, BigInt((log as any).args.requestId));
      }
      for (const log of await vault.queryFilter(vault.filters.RedeemRequested(), fromBlock, toBlock)) {
        const { requestId, owner, shares } = (log as any).args;
        this.onRedeemRequested(vaultAddr, BigInt(requestId), owner, BigInt(shares), log.blockNumber);
      }
      for (const log of await vault.queryFilter(vault.filters.RedeemClaimed(), fromBlock, toBlock)) {
        this.onRedeemClaimed(vaultAddr, BigInt((log as any).args.requestId));
      }
    }

    const queue = this.sdk.queue;
    for (const log of await queue.queryFilter(queue.filters.RequestQueued(null, QueueType.REDEEM), fromBlock, toBlock)) {
      const { vault, requestId, slotIndex, orderHash } = (log as any).args;
      this.onRedeemQueued(vault, BigInt(requestId), BigInt(slotIndex), orderHash);
    }
    for (const log of await queue.queryFilter(queue.filters.RequestDequeued(null, QueueType.REDEEM), fromBlock, toBlock)) {
      const { vault, requestId } = (log as any).args;
      this.onRedeemDequeued(vault, BigInt(requestId));
    }
    for (const log of await queue.queryFilter(
      queue.filters.RequestCancelledFromQueue(null, QueueType.REDEEM),
      fromBlock,
      toBlock,
    )) {
      const { vault, requestId } = (log as any).args;
      this.onRedeemCancelledFromQueue(vault, BigInt(requestId));
    }

    const settlement = this.sdk.settlement;
    for (const log of await settlement.queryFilter(settlement.filters.SettlementExecuted(), fromBlock, toBlock)) {
      await this.onSettlementExecuted(log.transactionHash);
    }

    const navOracle = this.sdk.navOracle;
    for (const log of await navOracle.queryFilter(navOracle.filters.NAVUpdated(), fromBlock, toBlock)) {
      const { rwaToken, price, dataTimestamp, updatedAt } = (log as any).args;
      this.onNAVUpdated(rwaToken, BigInt(price), BigInt(dataTimestamp), Number(updatedAt));
    }
  }

  // -----------------------------------------------------------------------
  // Live subscription
  // -----------------------------------------------------------------------

  start(): void {
    for (const tranche of TRANCHES) {
      const vaultAddr = this.sdk.vaultAddress(tranche);
      const vault = this.sdk.vault(tranche);
      this.subscribe(vault, "DepositRequested", (requestId, owner, assets, _ts, event) =>
        this.onDepositRequested(vaultAddr, BigInt(requestId), owner, BigInt(assets), event.log.blockNumber),
      );
      this.subscribe(vault, "DepositClaimed", (requestId) => this.onDepositClaimed(vaultAddr, BigInt(requestId)));
      this.subscribe(vault, "RequestCancelled", (requestId) => this.onRequestCancelled(vaultAddr, BigInt(requestId)));
      this.subscribe(vault, "RefundClaimed", (requestId) => this.onRefundClaimed(vaultAddr, BigInt(requestId)));
      this.subscribe(vault, "RedeemRequested", (requestId, owner, shares, _ts, event) =>
        this.onRedeemRequested(vaultAddr, BigInt(requestId), owner, BigInt(shares), event.log.blockNumber),
      );
      this.subscribe(vault, "RedeemClaimed", (requestId) => this.onRedeemClaimed(vaultAddr, BigInt(requestId)));
    }

    const queue = this.sdk.queue;
    this.subscribe(queue, "RequestQueued", (vault, queueType, requestId, slotIndex, orderHash) => {
      if (Number(queueType) === QueueType.REDEEM) this.onRedeemQueued(vault, BigInt(requestId), BigInt(slotIndex), orderHash);
    });
    this.subscribe(queue, "RequestDequeued", (vault, queueType, requestId) => {
      if (Number(queueType) === QueueType.REDEEM) this.onRedeemDequeued(vault, BigInt(requestId));
    });
    this.subscribe(queue, "RequestCancelledFromQueue", (vault, queueType, requestId) => {
      if (Number(queueType) === QueueType.REDEEM) this.onRedeemCancelledFromQueue(vault, BigInt(requestId));
    });

    const settlement = this.sdk.settlement;
    this.subscribe(settlement, "SettlementExecuted", (_batchHash, _cycleNumber, _ts, event) => {
      void this.onSettlementExecuted(event.log.transactionHash);
    });

    const navOracle = this.sdk.navOracle;
    this.subscribe(navOracle, "NAVUpdated", (rwaToken, price, dataTimestamp, updatedAt) =>
      this.onNAVUpdated(rwaToken, BigInt(price), BigInt(dataTimestamp), Number(updatedAt)),
    );
  }

  private subscribe(contract: Contract, event: string, handler: (...args: any[]) => void): void {
    contract.on(event, handler);
    this.listeners.push({ contract, event, handler });
  }

  stop(): void {
    for (const { contract, event, handler } of this.listeners) {
      contract.off(event, handler as any);
    }
    this.listeners.length = 0;
  }

  // -----------------------------------------------------------------------
  // Query surface (development-plan.md §3.5: "validate getClearingList and getPendingDeposits")
  // -----------------------------------------------------------------------

  /** Deposit requests not yet settled/cancelled/refunded — SettlementOperator's calc input. */
  getPendingDeposits(vault: Address): DepositRecord[] {
    return [...this.depositMap(vault).values()]
      .filter((r) => !r.settled && !r.cancelled && !r.refunded)
      .sort((a, b) => Number(a.requestId - b.requestId));
  }

  /** Redeem requests still resident in the on-chain FIFO queue, in FIFO order. */
  getClearingList(vault: Address): RedeemRecord[] {
    return [...this.redeemMap(vault).values()]
      .filter((r) => !r.dequeued && !r.tombstoned && r.slotIndex !== undefined)
      .sort((a, b) => Number((a.slotIndex ?? 0n) - (b.slotIndex ?? 0n)));
  }

  /** Last indexed NAV reading for `rwaToken`, or undefined if none has been backfilled/observed yet. */
  getLatestNAV(rwaToken: Address): NAVRecord | undefined {
    return this.navByToken.get(rwaToken);
  }

  /** Live on-chain depth of both dual-FIFO queues for `vault` (net settlement conversion, §8). */
  async getQueueSnapshot(vault: Address): Promise<QueueSnapshot> {
    const [depositDepth, redeemDepth] = await Promise.all([
      this.sdk.queueDepth(vault, QueueType.DEPOSIT),
      this.sdk.queueDepth(vault, QueueType.REDEEM),
    ]);
    return { depositDepth, redeemDepth };
  }

  /** Generic ad-hoc historical query — any contract/event this indexer doesn't already track. */
  async getEvents(contract: Contract, eventName: string, fromBlock: number | bigint = 0, toBlock: number | bigint | "latest" = "latest") {
    return contract.queryFilter(contract.filters[eventName](), fromBlock, toBlock);
  }
}
