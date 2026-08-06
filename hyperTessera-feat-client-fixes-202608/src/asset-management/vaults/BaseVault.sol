// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBaseVault} from "../../interfaces/IBaseVault.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";
import {IQueue} from "../../interfaces/IQueue.sol";
import {IGate} from "../../interfaces/IGate.sol";
import {IUnifiedPool} from "../../interfaces/IUnifiedPool.sol";
import {ISettlement} from "../../interfaces/ISettlement.sol";
import {IAdapter} from "../../interfaces/IAdapter.sol";
import {IAdapterRegistry} from "../../interfaces/IAdapterRegistry.sol";
import {IVaultRoles} from "../../interfaces/IVaultRoles.sol";
import {IHyperAccessControl} from "../../interfaces/IHyperAccessControl.sol";
import {CycleState, ProductState, QueueType, ProductParams, DepositRequestState, RedeemRequestState, RequestSettlement} from "../../libs/Types.sol";

/// @title BaseVault
/// @notice Abstract ERC-4626 + ERC-7540 async vault base shared by all HyperTessera tranches.
///         Each vault is its own ERC-20 share token. Subscribe/redeem are two-step async:
///         request → settlement → claim. Share mint/burn is settlement-gated.
///
///         Net settlement: deposits and redeems are FIFO-queued (Queue.sol, dual DEPOSIT/REDEEM
///         queues) and settled against a per-cycle `CycleSnapshot` price computed on-chain from
///         `totalAssets()/totalSupply()` — there is no external NAVOracle write path. A
///         Morpho-style performance fee (shares minted against a High-Water Mark) accrues once
///         per cycle in `snapshotSettlementPrice`. (development-plan §3.3.1, §8)
abstract contract BaseVault is IBaseVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // ERC-20 share token
    // -----------------------------------------------------------------------

    string public name;
    string public symbol;
    uint8  public constant decimals = 18;

    uint256 private _totalShares;
    mapping(address => uint256) private _shareBalance;
    mapping(address => mapping(address => uint256)) private _shareAllowance;

    // -----------------------------------------------------------------------
    // ERC-7540 request tracking
    // -----------------------------------------------------------------------

    struct DepositRequestInternal {
        address owner;
        uint256 assets;
        uint256 settledShares;
        uint256 cycleNumber;
        DepositRequestState state;
    }

    struct RedeemRequestInternal {
        address owner;
        uint256 shares;            // ORIGINAL requested shares — immutable after creation
        uint256 remainingShares;   // shares not yet paid; starts == shares, decremented per partial fill
        uint256 settledAssets;     // CUMULATIVE USDT reserved across however many cycles filled it
        uint256 queuePosition;
        uint256 cycleNumber;       // cycle of the most recent (partial or final) settlement
        RedeemRequestState state;
    }

    mapping(uint256 => DepositRequestInternal) internal _depositRequests;
    mapping(uint256 => RedeemRequestInternal)  internal _redeemRequests;
    uint256 public nextRequestId;

    // ERC-7540 operator approval
    mapping(address => mapping(address => bool)) private _operators;

    // -----------------------------------------------------------------------
    // Liability accounting (net settlement)
    // -----------------------------------------------------------------------

    uint256 public pendingDepositLiability;
    mapping(address => uint256) public pendingDepositByOwner;
    uint256 public reservedRedeemLiability;
    uint256 public refundableLiability;

    // -----------------------------------------------------------------------
    // Adapter aggregation + UnifiedPool
    // -----------------------------------------------------------------------

    address public override unifiedPool;
    address[] public adapters;
    mapping(address => bool) public override isAdapter;
    uint256 public constant MAX_ADAPTERS = 16;

    // -----------------------------------------------------------------------
    // Performance fee (Morpho-style, High-Water Mark)
    // -----------------------------------------------------------------------

    uint16  public performanceFeeBps;
    address public performanceFeeRecipient;
    uint256 public feeHighWaterMark; // 1e18-scale price
    uint16  public constant MAX_PERFORMANCE_FEE_BPS = 10_000;

    address public revenuePool;
    uint16  public protocolFeeShareBps;

    mapping(uint256 => CycleSnapshot) public cycleSnapshots;

    // -----------------------------------------------------------------------
    // Protocol wiring
    // -----------------------------------------------------------------------

    address public usdt;
    address public override stateManager;
    address public override settlement;
    address public queue;
    address public gate; // address(0) = open

    // -----------------------------------------------------------------------
    // Vault-local roles (IVaultRoles) — appointed by Owner, independent per Vault
    // -----------------------------------------------------------------------

    address public override owner;
    address public override curator;
    address public override guardian;
    address public override allocator;
    mapping(address => bool) private _keepers;

    /// @notice Bound once by VaultFactory in the same deploy transaction; never rebindable.
    address public override vaultTimelock;
    address public override adapterRegistry;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(
        string memory name_,
        string memory symbol_,
        address usdt_,
        address stateManager_,
        address queue_,
        address owner_
    ) {
        if (usdt_ == address(0) || stateManager_ == address(0) ||
            queue_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        name         = name_;
        symbol       = symbol_;
        usdt         = usdt_;
        stateManager = stateManager_;
        queue        = queue_;
        owner        = owner_;
        nextRequestId = 1;
    }

    /// @notice One-time wiring of this Vault's VaultTimelock and AdapterRegistry, called by
    ///         VaultFactory in the same transaction that constructs this Vault (VaultTimelock's
    ///         own constructor needs this Vault's address, so it cannot be a constructor arg here).
    function bindGovernance(address vaultTimelock_, address adapterRegistry_) external override {
        if (vaultTimelock != address(0)) revert GovernanceAlreadyBound();
        if (vaultTimelock_ == address(0) || adapterRegistry_ == address(0)) revert ZeroAddress();
        vaultTimelock = vaultTimelock_;
        adapterRegistry = adapterRegistry_;
    }

    // -----------------------------------------------------------------------
    // Modifiers / internal auth helpers
    // -----------------------------------------------------------------------

    modifier onlySettlementContract() {
        if (msg.sender != settlement) revert OnlySettlement(msg.sender);
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    function _onlyKeeper() internal view {
        if (!_keepers[msg.sender]) revert Unauthorized();
    }

    function _onlyCurator() internal view {
        if (msg.sender != curator) revert Unauthorized();
    }

    function _onlyGovernor() internal view {
        address ac = IStateManager(stateManager).accessControl();
        bytes32 role = IHyperAccessControl(ac).GOVERNOR_ROLE();
        if (!IHyperAccessControl(ac).hasRole(role, msg.sender)) revert Unauthorized();
    }

    function _isConfiguring() internal view returns (bool) {
        return IStateManager(stateManager).getProductState(address(this)) == ProductState.CONFIGURING;
    }

    /// @notice Direct Owner call while CONFIGURING (initial setup); VaultTimelock-only afterward.
    function _onlyOwnerDirectOrTimelock() internal view {
        if (_isConfiguring()) {
            if (msg.sender != owner) revert Unauthorized();
        } else {
            if (msg.sender != vaultTimelock) revert Unauthorized();
        }
    }

    /// @notice Direct Curator call while CONFIGURING (initial setup); VaultTimelock-only afterward.
    function _onlyCuratorDirectOrTimelock() internal view {
        if (_isConfiguring()) {
            if (msg.sender != curator) revert Unauthorized();
        } else {
            if (msg.sender != vaultTimelock) revert Unauthorized();
        }
    }

    // -----------------------------------------------------------------------
    // IVaultRoles
    // -----------------------------------------------------------------------

    /// @inheritdoc IVaultRoles
    function isKeeper(address account) external view override returns (bool) {
        return _keepers[account];
    }

    /// @inheritdoc IVaultRoles
    function transferOwnership(address newOwner) external override {
        _onlyOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        emit OwnerTransferred(address(this), old, newOwner, block.timestamp);
    }

    /// @inheritdoc IVaultRoles
    function setCurator(address account) external override {
        _onlyOwner();
        address old = curator;
        curator = account;
        emit CuratorSet(address(this), old, account, block.timestamp);
    }

    /// @inheritdoc IVaultRoles
    function setGuardian(address account) external override {
        _onlyOwner();
        address old = guardian;
        guardian = account;
        emit GuardianSet(address(this), old, account, block.timestamp);
    }

    /// @inheritdoc IVaultRoles
    function setAllocator(address account) external override {
        _onlyOwner();
        address old = allocator;
        allocator = account;
        emit AllocatorSet(address(this), old, account, block.timestamp);
    }

    /// @inheritdoc IVaultRoles
    function setKeeper(address account, bool approved) external override {
        _onlyOwner();
        _keepers[account] = approved;
        emit KeeperSet(address(this), account, approved, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // ERC-20 surface
    // -----------------------------------------------------------------------

    function totalSupply() external view returns (uint256) { return _totalShares; }
    function balanceOf(address account) external view returns (uint256) { return _shareBalance[account]; }
    function allowance(address owner, address spender) external view returns (uint256) {
        return _shareAllowance[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _shareAllowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferShares(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = _shareAllowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(from, msg.sender, allowed, amount);
            _shareAllowance[from][msg.sender] = allowed - amount;
        }
        _transferShares(from, to, amount);
        return true;
    }

    function _transferShares(address from, address to, uint256 amount) internal {
        if (_shareBalance[from] < amount) revert InsufficientShares(from, _shareBalance[from], amount);
        _shareBalance[from] -= amount;
        _shareBalance[to]   += amount;
        emit Transfer(from, to, amount);
    }

    function _mintShares(address to, uint256 amount) internal {
        _shareBalance[to] += amount;
        _totalShares      += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burnShares(address from, uint256 amount) internal {
        if (_shareBalance[from] < amount) revert InsufficientShares(from, _shareBalance[from], amount);
        _shareBalance[from] -= amount;
        _totalShares        -= amount;
        emit Transfer(from, address(0), amount);
    }

    // ERC-20 events (declared here for completeness; emitted in helpers)
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    error InsufficientAllowance(address owner, address spender, uint256 allowance, uint256 requested);

    // -----------------------------------------------------------------------
    // ERC-4626 read surface — dynamic pricing
    // -----------------------------------------------------------------------

    /// @notice Vault USDT balance + UnifiedPool receivable + Σ Adapter.realAssets().
    function grossManagedAssets() public view returns (uint256 total) {
        total = IERC20(usdt).balanceOf(address(this));
        if (unifiedPool != address(0)) {
            total += IUnifiedPool(unifiedPool).pending(address(this));
        }
        for (uint256 i = 0; i < adapters.length; i++) {
            total += IAdapter(adapters[i]).realAssets();
        }
    }

    /// @notice Share-holder net assets: grossManagedAssets minus all outstanding liabilities.
    function totalAssets() public view virtual returns (uint256) {
        uint256 gross = grossManagedAssets();
        uint256 liabilities = pendingDepositLiability + reservedRedeemLiability + refundableLiability;
        if (gross < liabilities) revert AccountingInsolvent();
        return gross - liabilities;
    }

    /// @notice Vault USDT balance not already earmarked for pending deposits, reserved
    ///         redeems, or refunds. Single canonical view — no before/after variants.
    function freeVaultUSDT() public view returns (uint256) {
        uint256 balance = IERC20(usdt).balanceOf(address(this));
        uint256 liabilities = pendingDepositLiability + reservedRedeemLiability + refundableLiability;
        if (balance < liabilities) revert AccountingInsolvent();
        return balance - liabilities;
    }

    function _pricePerShare() internal view returns (uint256) {
        uint256 supply = _totalShares;
        if (supply == 0) return 1_000_000;
        return Math.mulDiv(totalAssets(), 1e18, supply);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, 1e18, _pricePerShare());
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, _pricePerShare(), 1e18);
    }

    // -----------------------------------------------------------------------
    // ERC-7540 operator
    // -----------------------------------------------------------------------

    function setOperator(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
    }

    function isOperator(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function _checkOwnerOrOperator(address owner) internal view {
        if (msg.sender != owner && !_operators[owner][msg.sender]) {
            revert NotOwnerOrOperator(msg.sender, owner);
        }
    }

    // -----------------------------------------------------------------------
    // ERC-7540 lifecycle
    // -----------------------------------------------------------------------

    function requestDeposit(uint256 assets, address owner) external virtual nonReentrant returns (uint256 requestId) {
        if (assets == 0) revert ZeroAssets();
        _checkOwnerOrOperator(owner);

        // KYT gate
        if (gate != address(0) && !IGate(gate).isAllowed(owner)) revert GateBlocked(owner);

        // State check — delegate to StateManager
        IStateManager(stateManager).requireSubscribable(address(this));

        // Cap checks — delegate to StateManager (reverts on violation)
        IStateManager(stateManager).recordSubscription(address(this), owner, assets);

        // Pull USDT
        IERC20(usdt).safeTransferFrom(msg.sender, address(this), assets);

        requestId = nextRequestId++;
        uint256 cn = IStateManager(stateManager).currentCycleNumber(address(this));
        _depositRequests[requestId] = DepositRequestInternal({
            owner:         owner,
            assets:        assets,
            settledShares: 0,
            cycleNumber:   cn,
            state:         DepositRequestState.PENDING
        });

        pendingDepositLiability += assets;
        pendingDepositByOwner[owner] += assets;

        IQueue(queue).enqueue(address(this), QueueType.DEPOSIT, requestId, owner, assets);

        emit DepositRequested(requestId, owner, assets, block.timestamp);
    }

    function claimDeposit(uint256 requestId, address receiver) external virtual nonReentrant returns (uint256 shares) {
        DepositRequestInternal storage req = _depositRequests[requestId];
        if (req.owner == address(0)) revert RequestNotFound(requestId);
        _checkOwnerOrOperator(req.owner);
        if (req.state != DepositRequestState.SETTLED) revert RequestNotSettled(requestId);

        shares = req.settledShares;
        req.state = DepositRequestState.CLAIMED;

        _transferShares(address(this), receiver, shares);

        emit DepositClaimed(requestId, receiver, shares, block.timestamp);
    }

    function requestRedeem(uint256 shares, address owner) external virtual nonReentrant returns (uint256 requestId) {
        if (shares == 0) revert ZeroShares();
        _checkOwnerOrOperator(owner);

        IStateManager(stateManager).requireOperable(address(this));

        // Lock shares in vault
        _transferShares(owner, address(this), shares);

        requestId = nextRequestId++;
        uint256 cn = IStateManager(stateManager).currentCycleNumber(address(this));

        _redeemRequests[requestId] = RedeemRequestInternal({
            owner:           owner,
            shares:          shares,
            remainingShares: shares,
            settledAssets:   0,
            queuePosition:   0, // actual FIFO position tracked by Queue contract
            cycleNumber:     cn,
            state:           RedeemRequestState.QUEUED
        });

        IQueue(queue).enqueue(address(this), QueueType.REDEEM, requestId, owner, shares);

        emit RedeemRequested(requestId, owner, shares, block.timestamp);
    }

    function cancelRequest(uint256 requestId) external nonReentrant {
        // Check if deposit or redeem
        DepositRequestInternal storage dep = _depositRequests[requestId];
        if (dep.owner != address(0)) {
            _checkOwnerOrOperator(dep.owner);
            if (dep.state != DepositRequestState.PENDING) revert RequestNotFound(requestId);

            // Only cancelable in ACCEPTING
            CycleState cs = IStateManager(stateManager).getCycleState(address(this));
            if (cs != CycleState.ACCEPTING) revert CancelNotAllowed(requestId, cs);

            dep.state = DepositRequestState.CANCELLED;
            pendingDepositLiability -= dep.assets;
            pendingDepositByOwner[dep.owner] -= dep.assets;
            IQueue(queue).remove(address(this), QueueType.DEPOSIT, requestId);
            IStateManager(stateManager).releaseSubscription(address(this), dep.owner, dep.assets);
            IERC20(usdt).safeTransfer(dep.owner, dep.assets);

            emit RequestCancelled(requestId, msg.sender, block.timestamp);
            return;
        }

        RedeemRequestInternal storage red = _redeemRequests[requestId];
        if (red.owner == address(0)) revert RequestNotFound(requestId);
        _checkOwnerOrOperator(red.owner);
        if (red.state != RedeemRequestState.QUEUED) revert RequestNotFound(requestId);

        CycleState rcs = IStateManager(stateManager).getCycleState(address(this));
        if (rcs != CycleState.ACCEPTING) revert CancelNotAllowed(requestId, rcs);
        // A partially-filled redeem has already had its filled portion burned/reserved in a
        // prior settle(); the vault only holds `remainingShares` on this request's behalf, so
        // cancellation can't be allowed to hand out the full original `shares` amount.
        if (red.remainingShares != red.shares) revert CancelNotAllowed(requestId, rcs);

        red.state = RedeemRequestState.CANCELLED;
        IQueue(queue).remove(address(this), QueueType.REDEEM, requestId);
        _transferShares(address(this), red.owner, red.shares);

        emit RequestCancelled(requestId, msg.sender, block.timestamp);
    }

    function claimRedeem(uint256 requestId, address receiver) external virtual nonReentrant returns (uint256 assets) {
        RedeemRequestInternal storage req = _redeemRequests[requestId];
        if (req.owner == address(0)) revert RequestNotFound(requestId);
        _checkOwnerOrOperator(req.owner);
        if (req.state != RedeemRequestState.SETTLED) revert RequestNotSettled(requestId);

        assets = req.settledAssets;
        req.state = RedeemRequestState.CLAIMED;
        reservedRedeemLiability -= assets;

        IERC20(usdt).safeTransfer(receiver, assets);

        emit RedeemClaimed(requestId, receiver, assets, block.timestamp);
    }

    function claimRefund(uint256 requestId) external nonReentrant {
        DepositRequestInternal storage req = _depositRequests[requestId];
        if (req.owner == address(0)) revert RequestNotFound(requestId);
        if (req.state != DepositRequestState.REFUNDABLE) revert NotRefundable(requestId);

        uint256 assets = req.assets;
        req.state = DepositRequestState.REFUNDED;
        refundableLiability -= assets;

        IERC20(usdt).safeTransfer(req.owner, assets);

        emit RefundClaimed(requestId, req.owner, assets, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Performance fee snapshot — once per cycle, before settle()
    // -----------------------------------------------------------------------

    function snapshotSettlementPrice(uint256 cycleNumber) external onlySettlementContract {
        if (cycleSnapshots[cycleNumber].initialized) revert SnapshotAlreadyInitialized(cycleNumber);

        uint256 supply = _totalShares;
        uint256 assets = totalAssets();
        uint256 feeAssets;
        uint256 feeShares;

        if (supply == 0) {
            feeHighWaterMark = 1_000_000;
        } else {
            uint256 grossPrice = Math.mulDiv(assets, 1e18, supply);
            if (grossPrice > feeHighWaterMark) {
                uint256 profitPerShare = grossPrice - feeHighWaterMark;
                uint256 profitAssets = Math.mulDiv(supply, profitPerShare, 1e18);
                feeAssets = profitAssets * performanceFeeBps / 10_000;
                if (feeAssets > 0) {
                    if (performanceFeeRecipient != address(0)) {
                        feeShares = Math.mulDiv(feeAssets, supply, assets - feeAssets);
                        supply += feeShares;

                        uint256 protocolFeeShares = Math.mulDiv(feeShares, protocolFeeShareBps, 10_000);
                        uint256 recipientFeeShares = feeShares - protocolFeeShares;

                        if (protocolFeeShares > 0 && recipientFeeShares > 0 && revenuePool == performanceFeeRecipient) {
                            _mintShares(performanceFeeRecipient, feeShares);
                        } else {
                            if (recipientFeeShares > 0) _mintShares(performanceFeeRecipient, recipientFeeShares);
                            if (protocolFeeShares > 0) _mintShares(revenuePool, protocolFeeShares);
                        }

                        emit PerformanceFeeAccrued(cycleNumber, feeAssets, feeShares, block.timestamp);
                        emit PerformanceFeeDistributed(
                            cycleNumber, feeAssets, feeShares, protocolFeeShares, recipientFeeShares, revenuePool, performanceFeeRecipient
                        );
                    } else {
                        // No recipient configured: the fee can't be collected this cycle. Flag it
                        // on-chain instead of silently dropping it — feeShares stays 0 and the HWM
                        // still ratchets up below, so this cycle's fee is forfeited, not deferred.
                        emit PerformanceFeeSkipped(cycleNumber, feeAssets, block.timestamp);
                    }
                }
                feeHighWaterMark = Math.mulDiv(assets, 1e18, supply);
            }
        }

        uint256 settlementPrice = supply == 0 ? 1_000_000 : Math.mulDiv(assets, 1e18, supply);

        cycleSnapshots[cycleNumber] = CycleSnapshot({
            totalAssets:     assets,
            totalSupply:     supply,
            settlementPrice: settlementPrice,
            feeAssets:       feeAssets,
            feeShares:       feeShares,
            timestamp:       block.timestamp,
            initialized:     true
        });

        emit SettlementPriceSnapshotted(cycleNumber, assets, supply, settlementPrice, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Settlement — net settlement against the cycle's price snapshot
    // -----------------------------------------------------------------------

    function settle(
        uint256 cycleNumber,
        RequestSettlement[] calldata deposits,
        RequestSettlement[] calldata redeems,
        uint256 poolDistributedAssets
    ) external virtual onlySettlementContract nonReentrant returns (uint256[] memory fullyClearedRedeemIds) {
        IStateManager(stateManager).requireActive(address(this));

        CycleSnapshot storage snap = cycleSnapshots[cycleNumber];
        if (!snap.initialized) revert SnapshotNotInitialized(cycleNumber);

        // Captured before this batch's own liability changes: still excludes the deposits
        // being accepted this cycle (added back explicitly below) and the redeems being
        // reserved this cycle (which must not shrink their own funding check).
        uint256 freeBefore = freeVaultUSDT();

        uint256 acceptedDepositTotal = _processDeposits(deposits, cycleNumber, snap.settlementPrice);
        (uint256 acceptedRedeemTotal, uint256[] memory clearedIds) =
            _processRedeems(redeems, cycleNumber, snap.settlementPrice);
        fullyClearedRedeemIds = clearedIds;

        if (acceptedRedeemTotal > acceptedDepositTotal + freeBefore) {
            revert InsufficientSettlementLiquidity(acceptedRedeemTotal, acceptedDepositTotal + freeBefore);
        }

        ProductParams memory params = IStateManager(stateManager).getParams(address(this));
        if (params.subscriptionCap != 0) {
            uint256 projectedAUM;
            if (acceptedDepositTotal >= acceptedRedeemTotal) {
                projectedAUM = snap.totalAssets + (acceptedDepositTotal - acceptedRedeemTotal);
            } else {
                uint256 netRedeem = acceptedRedeemTotal - acceptedDepositTotal;
                projectedAUM = netRedeem > snap.totalAssets ? 0 : snap.totalAssets - netRedeem;
            }
            if (projectedAUM > params.subscriptionCap) {
                revert SubscriptionCapExceeded(params.subscriptionCap, projectedAUM);
            }
        }

        emit CycleNetFlow(
            cycleNumber, acceptedDepositTotal, acceptedRedeemTotal,
            int256(acceptedDepositTotal) - int256(acceptedRedeemTotal)
        );
        emit SettlementProcessed(deposits.length, redeems.length, poolDistributedAssets, block.timestamp);
    }

    /// @dev Refunds are pushed to `req.owner` via `safeTransfer`; a reverting/blacklisted
    ///      recipient reverts the whole settlement batch. Operational mitigation: evict the
    ///      offending request from the batch, or settle it as a full accept instead of partial.
    function _processDeposits(RequestSettlement[] calldata items, uint256 cycleNumber, uint256 settlementPrice)
        internal
        virtual
        returns (uint256 acceptedTotal)
    {
        for (uint256 i = 0; i < items.length; i++) {
            uint256 rid = items[i].requestId;
            DepositRequestInternal storage req = _depositRequests[rid];
            if (req.state == DepositRequestState.SETTLED) revert RequestAlreadySettled(rid);
            if (req.state != DepositRequestState.PENDING) revert RequestNotFound(rid);

            uint256 settleAmount = items[i].settleAmount;
            if (settleAmount == 0 || settleAmount > req.assets) revert InvalidSettleAmount(rid);

            uint256 shares = Math.mulDiv(settleAmount, 1e18, settlementPrice);
            req.settledShares = shares;
            req.state = DepositRequestState.SETTLED;
            req.cycleNumber = cycleNumber;

            pendingDepositLiability -= req.assets;
            pendingDepositByOwner[req.owner] -= req.assets;
            acceptedTotal += settleAmount;

            _mintShares(address(this), shares); // held for claimDeposit

            uint256 refund = req.assets - settleAmount;
            if (refund > 0) {
                IERC20(usdt).safeTransfer(req.owner, refund);
            }
            emit DepositSettled(rid, req.assets, settleAmount, refund, cycleNumber, block.timestamp);
        }
    }

    function _processRedeems(RequestSettlement[] calldata items, uint256 cycleNumber, uint256 settlementPrice)
        internal
        returns (uint256 acceptedTotal, uint256[] memory fullyClearedIds)
    {
        uint256[] memory cleared = new uint256[](items.length);
        uint256 clearedCount;

        for (uint256 i = 0; i < items.length; i++) {
            uint256 rid = items[i].requestId;
            RedeemRequestInternal storage req = _redeemRequests[rid];
            if (req.state != RedeemRequestState.QUEUED) revert RequestNotFound(rid);

            uint256 settleAmount = items[i].settleAmount; // shares
            if (settleAmount == 0 || settleAmount > req.remainingShares) revert InvalidSettleAmount(rid);

            uint256 assetsOut = Math.mulDiv(settleAmount, settlementPrice, 1e18);
            req.remainingShares -= settleAmount;
            req.settledAssets += assetsOut;
            req.cycleNumber = cycleNumber;

            reservedRedeemLiability += assetsOut;
            acceptedTotal += assetsOut;

            _burnShares(address(this), settleAmount);

            if (req.remainingShares == 0) {
                req.state = RedeemRequestState.SETTLED;
                cleared[clearedCount++] = rid;
            }
            emit RedeemSettled(rid, req.shares, settleAmount, req.remainingShares, assetsOut, cycleNumber, block.timestamp);
        }

        fullyClearedIds = new uint256[](clearedCount);
        for (uint256 i = 0; i < clearedCount; i++) {
            fullyClearedIds[i] = cleared[i];
        }
    }

    // -----------------------------------------------------------------------
    // Insolvency recovery — governance-directed loss write-down
    // -----------------------------------------------------------------------

    /// @notice Recovery path for when grossManagedAssets() has fallen below total liabilities
    ///         (e.g. an Adapter loss), which makes totalAssets()/freeVaultUSDT() revert with
    ///         AccountingInsolvent and blocks settle(). The Company computes the loss
    ///         allocation off-chain (same trust model as SettlementOperator's calc input) and
    ///         supplies the reduced amount owed on each still-outstanding request; this
    ///         function only applies haircuts (never increases what's owed) and requires the
    ///         write-down to fully clear the deficit before it takes effect.
    function writeDownInsolvency(
        uint256[] calldata pendingDepositIds,
        uint256[] calldata newPendingDepositAssets,
        uint256[] calldata settledRedeemIds,
        uint256[] calldata newSettledRedeemAssets,
        uint256[] calldata refundableDepositIds,
        uint256[] calldata newRefundableAssets
    ) external {
        if (msg.sender != vaultTimelock) revert Unauthorized();

        uint256 gross = grossManagedAssets();
        uint256 liabilitiesBefore = pendingDepositLiability + reservedRedeemLiability + refundableLiability;
        if (gross >= liabilitiesBefore) revert NotInsolvent();

        _writeDownPendingDeposits(pendingDepositIds, newPendingDepositAssets);
        _writeDownSettledRedeems(settledRedeemIds, newSettledRedeemAssets);
        _writeDownRefundables(refundableDepositIds, newRefundableAssets);

        uint256 liabilitiesAfter = pendingDepositLiability + reservedRedeemLiability + refundableLiability;
        if (gross < liabilitiesAfter) revert InsufficientWriteDown(gross, liabilitiesAfter);

        emit InsolvencyWrittenDown(gross, liabilitiesBefore, liabilitiesAfter, block.timestamp);
    }

    function _writeDownPendingDeposits(uint256[] calldata ids, uint256[] calldata newAssets) internal {
        if (ids.length != newAssets.length) revert LengthMismatch();
        for (uint256 i = 0; i < ids.length; i++) {
            DepositRequestInternal storage req = _depositRequests[ids[i]];
            if (req.state != DepositRequestState.PENDING) revert RequestNotFound(ids[i]);
            if (newAssets[i] > req.assets) revert WriteDownIncreasesLiability(ids[i]);
            uint256 haircut = req.assets - newAssets[i];
            req.assets = newAssets[i];
            pendingDepositLiability -= haircut;
            pendingDepositByOwner[req.owner] -= haircut;
            emit RequestWrittenDown(ids[i], haircut, newAssets[i], block.timestamp);
        }
    }

    function _writeDownSettledRedeems(uint256[] calldata ids, uint256[] calldata newAssets) internal {
        if (ids.length != newAssets.length) revert LengthMismatch();
        for (uint256 i = 0; i < ids.length; i++) {
            RedeemRequestInternal storage req = _redeemRequests[ids[i]];
            bool eligible = req.state == RedeemRequestState.SETTLED
                || (req.state == RedeemRequestState.QUEUED && req.settledAssets > 0);
            if (!eligible) revert RequestNotFound(ids[i]);
            if (newAssets[i] > req.settledAssets) revert WriteDownIncreasesLiability(ids[i]);
            uint256 haircut = req.settledAssets - newAssets[i];
            req.settledAssets = newAssets[i];
            reservedRedeemLiability -= haircut;
            emit RequestWrittenDown(ids[i], haircut, newAssets[i], block.timestamp);
        }
    }

    function _writeDownRefundables(uint256[] calldata ids, uint256[] calldata newAssets) internal {
        if (ids.length != newAssets.length) revert LengthMismatch();
        for (uint256 i = 0; i < ids.length; i++) {
            DepositRequestInternal storage req = _depositRequests[ids[i]];
            if (req.state != DepositRequestState.REFUNDABLE) revert RequestNotFound(ids[i]);
            if (newAssets[i] > req.assets) revert WriteDownIncreasesLiability(ids[i]);
            uint256 haircut = req.assets - newAssets[i];
            req.assets = newAssets[i];
            refundableLiability -= haircut;
            emit RequestWrittenDown(ids[i], haircut, newAssets[i], block.timestamp);
        }
    }

    // -----------------------------------------------------------------------
    // Mark all deposit requests REFUNDABLE (called when FUNDING_FAILED)
    // -----------------------------------------------------------------------

    function markRefundable(uint256[] calldata requestIds) external {
        ProductState ps = IStateManager(stateManager).getProductState(address(this));
        if (ps != ProductState.FUNDING_FAILED) revert WrongProductState(ProductState.FUNDING_FAILED, ps);
        _onlyCurator();

        for (uint256 i = 0; i < requestIds.length; i++) {
            DepositRequestInternal storage req = _depositRequests[requestIds[i]];
            if (req.state == DepositRequestState.PENDING) {
                req.state = DepositRequestState.REFUNDABLE;
                pendingDepositLiability -= req.assets;
                pendingDepositByOwner[req.owner] -= req.assets;
                refundableLiability += req.assets;
                IQueue(queue).remove(address(this), QueueType.DEPOSIT, requestIds[i]);
            }
        }
    }

    error WrongProductState(ProductState expected, ProductState actual);

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    function setSettlement(address settlement_) external {
        _onlyOwnerDirectOrTimelock();
        CycleState cs = IStateManager(stateManager).getCycleState(address(this));
        if (cs == CycleState.CALCULATING || cs == CycleState.FULFILLING) {
            revert SettlementChangeDuringActiveCycle(cs);
        }
        settlement = settlement_;
        emit SettlementSet(settlement_, block.timestamp);
    }

    function setGate(address gate_) external {
        _onlyOwnerDirectOrTimelock();
        address old = gate;
        gate = gate_;
        emit GateUpdated(old, gate_, block.timestamp);
    }

    function setUnifiedPool(address pool) external {
        _onlyOwnerDirectOrTimelock();
        if (pool == address(0)) revert ZeroAddress();
        unifiedPool = pool;
        emit UnifiedPoolSet(pool, block.timestamp);
    }

    function _onlySettlementOperator() internal view {
        if (!ISettlement(settlement).isOperator(address(this), msg.sender)) revert Unauthorized();
    }

    /// @notice Sends `amount` of this Vault's own free USDT to its configured UnifiedPool,
    ///         crediting this Vault's own pending there for later Settlement-directed
    ///         distribution.
    /// @dev    Access: this Vault's Settlement Operator (per this Vault's own bound Settlement
    ///         contract).
    function returnPrincipalToPool(uint256 amount) external {
        _onlySettlementOperator();
        if (unifiedPool == address(0)) revert UnifiedPoolNotSet();
        if (amount == 0) revert ZeroAssets();
        uint256 available = freeVaultUSDT();
        if (amount > available) revert InsufficientFreeUSDT(amount, available);

        IERC20(usdt).safeIncreaseAllowance(unifiedPool, amount);
        IUnifiedPool(unifiedPool).receiveVaultPrincipal(amount);
    }

    function addAdapter(address adapter_) public {
        _onlyCuratorDirectOrTimelock();
        if (adapter_ == address(0)) revert ZeroAddress();
        if (!IAdapterRegistry(adapterRegistry).isAdapterAllowed(adapter_)) revert AdapterNotAllowed(adapter_);
        if (IAdapter(adapter_).vault() != address(this)) revert AdapterNotFound(adapter_);
        if (isAdapter[adapter_]) revert AdapterAlreadyAdded(adapter_);
        if (adapters.length >= MAX_ADAPTERS) revert AdapterLimitExceeded();
        IAdapter(adapter_).realAssets(); // must not revert — confirms the adapter is well-formed before admission

        adapters.push(adapter_);
        isAdapter[adapter_] = true;
        emit AdapterAdded(adapter_, block.timestamp);
    }

    function removeAdapter(address adapter_) external {
        _onlyCuratorDirectOrTimelock();
        if (!isAdapter[adapter_]) revert AdapterNotFound(adapter_);
        if (IAdapter(adapter_).realAssets() != 0) revert AdapterStillHasAssets(adapter_);

        uint256 len = adapters.length;
        for (uint256 i = 0; i < len; i++) {
            if (adapters[i] == adapter_) {
                adapters[i] = adapters[len - 1];
                adapters.pop();
                break;
            }
        }
        isAdapter[adapter_] = false;
        emit AdapterRemoved(adapter_, block.timestamp);
    }

    function setPerformanceFeeBps(uint16 bps) external {
        _onlyCuratorDirectOrTimelock();
        if (bps > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh(bps);
        if (bps > 0 && performanceFeeRecipient == address(0)) revert InvalidFeeRecipient();
        performanceFeeBps = bps;
        emit PerformanceFeeUpdated(bps, block.timestamp);
    }

    function setPerformanceFeeRecipient(address recipient) external {
        _onlyCuratorDirectOrTimelock();
        if (performanceFeeBps > 0 && recipient == address(0)) revert InvalidFeeRecipient();
        performanceFeeRecipient = recipient;
        emit PerformanceFeeRecipientUpdated(recipient, block.timestamp);
    }

    function setProtocolFeeConfig(address revenuePool_, uint16 protocolFeeShareBps_) external {
        _onlyGovernor();
        if (protocolFeeShareBps_ > 10_000) revert FeeTooHigh(protocolFeeShareBps_);
        if (protocolFeeShareBps_ > 0 && revenuePool_ == address(0)) revert InvalidFeeRecipient();
        address old = revenuePool;
        revenuePool = revenuePool_;
        protocolFeeShareBps = protocolFeeShareBps_;
        emit ProtocolFeeConfigSet(old, revenuePool_, protocolFeeShareBps_, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Internal share getters (for subclasses)
    // -----------------------------------------------------------------------

    function _getShareBalance(address account) internal view returns (uint256) {
        return _shareBalance[account];
    }

    function _getTotalShares() internal view returns (uint256) {
        return _totalShares;
    }
}
