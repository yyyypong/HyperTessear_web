// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAdapter
/// @notice Vault's execution + position-ledger + valuation module. Curator authorizes buy/sell/
///         rebalance intent (amount/destination/settlement mode); Allocator executes exactly as
///         authorized (orderId only — no amount/destination discretion). (development-plan §3.4.1)
interface IAdapter {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum SettlementMode {
        TOKEN_RETURN, // destination eventually delivers an on-chain token; realAssets() falls back to it once resolved
        VALUE_RETURN // destination never tokenizes; permanently reported via updateDealData

    }

    struct Order {
        uint256 amount;
        address destination; // buy: purchase destination. sell: ignored. rebalance: target destination
        address source; // rebalance only — destination being unwound; ignored for buy/sell
        SettlementMode mode; // buy/rebalance only, Curator-declared; ignored for sell
        bool executed;
        bool cancelled;
    }

    struct DealData {
        uint256 dealValue; // current value of this order's deployed capital, 6-decimal USDT
        uint256 updatedAt; // block.timestamp when last updated
        uint256 stalenessWindow; // revert if now - updatedAt > stalenessWindow
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event BuyOrderCreated(uint256 indexed orderId, uint256 amount, address destination, uint8 mode, uint256 timestamp);
    event SellOrderCreated(uint256 indexed orderId, uint256 amount, uint256 timestamp);
    event RebalanceOrderCreated(
        uint256 indexed orderId, uint256 amount, address source, address destination, uint8 mode, uint256 timestamp
    );
    event BuyOrderExecuted(uint256 indexed orderId, uint256 timestamp);
    event SellOrderExecuted(uint256 indexed orderId, uint256 timestamp);
    event RebalanceOrderExecuted(uint256 indexed orderId, uint256 timestamp);
    event OrderCancelled(uint256 indexed orderId, uint8 orderType, uint256 timestamp); // 0=buy, 1=sell, 2=rebalance
    event DealDataUpdated(uint256 indexed orderId, uint256 newValue, uint256 timestamp);
    event DealValueCleared(uint256 indexed orderId, uint256 timestamp);
    event CapitalDeployed(address indexed destination, uint256 amount, uint256 timestamp);
    event CapitalRecalled(uint256 amount, uint256 timestamp);
    event AllocatorFrozen(address indexed actor, uint256 timestamp);
    event AllocatorUnfrozen(address indexed actor, uint256 timestamp);
    event DataProviderSet(address indexed provider, uint256 timestamp);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error NotCurator();
    error NotAllocator();
    error NotCuratorOrGuardian();
    error NotDataProvider();
    error NotGuardian();
    error OrderDoesNotExist(uint256 orderId);
    error OrderAlreadyExecuted(uint256 orderId);
    error OrderAlreadyCancelled(uint256 orderId);
    error StaleAdapterData(uint256 lastUpdated, uint256 stalenessWindow);
    error InsufficientAdapterBalance(uint256 balance, uint256 requested);
    error WrongSettlementMode(uint256 orderId, uint8 expected, uint8 actual);
    error AllocatorIsFrozen();

    // -----------------------------------------------------------------------
    // Curator order book
    // -----------------------------------------------------------------------

    function createBuyOrder(uint256 amount, address destination, SettlementMode mode)
        external
        returns (uint256 orderId);
    function createSellOrder(uint256 amount) external returns (uint256 orderId);
    function createRebalanceOrder(uint256 amount, address source, address destination, SettlementMode mode)
        external
        returns (uint256 orderId);

    function cancelBuyOrder(uint256 orderId) external;
    function cancelSellOrder(uint256 orderId) external;
    function cancelRebalanceOrder(uint256 orderId) external;

    // -----------------------------------------------------------------------
    // Allocator execution
    // -----------------------------------------------------------------------

    function executeBuy(uint256 orderId) external;
    function executeSell(uint256 orderId) external;
    function executeRebalance(uint256 orderId) external;

    // -----------------------------------------------------------------------
    // Emergency freeze (GUARDIAN_ROLE) — halts Allocator execution only; Curator order
    // creation/cancellation is unaffected.
    // -----------------------------------------------------------------------

    /// @notice Halt `executeBuy`/`executeSell`/`executeRebalance`. Access: this Vault's Guardian.
    function freezeAllocator() external;

    /// @notice Lift an Allocator freeze. Access: this Vault's Curator.
    function unfreezeAllocator() external;

    function allocatorFrozen() external view returns (bool);

    // -----------------------------------------------------------------------
    // Valuation
    // -----------------------------------------------------------------------

    function realAssets() external view returns (uint256);
    function updateDealData(uint256 orderId, uint256 newValue) external;
    function clearDealValue(uint256 orderId) external;
    function setStalenessWindow(uint256 window) external;

    /// @notice Sets this Adapter's off-chain valuation data provider. Access: this Vault's Curator.
    function setDataProvider(address provider) external;

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function buyOrders(uint256 orderId)
        external
        view
        returns (uint256 amount, address destination, address source, SettlementMode mode, bool executed, bool cancelled);
    function sellOrders(uint256 orderId)
        external
        view
        returns (uint256 amount, address destination, address source, SettlementMode mode, bool executed, bool cancelled);
    function rebalanceOrders(uint256 orderId)
        external
        view
        returns (uint256 amount, address destination, address source, SettlementMode mode, bool executed, bool cancelled);
    function pendingDeposits(uint256 orderId)
        external
        view
        returns (uint256 dealValue, uint256 updatedAt, uint256 stalenessWindow);
    function vault() external view returns (address);
}
