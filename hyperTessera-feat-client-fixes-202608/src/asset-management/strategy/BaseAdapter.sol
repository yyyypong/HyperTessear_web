// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapter} from "../../interfaces/IAdapter.sol";
import {IVaultRoles} from "../../interfaces/IVaultRoles.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";
import {ProductState} from "../../libs/Types.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BaseAdapter
/// @notice Vault's execution + position-ledger + valuation module (development-plan §3.4.1).
///         Standard OZ ERC-4626 for capital sourcing from the Vault; a Curator/Allocator order
///         book for buy/sell/rebalance; off-chain-fed valuation via `realAssets()` (virtual).
abstract contract BaseAdapter is ERC4626, IAdapter {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    address public immutable vault;

    /// @notice This Adapter's off-chain valuation data provider, set by the Vault's Curator.
    address public dataProvider;

    mapping(uint256 orderId => Order) public buyOrders;
    mapping(uint256 orderId => Order) public sellOrders;
    mapping(uint256 orderId => Order) public rebalanceOrders;
    uint256 public nextBuyOrderId;
    uint256 public nextSellOrderId;
    uint256 public nextRebalanceOrderId;

    mapping(uint256 buyOrderId => DealData) public pendingDeposits;
    uint256[] public liveDealOrderIds;

    uint256 public defaultStalenessWindow;

    bool public override allocatorFrozen;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(
        IERC20 asset_,
        address vault_,
        uint256 defaultStalenessWindow_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (address(asset_) == address(0) || vault_ == address(0)) {
            revert ZeroAddress();
        }
        vault = vault_;
        defaultStalenessWindow = defaultStalenessWindow_;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _onlyCurator() internal view {
        if (IVaultRoles(vault).curator() != msg.sender) revert NotCurator();
    }

    function _onlyAllocator() internal view {
        if (IVaultRoles(vault).allocator() != msg.sender) revert NotAllocator();
        if (allocatorFrozen) revert AllocatorIsFrozen();
    }

    function _onlyCuratorOrGuardian() internal view {
        IVaultRoles roles = IVaultRoles(vault);
        if (roles.curator() != msg.sender && roles.guardian() != msg.sender) {
            revert NotCuratorOrGuardian();
        }
    }

    function _onlyDataProvider() internal view {
        if (dataProvider != msg.sender) revert NotDataProvider();
    }

    /// @dev Direct Curator call while this Adapter's Vault is CONFIGURING (initial setup);
    ///      VaultTimelock-only afterward — matches the pattern used for BaseVault's other
    ///      Curator-class parameters (staleness window / data provider are both Curator-class
    ///      Timelock operations per 角色权限与职责修改方案 §6.4).
    function _onlyCuratorDirectOrTimelock() internal view {
        address sm = IVaultRoles(vault).stateManager();
        bool isConfiguring = IStateManager(sm).getProductState(vault) == ProductState.CONFIGURING;
        if (isConfiguring) {
            if (IVaultRoles(vault).curator() != msg.sender) revert NotCurator();
        } else {
            if (IVaultRoles(vault).vaultTimelock() != msg.sender) revert NotCurator();
        }
    }

    function _onlyGuardian() internal view {
        if (IVaultRoles(vault).guardian() != msg.sender) revert NotGuardian();
    }

    function _deployCapital(uint256 amount, address destination) internal {
        IERC20(asset()).safeTransfer(destination, amount);
        emit CapitalDeployed(destination, amount, block.timestamp);
    }

    function _recallCapital(uint256 amount) internal {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit CapitalRecalled(amount, block.timestamp);
    }

    function _recallCapitalFrom(address source, uint256 amount) internal {
        IERC20(asset()).safeTransferFrom(source, address(this), amount);
        emit CapitalRecalled(amount, block.timestamp);
    }

    function _removeLiveDeal(uint256 orderId) internal {
        uint256 len = liveDealOrderIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (liveDealOrderIds[i] == orderId) {
                liveDealOrderIds[i] = liveDealOrderIds[len - 1];
                liveDealOrderIds.pop();
                break;
            }
        }
    }

    // -----------------------------------------------------------------------
    // ERC-4626
    // -----------------------------------------------------------------------

    function totalAssets() public view override returns (uint256) {
        return realAssets();
    }

    // -----------------------------------------------------------------------
    // Curator order book
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapter
    function createBuyOrder(uint256 amount, address destination, SettlementMode mode)
        external
        override
        returns (uint256 orderId)
    {
        _onlyCurator();
        orderId = nextBuyOrderId++;
        buyOrders[orderId] = Order({
            amount: amount,
            destination: destination,
            source: address(0),
            mode: mode,
            executed: false,
            cancelled: false
        });
        emit BuyOrderCreated(orderId, amount, destination, uint8(mode), block.timestamp);
    }

    /// @inheritdoc IAdapter
    function createSellOrder(uint256 amount) external override returns (uint256 orderId) {
        _onlyCurator();
        orderId = nextSellOrderId++;
        sellOrders[orderId] = Order({
            amount: amount,
            destination: address(0),
            source: address(0),
            mode: SettlementMode.TOKEN_RETURN,
            executed: false,
            cancelled: false
        });
        emit SellOrderCreated(orderId, amount, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function createRebalanceOrder(uint256 amount, address source, address destination, SettlementMode mode)
        external
        override
        returns (uint256 orderId)
    {
        _onlyCurator();
        orderId = nextRebalanceOrderId++;
        rebalanceOrders[orderId] =
            Order({amount: amount, destination: destination, source: source, mode: mode, executed: false, cancelled: false});
        emit RebalanceOrderCreated(orderId, amount, source, destination, uint8(mode), block.timestamp);
    }

    /// @inheritdoc IAdapter
    function cancelBuyOrder(uint256 orderId) external override {
        _onlyCuratorOrGuardian();
        Order storage o = buyOrders[orderId];
        if (o.executed) revert OrderAlreadyExecuted(orderId);
        if (o.cancelled) revert OrderAlreadyCancelled(orderId);
        o.cancelled = true;
        emit OrderCancelled(orderId, 0, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function cancelSellOrder(uint256 orderId) external override {
        _onlyCuratorOrGuardian();
        Order storage o = sellOrders[orderId];
        if (o.executed) revert OrderAlreadyExecuted(orderId);
        if (o.cancelled) revert OrderAlreadyCancelled(orderId);
        o.cancelled = true;
        emit OrderCancelled(orderId, 1, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function cancelRebalanceOrder(uint256 orderId) external override {
        _onlyCuratorOrGuardian();
        Order storage o = rebalanceOrders[orderId];
        if (o.executed) revert OrderAlreadyExecuted(orderId);
        if (o.cancelled) revert OrderAlreadyCancelled(orderId);
        o.cancelled = true;
        emit OrderCancelled(orderId, 2, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Emergency freeze — Guardian can halt Allocator execution without cancelling every
    // individually pending order (development-plan §3.1.1 GUARDIAN_ROLE "freeze Allocator").
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapter
    function freezeAllocator() external override {
        _onlyGuardian();
        allocatorFrozen = true;
        emit AllocatorFrozen(msg.sender, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function unfreezeAllocator() external override {
        _onlyCurator();
        allocatorFrozen = false;
        emit AllocatorUnfrozen(msg.sender, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Allocator execution
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapter
    function executeBuy(uint256 orderId) external override {
        _onlyAllocator();
        if (orderId >= nextBuyOrderId) revert OrderDoesNotExist(orderId);
        Order storage o = buyOrders[orderId];
        if (o.cancelled) revert OrderAlreadyCancelled(orderId);
        if (o.executed) revert OrderAlreadyExecuted(orderId);

        o.executed = true;
        _deployCapital(o.amount, o.destination);

        pendingDeposits[orderId] = DealData({
            dealValue: o.amount,
            updatedAt: block.timestamp,
            stalenessWindow: defaultStalenessWindow
        });
        liveDealOrderIds.push(orderId);

        emit BuyOrderExecuted(orderId, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function executeSell(uint256 orderId) external override {
        _onlyAllocator();
        if (orderId >= nextSellOrderId) revert OrderDoesNotExist(orderId);
        Order storage o = sellOrders[orderId];
        if (o.cancelled) revert OrderAlreadyCancelled(orderId);
        if (o.executed) revert OrderAlreadyExecuted(orderId);

        o.executed = true;
        _recallCapital(o.amount);

        emit SellOrderExecuted(orderId, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function executeRebalance(uint256 orderId) external override {
        _onlyAllocator();
        if (orderId >= nextRebalanceOrderId) revert OrderDoesNotExist(orderId);
        Order storage o = rebalanceOrders[orderId];
        if (o.cancelled) revert OrderAlreadyCancelled(orderId);
        if (o.executed) revert OrderAlreadyExecuted(orderId);

        o.executed = true;
        _recallCapitalFrom(o.source, o.amount);
        _deployCapital(o.amount, o.destination);

        pendingDeposits[orderId] = DealData({
            dealValue: o.amount,
            updatedAt: block.timestamp,
            stalenessWindow: defaultStalenessWindow
        });
        liveDealOrderIds.push(orderId);

        emit RebalanceOrderExecuted(orderId, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Valuation
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapter
    function realAssets() public view virtual override returns (uint256) {
        uint256 sum = 0;
        uint256 len = liveDealOrderIds.length;
        for (uint256 i = 0; i < len; i++) {
            DealData storage d = pendingDeposits[liveDealOrderIds[i]];
            if (block.timestamp - d.updatedAt > d.stalenessWindow) {
                revert StaleAdapterData(d.updatedAt, d.stalenessWindow);
            }
            sum += d.dealValue;
        }
        return sum;
    }

    /// @notice Sum of live deal values belonging to executed TOKEN_RETURN buy orders — i.e. the
    ///         in-flight order cost that a real, on-chain-readable token balance is expected to
    ///         supersede once the asset is delivered. VALUE_RETURN deals are excluded: their value
    ///         is only ever knowable from `updateDealData`, never from a balance.
    /// @dev    Every term is also a term of `realAssets()`'s sum, so this can never exceed it.
    ///         Skips the staleness check `realAssets()` already performs on the same entries.
    function _liveTokenReturnDealValue() internal view returns (uint256 sum) {
        uint256 len = liveDealOrderIds.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 orderId = liveDealOrderIds[i];
            Order storage o = buyOrders[orderId];
            if (o.executed && o.mode == SettlementMode.TOKEN_RETURN) {
                sum += pendingDeposits[orderId].dealValue;
            }
        }
    }

    /// @inheritdoc IAdapter
    function updateDealData(uint256 orderId, uint256 newValue) external override {
        _onlyDataProvider();
        Order storage o = buyOrders[orderId];
        if (!o.executed) revert OrderDoesNotExist(orderId);
        if (o.mode != SettlementMode.VALUE_RETURN) {
            revert WrongSettlementMode(orderId, uint8(SettlementMode.VALUE_RETURN), uint8(o.mode));
        }
        pendingDeposits[orderId] =
            DealData({dealValue: newValue, updatedAt: block.timestamp, stalenessWindow: defaultStalenessWindow});
        emit DealDataUpdated(orderId, newValue, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function clearDealValue(uint256 orderId) external override {
        _onlyAllocator();
        Order storage o = buyOrders[orderId];
        if (!o.executed) revert OrderDoesNotExist(orderId);
        if (o.mode != SettlementMode.TOKEN_RETURN) {
            revert WrongSettlementMode(orderId, uint8(SettlementMode.TOKEN_RETURN), uint8(o.mode));
        }
        pendingDeposits[orderId].dealValue = 0;
        _removeLiveDeal(orderId);
        emit DealValueCleared(orderId, block.timestamp);
    }

    /// @inheritdoc IAdapter
    function setStalenessWindow(uint256 window) external override {
        _onlyCuratorDirectOrTimelock();
        defaultStalenessWindow = window;
    }

    /// @inheritdoc IAdapter
    function setDataProvider(address provider) external override {
        _onlyCuratorDirectOrTimelock();
        dataProvider = provider;
        emit DataProviderSet(provider, block.timestamp);
    }
}
