// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CycleState, DepositRequestState, RedeemRequestState, RequestSettlement} from "../libs/Types.sol";
import {IVaultRoles} from "./IVaultRoles.sol";

/// @title IBaseVault
/// @notice Shared ERC-4626 + ERC-7540 async vault surface. Dynamic pricing
///         (totalAssets/totalSupply), Adapter-aggregated assets, Morpho-style performance
///         fee, dual deposit/redeem FIFO, and net-settlement `settle()`.
///         Also implements IVaultRoles — Owner/Curator/Guardian/Allocator/Keeper are Vault-local
///         (角色权限与职责修改方案 §5), not global HyperAccessControl roles.
///         (development-plan §3.3.1, §8 — net settlement conversion — BaseVault)
interface IBaseVault is IVaultRoles {
    // -----------------------------------------------------------------------
    // Structs
    // -----------------------------------------------------------------------

    struct DepositRequest {
        address owner;
        uint256 assets;
        uint256 settledShares;
        uint256 cycleNumber;
        DepositRequestState state;
    }

    struct RedeemRequest {
        address owner;
        uint256 shares;
        uint256 remainingShares;
        uint256 settledAssets;
        uint256 queuePosition;
        uint256 cycleNumber;
        RedeemRequestState state;
    }

    struct CycleSnapshot {
        uint256 totalAssets;
        uint256 totalSupply;
        uint256 settlementPrice; // 1e18-scale: USDT(6-dec) per 1e18 shares
        uint256 feeAssets;
        uint256 feeShares;
        uint256 timestamp;
        bool initialized;
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event DepositRequested(uint256 indexed requestId, address indexed owner, uint256 assets, uint256 timestamp);
    event DepositClaimed(uint256 indexed requestId, address indexed receiver, uint256 shares, uint256 timestamp);
    event RedeemRequested(uint256 indexed requestId, address indexed owner, uint256 shares, uint256 timestamp);
    event RedeemClaimed(uint256 indexed requestId, address indexed receiver, uint256 assets, uint256 timestamp);
    event RequestCancelled(uint256 indexed requestId, address actor, uint256 timestamp);
    event SettlementProcessed(uint256 depositCount, uint256 redeemCount, uint256 poolDistributedAssets, uint256 timestamp);
    event GateUpdated(address oldGate, address newGate, uint256 timestamp);
    event SettlementSet(address settlement, uint256 timestamp);
    event RefundClaimed(uint256 indexed requestId, address indexed owner, uint256 assets, uint256 timestamp);
    event UnifiedPoolSet(address pool, uint256 timestamp);
    event AdapterAdded(address indexed adapter, uint256 timestamp);
    event AdapterRemoved(address indexed adapter, uint256 timestamp);
    event PerformanceFeeUpdated(uint16 bps, uint256 timestamp);
    event PerformanceFeeRecipientUpdated(address recipient, uint256 timestamp);
    event PerformanceFeeAccrued(uint256 indexed cycleNumber, uint256 feeAssets, uint256 feeShares, uint256 timestamp);
    event PerformanceFeeSkipped(uint256 indexed cycleNumber, uint256 feeAssets, uint256 timestamp);
    event ProtocolFeeConfigSet(address oldRevenuePool, address newRevenuePool, uint16 protocolFeeShareBps, uint256 timestamp);
    event PerformanceFeeDistributed(
        uint256 indexed cycleNumber,
        uint256 feeAssets,
        uint256 feeShares,
        uint256 protocolFeeShares,
        uint256 recipientFeeShares,
        address revenuePool,
        address performanceFeeRecipient
    );
    event SettlementPriceSnapshotted(
        uint256 indexed cycleNumber, uint256 totalAssets, uint256 totalSupply, uint256 settlementPrice, uint256 timestamp
    );
    event CycleNetFlow(
        uint256 indexed cycleNumber, uint256 acceptedDepositTotal, uint256 acceptedRedeemTotal, int256 netFlow
    );
    event RequestWrittenDown(uint256 indexed requestId, uint256 haircut, uint256 newAmount, uint256 timestamp);
    event InsolvencyWrittenDown(
        uint256 grossAssets, uint256 liabilitiesBefore, uint256 liabilitiesAfter, uint256 timestamp
    );
    event DepositSettled(
        uint256 indexed requestId, uint256 originalAssets, uint256 settledAssets, uint256 refundedAssets,
        uint256 indexed cycleNumber, uint256 timestamp
    );
    event RedeemSettled(
        uint256 indexed requestId, uint256 originalShares, uint256 settledSharesThisCycle, uint256 remainingShares,
        uint256 settledAssetsThisCycle, uint256 indexed cycleNumber, uint256 timestamp
    );

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error GateBlocked(address owner);
    error RequestNotSettled(uint256 requestId);
    error RequestAlreadyClaimed(uint256 requestId);
    error RequestAlreadySettled(uint256 requestId);
    error OnlySettlement(address caller);
    error InsufficientShares(address owner, uint256 available, uint256 requested);
    error CancelNotAllowed(uint256 requestId, CycleState currentCycle);
    error SettlementAlreadySet();
    error NotRefundable(uint256 requestId);
    error RequestNotFound(uint256 requestId);
    error NotOwnerOrOperator(address caller, address owner);
    error ZeroAssets();
    error ZeroShares();
    error ZeroAddress();
    error TransferFailed();
    error AccountingInsolvent();
    error AdapterAlreadyAdded(address adapter);
    error AdapterNotFound(address adapter);
    error AdapterLimitExceeded();
    error AdapterStillHasAssets(address adapter);
    error FeeTooHigh(uint16 bps);
    error InvalidFeeRecipient();
    error SnapshotAlreadyInitialized(uint256 cycleNumber);
    error SnapshotNotInitialized(uint256 cycleNumber);
    error SubscriptionCapExceeded(uint256 cap, uint256 projectedAUM);
    error InsufficientSettlementLiquidity(uint256 acceptedRedeemTotal, uint256 available);
    error NotInsolvent();
    error LengthMismatch();
    error WriteDownIncreasesLiability(uint256 requestId);
    error InvalidSettleAmount(uint256 requestId);
    error InsufficientWriteDown(uint256 grossAssets, uint256 liabilitiesAfter);
    error Unauthorized();
    error AdapterNotAllowed(address adapter);
    error GovernanceAlreadyBound();
    error SettlementChangeDuringActiveCycle(CycleState current);
    error UnifiedPoolNotSet();
    error InsufficientFreeUSDT(uint256 requested, uint256 available);

