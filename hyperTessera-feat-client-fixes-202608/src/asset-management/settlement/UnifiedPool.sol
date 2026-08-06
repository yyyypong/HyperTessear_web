// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IUnifiedPool} from "../../interfaces/IUnifiedPool.sol";
import {IRevenuePool} from "../../interfaces/IRevenuePool.sol";
import {IHyperAccessControl} from "../../interfaces/IHyperAccessControl.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";
import {IVaultRoles} from "../../interfaces/IVaultRoles.sol";
import {IBaseVault} from "../../interfaces/IBaseVault.sol";
import {ISettlement} from "../../interfaces/ISettlement.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Tranche} from "../../libs/Types.sol";

/// @title UnifiedPool
/// @notice Per-Vault USDT receivable ledger and real-cash pool (net settlement conversion,
///         development-plan §8). `pending[vault]` is an application-level receivable, not a
///         cash reservation — the pool's actual USDT balance (`cashBalance`) can be lower than
///         `totalPending` at any time; `distribute`/`availableToDistribute` are bounded by
///         actual cash, not just the ledger. No fee computation (BaseVault charges performance
///         fees as shares instead), no PSM coupling, no accounting-only `credit`.
///
///         UUPS upgradeable: deployed behind an ERC1967Proxy; upgrades gated to GOVERNOR_ROLE.
contract UnifiedPool is IUnifiedPool, Initializable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    IHyperAccessControl public ac;
    IStateManager public sm;
    IERC20 public override usdt;

    /// @notice Per-vault USDT receivable; not a cash reservation.
    mapping(address vault => uint256) public override pending;
    uint256 public override totalPending;

    /// @notice Deposited but not yet attributed to any specific Vault's pending (SET-06: a payer
    ///         no longer fixes Vault attribution at deposit time — that Vault's own Settlement
    ///         Operator decides later, via attributeInterest/attributePrincipal).
    uint256 public override unattributedInterest;
    uint256 public override unattributedPrincipal;

    mapping(Tranche => address[]) private _trancheVaults;
    mapping(Tranche => mapping(address => bool)) public override isTrancheVault;
    mapping(address => Tranche) public override vaultTranche;
    mapping(address => bool) public override vaultConfigured;
    mapping(address => bool) public override vaultActive;

    // -----------------------------------------------------------------------
    // Reentrancy guard (proxy-safe)
    // -----------------------------------------------------------------------

    /// @dev openzeppelin-contracts-upgradeable isn't a dependency of this repo, so this mirrors
    ///      ReentrancyGuardUpgradeable's pattern locally: OZ's plain `ReentrancyGuard` sets its
    ///      sentinel in a constructor, which never runs against a proxy's storage. Explicitly
    ///      initialized in `initialize()` below rather than relying on the zero-value default.
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    error ReentrancyGuardReentrantCall();

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrancyGuardReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    /// @dev Reserved storage for future upgrades (this contract's fields end above this slot).
    uint256[47] private __gap;

    // -----------------------------------------------------------------------
    // Constructor / Initializer
    // -----------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address usdt_, address stateManager_, address accessControl_) external initializer {
        if (usdt_ == address(0) || stateManager_ == address(0) || accessControl_ == address(0)) {
            revert ZeroAddress();
        }
        usdt = IERC20(usdt_);
        sm = IStateManager(stateManager_);
        ac = IHyperAccessControl(accessControl_);
        _reentrancyStatus = _NOT_ENTERED;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _onlyGovernor() internal view {
        if (!ac.hasRole(ac.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
    }

    function _onlyVaultOwner(address vault) internal view {
        if (IVaultRoles(vault).owner() != msg.sender) revert NotVaultOwner();
    }

    function _onlySettlementOperator(address vault) internal view {
        address settlement_ = IBaseVault(vault).settlement();
        if (!ISettlement(settlement_).isOperator(vault, msg.sender)) revert NotSettlementOperator(vault);
    }

    function _requireConfiguredActive(address vault) internal view {
        if (!vaultConfigured[vault]) revert VaultNotConfigured(vault);
        if (!vaultActive[vault]) revert VaultInactive(vault);
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override {
        _onlyGovernor();
    }

    // -----------------------------------------------------------------------
    // Vault registration
    // -----------------------------------------------------------------------

    /// @inheritdoc IUnifiedPool
    function addTrancheVault(Tranche tranche, address vault) external override {
        if (vault == address(0)) revert ZeroAddress();
        _onlyVaultOwner(vault);
        if (vaultConfigured[vault]) revert VaultAlreadyConfigured(vault);

        _trancheVaults[tranche].push(vault);
        isTrancheVault[tranche][vault] = true;
        vaultTranche[vault] = tranche;
        vaultConfigured[vault] = true;
        vaultActive[vault] = true;

        emit TrancheVaultAdded(tranche, vault, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function deactivateTrancheVault(address vault) external override {
        _onlyVaultOwner(vault);
        _requireConfiguredActive(vault);
        vaultActive[vault] = false;
        emit TrancheVaultDeactivated(vault, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function reactivateTrancheVault(address vault) external override {
        _onlyVaultOwner(vault);
        if (!vaultConfigured[vault]) revert VaultNotConfigured(vault);
        if (vaultActive[vault]) return;
        vaultActive[vault] = true;
        emit TrancheVaultReactivated(vault, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function getTrancheVaults(Tranche tranche) external view override returns (address[] memory) {
        return _trancheVaults[tranche];
    }

    // -----------------------------------------------------------------------
    // Real USDT inflows
    // -----------------------------------------------------------------------

    /// @inheritdoc IUnifiedPool
    function repayInterest(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        unattributedInterest += amount;

        emit InterestDeposited(msg.sender, amount, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function repayPrincipal(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        unattributedPrincipal += amount;

        emit PrincipalDeposited(msg.sender, amount, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function attributeInterest(address vault, uint256 amount) external override {
        _onlySettlementOperator(vault);
        if (amount == 0) revert ZeroAmount();
        _requireConfiguredActive(vault);
        if (amount > unattributedInterest) revert InsufficientUnattributedInterest(unattributedInterest, amount);

        unattributedInterest -= amount;
        pending[vault] += amount;
        totalPending += amount;

        emit InterestRepaid(vaultTranche[vault], vault, amount, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function attributePrincipal(address vault, uint256 amount) external override {
        _onlySettlementOperator(vault);
        if (amount == 0) revert ZeroAmount();
        _requireConfiguredActive(vault);
        if (amount > unattributedPrincipal) revert InsufficientUnattributedPrincipal(unattributedPrincipal, amount);

        unattributedPrincipal -= amount;
        pending[vault] += amount;
        totalPending += amount;

        emit PrincipalRepaid(vault, amount, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function receiveVaultPrincipal(uint256 amount) external override nonReentrant {
        if (!sm.registeredVaults(msg.sender)) revert UnregisteredVault(msg.sender);
        if (amount == 0) revert ZeroAmount();
        _requireConfiguredActive(msg.sender);

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        pending[msg.sender] += amount;
        totalPending += amount;

        emit VaultPrincipalReceived(msg.sender, amount, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Distribution
    // -----------------------------------------------------------------------

    /// @inheritdoc IUnifiedPool
    function distribute(address vault, uint256 amount) external override nonReentrant {
        if (msg.sender != IBaseVault(vault).settlement()) revert NotVaultSettlement(vault);
        if (!vaultConfigured[vault]) revert VaultNotConfigured(vault);

        uint256 p = pending[vault];
        if (p < amount) revert InsufficientPending(vault, p, amount);
        uint256 cashBalance = usdt.balanceOf(address(this));
        if (cashBalance < amount) revert InsufficientCash(cashBalance, amount);

        pending[vault] = p - amount;
        totalPending -= amount;
        usdt.safeTransfer(vault, amount);

        emit Distributed(vault, amount, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function availableToDistribute(address vault) external view override returns (uint256) {
        uint256 p = pending[vault];
        uint256 cashBalance = usdt.balanceOf(address(this));
        return p < cashBalance ? p : cashBalance;
    }

    // -----------------------------------------------------------------------
    // Operator third-party transfers
    // -----------------------------------------------------------------------

    /// @inheritdoc IUnifiedPool
    function operatorTransfer(address vault, address recipient, uint256 amount, bytes32 referenceId)
        external
        override
        nonReentrant
    {
        _onlySettlementOperator(vault);
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();

        usdt.safeTransfer(recipient, amount);
        emit ThirdPartyTransferExecuted(vault, msg.sender, recipient, amount, referenceId, block.timestamp);
    }

    /// @inheritdoc IUnifiedPool
    function operatorTransferToRevenuePool(address vault, address revenuePool, uint256 amount, bytes32 referenceId)
        external
        override
        nonReentrant
    {
        _onlySettlementOperator(vault);
        if (revenuePool == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();

        usdt.safeTransfer(revenuePool, amount);
        IRevenuePool(revenuePool).receiveFee(amount);

        emit ThirdPartyTransferExecuted(vault, msg.sender, revenuePool, amount, referenceId, block.timestamp);
    }
}
