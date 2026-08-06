// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ILiquidityAdapter
/// @notice LiquidityAdapter-specific additions on top of IAdapter: the structural,
///         automatic LP→Cash Cash-Token bridging leg. (development-plan §3.4.1)
interface ILiquidityAdapter {
    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event BridgeTargetSet(address liquidityBridge, address cashVault, uint256 timestamp);
    event BridgedToCash(uint256 assets, uint256 shares, uint256 timestamp);
    event CashTokensRecalled(uint256 shares, uint256 timestamp);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error BridgeTargetNotSet();
    error NotSettlementOrVault();
    error NotVault();
    error InvalidCashVault(address cashVault);

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    /// @notice This Vault's Curator's initial (and any later) configuration of the LP
    ///         structural bridge target, consistent with Curator owning order destinations
    ///         elsewhere. Required before the first `bridgeToCash` call.
    function setBridgeTarget(address newLiquidityBridge, address newCashVault) external;

    /// @notice Pulls `amount` USDT from the LP vault and bridges it to the Cash vault via
    ///         LiquidityBridge; resulting Cash Tokens land in this adapter's balance.
    ///         Access: the registered `vault` itself only — this Adapter serves exactly one Vault.
    function bridgeToCash(uint256 amount) external returns (uint256 shares);

    /// @notice Releases `shares` Cash Tokens back to the LP vault (exit/maturity distribution).
    ///         Access: `vault` only.
    function recallCashTokens(uint256 shares) external;

    function liquidityBridge() external view returns (address);
    function cashVault() external view returns (address);
    function cashTokenBalance() external view returns (uint256);
}
