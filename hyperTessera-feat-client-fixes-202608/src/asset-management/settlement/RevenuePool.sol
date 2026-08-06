// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IRevenuePool} from "../../interfaces/IRevenuePool.sol";
import {IHyperAccessControl} from "../../interfaces/IHyperAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RevenuePool
/// @notice Protocol fee sink. Any Governor-authorised source may deposit fees;
///         only GOVERNOR_ROLE can sweep funds to a recipient. (development-plan §3.2.1)
///
///         Multi-source: Governor adds/removes authorised source addresses via
///         addAuthorizedSource / removeAuthorizedSource, supporting future products.
contract RevenuePool is IRevenuePool {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    IHyperAccessControl public immutable ac;
    IERC20 public immutable usdt;

    mapping(address => bool) public override authorizedSources;
    uint256 public override totalFeesReceived;

    /// @dev Phase 1 interface reservation only (development-plan §7) — no-op, default address(0).
    address public override yieldStrategy;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address _usdt, address _ac) {
        if (_usdt == address(0) || _ac == address(0)) revert ZeroAddress();
        usdt = IERC20(_usdt);
        ac = IHyperAccessControl(_ac);
    }

    // -----------------------------------------------------------------------
    // Native currency
    // -----------------------------------------------------------------------

    receive() external payable {}

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _onlyGovernor() internal view {
        if (!ac.hasRole(ac.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
    }

    // -----------------------------------------------------------------------
    // Mutating functions
    // -----------------------------------------------------------------------

    /// @inheritdoc IRevenuePool
    function receiveFee(uint256 amount) external override {
        if (!authorizedSources[msg.sender]) revert UnauthorizedFeeSource(msg.sender);

        // Caller must have transferred USDT to this contract before calling.
        // We verify by checking the contract's balance covers the claim.
        uint256 bal = usdt.balanceOf(address(this));
        if (bal < amount) revert InsufficientBalance(bal, amount);

        totalFeesReceived += amount;

        emit FeeReceived(msg.sender, amount, block.timestamp);
    }

    /// @inheritdoc IRevenuePool
    function withdraw(address recipient, uint256 amount) external override {
        _onlyGovernor();
        uint256 bal = usdt.balanceOf(address(this));
        if (bal < amount) revert InsufficientBalance(bal, amount);

        usdt.safeTransfer(recipient, amount);

        emit FeeWithdrawn(recipient, amount, block.timestamp);
    }

    /// @inheritdoc IRevenuePool
    function withdrawToken(address token, address to, uint256 amount) external override {
        _onlyGovernor();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokenWithdrawn(token, to, amount, block.timestamp);
    }

    /// @inheritdoc IRevenuePool
    function withdrawNative(address to, uint256 amount) external override {
        _onlyGovernor();
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit NativeWithdrawn(to, amount, block.timestamp);
    }

    /// @inheritdoc IRevenuePool
    function addAuthorizedSource(address source) external override {
        _onlyGovernor();
        if (source == address(0)) revert ZeroAddress();
        authorizedSources[source] = true;
        emit SourceAuthorized(source, block.timestamp);
    }

    /// @inheritdoc IRevenuePool
    function removeAuthorizedSource(address source) external override {
        _onlyGovernor();
        authorizedSources[source] = false;
        emit SourceRevoked(source, block.timestamp);
    }

    /// @inheritdoc IRevenuePool
    function setYieldStrategy(address strategy) external override {
        _onlyGovernor();
        yieldStrategy = strategy;
        emit YieldStrategySet(strategy, block.timestamp);
    }
}
