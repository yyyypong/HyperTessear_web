// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IAdapterRegistry
/// @notice Minimal Adapter implementation whitelist. A Vault fixes its bound Registry at deploy
///         time (never rebindable); a Vault Owner may point their Vault at the officially shared
///         Registry, or deploy and manage their own. A Vault's Curator may only `addAdapter` an
///         implementation this Registry has whitelisted. (角色权限与职责修改方案 §10)
interface IAdapterRegistry {
    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event AdapterAllowedSet(address indexed adapter, bool allowed, uint256 timestamp);
    event RegistryOwnershipTransferred(address indexed oldOwner, address indexed newOwner, uint256 timestamp);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error NotRegistryOwner();
    error ZeroAddress();

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    function registryOwner() external view returns (address);
    function isAllowed(address adapter) external view returns (bool);

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    function setAdapterAllowed(address adapter, bool allowed) external;
    function isAdapterAllowed(address adapter) external view returns (bool);
    function transferRegistryOwnership(address newOwner) external;
}
