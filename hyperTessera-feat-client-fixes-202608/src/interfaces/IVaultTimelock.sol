// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IVaultTimelock
/// @notice Per-Vault delay queue protecting Owner-class and Curator-class parameter changes.
///         Replaces the global ProtocolTimelock — the protocol layer no longer runs a Timelock;
///         every Vault gets its own instance, bound at deploy time and never rebindable.
///         (角色权限与职责修改方案 §6)
interface IVaultTimelock {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /// @notice Which local role may schedule a given (target, selector) pair.
    enum ActionClass {
        OWNER,
        CURATOR
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event ParamChangeScheduled(
        bytes32 indexed changeId, address indexed target, bytes data, uint256 executableAfter, uint256 expiresAt
    );
    event ParamChangeExecuted(bytes32 indexed changeId, uint256 executedAt);
    event ParamChangeCancelled(bytes32 indexed changeId, uint256 cancelledAt);
    event DelayUpdated(uint256 oldDelay, uint256 newDelay, uint256 timestamp);
    event AllowedActionSet(address indexed target, bytes4 indexed selector, ActionClass class, bool allowed, uint256 timestamp);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error NotOwnerOrCurator();
    error NotOwnerOrGuardianOrProposer();
    error NotSelf();
    error ActionNotAllowed(address target, bytes4 selector);
    error EntryNotFound();
    error AlreadyExecuted();
    error AlreadyCancelled();
    error TooEarly();
    error Expired();
    error CallFailed();
    error DelayOutOfRange();

    // -----------------------------------------------------------------------
    // State accessors
    // -----------------------------------------------------------------------

    function vault() external view returns (address);
    function delay() external view returns (uint256);
    function changeNonce() external view returns (uint256);
    function isActionAllowed(address target, bytes4 selector, ActionClass class) external view returns (bool);

    // -----------------------------------------------------------------------
    // Core functions
    // -----------------------------------------------------------------------

    /// @notice Schedules a parameter change. Caller must be the bound Vault's Owner (may submit
    ///         any whitelisted OWNER-class action) or Curator (may submit any whitelisted
    ///         CURATOR-class action); `target`+`selector` must be on the allowed-action whitelist
    ///         for the caller's class.
    function scheduleParamChange(address target, bytes calldata data) external returns (bytes32 changeId);

    /// @notice Executes a previously scheduled change after its delay elapses and before it
    ///         expires. Permissionless — any caller (including a Relayer/Keeper Bot) may execute.
    function executeParamChange(bytes32 changeId) external;

    /// @notice Cancels a pending change. Caller must be the Vault Owner, Vault Guardian, or the
    ///         original proposer.
    function cancelParamChange(bytes32 changeId) external;

    /// @notice Updates this Timelock's own delay. Self-scheduled only (msg.sender == address(this))
    ///         — i.e. must be queued through scheduleParamChange/executeParamChange against the old
    ///         delay like any other change; the Owner cannot shorten or lengthen it instantly.
    function setDelay(uint256 newDelay) external;

    /// @notice Adds/removes a (target, selector) pair from the allowed-action whitelist for a
    ///         given class. Self-scheduled only (msg.sender == address(this)) — the Owner submits
    ///         this through the normal schedule/execute flow, it is never called directly.
    function setAllowedAction(address target, bytes4 selector, ActionClass class, bool allowed) external;
}
