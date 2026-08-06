// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseVault} from "./BaseVault.sol";
import {ILiquidityBridge} from "../../interfaces/ILiquidityBridge.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";
import {IQueue} from "../../interfaces/IQueue.sol";
import {DepositRequestState, QueueType, RequestSettlement} from "../../libs/Types.sol";

/// @title LiquidityEarnVault
/// @notice LP tranche vault. Extends BaseVault.
///         On deposit: USDT is forwarded to CashVault via LiquidityBridge; LP Vault
///         holds resulting Cash Tokens in its own balance (not USDT).
///         On exit / maturity: LP Vault distributes Cash Tokens + LP rewards directly
///         to investors — no USDT unwinding at this layer.
///         (development-plan §3.3.1, §8 — LiquidityEarnVault)
contract LiquidityEarnVault is BaseVault {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    address public liquidityBridge;
    address public cashVault;
    address public adapter; // the single LiquidityAdapter registered into BaseVault.adapters[]

    uint256 public constant MAX_CYCLE_REQUESTS = 200;

    struct CycleRecord {
        uint256 acceptedTotalAssets;
        uint256 cashTokenDistributed;
        uint256 bonusUsdtDistributed;
        bool completed;
    }
    mapping(uint256 => CycleRecord) public cycleRecords;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event CashTokensReceived(address indexed fromBridge, uint256 assets, uint256 cashShares, uint256 timestamp);
    event CycleSettled(
        uint256 indexed cycleNumber,
        uint256 acceptedTotalAssets,
        uint256 cashTokenDistributed,
        uint256 bonusUsdtDistributed,
        uint256 requestCount,
        uint256 timestamp
    );
    event DepositRequestEvicted(uint256 indexed requestId, address indexed owner, uint256 assets, uint256 timestamp);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroCashVault();
    error ZeroLiquidityBridge();
    error AdapterAlreadySet();
    error ActionDisabled();
    error RedeemNotSupported();
    error CycleRequestLimitExceeded(uint256 count, uint256 max);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(
        string memory name_,
        string memory symbol_,
        address usdt_,
        address stateManager_,
        address queue_,
        address owner_,
        address liquidityBridge_,
        address cashVault_
    ) BaseVault(name_, symbol_, usdt_, stateManager_, queue_, owner_) {
        if (liquidityBridge_ == address(0)) revert ZeroLiquidityBridge();
        if (cashVault_ == address(0)) revert ZeroCashVault();
        liquidityBridge = liquidityBridge_;
        cashVault       = cashVault_;
    }

    // -----------------------------------------------------------------------
    // Adapter wiring — Vault Curator (direct while CONFIGURING, VaultTimelock after — enforced
    // by addAdapter itself), set once. Registers into BaseVault.adapters[] so
    // grossManagedAssets() aggregates it like any other Adapter.
    // -----------------------------------------------------------------------

    function setAdapter(address adapter_) external {
        if (adapter != address(0)) revert AdapterAlreadySet();
        addAdapter(adapter_);
        adapter = adapter_;
    }

    // -----------------------------------------------------------------------
    // No-share-mint product — old share-based claim/redeem/settle surface disabled.
    // Task 8 replaces settle() with the real cyclical pro-rata implementation.
    // -----------------------------------------------------------------------

    function claimDeposit(uint256, address) external pure override returns (uint256) {
        revert ActionDisabled();
    }

    function requestRedeem(uint256, address) external pure override returns (uint256) {
        revert ActionDisabled();
    }

    function claimRedeem(uint256, address) external pure override returns (uint256) {
        revert ActionDisabled();
    }

    // -----------------------------------------------------------------------
    // Curator-only eviction — unblocks the FIFO deposit queue if a PENDING request's owner
    // cannot receive tokens (e.g. a blocklisted USDT address), which would otherwise
    // permanently brick settle()'s single-transaction, all-or-nothing distribution for every
    // request queued behind it (Queue.dequeue enforces strict FIFO head order, so a stuck head
    // slot blocks everything after it). Reuses the existing REFUNDABLE/claimRefund path
    // (inherited from BaseVault) so the evicted owner can still recover their principal, and
    // Queue's tombstone mechanism (Queue.remove) so the FIFO head can advance past the evicted
    // slot on the next dequeue without violating strict ordering.
    // -----------------------------------------------------------------------

    function evictDepositRequest(uint256 requestId) external {
        _onlyCurator();
        DepositRequestInternal storage req = _depositRequests[requestId];
        if (req.state != DepositRequestState.PENDING) revert RequestNotFound(requestId);

        uint256 assets = req.assets;
        req.state = DepositRequestState.REFUNDABLE;
        pendingDepositLiability -= assets;
        pendingDepositByOwner[req.owner] -= assets;
        refundableLiability += assets;
        IQueue(queue).remove(address(this), QueueType.DEPOSIT, requestId);

        emit DepositRequestEvicted(requestId, req.owner, assets, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // settle() — single-transaction cyclical pro-rata distribution. No shares are ever
    // minted for this vault; instead, accepted deposits' combined USDT is bridged to
    // cashVault in one call and the resulting Cash Tokens, plus a UnifiedPool-provided
    // USDT bonus, are split pro-rata across the batch's requests. The last request (by
    // array order) absorbs the integer-division remainder for both outputs so the vault
    // is left holding zero dust.
    // -----------------------------------------------------------------------

    function settle(
        uint256 cycleNumber,
        RequestSettlement[] calldata deposits,
        RequestSettlement[] calldata redeems,
        uint256 poolDistributedAssets
    ) external override onlySettlementContract nonReentrant returns (uint256[] memory) {
        IStateManager(stateManager).requireActive(address(this));

        if (redeems.length != 0) revert RedeemNotSupported();
        if (deposits.length > MAX_CYCLE_REQUESTS) {
            revert CycleRequestLimitExceeded(deposits.length, MAX_CYCLE_REQUESTS);
        }

        if (!cycleSnapshots[cycleNumber].initialized) revert SnapshotNotInitialized(cycleNumber);

        uint256 cycleTotalAssets = _validateDeposits(deposits);

        if (deposits.length == 0 || cycleTotalAssets == 0) {
            cycleRecords[cycleNumber] = CycleRecord(0, 0, 0, true);
            emit CycleSettled(cycleNumber, 0, 0, 0, deposits.length, block.timestamp);
            return new uint256[](0);
        }

        // Effects before external calls: flip every accepted request to SETTLED and shrink
        // liabilities up front (checks-effects-interactions + the nonReentrant guard above cover
        // the "no partial distribution across a revert" requirement).
        _flipDepositsToSettled(deposits, cycleNumber);

        uint256 cashReceived = _bridgeDeposits(cycleTotalAssets);

        (uint256 cashDistributed, uint256 bonusDistributed) =
            _distribute(deposits, cycleTotalAssets, cashReceived, poolDistributedAssets);

        cycleRecords[cycleNumber] = CycleRecord(cycleTotalAssets, cashDistributed, bonusDistributed, true);
        emit CycleSettled(cycleNumber, cycleTotalAssets, cashDistributed, bonusDistributed, deposits.length, block.timestamp);
        return new uint256[](0);
    }

    /// @dev Bridges cycleTotalAssets of USDT out via liquidityBridge and returns the Cash Token
    ///      amount actually received back (measured by balance diff, not an assumed 1:1).
    function _bridgeDeposits(uint256 cycleTotalAssets) internal returns (uint256 cashReceived) {
        IERC20(usdt).forceApprove(liquidityBridge, cycleTotalAssets);
        uint256 cashBefore = IERC20(cashVault).balanceOf(address(this));
        ILiquidityBridge(liquidityBridge).bridgeDeposit(cycleTotalAssets, address(this), cashVault);
        cashReceived = IERC20(cashVault).balanceOf(address(this)) - cashBefore;
    }

    /// @dev Validates every deposit request is PENDING and settled for its exact full original
    ///      amount (no partial fills for this vault type), and sums the accepted total.
    function _validateDeposits(RequestSettlement[] calldata deposits) internal view returns (uint256 cycleTotalAssets) {
        uint256 n = deposits.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 rid = deposits[i].requestId;
            uint256 settleAmount = deposits[i].settleAmount;
            DepositRequestInternal storage req = _depositRequests[rid];
            if (req.state == DepositRequestState.SETTLED) revert RequestAlreadySettled(rid);
            if (req.state != DepositRequestState.PENDING) revert RequestNotFound(rid);
            if (settleAmount != req.assets) revert InvalidSettleAmount(rid);
            cycleTotalAssets += req.assets;
        }
    }

    /// @dev Flips every accepted request to SETTLED and shrinks liabilities.
    function _flipDepositsToSettled(RequestSettlement[] calldata deposits, uint256 cycleNumber) internal {
        uint256 n = deposits.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 rid = deposits[i].requestId;
            DepositRequestInternal storage req = _depositRequests[rid];
            req.state = DepositRequestState.SETTLED;
            req.cycleNumber = cycleNumber;
            pendingDepositLiability -= req.assets;
            pendingDepositByOwner[req.owner] -= req.assets;
        }
    }

    /// @dev Splits cashReceived and poolDistributedAssets pro-rata across the batch's requests;
    ///      the last request (by array order) absorbs the integer-division remainder for both.
    function _distribute(
        RequestSettlement[] calldata deposits,
        uint256 cycleTotalAssets,
        uint256 cashReceived,
        uint256 poolDistributedAssets
    ) internal returns (uint256 cashDistributed, uint256 bonusDistributed) {
        uint256 n = deposits.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 rid = deposits[i].requestId;
            DepositRequestInternal storage req = _depositRequests[rid];
            uint256 cashOut;
            uint256 bonusOut;
            if (i == n - 1) {
                // Last request absorbs the integer-division remainder for both outputs.
                cashOut = cashReceived - cashDistributed;
                bonusOut = poolDistributedAssets - bonusDistributed;
            } else {
                cashOut = Math.mulDiv(cashReceived, req.assets, cycleTotalAssets);
                bonusOut = Math.mulDiv(poolDistributedAssets, req.assets, cycleTotalAssets);
            }
            cashDistributed += cashOut;
            bonusDistributed += bonusOut;

            if (cashOut > 0) IERC20(cashVault).safeTransfer(req.owner, cashOut);
            if (bonusOut > 0) IERC20(usdt).safeTransfer(req.owner, bonusOut);
        }
    }
}