    // -----------------------------------------------------------------------
    // ERC-4626 read surface
    // -----------------------------------------------------------------------

    function totalAssets() external view returns (uint256);
    function grossManagedAssets() external view returns (uint256);
    function freeVaultUSDT() external view returns (uint256);
    function unifiedPool() external view returns (address);
    function settlement() external view returns (address);
    function isAdapter(address adapter) external view returns (bool);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function totalSupply() external view returns (uint256);

    // -----------------------------------------------------------------------
    // ERC-7540 lifecycle
    // -----------------------------------------------------------------------

    function requestDeposit(uint256 assets, address owner) external returns (uint256 requestId);
    function claimDeposit(uint256 requestId, address receiver) external returns (uint256 shares);
    function requestRedeem(uint256 shares, address owner) external returns (uint256 requestId);
    function cancelRequest(uint256 requestId) external;
    function claimRedeem(uint256 requestId, address receiver) external returns (uint256 assets);
    function claimRefund(uint256 requestId) external;

    // -----------------------------------------------------------------------
    // Settlement
    // -----------------------------------------------------------------------

    function snapshotSettlementPrice(uint256 cycleNumber) external;

    /// @dev FIFO constraint: `redeems` is dequeued strict FIFO-from-head (Queue.dequeue). If a
    ///      redeem request is only partially filled (its settleAmount < remainingShares), it
    ///      must be the LAST redeem entry in this batch — nothing queued after it can also be
    ///      included, even if fully cleared, or this call reverts with Queue's
    ///      OutOfOrderDequeue.
    function settle(
        uint256 cycleNumber,
        RequestSettlement[] calldata deposits,
        RequestSettlement[] calldata redeems,
        uint256 poolDistributedAssets
    ) external returns (uint256[] memory fullyClearedRedeemIds);

    function writeDownInsolvency(
        uint256[] calldata pendingDepositIds,
        uint256[] calldata newPendingDepositAssets,
        uint256[] calldata settledRedeemIds,
        uint256[] calldata newSettledRedeemAssets,
        uint256[] calldata refundableDepositIds,
        uint256[] calldata newRefundableAssets
    ) external;

    // -----------------------------------------------------------------------
    // ERC-7540 operator
    // -----------------------------------------------------------------------

    function setOperator(address operator, bool approved) external;
    function isOperator(address owner, address operator) external view returns (bool);

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    /// @notice One-time wiring of this Vault's VaultTimelock and AdapterRegistry, called by
    ///         VaultFactory in the same transaction that constructs this Vault.
    function bindGovernance(address vaultTimelock_, address adapterRegistry_) external;

    function setSettlement(address settlement_) external;
    function setGate(address gate_) external;
    function setUnifiedPool(address pool) external;
    function addAdapter(address adapter) external;
    function removeAdapter(address adapter) external;
    function setPerformanceFeeBps(uint16 bps) external;
    function setPerformanceFeeRecipient(address recipient) external;
    function returnPrincipalToPool(uint256 amount) external;
    function revenuePool() external view returns (address);
    function protocolFeeShareBps() external view returns (uint16);
    function setProtocolFeeConfig(address revenuePool_, uint16 protocolFeeShareBps_) external;

    // -----------------------------------------------------------------------
    // ERC-20 share token
    // -----------------------------------------------------------------------

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}
