// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAdapterFactory {
    struct AdapterParams {
        address asset; // USDT
        address vault; // EarnVault this adapter serves
        uint256 stalenessWindow; // pendingDeposits staleness window; default 36h
    }

    struct RWAAdapterParams {
        address asset; // Vault's accounting asset
        address vault; // EarnVault this adapter serves, fixed at deploy
        address rwaToken; // RWA Token this adapter values, fixed at deploy
        address navOracle; // NAVOracle instance queried for rwaToken's price, fixed at deploy
        uint256 dealDataStalenessWindow; // BaseAdapter's existing pending-deal staleness window
    }

    event AdapterDeployed(address indexed adapter, address indexed vault, uint256 timestamp);

    error ZeroAddress();
    error InvalidAdapterParams();

    function deployAdapter(AdapterParams calldata params) external returns (address adapter);
    function deployLiquidityAdapter(AdapterParams calldata params) external returns (address adapter);
    function deployRWAAdapter(RWAAdapterParams calldata params) external returns (address adapter);

    function isAdapter(address adapter) external view returns (bool);
}
