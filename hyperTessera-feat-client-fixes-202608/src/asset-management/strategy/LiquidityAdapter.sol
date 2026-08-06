// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseAdapter} from "./BaseAdapter.sol";
import {IAdapter} from "../../interfaces/IAdapter.sol";
import {ILiquidityAdapter} from "../../interfaces/ILiquidityAdapter.sol";
import {ILiquidityBridge} from "../../interfaces/ILiquidityBridge.sol";
import {IVaultRoles} from "../../interfaces/IVaultRoles.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";

/// @dev Minimal read surface for the Cash vault's dynamic share pricing (BaseVault.convertToAssets()).
interface ICashVaultSharePrice {
    function convertToAssets(uint256 shares) external view returns (uint256);
}

/// @title LiquidityAdapter
/// @notice Concrete BaseAdapter for the LP EarnVault. Adds the structural, automatic LP→Cash
///         Cash-Token bridging leg (via LiquidityBridge) on top of the inherited Curator/Allocator
///         RWA order book. realAssets() = Cash-Token leg (on-chain measurable) + inherited
///         Recorded Position leg. (development-plan §3.4.1)
contract LiquidityAdapter is BaseAdapter, ILiquidityAdapter {
    using SafeERC20 for IERC20;

    address public override liquidityBridge;
    address public override cashVault;
    uint256 public override cashTokenBalance;

    constructor(IERC20 asset_, address vault_, uint256 stalenessWindow_)
        BaseAdapter(asset_, vault_, stalenessWindow_, "Liquidity Adapter Share", "lqaShare")
    {}

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// @dev Only this Adapter's bound LiquidityEarnVault may bridge — no global SETTLEMENT_ROLE
    ///      path; this Adapter serves exactly one Vault. (角色权限与职责修改方案 S-04)
    function _onlyVault() internal view {
        if (msg.sender != vault) revert NotSettlementOrVault();
    }

    // -----------------------------------------------------------------------
    // Bridge target configuration
    // -----------------------------------------------------------------------

    /// @inheritdoc ILiquidityAdapter
    function setBridgeTarget(address newLiquidityBridge, address newCashVault) external override {
        _onlyCuratorDirectOrTimelock();
        if (newLiquidityBridge == address(0) || newCashVault == address(0)) revert ZeroAddress();
        if (!IStateManager(IVaultRoles(vault).stateManager()).isVaultRegistered(newCashVault)) {
            revert InvalidCashVault(newCashVault);
        }
        liquidityBridge = newLiquidityBridge;
        cashVault = newCashVault;
        emit BridgeTargetSet(newLiquidityBridge, newCashVault, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // LP → Cash bridging
    // -----------------------------------------------------------------------

    /// @inheritdoc ILiquidityAdapter
    function bridgeToCash(uint256 amount) external override returns (uint256 shares) {
        _onlyVault();
        if (liquidityBridge == address(0)) revert BridgeTargetNotSet();

        IERC20(asset()).safeTransferFrom(vault, address(this), amount);
        IERC20(asset()).forceApprove(liquidityBridge, amount);
        shares = ILiquidityBridge(liquidityBridge).bridgeDeposit(amount, address(this), cashVault);
        cashTokenBalance += shares;

        emit BridgedToCash(amount, shares, block.timestamp);
    }

    /// @inheritdoc ILiquidityAdapter
    function recallCashTokens(uint256 shares) external override {
        if (msg.sender != vault) revert NotVault();
        if (cashTokenBalance < shares) revert InsufficientAdapterBalance(cashTokenBalance, shares);

        cashTokenBalance -= shares;
        IERC20(cashVault).safeTransfer(vault, shares);

        emit CashTokensRecalled(shares, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Valuation
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapter
    function realAssets() public view override returns (uint256) {
        uint256 cashLeg = cashVault == address(0)
            ? 0
            : ICashVaultSharePrice(cashVault).convertToAssets(cashTokenBalance);
        return cashLeg + super.realAssets();
    }
}
