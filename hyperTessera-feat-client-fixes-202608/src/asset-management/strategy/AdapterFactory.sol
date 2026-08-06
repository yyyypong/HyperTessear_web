// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapterFactory} from "../../interfaces/IAdapterFactory.sol";
import {FirstPeriodAdapterDeployer, LiquidityAdapterDeployer, RWAAdapterDeployer} from "./AdapterDeployer.sol";

contract AdapterFactory is IAdapterFactory {
    mapping(address adapter => bool) public override isAdapter;

    FirstPeriodAdapterDeployer public immutable fpaDeployer;
    LiquidityAdapterDeployer public immutable lqaDeployer;
    RWAAdapterDeployer public immutable rwaDeployer;

    constructor() {
        fpaDeployer = new FirstPeriodAdapterDeployer();
        lqaDeployer = new LiquidityAdapterDeployer();
        rwaDeployer = new RWAAdapterDeployer();
    }

    function _validateParams(AdapterParams calldata params) internal pure {
        if (params.asset == address(0) || params.vault == address(0)) {
            revert InvalidAdapterParams();
        }
    }

    function _validateRWAParams(RWAAdapterParams calldata params) internal pure {
        if (
            params.asset == address(0) || params.vault == address(0) || params.rwaToken == address(0)
                || params.navOracle == address(0)
        ) {
            revert InvalidAdapterParams();
        }
    }

    function deployAdapter(AdapterParams calldata params) external override returns (address adapter) {
        _validateParams(params);
        adapter = fpaDeployer.deploy(params.asset, params.vault, params.stalenessWindow);
        isAdapter[adapter] = true;
        emit AdapterDeployed(adapter, params.vault, block.timestamp);
    }

    function deployLiquidityAdapter(AdapterParams calldata params) external override returns (address adapter) {
        _validateParams(params);
        adapter = lqaDeployer.deploy(params.asset, params.vault, params.stalenessWindow);
        isAdapter[adapter] = true;
        emit AdapterDeployed(adapter, params.vault, block.timestamp);
    }

    function deployRWAAdapter(RWAAdapterParams calldata params) external override returns (address adapter) {
        _validateRWAParams(params);
        adapter = rwaDeployer.deploy(
            params.asset, params.vault, params.rwaToken, params.navOracle, params.dealDataStalenessWindow
        );
        isAdapter[adapter] = true;
        emit AdapterDeployed(adapter, params.vault, block.timestamp);
    }
}
