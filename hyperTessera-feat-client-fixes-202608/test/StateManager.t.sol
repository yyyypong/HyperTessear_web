// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {IStateManager} from "../src/interfaces/IStateManager.sol";
import {ProductState, CycleState, PauseState, StateContext, ProductParams, ModuleId} from "../src/libs/Types.sol";

// ---------------------------------------------------------------------------
// Minimal vault-local-roles mock. StateManager only ever performs low-level
// interface calls (owner()/curator()/guardian()/isKeeper()/settlement()) on the
// "vault" address, so a small standalone mock (no real access-control gating on
// its own setters — that's the real BaseVault's job, tested elsewhere) is
// sufficient here and keeps role assignment trivial per-test.
// ---------------------------------------------------------------------------
contract MockVault {
    address public owner;
    address public curator;
    address public guardian;
    address public settlement;
    mapping(address => bool) private _keepers;

    constructor(address owner_) {
        owner = owner_;
    }

    function isKeeper(address account) external view returns (bool) {
        return _keepers[account];
    }

    function setCurator(address a) external { curator = a; }
    function setGuardian(address a) external { guardian = a; }
    function setSettlement(address a) external { settlement = a; }
    function setKeeper(address a, bool approved) external { _keepers[a] = approved; }
}

contract StateManagerTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    MockVault internal vaultMock;

    address internal governor       = makeAddr("governor");
    address internal vaultFactory   = makeAddr("vaultFactory");
    address internal keeper         = makeAddr("keeper");
    address internal guardian       = makeAddr("guardian");
    address internal settlement     = makeAddr("settlement");
    address internal curator        = makeAddr("curator");
    address internal vaultOwner     = makeAddr("vaultOwner");
    address internal alice          = makeAddr("alice");
    address internal vault; // address of vaultMock

    // Default product params for most tests
    ProductParams internal defaultParams;
    uint256 internal constant NOW = 1_000_000;

    function setUp() public {
        vm.warp(NOW);
        ac = new HyperAccessControl(governor);
        sm = new StateManager(address(ac));

        vaultMock = new MockVault(vaultOwner);
        vault = address(vaultMock);
        vaultMock.setCurator(curator);
        vaultMock.setGuardian(guardian);
        vaultMock.setSettlement(settlement);
        vaultMock.setKeeper(keeper, true);

        vm.prank(governor);
        sm.setVaultFactory(vaultFactory);

        defaultParams = ProductParams({
            subscriptionStart:    NOW,
            subscriptionEnd:      NOW + 7 days,
            subscriptionCap:      1_000_000e6,
            walletSubscriptionCap: 100_000e6,
            minRaiseAmount:       100_000e6,
            firstCycleStart:      NOW + 7 days,
            cycleDuration:        7 days,
            maturityTimestamp:    NOW + 365 days,
            claimingStart:        NOW + 370 days,
            claimingEnd:          NOW + 400 days,
            feeParams:            0
        });
    }

    // -----------------------------------------------------------------------
    // setVaultFactory
    // -----------------------------------------------------------------------

    function test_setVaultFactory_onlyOnce() public {
        // Already set once in setUp(); calling again must revert.
        vm.prank(governor);
        vm.expectRevert(IStateManager.VaultFactoryAlreadySet.selector);
        sm.setVaultFactory(alice);
    }

    function test_setVaultFactory_zeroAddressReverts() public {
        StateManager fresh = new StateManager(address(ac));
        vm.prank(governor);
        vm.expectRevert(IStateManager.ZeroAddress.selector);
        fresh.setVaultFactory(address(0));
    }

    function test_setVaultFactory_nonGovernorReverts() public {
        StateManager fresh = new StateManager(address(ac));
        vm.prank(alice);
        vm.expectRevert(IStateManager.NotGovernor.selector);
        fresh.setVaultFactory(vaultFactory);
    }

    // -----------------------------------------------------------------------
    // registerVault
    // -----------------------------------------------------------------------

    function test_registerVault_factorySucceeds() public {
        vm.prank(vaultFactory);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);

        assertTrue(sm.isVaultRegistered(vault));
        StateContext memory ctx = sm.getState(vault);
        assertEq(uint8(ctx.product), uint8(ProductState.CONFIGURING));
        assertEq(uint8(ctx.cycle),   uint8(CycleState.ACCEPTING));
        assertEq(uint8(ctx.pause),   uint8(PauseState.ACTIVE));
        assertEq(ctx.currentCycleNumber, 0);
    }

    function test_registerVault_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit IStateManager.VaultRegistered(vault, ProductState.CONFIGURING, CycleState.ACCEPTING, NOW);
        vm.prank(vaultFactory);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
    }

    function test_registerVault_nonFactoryReverts() public {
        vm.prank(alice);
        vm.expectRevert(IStateManager.NotVaultFactory.selector);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
    }

    // Governor no longer has a bypass for registerVault — only the wired factory can call it.
    function test_registerVault_governorAloneReverts() public {
        vm.prank(governor);
        vm.expectRevert(IStateManager.NotVaultFactory.selector);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
    }

    function test_registerVault_duplicateReverts() public {
        vm.prank(vaultFactory);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
        vm.prank(vaultFactory);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.VaultAlreadyRegistered.selector, vault));
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
    }

    function test_registeredVaults_backwardCompat() public {
        vm.prank(vaultFactory);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
        assertTrue(sm.registeredVaults(vault));
        assertFalse(sm.registeredVaults(alice));
    }

    // -----------------------------------------------------------------------
    // setProductParams
    // -----------------------------------------------------------------------

    function test_setProductParams_curatorInConfiguring() public {
        _registerVault();
        vm.prank(curator);
        sm.setProductParams(vault, defaultParams);
        ProductParams memory p = sm.getParams(vault);
        assertEq(p.subscriptionCap, defaultParams.subscriptionCap);
    }

    function test_setProductParams_emitsEvent() public {
        _registerVault();
        vm.expectEmit(true, false, false, false);
        emit IStateManager.ProductParamsSet(vault, NOW);
        vm.prank(curator);
        sm.setProductParams(vault, defaultParams);
    }

    // Governor no longer has a bypass for setProductParams — only that vault's own Curator.
    function test_setProductParams_governorReverts() public {
        _registerVault();
        vm.prank(governor);
        vm.expectRevert(IStateManager.Unauthorized.selector);
        sm.setProductParams(vault, defaultParams);
    }

    function test_setProductParams_nonAuthorizedReverts() public {
        _registerVault();
        vm.prank(alice);
        vm.expectRevert(IStateManager.Unauthorized.selector);
        sm.setProductParams(vault, defaultParams);
    }

    function test_setProductParams_wrongStateReverts() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(
            IStateManager.WrongProductState.selector, ProductState.CONFIGURING, ProductState.SUBSCRIBING
        ));
        sm.setProductParams(vault, defaultParams);
    }

    // -----------------------------------------------------------------------
    // openSubscription
    // -----------------------------------------------------------------------

    function test_openSubscription_configuring_to_subscribing() public {
        _registerVaultAndParams();
        _openSubscription();
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.SUBSCRIBING));
    }

    function test_openSubscription_tooEarlyReverts() public {
        _registerVaultAndParams();
        vm.warp(NOW - 1);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.ConditionNotMet.selector, "subscriptionStart not reached"));
        sm.openSubscription(vault);
    }

    function test_openSubscription_wrongStateReverts() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(keeper);
        vm.expectRevert(); // InvalidStateTransition
        sm.openSubscription(vault);
    }

    function test_openSubscription_nonKeeperReverts() public {
        _registerVaultAndParams();
        vm.prank(alice);
        vm.expectRevert(IStateManager.NotKeeper.selector);
        sm.openSubscription(vault);
    }

    function test_openSubscription_vaultOwnerWithoutKeeperGrantReverts() public {
        // Owner no longer gets implicit Keeper access; without an explicit setKeeper, it reverts.
        _registerVaultAndParams();
        vm.prank(vaultOwner);
        vm.expectRevert(IStateManager.NotKeeper.selector);
        sm.openSubscription(vault);
    }

    // -----------------------------------------------------------------------
    // finalizeSubscription
    // -----------------------------------------------------------------------

    function test_finalizeSubscription_operating_when_raised() public {
        _registerVaultAndParams();
        _openSubscription();
        // Simulate enough subscriptions
        vm.prank(vault);
        sm.recordSubscription(vault, alice, 100_000e6);
        // Warp past subscriptionEnd
        vm.warp(NOW + 7 days + 1);
        vm.prank(keeper);
        sm.finalizeSubscription(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.OPERATING));
    }

    function test_finalizeSubscription_fundingFailed_when_not_raised() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.warp(NOW + 7 days + 1);
        vm.prank(keeper);
        sm.finalizeSubscription(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.FUNDING_FAILED));
    }

    function test_finalizeSubscription_tooEarlyReverts() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.ConditionNotMet.selector, "subscriptionEnd not reached"));
        sm.finalizeSubscription(vault);
    }

    // -----------------------------------------------------------------------
    // Cycle-0 fix: successful raise goes straight to CALCULATING (not ACCEPTING),
    // blocking new deposit/redeem requests until the bound Settlement contract
    // completes cycle 0, at which point currentCycleNumber becomes 1 and the
    // vault re-opens to ACCEPTING. This is the client-requested fix for initial
    // subscribers otherwise being stuck waiting a full cycleDuration.
    // -----------------------------------------------------------------------

    function test_finalizeSubscription_raiseSucceeds_entersCalculating_notAccepting() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(vault);
        sm.recordSubscription(vault, alice, 100_000e6);
        vm.warp(NOW + 7 days + 1);
        vm.prank(keeper);
        sm.finalizeSubscription(vault);

        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.OPERATING));
        assertEq(uint8(sm.getCycleState(vault)),   uint8(CycleState.CALCULATING));
        assertEq(sm.currentCycleNumber(vault), 0);
    }

    function test_cycle0_blocksNewSubscriptionsAndRedeemsUntilSettled() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(vault);
        sm.recordSubscription(vault, alice, 100_000e6);
        vm.warp(NOW + 7 days + 1);
        vm.prank(keeper);
        sm.finalizeSubscription(vault);

        // OPERATING but cycle == CALCULATING: neither subscribe nor redeem gates pass.
        vm.expectRevert();
        sm.requireSubscribable(vault);
        vm.expectRevert();
        sm.requireOperable(vault);

        // Only completeCycle (by the vault's bound Settlement) reopens ACCEPTING and
        // bumps currentCycleNumber from 0 to 1.
        vm.prank(settlement);
        sm.completeCycle(vault);

        assertEq(uint8(sm.getCycleState(vault)), uint8(CycleState.ACCEPTING));
        assertEq(sm.currentCycleNumber(vault), 1);
        sm.requireSubscribable(vault); // now passes
        sm.requireOperable(vault);     // now passes
    }

    // -----------------------------------------------------------------------
    // startCycleCalculation
    // -----------------------------------------------------------------------

    function test_startCycleCalculation_succeeds() public {
        _fullSubscribeToOperatingAndAccepting();
        vm.warp(NOW + 7 days + 7 days + 1);
        vm.prank(keeper);
        sm.startCycleCalculation(vault);
        assertEq(uint8(sm.getCycleState(vault)), uint8(CycleState.CALCULATING));
    }

    function test_startCycleCalculation_tooEarlyReverts() public {
        _fullSubscribeToOperatingAndAccepting();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.ConditionNotMet.selector, "cycleDuration not elapsed"));
        sm.startCycleCalculation(vault);
    }

    // -----------------------------------------------------------------------
    // enterFinalSettlement
    // -----------------------------------------------------------------------

    function test_enterFinalSettlement_succeeds() public {
        _fullSubscribeToOperating();
        vm.warp(NOW + 365 days + 1);
        vm.prank(keeper);
        sm.enterFinalSettlement(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.SETTLING));
    }

    function test_enterFinalSettlement_tooEarlyReverts() public {
        _fullSubscribeToOperating();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.ConditionNotMet.selector, "maturityTimestamp not reached"));
        sm.enterFinalSettlement(vault);
    }

    // -----------------------------------------------------------------------
    // enterMaturing / enterClaiming / closeProduct
    // -----------------------------------------------------------------------

    function test_enterMaturing_settling_to_maturing() public {
        _fullSubscribeToSettling();
        vm.prank(settlement);
        sm.completeFinalSettlement(vault);
        vm.prank(keeper);
        sm.enterMaturing(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.MATURING));
    }

    function test_enterMaturing_revertsWithoutFinalSettlementComplete() public {
        _fullSubscribeToSettling();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.ConditionNotMet.selector, "final settlement not confirmed"));
        sm.enterMaturing(vault);
    }

    function test_completeFinalSettlement_onlyVaultSettlement_reverts() public {
        _fullSubscribeToSettling();
        vm.prank(alice);
        vm.expectRevert(IStateManager.NotSettlement.selector);
        sm.completeFinalSettlement(vault);
    }

    function test_completeFinalSettlement_wrongProductStateReverts() public {
        // Still OPERATING — never advanced to SETTLING.
        _fullSubscribeToOperating();
        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(
            IStateManager.WrongProductState.selector, ProductState.SETTLING, ProductState.OPERATING
        ));
        sm.completeFinalSettlement(vault);
    }

    function test_enterMaturing_succeedsAfterFinalSettlementComplete() public {
        _fullSubscribeToSettling();

        vm.prank(settlement);
        sm.completeFinalSettlement(vault);
        assertTrue(sm.isFinalSettlementComplete(vault));

        vm.prank(keeper);
        sm.enterMaturing(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.MATURING));
    }

    function test_enterClaiming_maturing_to_claiming() public {
        _fullSubscribeToSettling();
        vm.prank(settlement);
        sm.completeFinalSettlement(vault);
        vm.prank(keeper);
        sm.enterMaturing(vault);
        vm.warp(NOW + 370 days + 1);
        vm.prank(keeper);
        sm.enterClaiming(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.CLAIMING));
    }

    function test_closeProduct_claiming_to_closed() public {
        _fullSubscribeToSettling();
        vm.prank(settlement); sm.completeFinalSettlement(vault);
        vm.prank(keeper); sm.enterMaturing(vault);
        vm.warp(NOW + 370 days + 1);
        vm.prank(keeper); sm.enterClaiming(vault);
        vm.warp(defaultParams.claimingEnd);
        vm.prank(keeper); sm.closeProduct(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.CLOSED));
    }

    function test_closeProduct_revertsBeforeClaimingEnd() public {
        _fullSubscribeToSettling();
        vm.prank(settlement); sm.completeFinalSettlement(vault);
        vm.prank(keeper); sm.enterMaturing(vault);
        vm.warp(NOW + 370 days + 1);
        vm.prank(keeper); sm.enterClaiming(vault);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.ConditionNotMet.selector, "claimingEnd not reached"));
        sm.closeProduct(vault);
    }

    function test_closeProduct_succeedsAtClaimingEnd() public {
        _fullSubscribeToSettling();
        vm.prank(settlement); sm.completeFinalSettlement(vault);
        vm.prank(keeper); sm.enterMaturing(vault);
        vm.warp(NOW + 370 days + 1);
        vm.prank(keeper); sm.enterClaiming(vault);
        vm.warp(defaultParams.claimingEnd);

        vm.prank(keeper);
        sm.closeProduct(vault);
        assertEq(uint8(sm.getProductState(vault)), uint8(ProductState.CLOSED));
    }

    // -----------------------------------------------------------------------
    // completeCycle
    // -----------------------------------------------------------------------

    function test_completeCycle_atomic_CALCULATING_to_ACCEPTING() public {
        _fullSubscribeToOperatingAndAccepting();
        vm.warp(NOW + 7 days + 7 days + 1);
        vm.prank(keeper); sm.startCycleCalculation(vault);
        assertEq(sm.currentCycleNumber(vault), 1);
        vm.prank(settlement); sm.completeCycle(vault);
        assertEq(uint8(sm.getCycleState(vault)), uint8(CycleState.ACCEPTING));
        assertEq(sm.currentCycleNumber(vault), 2);
    }

    function test_completeCycle_nonSettlementReverts() public {
        // finalizeSubscription already leaves cycle 0 at CALCULATING (cycle-0 fix).
        _fullSubscribeToOperating();
        vm.prank(alice);
        vm.expectRevert(IStateManager.NotSettlement.selector);
        sm.completeCycle(vault);
    }

    function test_completeCycle_wrongCycleStateReverts() public {
        // Registered but never finalized: cycle is ACCEPTING (initial), not CALCULATING.
        _registerVault();
        vm.prank(settlement);
        vm.expectRevert(); // InvalidCycleTransition
        sm.completeCycle(vault);
    }

    // -----------------------------------------------------------------------
    // Pause layer
    // -----------------------------------------------------------------------

    function test_guardian_pause_PAUSED_BY_GUARDIAN() public {
        _registerVault();
        vm.prank(guardian);
        sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        assertEq(uint8(sm.getPauseState(vault)), uint8(PauseState.PAUSED_BY_GUARDIAN));
    }

    // Governor no longer has any pause bypass — only that vault's own Guardian, regardless
    // of the PauseState reason passed (removed: old test_governor_pause_PAUSED_BY_GOVERNOR,
    // which relied on a Governor-specific pause path that no longer exists).
    function test_governor_cannot_pause() public {
        _registerVault();
        vm.prank(governor);
        vm.expectRevert(IStateManager.NotGuardian.selector);
        sm.pause(vault, PauseState.PAUSED_BY_GOVERNOR);
    }

    // Guardian may pause with any non-ACTIVE reason now (removed: old
    // test_guardian_cannot_pause_PAUSED_BY_GOVERNOR, which assumed the reason enum value
    // itself gated who could call — it no longer does; only guardian identity is checked).
    function test_guardian_can_pause_with_any_reason() public {
        _registerVault();
        vm.prank(guardian);
        sm.pause(vault, PauseState.PAUSED_BY_GOVERNOR);
        assertEq(uint8(sm.getPauseState(vault)), uint8(PauseState.PAUSED_BY_GOVERNOR));
    }

    function test_nonAuth_pause_reverts() public {
        _registerVault();
        vm.prank(alice);
        vm.expectRevert(IStateManager.NotGuardian.selector);
        sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
    }

    function test_vaultOwner_can_unpause() public {
        _registerVault();
        vm.prank(guardian); sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        vm.prank(vaultOwner); sm.unpause(vault);
        assertEq(uint8(sm.getPauseState(vault)), uint8(PauseState.ACTIVE));
    }

    // Governor no longer has an unpause bypass — only that vault's own Owner.
    function test_governor_cannot_unpause() public {
        _registerVault();
        vm.prank(guardian); sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        vm.prank(governor);
        vm.expectRevert(IStateManager.Unauthorized.selector);
        sm.unpause(vault);
    }

    function test_guardian_cannot_unpause() public {
        _registerVault();
        vm.prank(guardian); sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        vm.prank(guardian);
        vm.expectRevert(IStateManager.Unauthorized.selector);
        sm.unpause(vault);
    }

    function test_pause_ACTIVE_is_invalid_reason() public {
        _registerVault();
        vm.prank(guardian);
        vm.expectRevert(IStateManager.InvalidPauseReason.selector);
        sm.pause(vault, PauseState.ACTIVE);
    }

    function test_double_pause_reverts() public {
        _registerVault();
        vm.prank(guardian); sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.AlreadyPaused.selector, vault));
        sm.pause(vault, PauseState.PAUSED_BY_GOVERNOR);
    }

    // -----------------------------------------------------------------------
    // Gate views
    // -----------------------------------------------------------------------

    function test_requireSubscribable_in_SUBSCRIBING() public {
        _registerVaultAndParams();
        _openSubscription();
        sm.requireSubscribable(vault); // should not revert
    }

    function test_requireSubscribable_in_OPERATING_ACCEPTING() public {
        _fullSubscribeToOperatingAndAccepting();
        sm.requireSubscribable(vault); // should not revert
    }

    function test_requireSubscribable_paused_reverts() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(guardian); sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.VaultPausedError.selector, vault, PauseState.PAUSED_BY_GUARDIAN));
        sm.requireSubscribable(vault);
    }

    function test_requireSubscribable_wrong_state_reverts() public {
        _registerVaultAndParams();
        // CONFIGURING — should revert
        vm.expectRevert();
        sm.requireSubscribable(vault);
    }

    function test_requireOperable_in_OPERATING_ACCEPTING() public {
        _fullSubscribeToOperatingAndAccepting();
        sm.requireOperable(vault); // should not revert
    }

    function test_requireOperable_wrong_state_reverts() public {
        _registerVaultAndParams();
        _openSubscription();
        // SUBSCRIBING — not operable
        vm.expectRevert();
        sm.requireOperable(vault);
    }

    function test_requireCycleState_correct() public {
        _fullSubscribeToOperatingAndAccepting();
        vm.warp(NOW + 7 days + 7 days + 1);
        vm.prank(keeper); sm.startCycleCalculation(vault);
        sm.requireCycleState(vault, CycleState.CALCULATING); // should not revert
    }

    function test_requireCycleState_wrong_reverts() public {
        _fullSubscribeToOperatingAndAccepting();
        // cycle is ACCEPTING, but we ask for CALCULATING
        vm.expectRevert(abi.encodeWithSelector(
            IStateManager.CycleStateMismatch.selector, vault, CycleState.CALCULATING, CycleState.ACCEPTING
        ));
        sm.requireCycleState(vault, CycleState.CALCULATING);
    }

    function test_requireActive_paused_reverts() public {
        _registerVault();
        vm.prank(guardian); sm.pause(vault, PauseState.PAUSED_BY_GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(IStateManager.VaultPausedError.selector, vault, PauseState.PAUSED_BY_GUARDIAN));
        sm.requireActive(vault);
    }

    function test_requireActive_active_ok() public {
        _registerVault();
        sm.requireActive(vault); // should not revert
    }

    // -----------------------------------------------------------------------
    // Subscription tracking
    // -----------------------------------------------------------------------

    function test_recordSubscription_updates_totals() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(vault); // caller must be vault
        sm.recordSubscription(vault, alice, 1_000e6);
        assertEq(sm.totalSubscribed(vault), 1_000e6);
        assertEq(sm.subscribedByWallet(vault, alice), 1_000e6);
    }

    function test_releaseSubscription_decrements_totals() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(vault); sm.recordSubscription(vault, alice, 1_000e6);
        vm.prank(vault); sm.releaseSubscription(vault, alice, 500e6);
        assertEq(sm.totalSubscribed(vault), 500e6);
        assertEq(sm.subscribedByWallet(vault, alice), 500e6);
    }

    function test_recordSubscription_nonVaultReverts() public {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(alice);
        vm.expectRevert(IStateManager.Unauthorized.selector);
        sm.recordSubscription(vault, alice, 1_000e6);
    }

    function test_subscriptionCap_exceeded_reverts() public {
        // Set tiny cap
        ProductParams memory p = defaultParams;
        p.subscriptionCap = 500e6;
        _registerVault();
        vm.prank(curator); sm.setProductParams(vault, p);
        _openSubscription();
        vm.prank(vault); sm.recordSubscription(vault, alice, 400e6);
        vm.prank(vault);
        vm.expectRevert(); // SubscriptionCapExceeded
        sm.recordSubscription(vault, alice, 200e6);
    }

    function test_walletCap_exceeded_reverts() public {
        ProductParams memory p = defaultParams;
        p.walletSubscriptionCap = 500e6;
        _registerVault();
        vm.prank(curator); sm.setProductParams(vault, p);
        _openSubscription();
        vm.prank(vault); sm.recordSubscription(vault, alice, 400e6);
        vm.prank(vault);
        vm.expectRevert(); // WalletCapExceeded
        sm.recordSubscription(vault, alice, 200e6);
    }

    function test_recordSubscription_notEnforced_afterOperating() public {
        // subscriptionCap is a one-time initial-raise gate; once the vault is
        // OPERATING (recurring per-cycle deposits), totals never decrement,
        // so re-enforcing the same cap would permanently lock out deposits.
        ProductParams memory p = defaultParams;
        p.subscriptionCap = 500e6;
        p.minRaiseAmount = 0;
        _registerVault();
        vm.prank(curator); sm.setProductParams(vault, p);
        _openSubscription();
        vm.prank(vault); sm.recordSubscription(vault, alice, 500e6); // hits cap during SUBSCRIBING
        vm.warp(NOW + 7 days + 1);
        vm.prank(keeper); sm.finalizeSubscription(vault); // -> OPERATING (raised >= minRaiseAmount)

        // Further recurring-cycle deposits must not revert despite total already at cap.
        vm.prank(vault); sm.recordSubscription(vault, alice, 1_000e6);
    }

    // -----------------------------------------------------------------------
    // requireOperable during SETTLING (redeem allowed)
    // -----------------------------------------------------------------------

    function test_requireOperable_in_SETTLING() public {
        _fullSubscribeToSettling();
        sm.requireOperable(vault); // should not revert
    }

    // -----------------------------------------------------------------------
    // Lifecycle transition reverts for invalid paths
    // -----------------------------------------------------------------------

    function test_invalid_product_transitions_revert() public {
        _registerVaultAndParams();
        // Cannot finalizeSubscription from CONFIGURING
        vm.prank(keeper);
        vm.expectRevert();
        sm.finalizeSubscription(vault);
    }

    function test_invalid_cycle_transition_revert() public {
        _fullSubscribeToOperatingAndAccepting();
        // Cannot startCycleCalculation from CALCULATING
        vm.warp(NOW + 7 days + 7 days + 1);
        vm.prank(keeper); sm.startCycleCalculation(vault);
        vm.prank(keeper);
        vm.expectRevert(); // WrongProductState or WrongCycleState
        sm.startCycleCalculation(vault);
    }

    // -----------------------------------------------------------------------
    // Module pause (backward compat)
    // -----------------------------------------------------------------------

    function test_modulePaused_default_false() public view {
        assertFalse(sm.modulePaused(ModuleId.PSM_POOL));
    }

    function test_pauseModule_unpauseModule() public {
        vm.prank(governor); sm.pauseModule(ModuleId.PSM_POOL);
        assertTrue(sm.modulePaused(ModuleId.PSM_POOL));
        vm.prank(governor); sm.unpauseModule(ModuleId.PSM_POOL);
        assertFalse(sm.modulePaused(ModuleId.PSM_POOL));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _registerVault() internal {
        vm.prank(vaultFactory);
        sm.registerVault(vault, ProductState.CONFIGURING, CycleState.ACCEPTING);
    }

    function _registerVaultAndParams() internal {
        _registerVault();
        vm.prank(curator);
        sm.setProductParams(vault, defaultParams);
    }

    function _openSubscription() internal {
        vm.prank(keeper);
        sm.openSubscription(vault);
    }

    function _fullSubscribeToOperating() internal {
        _registerVaultAndParams();
        _openSubscription();
        vm.prank(vault);
        sm.recordSubscription(vault, alice, 100_000e6);
        vm.warp(NOW + 7 days + 1);
        vm.prank(keeper);
        sm.finalizeSubscription(vault);
    }

    /// @dev Cycle-0 fix: finalizeSubscription lands on CALCULATING at cycle 0, not
    ///      ACCEPTING. Tests that need the vault in a "steady state" OPERATING+ACCEPTING
    ///      (post-cycle-0) must additionally complete cycle 0 via the bound Settlement.
    function _fullSubscribeToOperatingAndAccepting() internal {
        _fullSubscribeToOperating();
        vm.prank(settlement);
        sm.completeCycle(vault);
    }

    function _fullSubscribeToSettling() internal {
        _fullSubscribeToOperating();
        vm.warp(NOW + 365 days + 1);
        vm.prank(keeper);
        sm.enterFinalSettlement(vault);
    }
}
