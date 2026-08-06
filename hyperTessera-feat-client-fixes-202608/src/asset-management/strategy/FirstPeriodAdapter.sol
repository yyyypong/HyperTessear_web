// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAdapter} from "./BaseAdapter.sol";

/// @title FirstPeriodAdapter
/// @notice Concrete BaseAdapter for the Cash and Note EarnVaults — no overrides. realAssets()
///         uses BaseAdapter's default (sum of live pendingDeposits). (development-plan §3.4.1)
contract FirstPeriodAdapter is BaseAdapter {
    constructor(IERC20 asset_, address vault_, uint256 stalenessWindow_)
        BaseAdapter(asset_, vault_, stalenessWindow_, "FirstPeriod Adapter Share", "fpaShare")
    {}
}
