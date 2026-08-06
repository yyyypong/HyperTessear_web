// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAdapterRegistry} from "../../interfaces/IAdapterRegistry.sol";

/// @title AdapterRegistry
/// @notice Minimal whitelist of Adapter implementations. Anyone may deploy their own instance and
///         manage it independently; there is no protocol-global ADAPTER_ROLE.
///         (角色权限与职责修改方案 §10)
contract AdapterRegistry is IAdapterRegistry {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapterRegistry
    address public override registryOwner;

    /// @inheritdoc IAdapterRegistry
    mapping(address adapter => bool) public override isAllowed;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        registryOwner = owner_;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _onlyRegistryOwner() internal view {
        if (msg.sender != registryOwner) revert NotRegistryOwner();
    }

    // -----------------------------------------------------------------------
    // Mutating functions
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapterRegistry
    function setAdapterAllowed(address adapter, bool allowed) external override {
        _onlyRegistryOwner();
        if (adapter == address(0)) revert ZeroAddress();
        isAllowed[adapter] = allowed;
        emit AdapterAllowedSet(adapter, allowed, block.timestamp);
    }

    /// @inheritdoc IAdapterRegistry
    function transferRegistryOwnership(address newOwner) external override {
        _onlyRegistryOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        address old = registryOwner;
        registryOwner = newOwner;
        emit RegistryOwnershipTransferred(old, newOwner, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// @inheritdoc IAdapterRegistry
    function isAdapterAllowed(address adapter) external view override returns (bool) {
        return isAllowed[adapter];
    }
}
