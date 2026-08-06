// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IStateManager} from "../interfaces/IStateManager.sol";
import {IHyperAccessControl} from "../interfaces/IHyperAccessControl.sol";
import {IVaultRoles} from "../interfaces/IVaultRoles.sol";
import {IBaseVault} from "../interfaces/IBaseVault.sol";
import {
    ProductState,
    CycleState,
    PauseState,
    StateContext,
    ProductParams,
    ModuleId
} from "../libs/Types.sol";

/// @title StateManager
/// @notice Three-layer (Product × Cycle × Pause) state machine for HyperTessera vaults.
///         (development-plan §3.3.1)
contract StateManager is IStateManager {
    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    mapping(address vault => StateContext) private _states;
    mapping(address vault => ProductParams) private _params;
    mapping(address vault => uint256) private _totalSubscribed;
    mapping(address vault => mapping(address => uint256)) private _subscribedByWallet;
    mapping(address vault => bool) private _registered;
    mapping(address vault => uint256) private _cycleStart;
    mapping(address vault => bool) private _finalSettlementComplete;
    mapping(ModuleId => bool) private _modulePaused;

    address public accessControl;

    /// @notice Official VaultFactory allowed to call registerVault; set once by GOVERNOR_ROLE.
    address public vaultFactory;

    // -----------------------------------------------------------------------
    // Role constant (read from HyperAccessControl)
    // -----------------------------------------------------------------------

    bytes32 private immutable GOVERNOR_ROLE;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address accessControl_) {
        if (accessControl_ == address(0)) revert ZeroAddress();
        accessControl = accessControl_;
        GOVERNOR_ROLE = IHyperAccessControl(accessControl_).GOVERNOR_ROLE();
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyGovernor() {
        if (!IHyperAccessControl(accessControl).hasRole(GOVERNOR_ROLE, msg.sender)) revert NotGovernor();
        _;
    }

    modifier onlyVaultKeeper(address vault) {
        if (!IVaultRoles(vault).isKeeper(msg.sender)) revert NotKeeper();
        _;
    }

    modifier onlyVaultSettlement(address vault) {
        if (msg.sender != IBaseVault(vault).settlement()) revert NotSettlement();
        _;
    }

    modifier onlyRegistered(address vault) {
        if (!_registered[vault]) revert VaultNotRegistered(vault);
        _;
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    /// @inheritdoc IStateManager
    function setVaultFactory(address factory) external onlyGovernor {
        if (vaultFactory != address(0)) revert VaultFactoryAlreadySet();
        if (factory == address(0)) revert ZeroAddress();
        vaultFactory = factory;
    }

    function registerVault(address vault, ProductState initialProduct, CycleState initialCycle) external {
        if (msg.sender != vaultFactory) revert NotVaultFactory();
        if (vault == address(0)) revert ZeroAddress();
        if (_registered[vault]) revert VaultAlreadyRegistered(vault);

        _registered[vault] = true;
        _states[vault] = StateContext({
            product:            initialProduct,
            cycle:              initialCycle,
            pause:              PauseState.ACTIVE,
            currentCycleNumber: 0
        });
        _cycleStart[vault] = block.timestamp;

        emit VaultRegistered(vault, initialProduct, initialCycle, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Product params
    // -----------------------------------------------------------------------

    function setProductParams(address vault, ProductParams calldata params)
        external
        onlyRegistered(vault)
    {
        if (IVaultRoles(vault).curator() != msg.sender) revert Unauthorized();
        if (_states[vault].product != ProductState.CONFIGURING) {
            revert WrongProductState(ProductState.CONFIGURING, _states[vault].product);
        }
        _params[vault] = params;
        emit ProductParamsSet(vault, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Subscription tracking
    // -----------------------------------------------------------------------

    /// @dev subscriptionCap/walletSubscriptionCap gate only the initial raise window
    ///      (ProductState.SUBSCRIBING). Recurring per-cycle deposits during
    ///      OPERATING+ACCEPTING are not subject to the initial-raise cap, since
    ///      _totalSubscribed/_subscribedByWallet are never decremented on settlement
    ///      and would otherwise permanently lock out deposits after the cap is first hit.
    function recordSubscription(address vault, address wallet, uint256 amount)
        external
        onlyRegistered(vault)
    {
        if (msg.sender != vault) revert Unauthorized();
        if (_states[vault].product != ProductState.SUBSCRIBING) return;

        ProductParams storage p = _params[vault];
        uint256 newTotal  = _totalSubscribed[vault] + amount;
        uint256 newWallet = _subscribedByWallet[vault][wallet] + amount;
        if (p.subscriptionCap > 0 && newTotal > p.subscriptionCap) {
            revert SubscriptionCapExceeded(p.subscriptionCap, newTotal);
        }
        if (p.walletSubscriptionCap > 0 && newWallet > p.walletSubscriptionCap) {
            revert WalletCapExceeded(wallet, p.walletSubscriptionCap, newWallet);
        }
        _totalSubscribed[vault] = newTotal;
        _subscribedByWallet[vault][wallet] = newWallet;
    }

    function releaseSubscription(address vault, address wallet, uint256 amount)
        external
        onlyRegistered(vault)
    {
        if (msg.sender != vault) revert Unauthorized();
        uint256 totalSub  = _totalSubscribed[vault];
        uint256 walletSub = _subscribedByWallet[vault][wallet];
        _totalSubscribed[vault]            = totalSub  > amount ? totalSub  - amount : 0;
        _subscribedByWallet[vault][wallet] = walletSub > amount ? walletSub - amount : 0;
    }

    // -----------------------------------------------------------------------
    // Lifecycle — Keeper / Curator
    // -----------------------------------------------------------------------

    function openSubscription(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.CONFIGURING) {
            revert InvalidStateTransition(s.product, ProductState.SUBSCRIBING);
        }
        ProductParams storage p = _params[vault];
        if (block.timestamp < p.subscriptionStart) {
            revert ConditionNotMet("subscriptionStart not reached");
        }
        emit ProductStateChanged(vault, s.product, ProductState.SUBSCRIBING, block.timestamp);
        s.product = ProductState.SUBSCRIBING;
    }

    function finalizeSubscription(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.SUBSCRIBING) {
            revert WrongProductState(ProductState.SUBSCRIBING, s.product);
        }
        ProductParams storage p = _params[vault];
        if (block.timestamp < p.subscriptionEnd) {
            revert ConditionNotMet("subscriptionEnd not reached");
        }

        ProductState next;
        if (_totalSubscribed[vault] >= p.minRaiseAmount) {
            next = ProductState.OPERATING;
            _cycleStart[vault] = p.firstCycleStart > 0 ? p.firstCycleStart : block.timestamp;

            // Cycle 0 initial-settlement phase: go straight to CALCULATING instead of opening
            // an ACCEPTING window first. This closes new subscribe/redeem requests immediately
            // and lets Settlement run its normal snapshotSettlementPrice/settle/completeCycle
            // flow right away against cycle 0 — settling every SUBSCRIBING-phase deposit at the
            // standard zero-supply 1 USDT : 1 share price — instead of making the initial
            // subscribers wait out a full cycleDuration before they see shares.
            if (s.cycle != CycleState.CALCULATING) {
                emit CycleStateChanged(vault, s.cycle, CycleState.CALCULATING, s.currentCycleNumber, block.timestamp);
                s.cycle = CycleState.CALCULATING;
            }
        } else {
            next = ProductState.FUNDING_FAILED;
        }
        emit ProductStateChanged(vault, ProductState.SUBSCRIBING, next, block.timestamp);
        s.product = next;
    }

    function startCycleCalculation(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.OPERATING) {
            revert WrongProductState(ProductState.OPERATING, s.product);
        }
        if (s.cycle != CycleState.ACCEPTING) {
            revert WrongCycleState(CycleState.ACCEPTING, s.cycle);
        }
        ProductParams storage p = _params[vault];
        if (block.timestamp < _cycleStart[vault] + p.cycleDuration) {
            revert ConditionNotMet("cycleDuration not elapsed");
        }
        emit CycleStateChanged(vault, CycleState.ACCEPTING, CycleState.CALCULATING, s.currentCycleNumber, block.timestamp);
        s.cycle = CycleState.CALCULATING;
    }

    function enterFinalSettlement(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.OPERATING) {
            revert WrongProductState(ProductState.OPERATING, s.product);
        }
        ProductParams storage p = _params[vault];
        if (block.timestamp < p.maturityTimestamp) {
            revert ConditionNotMet("maturityTimestamp not reached");
        }
        emit ProductStateChanged(vault, ProductState.OPERATING, ProductState.SETTLING, block.timestamp);
        s.product = ProductState.SETTLING;
    }

    function enterMaturing(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.SETTLING) {
            revert InvalidStateTransition(s.product, ProductState.MATURING);
        }
        if (!_finalSettlementComplete[vault]) {
            revert ConditionNotMet("final settlement not confirmed");
        }
        emit ProductStateChanged(vault, ProductState.SETTLING, ProductState.MATURING, block.timestamp);
        s.product = ProductState.MATURING;
    }

    function enterClaiming(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.MATURING) {
            revert InvalidStateTransition(s.product, ProductState.CLAIMING);
        }
        ProductParams storage p = _params[vault];
        if (block.timestamp < p.claimingStart) {
            revert ConditionNotMet("claimingStart not reached");
        }
        emit ProductStateChanged(vault, ProductState.MATURING, ProductState.CLAIMING, block.timestamp);
        s.product = ProductState.CLAIMING;
    }

    function closeProduct(address vault) external onlyVaultKeeper(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.CLAIMING) {
            revert InvalidStateTransition(s.product, ProductState.CLOSED);
        }
        ProductParams storage p = _params[vault];
        if (block.timestamp < p.claimingEnd) {
            revert ConditionNotMet("claimingEnd not reached");
        }
        emit ProductStateChanged(vault, ProductState.CLAIMING, ProductState.CLOSED, block.timestamp);
        s.product = ProductState.CLOSED;
    }

    // -----------------------------------------------------------------------
    // Lifecycle — Settlement (atomic cycle completion)
    // -----------------------------------------------------------------------

    function completeCycle(address vault) external onlyVaultSettlement(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.cycle != CycleState.CALCULATING) {
            revert InvalidCycleTransition(s.cycle, CycleState.FULFILLING);
        }
        uint256 cn = s.currentCycleNumber;

        // CALCULATING → FULFILLING → COMPLETED → ACCEPTING (atomic)
        emit CycleStateChanged(vault, CycleState.CALCULATING, CycleState.FULFILLING,   cn, block.timestamp);
        emit CycleStateChanged(vault, CycleState.FULFILLING,  CycleState.COMPLETED,    cn, block.timestamp);

        s.currentCycleNumber = cn + 1;
        _cycleStart[vault] = block.timestamp;

        emit CycleStateChanged(vault, CycleState.COMPLETED,   CycleState.ACCEPTING, cn + 1, block.timestamp);
        s.cycle = CycleState.ACCEPTING;
    }

    function completeFinalSettlement(address vault) external onlyVaultSettlement(vault) onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.product != ProductState.SETTLING) {
            revert WrongProductState(ProductState.SETTLING, s.product);
        }
        _finalSettlementComplete[vault] = true;
        emit FinalSettlementCompleted(vault, block.timestamp);
    }

    function isFinalSettlementComplete(address vault) external view returns (bool) {
        return _finalSettlementComplete[vault];
    }

    // -----------------------------------------------------------------------
    // Pause layer
    // -----------------------------------------------------------------------

    function pause(address vault, PauseState reason) external onlyRegistered(vault) {
        if (reason == PauseState.ACTIVE) revert InvalidPauseReason();
        if (IVaultRoles(vault).guardian() != msg.sender) revert NotGuardian();

        StateContext storage s = _states[vault];
        if (s.pause != PauseState.ACTIVE) revert AlreadyPaused(vault);

        emit VaultPauseSet(vault, reason, msg.sender, block.timestamp);
        s.pause = reason;
    }

    function unpause(address vault) external onlyRegistered(vault) {
        if (IVaultRoles(vault).owner() != msg.sender) revert Unauthorized();
        StateContext storage s = _states[vault];
        if (s.pause == PauseState.ACTIVE) revert NotPaused(vault);
        PauseState prev = s.pause;
        s.pause = PauseState.ACTIVE;
        emit VaultUnpaused(vault, prev, msg.sender, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Module-level pause
    // -----------------------------------------------------------------------

    function pauseModule(ModuleId id) external onlyGovernor {
        _modulePaused[id] = true;
        emit ModulePaused(id, msg.sender, block.timestamp);
    }

    function unpauseModule(ModuleId id) external onlyGovernor {
        _modulePaused[id] = false;
        emit ModuleUnpaused(id, msg.sender, block.timestamp);
    }

    function modulePaused(ModuleId id) external view returns (bool) {
        return _modulePaused[id];
    }

    function requireModuleActive(ModuleId id) external view {
        if (_modulePaused[id]) revert ModuleIsPaused(id);
    }

    // -----------------------------------------------------------------------
    // Gate views
    // -----------------------------------------------------------------------

    function requireSubscribable(address vault) external view onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.pause != PauseState.ACTIVE) revert VaultPausedError(vault, s.pause);

        bool ok = (s.product == ProductState.SUBSCRIBING) ||
                  (s.product == ProductState.OPERATING && s.cycle == CycleState.ACCEPTING);
        if (!ok) {
            revert WrongProductState(ProductState.SUBSCRIBING, s.product);
        }
    }

    function requireOperable(address vault) external view onlyRegistered(vault) {
        StateContext storage s = _states[vault];
        if (s.pause != PauseState.ACTIVE) revert VaultPausedError(vault, s.pause);
        if (s.product != ProductState.OPERATING && s.product != ProductState.SETTLING) {
            revert WrongProductState(ProductState.OPERATING, s.product);
        }
        if (s.product == ProductState.OPERATING && s.cycle != CycleState.ACCEPTING) {
            revert WrongCycleState(CycleState.ACCEPTING, s.cycle);
        }
    }

    function requireCycleState(address vault, CycleState expected) external view onlyRegistered(vault) {
        CycleState actual = _states[vault].cycle;
        if (actual != expected) revert CycleStateMismatch(vault, expected, actual);
    }

    function requireActive(address vault) external view onlyRegistered(vault) {
        PauseState ps = _states[vault].pause;
        if (ps != PauseState.ACTIVE) revert VaultPausedError(vault, ps);
    }

    // -----------------------------------------------------------------------
    // Getters
    // -----------------------------------------------------------------------

    function getState(address vault) external view returns (StateContext memory) {
        return _states[vault];
    }

    function getParams(address vault) external view returns (ProductParams memory) {
        return _params[vault];
    }

    function isVaultRegistered(address vault) external view returns (bool) {
        return _registered[vault];
    }

    function registeredVaults(address vault) external view returns (bool) {
        return _registered[vault];
    }

    function totalSubscribed(address vault) external view returns (uint256) {
        return _totalSubscribed[vault];
    }

    function subscribedByWallet(address vault, address wallet) external view returns (uint256) {
        return _subscribedByWallet[vault][wallet];
    }

    function currentCycleNumber(address vault) external view returns (uint256) {
        return _states[vault].currentCycleNumber;
    }

    function currentCycleStart(address vault) external view returns (uint256) {
        return _cycleStart[vault];
    }

    function getProductState(address vault) external view returns (ProductState) {
        return _states[vault].product;
    }

    function getCycleState(address vault) external view returns (CycleState) {
        return _states[vault].cycle;
    }

    function getPauseState(address vault) external view returns (PauseState) {
        return _states[vault].pause;
    }
}
