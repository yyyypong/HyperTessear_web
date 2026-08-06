// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVaultTimelock} from "../interfaces/IVaultTimelock.sol";
import {IVaultRoles} from "../interfaces/IVaultRoles.sol";
import {IBaseVault} from "../interfaces/IBaseVault.sol";
import {IStateManager} from "../interfaces/IStateManager.sol";
import {ProductState} from "../libs/Types.sol";

/// @title VaultTimelock
/// @notice One instance per Vault, deployed and bound by VaultFactory; never rebindable to a
///         different Vault. Delay-queues Owner-class and Curator-class parameter changes behind
///         a per-target-and-selector whitelist. Replaces the global ProtocolTimelock: the
///         protocol layer runs no Timelock of its own. (角色权限与职责修改方案 §6)
contract VaultTimelock is IVaultTimelock {
    // -----------------------------------------------------------------------
    // Delay bounds
    // -----------------------------------------------------------------------

    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant DEFAULT_DELAY = 48 hours;
    uint256 public constant EXECUTION_WINDOW = 7 days;

    // -----------------------------------------------------------------------
    // Immutables
    // -----------------------------------------------------------------------

    /// @inheritdoc IVaultTimelock
    address public immutable override vault;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    struct PendingChange {
        address target;
        bytes data;
        address proposer;
        uint256 executableAfter;
        uint256 expiresAt;
        bool executed;
        bool cancelled;
    }

    /// @inheritdoc IVaultTimelock
    uint256 public override delay;

    /// @inheritdoc IVaultTimelock
    uint256 public override changeNonce;

    mapping(bytes32 changeId => PendingChange) public pendingChanges;

    /// @inheritdoc IVaultTimelock
    mapping(address target => mapping(bytes4 selector => mapping(ActionClass class => bool))) public override isActionAllowed;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param vault_ The Vault this Timelock is permanently bound to.
    /// @dev    Pre-seeds the whitelist for the fixed set of BaseVault/self targets known at deploy
    ///         time (角色权限与职责修改方案 §6.4). Adapter-specific targets are not known yet at this
    ///         point — the Vault Owner whitelists those directly while the Vault is still
    ///         CONFIGURING (see `setAllowedAction`), mirroring the same direct-during-CONFIGURING /
    ///         Timelock-gated-after pattern used throughout the rest of the Vault's own parameter
    ///         surface. NAVOracle is no longer Vault-governed at all (NAVOracle/RWAAdapter redesign).
    constructor(address vault_) {
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        delay = DEFAULT_DELAY;

        isActionAllowed[vault_][IBaseVault.setSettlement.selector][ActionClass.OWNER] = true;
        isActionAllowed[vault_][IBaseVault.setUnifiedPool.selector][ActionClass.OWNER] = true;
        isActionAllowed[vault_][IBaseVault.setGate.selector][ActionClass.OWNER] = true;
        isActionAllowed[vault_][IBaseVault.writeDownInsolvency.selector][ActionClass.OWNER] = true;
        isActionAllowed[address(this)][this.setDelay.selector][ActionClass.OWNER] = true;
        isActionAllowed[address(this)][this.setAllowedAction.selector][ActionClass.OWNER] = true;

        isActionAllowed[vault_][IBaseVault.setPerformanceFeeBps.selector][ActionClass.CURATOR] = true;
        isActionAllowed[vault_][IBaseVault.setPerformanceFeeRecipient.selector][ActionClass.CURATOR] = true;
        isActionAllowed[vault_][IBaseVault.addAdapter.selector][ActionClass.CURATOR] = true;
        isActionAllowed[vault_][IBaseVault.removeAdapter.selector][ActionClass.CURATOR] = true;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _isConfiguring() internal view returns (bool) {
        address sm = IVaultRoles(vault).stateManager();
        return IStateManager(sm).getProductState(vault) == ProductState.CONFIGURING;
    }

    // -----------------------------------------------------------------------
    // scheduleParamChange
    // -----------------------------------------------------------------------

    /// @inheritdoc IVaultTimelock
    function scheduleParamChange(address target, bytes calldata data) external override returns (bytes32 changeId) {
        if (target == address(0)) revert ZeroAddress();

        IVaultRoles roles = IVaultRoles(vault);
        ActionClass class;
        if (msg.sender == roles.owner()) {
            class = ActionClass.OWNER;
        } else if (msg.sender == roles.curator()) {
            class = ActionClass.CURATOR;
        } else {
            revert NotOwnerOrCurator();
        }

        bytes4 selector = bytes4(data);
        if (!isActionAllowed[target][selector][class]) revert ActionNotAllowed(target, selector);

        changeId = keccak256(abi.encode(address(this), block.chainid, vault, target, data, changeNonce));
        changeNonce += 1;

        uint256 executableAfter = block.timestamp + delay;
        uint256 expiresAt = executableAfter + EXECUTION_WINDOW;
        pendingChanges[changeId] = PendingChange({
            target: target,
            data: data,
            proposer: msg.sender,
            executableAfter: executableAfter,
            expiresAt: expiresAt,
            executed: false,
            cancelled: false
        });

        emit ParamChangeScheduled(changeId, target, data, executableAfter, expiresAt);
    }

    // -----------------------------------------------------------------------
    // executeParamChange
    // -----------------------------------------------------------------------

    /// @inheritdoc IVaultTimelock
    function executeParamChange(bytes32 changeId) external override {
        PendingChange storage c = pendingChanges[changeId];

        if (c.executableAfter == 0) revert EntryNotFound();
        if (c.executed) revert AlreadyExecuted();
        if (c.cancelled) revert AlreadyCancelled();
        if (block.timestamp < c.executableAfter) revert TooEarly();
        if (block.timestamp > c.expiresAt) revert Expired();

        c.executed = true;

        (bool success,) = c.target.call(c.data);
        if (!success) revert CallFailed();

        emit ParamChangeExecuted(changeId, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // cancelParamChange
    // -----------------------------------------------------------------------

    /// @inheritdoc IVaultTimelock
    function cancelParamChange(bytes32 changeId) external override {
        PendingChange storage c = pendingChanges[changeId];
        if (c.executableAfter == 0) revert EntryNotFound();
        if (c.executed) revert AlreadyExecuted();
        if (c.cancelled) revert AlreadyCancelled();

        IVaultRoles roles = IVaultRoles(vault);
        if (msg.sender != roles.owner() && msg.sender != roles.guardian() && msg.sender != c.proposer) {
            revert NotOwnerOrGuardianOrProposer();
        }

        c.cancelled = true;

        emit ParamChangeCancelled(changeId, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Self-scheduled configuration
    // -----------------------------------------------------------------------

    /// @inheritdoc IVaultTimelock
    function setDelay(uint256 newDelay) external override {
        if (msg.sender != address(this)) revert NotSelf();
        if (newDelay < MIN_DELAY || newDelay > MAX_DELAY) revert DelayOutOfRange();

        uint256 oldDelay = delay;
        delay = newDelay;

        emit DelayUpdated(oldDelay, newDelay, block.timestamp);
    }

    /// @inheritdoc IVaultTimelock
    function setAllowedAction(address target, bytes4 selector, ActionClass class, bool allowed) external override {
        bool isSelf = msg.sender == address(this);
        bool isOwnerBootstrapping = !isSelf && msg.sender == IVaultRoles(vault).owner() && _isConfiguring();
        if (!isSelf && !isOwnerBootstrapping) revert NotSelf();

        isActionAllowed[target][selector][class] = allowed;
        emit AllowedActionSet(target, selector, class, allowed, block.timestamp);
    }
}
