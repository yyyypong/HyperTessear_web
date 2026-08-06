// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ILiquidityBridge
/// @notice Stateless bridge that deposits USDT from one vault into another ERC-4626 vault
///         using the synchronous deposit surface and forwards resulting shares to fromVault.
///         (development-plan §3.3.1 — LiquidityBridge)
interface ILiquidityBridge {
    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event DepositBridged(
        address indexed fromVault,
        address indexed toVault,
        uint256 assets,
        uint256 shares,
        uint256 timestamp
    );

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error CallerNotAuthorized(address caller);
    error ZeroAssets();
    error ZeroAddress();

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    /// @notice Transfers `assets` USDT from `fromVault`, deposits into `toVault`
    ///         synchronously (standard ERC-4626 deposit), returns resulting shares
    ///         directly to `fromVault`.
    /// @param  assets    USDT amount (6-decimal)
    /// @param  fromVault vault providing USDT and receiving resulting shares
    /// @param  toVault   target ERC-4626 vault to deposit into
    /// @return shares    minted to fromVault by toVault
    function bridgeDeposit(
        uint256 assets,
        address fromVault,
        address toVault
    ) external returns (uint256 shares);
}
