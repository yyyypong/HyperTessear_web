// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseVault} from "./BaseVault.sol";
import {IEarnVault} from "../../interfaces/IEarnVault.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";

/// @title EarnVault
/// @notice Unified Cash / Note tranche vault parameterized by cycleDuration.
///         - Cash tranche: cycleDuration = 7 days; exposes sync ERC-4626 deposit for LiquidityBridge.
///         - Note tranche: cycleDuration = 365 days; no sync deposit; liquidityBridge = address(0).
///         (development-plan §3.3.1 — EarnVault)
contract EarnVault is BaseVault, IEarnVault {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    address public liquidityBridge; // set once at deploy; only caller allowed on sync deposit

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
        address liquidityBridge_   // address(0) for Note tranche
    ) BaseVault(name_, symbol_, usdt_, stateManager_, queue_, owner_) {
        liquidityBridge = liquidityBridge_;
    }

    // -----------------------------------------------------------------------
    // Sync ERC-4626 deposit (Cash tranche — LiquidityBridge only)
    // -----------------------------------------------------------------------

    /// @inheritdoc IEarnVault
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (msg.sender != liquidityBridge) revert OnlyLiquidityBridge(msg.sender);
        if (assets == 0) revert ZeroAssets();
        IStateManager(stateManager).requireActive(address(this));

        IERC20(usdt).safeTransferFrom(msg.sender, address(this), assets);

        shares = convertToShares(assets);
        _mintShares(receiver, shares);

        emit SyncDeposit(receiver, assets, shares, block.timestamp);
    }

}
