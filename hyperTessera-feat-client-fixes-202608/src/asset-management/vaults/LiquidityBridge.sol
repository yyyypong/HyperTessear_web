// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILiquidityBridge} from "../../interfaces/ILiquidityBridge.sol";
import {IVaultRoles} from "../../interfaces/IVaultRoles.sol";
import {IEarnVault} from "../../interfaces/IEarnVault.sol";

/// @title LiquidityBridge
/// @notice Stateless bridge — deposits USDT from `fromVault` into `toVault` using the
///         synchronous ERC-4626 deposit surface and returns resulting shares directly to
///         `fromVault`. Does NOT custody shares.
///         Access: `fromVault`'s own Allocator, or `fromVault` itself.
///         (development-plan §3.3.1 — LiquidityBridge [REDESIGNED 2026-07-01]; 角色权限与职责修改
///         方案 §12.4 A-05)
contract LiquidityBridge is ILiquidityBridge {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    address public usdt;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address usdt_) {
        if (usdt_ == address(0)) revert ZeroAddress();
        usdt = usdt_;
    }

    // -----------------------------------------------------------------------
    // Bridge
    // -----------------------------------------------------------------------

    /// @inheritdoc ILiquidityBridge
    function bridgeDeposit(
        uint256 assets,
        address fromVault,
        address toVault
    ) external returns (uint256 shares) {
        if (assets == 0) revert ZeroAssets();
        if (fromVault == address(0) || toVault == address(0)) revert ZeroAddress();

        // Access: fromVault itself (called from within LiquidityEarnVault.settle) or fromVault's own
        // Allocator. Short-circuited: the allocator() external call only runs when the cheaper
        // self-call check fails, so a non-vault fromVault doesn't break the self-call path.
        if (msg.sender != fromVault && IVaultRoles(fromVault).allocator() != msg.sender) {
            revert CallerNotAuthorized(msg.sender);
        }

        // Pull USDT from fromVault
        IERC20(usdt).safeTransferFrom(fromVault, address(this), assets);

        // Approve toVault to spend USDT
        IERC20(usdt).forceApprove(toVault, assets);

        // Sync deposit into toVault; shares go directly to fromVault
        shares = IEarnVault(toVault).deposit(assets, fromVault);

        emit DepositBridged(fromVault, toVault, assets, shares, block.timestamp);
    }
}
