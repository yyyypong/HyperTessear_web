// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {VaultTimelock} from "../src/governance/VaultTimelock.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {AdapterRegistry} from "../src/asset-management/vaults/AdapterRegistry.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {IGate} from "../src/interfaces/IGate.sol";
import {IBaseVault} from "../src/interfaces/IBaseVault.sol";
import {IStateManager} from "../src/interfaces/IStateManager.sol";
import {IVaultTimelock} from "../src/interfaces/IVaultTimelock.sol";
import {ProductState, CycleState, PauseState, ProductParams, ModuleId, Tranche, RequestSettlement} from "../src/libs/Types.sol";
import {UnifiedPool} from "../src/asset-management/settlement/UnifiedPool.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Vm} from "forge-std/Vm.sol";

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract BlockingGate is IGate {
    address public blocked;
    constructor(address _blocked) { blocked = _blocked; }
    function isAllowed(address account) external view returns (bool) { return account != blocked; }
}

contract AllowAllGate is IGate {
    function isAllowed(address) external pure returns (bool) { return true; }
}

/// @notice Minimal IUnifiedPool.pending() stand-in for grossManagedAssets() aggregation tests.
contract MockUnifiedPool {
    mapping(address => uint256) public pending;
    function setPending(address vault, uint256 amount) external { pending[vault] = amount; }
}

/// @notice Minimal ISettlement.isOperator(vault, account) stand-in for Settlement-Operator-gated
///         BaseVault functions (e.g. returnPrincipalToPool). setUp()'s `settlement` is a bare
///         makeAddr() EOA with no isOperator function, so tests that need a real Settlement
///         Operator check point the vault's settlement at one of these instead.
contract MockSettlementOperator {
    mapping(address => mapping(address => bool)) public isOperator;
    function setOperator(address vault_, address account, bool approved) external {
        isOperator[vault_][account] = approved;
    }
}

contract RevertingRealAssetsAdapter {
    address public immutable vault;
    constructor(address vault_) { vault = vault_; }
    function realAssets() external pure returns (uint256) { revert("malformed adapter"); }
}

// ---------------------------------------------------------------------------
// Main test contract
// ---------------------------------------------------------------------------

contract EarnVaultTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    EarnVault internal vault;
    VaultTimelock internal tl;
    AdapterRegistry internal reg;

    // `governor` is the HyperAccessControl protocol Governor (used only to wire
    // StateManager.setVaultFactory); it is also reused as this vault's Owner (IVaultRoles) for
    // test simplicity. `curator` is kept as a distinct address from `governor`/owner because
    // VaultTimelock.scheduleParamChange resolves the caller's ActionClass by checking
    // `== owner()` before `== curator()` — an address that is both would always resolve to
    // OWNER class and could never schedule a CURATOR-class action.
    address internal governor   = makeAddr("governor");
    address internal curator    = makeAddr("curator");
    address internal factory    = makeAddr("factory");
    address internal keeper     = makeAddr("keeper");
    address internal guardian   = makeAddr("guardian");
    address internal settlement = makeAddr("settlement");
    address internal alice      = makeAddr("alice");
    address internal bob        = makeAddr("bob");

    mapping(uint256 => uint256) internal _reqAssets; // requestId -> deposit's original assets
    mapping(uint256 => uint256) internal _reqShares; // requestId -> redeem's original shares

    uint256 internal constant NOW = 1_000_000;
    // Initial (and, absent any yield/fee, stable) price: 1e18 shares per 1_000_000 (6-dec) USDT.
    uint256 internal constant PRICE_ONE = 1_000_000;
    uint256 internal constant SHARE_SCALE = 1e18;

    function setUp() public {
        vm.warp(NOW);

        ac = new HyperAccessControl(governor);
        usdt = new MockUSDT();
        sm   = new StateManager(address(ac));

        vm.prank(governor);
        sm.setVaultFactory(factory);

        queue = new Queue(address(sm));

        vault = new EarnVault(
            "HyperTessera Cash Earn",
            "htCASH",
            address(usdt),
            address(sm),
            address(queue),
            governor,   // owner_ (was accessControl_ under the old global-role model)
            address(0)  // liquidityBridge (none for this test)
        );

        tl  = new VaultTimelock(address(vault));
        reg = new AdapterRegistry(governor);
        vault.bindGovernance(address(tl), address(reg));

        // Register vault, appoint vault-local roles, set params, open subscription
        vm.prank(factory);
        sm.registerVault(address(vault), ProductState.CONFIGURING, CycleState.ACCEPTING);

        vm.startPrank(governor);
        vault.setCurator(curator);
        vault.setGuardian(guardian);
        vault.setKeeper(keeper, true);
        vm.stopPrank();

        vm.prank(curator);
        sm.setProductParams(address(vault), _defaultParams());

        vm.prank(governor);
        vault.setSettlement(settlement);

        vm.prank(keeper);
        sm.openSubscription(address(vault));

        // Pre-mint USDT for alice and bob
        usdt.mint(alice, 100_000e6);
        usdt.mint(bob,   100_000e6);
    }

    /// @notice Schedules `data` against `vault` via VaultTimelock as `proposer` (must be
    ///         vault.owner() or vault.curator() matching the target selector's whitelisted
    ///         ActionClass), warps past the delay, and executes it.
    function _scheduleAndExecute(address proposer, bytes memory data) internal returns (bytes32 id) {
        vm.prank(proposer);
        id = tl.scheduleParamChange(address(vault), data);
        vm.warp(block.timestamp + tl.delay());
        tl.executeParamChange(id);
    }

    // -----------------------------------------------------------------------
    // requestDeposit
    // -----------------------------------------------------------------------

    function test_requestDeposit_transfersUSDT_createsRequest() public {
        uint256 assets = 1_000e6;
        vm.startPrank(alice);
        usdt.approve(address(vault), assets);
        uint256 rid = vault.requestDeposit(assets, alice);
        vm.stopPrank();

        assertEq(rid, 1);
        assertEq(usdt.balanceOf(address(vault)), assets);
        assertEq(usdt.balanceOf(alice), 100_000e6 - assets);
        assertEq(vault.pendingDepositLiability(), assets);
        assertEq(vault.pendingDepositByOwner(alice), assets);
    }

    function test_requestDeposit_emitsDepositRequested() public {
        uint256 assets = 1_000e6;
        vm.startPrank(alice);
        usdt.approve(address(vault), assets);
        vm.expectEmit(true, true, false, true);
        emit IBaseVault.DepositRequested(1, alice, assets, NOW);
        vault.requestDeposit(assets, alice);
        vm.stopPrank();
    }

    function test_requestDeposit_gate_addressZero_alwaysPasses() public {
        // gate is address(0) by default
        vm.startPrank(alice);
        usdt.approve(address(vault), 100e6);
        vault.requestDeposit(100e6, alice);
        vm.stopPrank();
    }

    function test_requestDeposit_gate_blocksOwner() public {
        BlockingGate g = new BlockingGate(alice);
        // Vault is already past CONFIGURING (setUp opened subscription), so setGate is now
        // Timelock-only — route through VaultTimelock instead of calling directly as Owner.
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setGate, (address(g))));

        vm.startPrank(alice);
        usdt.approve(address(vault), 100e6);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.GateBlocked.selector, alice));
        vault.requestDeposit(100e6, alice);
        vm.stopPrank();
    }

    function test_requestDeposit_zero_assets_reverts() public {
        vm.startPrank(alice);
        usdt.approve(address(vault), 0);
        vm.expectRevert(IBaseVault.ZeroAssets.selector);
        vault.requestDeposit(0, alice);
        vm.stopPrank();
    }

    function test_requestDeposit_subscriptionCap_reverts() public {
        // subscriptionCap in defaultParams = 1_000_000e6; walletCap = 100_000e6
        // Alice deposits full wallet cap first
        vm.startPrank(alice);
        usdt.approve(address(vault), 100_001e6);
        usdt.mint(alice, 1e6); // give alice a tiny bit more
        vm.expectRevert(); // WalletCapExceeded (100k cap per wallet)
        vault.requestDeposit(100_001e6, alice);
        vm.stopPrank();
    }

    function test_requestDeposit_walletCap_reverts() public {
        vm.startPrank(alice);
        usdt.approve(address(vault), 100_000e6);
        vault.requestDeposit(100_000e6, alice); // hits wallet cap
        usdt.mint(alice, 1e6);
        usdt.approve(address(vault), 1e6);
        vm.expectRevert(); // WalletCapExceeded
        vault.requestDeposit(1e6, alice);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // claimDeposit
    // -----------------------------------------------------------------------

    function test_claimDeposit_before_settled_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.RequestNotSettled.selector, rid));
        vault.claimDeposit(rid, alice);
    }

    function test_claimDeposit_after_settled_transfers_shares() public {
        uint256 assets = 1_000e6;
        uint256 rid = _requestDeposit(alice, assets);

        _advanceToCalculating();
        _settleDeposits(_arr(rid));

        vm.prank(alice);
        uint256 shares = vault.claimDeposit(rid, alice);
        assertEq(shares, _sharesFor(assets));
        assertEq(vault.balanceOf(alice), shares);
        // Alice's liability is released once her deposit is settled (before claim); the
        // funder2 deposit _advanceToCalculating() injects to meet minRaiseAmount is still
        // PENDING (not part of this settlement batch).
        assertEq(vault.pendingDepositLiability(), _defaultParams().minRaiseAmount);
    }

    function test_claimDeposit_emitsDepositClaimed() public {
        uint256 assets = 1_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));

        uint256 expectedShares = _sharesFor(assets);
        vm.startPrank(alice);
        vm.expectEmit(true, true, false, false);
        emit IBaseVault.DepositClaimed(rid, alice, expectedShares, block.timestamp);
        vault.claimDeposit(rid, alice);
        vm.stopPrank();
    }

    function test_claimDeposit_twice_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));

        vm.prank(alice); vault.claimDeposit(rid, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.RequestNotSettled.selector, rid));
        vault.claimDeposit(rid, alice);
    }

    // -----------------------------------------------------------------------
    // requestRedeem
    // -----------------------------------------------------------------------

    function test_requestRedeem_locks_shares() public {
        // Get some shares first
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        // requestId 2 is taken by funder in _advanceToCalculating; alice's redeem is id 3
        vm.startPrank(alice);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();
        assertGt(redeemId, 1);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.balanceOf(address(vault)), shares);
    }

    function test_requestRedeem_emitsEvent() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        // requestId 2 is taken by funder in _advanceToCalculating
        vm.expectEmit(true, true, false, false);
        emit IBaseVault.RedeemRequested(3, alice, shares, block.timestamp);
        vault.requestRedeem(shares, alice);
        vm.stopPrank();
    }

    function test_requestRedeem_insufficient_shares_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.requestRedeem(1_000e6, alice);
    }

    // -----------------------------------------------------------------------
    // cancelRequest
    // -----------------------------------------------------------------------

    function test_cancelRequest_deposit_returns_USDT() public {
        uint256 assets = 1_000e6;
        uint256 rid = _requestDeposit(alice, assets);

        uint256 balBefore = usdt.balanceOf(alice);
        vm.prank(alice); vault.cancelRequest(rid);
        assertEq(usdt.balanceOf(alice), balBefore + assets);
        assertEq(vault.pendingDepositLiability(), 0);
        assertEq(vault.pendingDepositByOwner(alice), 0);
    }

    function test_cancelRequest_during_CALCULATING_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.CancelNotAllowed.selector, rid, CycleState.CALCULATING));
        vault.cancelRequest(rid);
    }

    function test_cancelRequest_redeem_returns_shares() public {
        // Acquire shares
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        uint256 sharesBefore = vault.balanceOf(alice);
        vm.prank(alice); vault.cancelRequest(redeemId);
        assertEq(vault.balanceOf(alice), sharesBefore + shares);
    }

    function test_cancelRequest_redeem_partiallyFilled_reverts() public {
        uint256 assets = 3_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        // Partially settle in one cycle, leaving remainingShares > 0.
        uint256 firstChunk = shares / 3;
        _advanceToCalculating();
        uint256 cycle1 = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycle1);
        vault.settle(cycle1, _rs0(), _rs1(redeemId, firstChunk), 0);
        vm.stopPrank();
        _completeCycle();

        // Now in a later ACCEPTING cycle — cancellation must be rejected since the request has
        // already been partially filled (the vault no longer holds the full original `shares`
        // on this request's behalf).
        CycleState cs = sm.getCycleState(address(vault));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.CancelNotAllowed.selector, redeemId, cs));
        vault.cancelRequest(redeemId);
    }

    // -----------------------------------------------------------------------
    // claimRedeem
    // -----------------------------------------------------------------------

    function test_claimRedeem_before_settled_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.RequestNotSettled.selector, redeemId));
        vault.claimRedeem(redeemId, alice);
    }

    function test_claimRedeem_after_settled_transfers_USDT() public {
        uint256 assets = 1_000e6;
        uint256 depRid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(depRid));
        vm.prank(alice); vault.claimDeposit(depRid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();
        _reqShares[redeemId] = shares;

        // Advance another cycle to CALCULATING. The original deposit's USDT is still sitting
        // in the vault (no Adapter/UnifiedPool wired), so freeVaultUSDT() already covers the
        // redeem — no extra funding needed to demonstrate net settlement.
        _advanceToCalculating();
        _settleRedeems(_arr(redeemId), 0);

        uint256 redeemAmt = _assetsFor(shares);
        uint256 balBefore = usdt.balanceOf(alice);
        vm.prank(alice); vault.claimRedeem(redeemId, alice);
        assertEq(usdt.balanceOf(alice), balBefore + redeemAmt);
        assertEq(vault.reservedRedeemLiability(), 0);
    }

    // -----------------------------------------------------------------------
    // freeVaultUSDT / totalAssets
    // -----------------------------------------------------------------------

    function test_freeVaultUSDT_excludesPendingDeposit() public {
        uint256 assets = 1_000e6;
        _requestDeposit(alice, assets);
        assertEq(vault.freeVaultUSDT(), 0);
        assertEq(usdt.balanceOf(address(vault)), assets);
    }

    function test_totalAssets_zeroWhenEmpty() public view {
        assertEq(vault.totalAssets(), 0);
    }

    // -----------------------------------------------------------------------
    // snapshotSettlementPrice / settle
    // -----------------------------------------------------------------------

    function test_settle_by_non_settlement_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.OnlySettlement.selector, alice));
        vault.settle(1, _rs0(), _rs0(), 0);
    }

    function test_snapshotSettlementPrice_by_non_settlement_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.OnlySettlement.selector, alice));
        vault.snapshotSettlementPrice(1);
    }

    function test_settle_revertsIfSnapshotNotInitialized() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.SnapshotNotInitialized.selector, cycleNumber));
        vault.settle(cycleNumber, _rs1(rid, 1_000e6), _rs0(), 0);
    }

    function test_snapshotSettlementPrice_revertsIfAlreadyInitialized() public {
        _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));

        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.SnapshotAlreadyInitialized.selector, cycleNumber));
        vault.snapshotSettlementPrice(cycleNumber);
    }

    function test_settle_mints_correct_shares() public {
        uint256 assets = 2_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);
        assertEq(vault.balanceOf(alice), _sharesFor(assets));
    }

    function test_settle_carriesOverUnselectedDeposit() public {
        uint256 rid1 = _requestDeposit(alice, 1_000e6);
        uint256 rid2 = _requestDeposit(bob, 500e6);
        _advanceToCalculating();

        // Only settle alice's deposit; bob's stays PENDING and rolls to next cycle.
        _settleDeposits(_arr(rid1));

        vm.prank(alice); vault.claimDeposit(rid1, alice);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.RequestNotSettled.selector, rid2));
        vault.claimDeposit(rid2, bob);
        // Bob's unselected deposit plus the funder2 deposit _advanceToCalculating() injects
        // to meet minRaiseAmount are both still PENDING.
        assertEq(vault.pendingDepositLiability(), 500e6 + _defaultParams().minRaiseAmount);
    }

    function test_settle_insufficientLiquidity_reverts() public {
        // Deposit, settle, claim, then request a redeem — but move the vault's free USDT to
        // UnifiedPool (simulating capital deployed elsewhere), with UnifiedPool.pending()
        // reflecting it so totalAssets()/price stay unchanged — only *liquid* cash (checked by
        // freeVaultUSDT()) drops, so the redeem becomes unfundable this cycle without being
        // an actual loss.
        MockUnifiedPool pool = new MockUnifiedPool();
        // Vault is already past CONFIGURING — setUnifiedPool is Timelock-only now.
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setUnifiedPool, (address(pool))));

        uint256 assets = 1_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        uint256 freeAmount = vault.freeVaultUSDT();
        vm.prank(address(vault));
        usdt.transfer(address(pool), freeAmount);
        pool.setPending(address(vault), freeAmount);

        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        uint256 redeemAmt = _assetsFor(shares);
        vm.prank(settlement);
        vm.expectRevert(
            abi.encodeWithSelector(IBaseVault.InsufficientSettlementLiquidity.selector, redeemAmt, 0)
        );
        vault.settle(cycleNumber, _rs0(), _rs1(redeemId, shares), 0);
    }

    function test_settle_partialDeposit_refundsRemainderImmediately() public {
        uint256 requested = 400_000e6;
        uint256 accepted = 350_000e6;
        // walletSubscriptionCap only gates the initial raise (SUBSCRIBING) — clear that phase
        // first via a funder-only cycle so alice's single 400k deposit isn't cap-blocked.
        _seedFirstCycle();
        usdt.mint(alice, requested); // top up beyond setUp's 100_000e6
        uint256 rid = _requestDeposit(alice, requested);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));

        uint256 balBefore = usdt.balanceOf(alice);
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IBaseVault.DepositSettled(rid, requested, accepted, requested - accepted, cycleNumber, block.timestamp);
        vault.settle(cycleNumber, _rs1(rid, accepted), _rs0(), 0);
        vm.stopPrank();

        // Refunded immediately — no claimRefund step, no re-queue.
        assertEq(usdt.balanceOf(alice), balBefore + (requested - accepted));
        assertEq(vault.pendingDepositLiability(), 0);
        assertEq(vault.pendingDepositByOwner(alice), 0);

        vm.prank(alice);
        uint256 shares = vault.claimDeposit(rid, alice);
        assertEq(shares, _sharesFor(accepted));
    }

    function test_settle_partialRedeem_staysQueuedAcrossCycles() public {
        uint256 assets = 3_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        // Cycle 1: pay out 1/3 of the shares only.
        uint256 firstChunk = shares / 3;
        _advanceToCalculating();
        uint256 cycle1 = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycle1);
        vault.settle(cycle1, _rs0(), _rs1(redeemId, firstChunk), 0);
        vm.stopPrank();
        _completeCycle();

        // Still not claimable — the request is not fully cleared.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.RequestNotSettled.selector, redeemId));
        vault.claimRedeem(redeemId, alice);

        // Cycle 2: pay out the rest.
        uint256 remaining = shares - firstChunk;
        _advanceToCalculating();
        uint256 cycle2 = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycle2);
        vault.settle(cycle2, _rs0(), _rs1(redeemId, remaining), 0);
        vm.stopPrank();
        _completeCycle();

        uint256 balBefore = usdt.balanceOf(alice);
        vm.prank(alice);
        uint256 assetsOut = vault.claimRedeem(redeemId, alice);
        assertEq(assetsOut, _assetsFor(shares)); // cumulative across both cycles
        assertEq(usdt.balanceOf(alice), balBefore + assetsOut);
    }

    function test_settle_clientExample_depositCoversRedeem_excessRefunded() public {
        // Bob acquires shares, then queues a 350k redeem.
        uint256 bobAssets = 350_000e6;
        // walletSubscriptionCap only gates the initial raise (SUBSCRIBING) — clear that phase
        // first via a funder-only cycle so bob's single 350k deposit isn't cap-blocked.
        _seedFirstCycle();
        usdt.mint(bob, bobAssets); // top up beyond setUp's 100_000e6
        uint256 bobRid = _requestDeposit(bob, bobAssets);
        _advanceToCalculating();
        _settleDeposits(_arr(bobRid));
        vm.prank(bob); vault.claimDeposit(bobRid, bob);
        uint256 bobShares = vault.balanceOf(bob);
        vm.startPrank(bob);
        vault.approve(address(vault), bobShares);
        uint256 redeemId = vault.requestRedeem(bobShares, bob);
        vm.stopPrank();

        // Alice's 400k deposit request is next in the queue.
        uint256 aliceRequested = 400_000e6;
        usdt.mint(alice, aliceRequested);
        uint256 aliceRid = _requestDeposit(alice, aliceRequested);

        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        uint256 redeemAssets = _assetsFor(bobShares); // == 350_000e6 at the stable 1:1 price in this test

        uint256 aliceBalBefore = usdt.balanceOf(alice);
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        // Accept exactly enough of alice's deposit to cover bob's redeem; refund the rest immediately.
        uint256[] memory cleared =
            vault.settle(cycleNumber, _rs1(aliceRid, redeemAssets), _rs1(redeemId, bobShares), 0);
        vm.stopPrank();

        assertEq(cleared.length, 1);
        assertEq(cleared[0], redeemId); // bob's redeem fully cleared this cycle

        // Alice: partial accept + immediate refund of the untouched 50k.
        assertEq(usdt.balanceOf(alice), aliceBalBefore + (aliceRequested - redeemAssets));
        vm.prank(alice);
        uint256 aliceShares = vault.claimDeposit(aliceRid, alice);
        assertEq(aliceShares, _sharesFor(redeemAssets));

        // Bob: fully paid, claimable now.
        vm.prank(bob);
        uint256 bobAssetsOut = vault.claimRedeem(redeemId, bob);
        assertEq(bobAssetsOut, redeemAssets);
    }

    function test_settle_deposit_zeroSettleAmount_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.InvalidSettleAmount.selector, rid));
        vault.settle(cycleNumber, _rs1(rid, 0), _rs0(), 0);
        vm.stopPrank();
    }

    function test_settle_deposit_settleAmountExceedsRequest_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.InvalidSettleAmount.selector, rid));
        vault.settle(cycleNumber, _rs1(rid, 1_000e6 + 1), _rs0(), 0);
        vm.stopPrank();
    }

    function test_settle_redeem_settleAmountExceedsRemaining_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.InvalidSettleAmount.selector, redeemId));
        vault.settle(cycleNumber, _rs0(), _rs1(redeemId, shares + 1), 0);
        vm.stopPrank();
    }

    // -------------------------------------------------------------------
    // writeDownInsolvency
    // -------------------------------------------------------------------

    /// @notice Drains the vault's own USDT balance to simulate an Adapter-side loss, without
    ///         crediting UnifiedPool/anything else — grossManagedAssets() drops for real.
    function _simulateLoss(uint256 amount) internal {
        vm.prank(address(vault));
        usdt.transfer(makeAddr("lossSink"), amount);
    }

    function test_writeDownInsolvency_unblocksSettlement() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 funderRid = vault.nextRequestId() - 1; // funder2's minRaiseAmount deposit
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        // Vault holds alice's claimed-but-unwithdrawn 1_000e6 (still in vault) + funder2's
        // still-PENDING 100_000e6 == 101_000e6 gross. Drain it down to 500e6 — well below
        // funder2's 100_000e6 pendingDepositLiability.
        _simulateLoss(101_000e6 - 500e6);

        assertEq(vault.grossManagedAssets(), 500e6);
        assertEq(vault.pendingDepositLiability(), 100_000e6);
        vm.expectRevert(IBaseVault.AccountingInsolvent.selector);
        vault.totalAssets();

        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.prank(settlement);
        vm.expectRevert(IBaseVault.AccountingInsolvent.selector);
        vault.snapshotSettlementPrice(cycleNumber);

        // Governance haircuts funder2's pending deposit down to 300e6 — enough to clear the
        // deficit (500e6 gross >= 300e6 liabilities) while leaving 200e6 of headroom, so
        // existing shareholders (alice) absorb the rest of the loss automatically via price.
        // writeDownInsolvency is Timelock-only (no direct Owner bypass, even during CONFIGURING)
        // — route through VaultTimelock.
        _scheduleAndExecute(governor, abi.encodeCall(
            IBaseVault.writeDownInsolvency,
            (
                _arr(funderRid), _arr(uint256(300e6)),
                new uint256[](0), new uint256[](0),
                new uint256[](0), new uint256[](0)
            )
        ));

        assertEq(vault.pendingDepositLiability(), 300e6);
        assertEq(vault.totalAssets(), 200e6);

        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vm.prank(settlement);
        vault.settle(cycleNumber, _rs1(funderRid, 300e6), _rs0(), 0);

        assertEq(vault.pendingDepositLiability(), 0);
    }

    // NOTE: writeDownInsolvency is now Timelock-only (no direct-Owner bypass). Since these three
    // tests route through VaultTimelock.executeParamChange, the underlying BaseVault revert
    // reason is swallowed by the low-level `.call()` there and surfaces as generic
    // IVaultTimelock.CallFailed instead of the original selector.

    function test_writeDownInsolvency_revertsWhenNotInsolvent() public {
        vm.prank(governor);
        bytes32 id = tl.scheduleParamChange(address(vault), abi.encodeCall(
            IBaseVault.writeDownInsolvency,
            (
                new uint256[](0), new uint256[](0),
                new uint256[](0), new uint256[](0),
                new uint256[](0), new uint256[](0)
            )
        ));
        vm.warp(block.timestamp + tl.delay());
        vm.expectRevert(IVaultTimelock.CallFailed.selector);
        tl.executeParamChange(id);
    }

    function test_writeDownInsolvency_revertsIfIncreasesLiability() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 funderRid = vault.nextRequestId() - 1;
        _simulateLoss(101_000e6 - 500e6);

        vm.prank(governor);
        bytes32 id = tl.scheduleParamChange(address(vault), abi.encodeCall(
            IBaseVault.writeDownInsolvency,
            (
                _arr(funderRid), _arr(uint256(200_000e6)), // more than the original 100_000e6
                new uint256[](0), new uint256[](0),
                new uint256[](0), new uint256[](0)
            )
        ));
        vm.warp(block.timestamp + tl.delay());
        vm.expectRevert(IVaultTimelock.CallFailed.selector);
        tl.executeParamChange(id);
    }

    function test_writeDownInsolvency_revertsIfInsufficient() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 funderRid = vault.nextRequestId() - 1;
        _simulateLoss(101_000e6 - 500e6);

        // Alice's own 1_000e6 deposit is also still PENDING here (unsettled), so it still
        // counts toward liabilities alongside funder2's haircut amount.
        vm.prank(governor);
        bytes32 id = tl.scheduleParamChange(address(vault), abi.encodeCall(
            IBaseVault.writeDownInsolvency,
            (
                _arr(funderRid), _arr(uint256(600e6)), // 600e6 + alice's untouched 1_000e6 still exceeds 500e6 gross
                new uint256[](0), new uint256[](0),
                new uint256[](0), new uint256[](0)
            )
        ));
        vm.warp(block.timestamp + tl.delay());
        vm.expectRevert(IVaultTimelock.CallFailed.selector);
        tl.executeParamChange(id);
    }

    function test_writeDownInsolvency_by_non_governor_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _simulateLoss(101_000e6 - 500e6);

        vm.prank(alice);
        vm.expectRevert(); // Unauthorized()
        vault.writeDownInsolvency(
            new uint256[](0), new uint256[](0),
            new uint256[](0), new uint256[](0),
            new uint256[](0), new uint256[](0)
        );
    }

    function test_writeDownInsolvency_haircutsPartiallyFilledRedeem() public {
        uint256 assets = 1_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();

        // Partially settle the redeem (half), leaving it QUEUED with settledAssets > 0.
        uint256 half = shares / 2;
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vault.settle(cycleNumber, _rs0(), _rs1(redeemId, half), 0);
        vm.stopPrank();
        _completeCycle();

        uint256 reservedBefore = vault.reservedRedeemLiability();
        assertGt(reservedBefore, 0);

        // writeDownInsolvency requires actual insolvency (gross < liabilities) — simulate an
        // adapter-side loss that dips gross just under liabilitiesBefore, while staying above
        // liabilitiesAfter (post-haircut), so the write-down itself doesn't revert either.
        uint256 liabilitiesBefore = vault.pendingDepositLiability() + reservedBefore + vault.refundableLiability();
        uint256 gross = vault.grossManagedAssets();
        if (gross >= liabilitiesBefore) {
            _simulateLoss(gross - liabilitiesBefore + 1);
        }

        // Governance haircuts the partially-filled redeem's already-reserved liability.
        _scheduleAndExecute(governor, abi.encodeCall(
            IBaseVault.writeDownInsolvency,
            (
                new uint256[](0), new uint256[](0),
                _arr(redeemId), _arr(reservedBefore / 2),
                new uint256[](0), new uint256[](0)
            )
        ));

        assertEq(vault.reservedRedeemLiability(), reservedBefore / 2);
    }

    // -------------------------------------------------------------------
    // Performance fee — unset recipient
    // -------------------------------------------------------------------

    function test_setPerformanceFeeBps_revertsIfRecipientUnset_viaTimelock() public {
        // Task 5's recipient-must-already-be-set guard on setPerformanceFeeBps makes the old
        // "fee enabled but recipient unset -> PerformanceFeeSkipped" scenario unreachable via the
        // public API: the vault has no recipient configured yet (setUp() never sets one), so
        // enabling a nonzero fee now reverts up front, whether called directly or via Timelock.
        vm.prank(curator);
        bytes32 id = tl.scheduleParamChange(address(vault), abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(100))));
        vm.warp(block.timestamp + tl.delay());
        vm.expectRevert(IVaultTimelock.CallFailed.selector);
        tl.executeParamChange(id);

        assertEq(vault.performanceFeeBps(), 0);
    }

    function test_snapshotSettlementPrice_accruesPerformanceFee_whenRecipientSet() public {
        // Vault is already past CONFIGURING — Curator-class actions are Timelock-only now.
        // Recipient must be set first: setPerformanceFeeBps now guards against enabling a nonzero
        // fee before a recipient exists.
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeRecipient, (bob)));
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(100)))); // 1%

        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        usdt.mint(address(vault), 10_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));

        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        assertGt(vault.balanceOf(bob), 0);
    }

    // -------------------------------------------------------------------
    // Performance fee — cap raised to 10,000 bps
    // -------------------------------------------------------------------

    function test_setPerformanceFeeBps_allowsAboveOldFivePercentCeiling() public {
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeRecipient, (bob)));
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(5000)))); // 50%
        assertEq(vault.performanceFeeBps(), 5000);
    }

    function test_setPerformanceFeeBps_revertsAboveTenThousandBps() public {
        vm.prank(curator); // still CONFIGURING at this point in a fresh vault — direct Curator call
        EarnVault v = new EarnVault(
            "Fee Cap", "htFEE", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.prank(governor);
        v.setCurator(curator);
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.FeeTooHigh.selector, uint16(10_001)));
        v.setPerformanceFeeBps(10_001);
    }

    function test_setPerformanceFeeBps_revertsIfRecipientNotYetSet() public {
        EarnVault v = new EarnVault(
            "Fee Guard", "htFEEG", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.prank(governor);
        v.setCurator(curator);
        vm.prank(curator);
        vm.expectRevert(IBaseVault.InvalidFeeRecipient.selector);
        v.setPerformanceFeeBps(100);
    }

    // -------------------------------------------------------------------
    // Protocol fee split — Governor-only config
    // -------------------------------------------------------------------

    function test_setProtocolFeeConfig_governorSucceeds() public {
        address revPool = makeAddr("revenuePool");
        vm.prank(governor); // this test file's `governor` doubles as HyperAccessControl's GOVERNOR_ROLE holder
        vault.setProtocolFeeConfig(revPool, 3000);
        assertEq(vault.revenuePool(), revPool);
        assertEq(vault.protocolFeeShareBps(), 3000);
    }

    function test_setProtocolFeeConfig_revertsForNonGovernor() public {
        vm.prank(curator);
        vm.expectRevert(); // Unauthorized — governed by HyperAccessControl, not Vault-local Curator
        vault.setProtocolFeeConfig(makeAddr("revenuePool"), 3000);
    }

    function test_setProtocolFeeConfig_revertsAboveTenThousandBps() public {
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.FeeTooHigh.selector, uint16(10_001)));
        vault.setProtocolFeeConfig(makeAddr("revenuePool"), 10_001);
    }

    function test_setProtocolFeeConfig_revertsForZeroRevenuePoolWithNonzeroShare() public {
        vm.prank(governor);
        vm.expectRevert(IBaseVault.InvalidFeeRecipient.selector);
        vault.setProtocolFeeConfig(address(0), 1);
    }

    function test_setProtocolFeeConfig_allowsZeroShareWithZeroRevenuePool() public {
        vm.prank(governor);
        vault.setProtocolFeeConfig(address(0), 0);
        assertEq(vault.revenuePool(), address(0));
        assertEq(vault.protocolFeeShareBps(), 0);
    }

    // -------------------------------------------------------------------
    // Performance fee — split between recipient and revenuePool
    // -------------------------------------------------------------------

    function test_snapshotSettlementPrice_splitsFeeBetweenRecipientAndRevenuePool() public {
        address revPool = makeAddr("revenuePool");
        vm.prank(governor);
        vault.setProtocolFeeConfig(revPool, 3000); // protocol 30%

        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeRecipient, (bob)));
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(2000)))); // 20% total fee

        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        uint256 yield = 100_000e6; // matches the client's worked example
        usdt.mint(address(vault), yield);

        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.recordLogs();
        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        // Client's worked example: 100_000 USDT profit, 20% fee -> 20_000 Share total,
        // 30% protocol / 70% manager split -> 6_000 / 14_000 Share.
        // (Exact totalSupply/assets at snapshot time differ from the doc's simplified example, so
        // assert the *split ratio* rather than the literal 6_000/14_000 numbers.)
        uint256 revPoolShares = vault.balanceOf(revPool);
        uint256 bobShares = vault.balanceOf(bob);
        assertGt(revPoolShares, 0);
        assertGt(bobShares, 0);
        // protocolFeeShares = feeShares * 3000 / 10_000 (floored) — exact, same floor-division
        // semantics as the contract, no tolerance.
        assertEq(revPoolShares, ((revPoolShares + bobShares) * 3000) / 10_000);

        // No-drift invariant: decode the PerformanceFeeDistributed event and cross-check its
        // reported totals against both the event's own split and the actual on-chain balances.
        // This is the check that would fail if recipientFeeShares were computed via an
        // independent second mulDiv instead of feeShares - protocolFeeShares.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        uint256 feeShares;
        uint256 protocolFeeShares;
        uint256 recipientFeeShares;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == IBaseVault.PerformanceFeeDistributed.selector) {
                (, feeShares, protocolFeeShares, recipientFeeShares,,) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, address, address));
                found = true;
                break;
            }
        }
        assertTrue(found, "PerformanceFeeDistributed not emitted");
        assertEq(protocolFeeShares + recipientFeeShares, feeShares);
        assertEq(feeShares, vault.balanceOf(revPool) + vault.balanceOf(bob));
    }

    function test_snapshotSettlementPrice_singleMint_whenRecipientEqualsRevenuePool() public {
        vm.prank(governor);
        vault.setProtocolFeeConfig(bob, 3000); // revenuePool == performanceFeeRecipient == bob

        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeRecipient, (bob)));
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(2000))));

        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        usdt.mint(address(vault), 100_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));

        vm.recordLogs();
        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        assertGt(vault.balanceOf(bob), 0);

        // Prove the single-mint branch (revenuePool == performanceFeeRecipient) actually took a
        // single _mintShares call for the fee, rather than two separate mints that happened to
        // land on the same balance. Count Transfer(0x0, bob, _) mint events emitted for the fee.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferTopic = keccak256("Transfer(address,address,uint256)");
        uint256 mintToBobCount;
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(vault) && logs[i].topics[0] == transferTopic
                    && logs[i].topics[1] == bytes32(0) && address(uint160(uint256(logs[i].topics[2]))) == bob
            ) {
                mintToBobCount++;
            }
        }
        assertEq(mintToBobCount, 1, "expected exactly one mint Transfer to bob (single-mint branch)");
    }

    function test_snapshotSettlementPrice_protocolOnlyWhenShareIs100Percent() public {
        address revPool = makeAddr("revenuePool");
        vm.prank(governor);
        vault.setProtocolFeeConfig(revPool, 10_000); // 100% to protocol

        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeRecipient, (bob)));
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(2000))));

        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        usdt.mint(address(vault), 100_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        assertGt(vault.balanceOf(revPool), 0);
        assertEq(vault.balanceOf(bob), 0); // manager gets nothing this cycle — 100% went to protocol
    }

    function test_snapshotSettlementPrice_emitsPerformanceFeeDistributed() public {
        address revPool = makeAddr("revenuePool");
        vm.prank(governor);
        vault.setProtocolFeeConfig(revPool, 3000);
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeRecipient, (bob)));
        _scheduleAndExecute(curator, abi.encodeCall(IBaseVault.setPerformanceFeeBps, (uint16(2000))));

        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        _settleDeposits(_arr(rid));
        vm.prank(alice); vault.claimDeposit(rid, alice);

        usdt.mint(address(vault), 100_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));

        // Don't assert exact feeAssets/feeShares values inline (depends on live totalAssets/totalSupply
        // at snapshot time) — `IBaseVault.PerformanceFeeDistributed.selector` on an event identifier
        // doesn't compile as a topic-matching expression, so use vm.expectEmit checking only the
        // indexed cycleNumber topic (the non-indexed fee amounts aren't known ahead of the call) and
        // let a separate balance-based test (above) cover the numeric split.
        vm.expectEmit(true, false, false, false, address(vault));
        emit IBaseVault.PerformanceFeeDistributed(cycleNumber, 0, 0, 0, 0, revPool, bob);
        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
    }

    function test_settle_subscriptionCapExceeded_reverts() public {
        // Fresh vault with a small cap. StateManager.recordSubscription only enforces the
        // cap during SUBSCRIBING, so a deposit within cap gets the product to OPERATING,
        // then a second OPERATING-phase deposit (recordSubscription no-ops there) pushes the
        // projected AUM over cap — only BaseVault.settle()'s own cap check catches this.
        EarnVault v = new EarnVault(
            "Cap Test", "htCAP", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.prank(factory);
        sm.registerVault(address(v), ProductState.CONFIGURING, CycleState.ACCEPTING);

        vm.startPrank(governor);
        v.setCurator(governor); // reused as Curator here too; still CONFIGURING, no Timelock class conflict
        ProductParams memory p = _defaultParams();
        p.subscriptionCap = 500e6;
        p.walletSubscriptionCap = 10_000e6;
        p.minRaiseAmount = 100e6;
        sm.setProductParams(address(v), p);
        v.setSettlement(settlement);
        v.setKeeper(keeper, true);
        vm.stopPrank();
        vm.prank(keeper);
        sm.openSubscription(address(v));

        vm.startPrank(alice);
        usdt.approve(address(v), 100e6);
        uint256 rid0 = v.requestDeposit(100e6, alice);
        vm.stopPrank();

        uint256 target = p.firstCycleStart + p.cycleDuration + 1;
        vm.warp(target);
        // Cycle-0 fix: finalizeSubscription now force-sets CycleState to CALCULATING directly
        // on a successful raise, instead of leaving it at ACCEPTING — no separate
        // startCycleCalculation call needed (and calling it here would now revert
        // WrongCycleState since the cycle is no longer ACCEPTING).
        vm.prank(keeper); sm.finalizeSubscription(address(v));

        uint256 cycle0 = sm.currentCycleNumber(address(v));
        vm.startPrank(settlement);
        v.snapshotSettlementPrice(cycle0);
        v.settle(cycle0, _rs1(rid0, 100e6), _rs0(), 0);
        vm.stopPrank();
        vm.prank(settlement);
        sm.completeCycle(address(v));

        // OPERATING-phase deposit: recordSubscription no-ops here, so this is only caught by
        // BaseVault.settle()'s own subscriptionCap check.
        vm.startPrank(bob);
        usdt.approve(address(v), 500e6);
        uint256 rid1 = v.requestDeposit(500e6, bob);
        vm.stopPrank();

        uint256 cycleStart = sm.currentCycleStart(address(v));
        vm.warp(cycleStart + p.cycleDuration + 1);
        vm.prank(keeper); sm.startCycleCalculation(address(v));

        uint256 cycle1 = sm.currentCycleNumber(address(v));
        vm.prank(settlement);
        v.snapshotSettlementPrice(cycle1);

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.SubscriptionCapExceeded.selector, 500e6, 600e6));
        v.settle(cycle1, _rs1(rid1, 500e6), _rs0(), 0);
    }

    function test_settle_reverts_when_vault_paused() public {
        uint256 assets = 1_000e6;
        uint256 rid = _requestDeposit(alice, assets);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.prank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);

        vm.prank(guardian);
        sm.pause(address(vault), PauseState.PAUSED_BY_GUARDIAN);

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(
            IStateManager.VaultPausedError.selector, address(vault), PauseState.PAUSED_BY_GUARDIAN
        ));
        vault.settle(cycleNumber, _rs1(rid, 1_000e6), _rs0(), 0);
    }

    // -----------------------------------------------------------------------
    // Adapter / UnifiedPool wiring
    // -----------------------------------------------------------------------

    function test_setUnifiedPool_by_non_governor_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setUnifiedPool(alice);
    }

    function test_setUnifiedPool_by_governor_succeeds() public {
        // Vault is already past CONFIGURING — setUnifiedPool is Timelock-only now.
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setUnifiedPool, (alice)));
        assertEq(vault.unifiedPool(), alice);
    }

    function test_addAdapter_revertsIfRealAssetsReverts() public {
        // Create a fresh vault in CONFIGURING state to test direct call (not through Timelock)
        EarnVault testVault = new EarnVault(
            "Test Vault", "tVault", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.prank(factory);
        sm.registerVault(address(testVault), ProductState.CONFIGURING, CycleState.ACCEPTING);

        vm.startPrank(governor);
        testVault.setCurator(curator);
        AdapterRegistry testReg = new AdapterRegistry(governor);
        testVault.bindGovernance(address(tl), address(testReg));
        vm.stopPrank();

        RevertingRealAssetsAdapter badAdapter = new RevertingRealAssetsAdapter(address(testVault));
        vm.prank(governor);
        testReg.setAdapterAllowed(address(badAdapter), true);

        vm.prank(curator);
        vm.expectRevert("malformed adapter");
        testVault.addAdapter(address(badAdapter));
    }

    // -----------------------------------------------------------------------
    // setGate
    // -----------------------------------------------------------------------

    function test_setGate_by_governor() public {
        AllowAllGate g = new AllowAllGate();
        // Vault is already past CONFIGURING — setGate is Timelock-only now.
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setGate, (address(g))));
        assertEq(vault.gate(), address(g));
    }

    function test_setGate_by_non_governor_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setGate(alice);
    }

    // -----------------------------------------------------------------------
    // setSettlement
    // -----------------------------------------------------------------------

    // NOTE: SettlementAlreadySet was removed in the redesign — setSettlement may now be called
    // again to replace an already-set settlement, subject to the same CONFIGURING/Timelock
    // gating and the new CycleState.CALCULATING/FULFILLING guard. Split into two tests below.

    function test_setSettlement_replaceable_viaTimelock() public {
        // Vault is already past CONFIGURING (setUp opened subscription) — route through
        // VaultTimelock. A second call to setSettlement no longer reverts.
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setSettlement, (alice)));
        assertEq(vault.settlement(), alice);
    }

    function test_setSettlement_revertsDuringActiveCycle() public {
        EarnVault v = new EarnVault(
            "Active Cycle Test", "htACT", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.prank(factory);
        sm.registerVault(address(v), ProductState.CONFIGURING, CycleState.CALCULATING);

        // Still CONFIGURING, so this is a direct Owner call — but the vault's CycleState is
        // CALCULATING, which setSettlement now blocks regardless of CONFIGURING/Timelock gating.
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.SettlementChangeDuringActiveCycle.selector, CycleState.CALCULATING));
        v.setSettlement(settlement);
    }

    // -----------------------------------------------------------------------
    // Sync ERC-4626 deposit (EarnVault specific)
    // -----------------------------------------------------------------------

    function test_syncDeposit_only_liquidityBridge() public {
        // vault has no liquidityBridge set (address(0))
        vm.prank(alice);
        vm.expectRevert(); // OnlyLiquidityBridge
        vault.deposit(1_000e6, alice);
    }

    function test_syncDeposit_with_liquidityBridge() public {
        address lb = makeAddr("lb");
        EarnVault v = new EarnVault(
            "Cash", "htCASH",
            address(usdt), address(sm), address(queue), governor, lb
        );
        vm.prank(factory); sm.registerVault(address(v), ProductState.CONFIGURING, CycleState.ACCEPTING);

        uint256 assets = 1_000e6;
        usdt.mint(lb, assets);
        vm.startPrank(lb);
        usdt.approve(address(v), assets);
        uint256 shares = v.deposit(assets, alice);
        vm.stopPrank();

        assertEq(shares, _sharesFor(assets));
        assertEq(v.balanceOf(alice), shares);
    }

    // -----------------------------------------------------------------------
    // markRefundable — Curator-only (moved off Keeper)
    // -----------------------------------------------------------------------

    function _makeFundingFailedVault() internal returns (EarnVault v, ProductParams memory p) {
        v = new EarnVault(
            "Refund Test", "htREF", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.prank(factory);
        sm.registerVault(address(v), ProductState.CONFIGURING, CycleState.ACCEPTING);

        vm.startPrank(governor);
        v.setCurator(curator);
        v.setKeeper(keeper, true);
        vm.stopPrank();

        p = _defaultParams();
        p.minRaiseAmount = 100_000e6; // deliberately never met below
        vm.prank(curator);
        sm.setProductParams(address(v), p);

        vm.prank(keeper);
        sm.openSubscription(address(v));

        // Small deposit, well under minRaiseAmount. Alice already has 100_000e6 from setUp.
        vm.startPrank(alice);
        usdt.approve(address(v), 1_000e6);
        v.requestDeposit(1_000e6, alice);
        vm.stopPrank();

        vm.warp(p.subscriptionEnd + 1);
        vm.prank(keeper);
        sm.finalizeSubscription(address(v));
        assertEq(uint8(sm.getProductState(address(v))), uint8(ProductState.FUNDING_FAILED));
    }

    function test_markRefundable_revertsForKeeper() public {
        (EarnVault v,) = _makeFundingFailedVault();
        uint256[] memory ids = new uint256[](1);
        ids[0] = v.nextRequestId() - 1;

        vm.prank(keeper);
        vm.expectRevert(IBaseVault.Unauthorized.selector);
        v.markRefundable(ids);
    }

    function test_markRefundable_revertsForRandomCaller() public {
        (EarnVault v,) = _makeFundingFailedVault();
        uint256[] memory ids = new uint256[](1);
        ids[0] = v.nextRequestId() - 1;

        vm.prank(alice);
        vm.expectRevert(IBaseVault.Unauthorized.selector);
        v.markRefundable(ids);
    }

    function test_markRefundable_curatorSucceeds() public {
        (EarnVault v,) = _makeFundingFailedVault();
        uint256 rid = v.nextRequestId() - 1;
        uint256[] memory ids = new uint256[](1);
        ids[0] = rid;

        assertEq(v.pendingDepositLiability(), 1_000e6);
        assertEq(v.refundableLiability(), 0);

        vm.prank(curator);
        v.markRefundable(ids);

        assertEq(v.pendingDepositLiability(), 0);
        assertEq(v.refundableLiability(), 1_000e6);

        // A REFUNDABLE request can now be refunded; a still-PENDING one could not (proves the
        // state actually flipped, without needing a dedicated field getter).
        vm.prank(alice);
        v.claimRefund(rid);
        assertEq(usdt.balanceOf(alice), 100_000e6); // alice started with 100_000e6, spent 1_000e6, got it back
    }

    // -----------------------------------------------------------------------
    // returnPrincipalToPool
    // -----------------------------------------------------------------------

    /// @notice Points `vault`'s settlement at a fresh MockSettlementOperator and approves
    ///         `settlement` (the plain EOA from setUp) as that vault's Settlement Operator, so
    ///         `vm.prank(settlement)` satisfies `_onlySettlementOperator()`'s real
    ///         `ISettlement(vault.settlement()).isOperator(vault, msg.sender)` check.
    function _wireSettlementOperator() internal {
        MockSettlementOperator mockSettlement = new MockSettlementOperator();
        // Subscription is already open at this point (post-setUp), so setSettlement is a
        // VaultTimelock-only OWNER action, not a direct-owner call.
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setSettlement, (address(mockSettlement))));
        mockSettlement.setOperator(address(vault), settlement, true);
    }

    function test_returnPrincipalToPool_revertsIfUnifiedPoolNotSet() public {
        _wireSettlementOperator();
        usdt.mint(address(vault), 100e6);

        vm.prank(settlement);
        vm.expectRevert(IBaseVault.UnifiedPoolNotSet.selector);
        vault.returnPrincipalToPool(100e6);
    }

    function test_returnPrincipalToPool_movesUSDTAndCreditsPending() public {
        _wireSettlementOperator();

        // Wire a real UnifiedPool for this one test.
        UnifiedPool poolImpl = new UnifiedPool();
        bytes memory initData = abi.encodeCall(UnifiedPool.initialize, (address(usdt), address(sm), address(ac)));
        UnifiedPool pool = UnifiedPool(address(new ERC1967Proxy(address(poolImpl), initData)));

        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setUnifiedPool, (address(pool))));

        vm.prank(governor); // vault's Owner == this pool's expected addTrancheVault caller
        pool.addTrancheVault(Tranche.Cash, address(vault));

        usdt.mint(address(vault), 5_000e6);

        vm.prank(settlement); // this vault's Settlement Operator (see _wireSettlementOperator)
        vault.returnPrincipalToPool(3_000e6);

        assertEq(pool.pending(address(vault)), 3_000e6);
        assertEq(usdt.balanceOf(address(vault)), 2_000e6);
        assertEq(usdt.balanceOf(address(pool)), 3_000e6);
    }

    function test_returnPrincipalToPool_revertsIfExceedsFreeUSDT() public {
        _wireSettlementOperator();

        UnifiedPool poolImpl = new UnifiedPool();
        bytes memory initData = abi.encodeCall(UnifiedPool.initialize, (address(usdt), address(sm), address(ac)));
        UnifiedPool pool = UnifiedPool(address(new ERC1967Proxy(address(poolImpl), initData)));
        _scheduleAndExecute(governor, abi.encodeCall(IBaseVault.setUnifiedPool, (address(pool))));

        usdt.mint(address(vault), 100e6);

        vm.prank(settlement);
        vm.expectRevert(); // InsufficientFreeUSDT — exact args depend on freeVaultUSDT() internals
        vault.returnPrincipalToPool(101e6);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _defaultParams() internal view returns (ProductParams memory) {
        return ProductParams({
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

    function _sharesFor(uint256 assets) internal pure returns (uint256) {
        return assets * SHARE_SCALE / PRICE_ONE;
    }

    function _assetsFor(uint256 shares) internal pure returns (uint256) {
        return shares * PRICE_ONE / SHARE_SCALE;
    }

    function _requestDeposit(address user, uint256 amount) internal returns (uint256) {
        vm.startPrank(user);
        usdt.approve(address(vault), amount);
        uint256 rid = vault.requestDeposit(amount, user);
        vm.stopPrank();
        _reqAssets[rid] = amount;
        return rid;
    }

    function _advanceToCalculating() internal {
        ProductParams memory p = sm.getParams(address(vault));

        if (uint8(sm.getProductState(address(vault))) == uint8(ProductState.SUBSCRIBING)) {
            // Warp past subscriptionEnd + cycleDuration so both checks pass
            uint256 target = p.firstCycleStart + p.cycleDuration + 1;
            if (block.timestamp < target) vm.warp(target);
            // Use a dedicated funder to meet minRaiseAmount without hitting alice's wallet cap
            if (sm.totalSubscribed(address(vault)) < p.minRaiseAmount) {
                address funder = makeAddr("funder2");
                usdt.mint(funder, p.minRaiseAmount);
                vm.startPrank(funder);
                usdt.approve(address(vault), p.minRaiseAmount);
                uint256 fRid = vault.requestDeposit(p.minRaiseAmount, funder);
                vm.stopPrank();
                _reqAssets[fRid] = p.minRaiseAmount;
            }
            vm.prank(keeper); sm.finalizeSubscription(address(vault));
        }

        if (uint8(sm.getProductState(address(vault))) == uint8(ProductState.OPERATING) &&
            uint8(sm.getCycleState(address(vault))) == uint8(CycleState.ACCEPTING)) {
            // Warp past current cycle start + cycleDuration
            uint256 cycleStart = sm.currentCycleStart(address(vault));
            uint256 target = cycleStart + p.cycleDuration + 1;
            if (block.timestamp < target) vm.warp(target);
            vm.prank(keeper); sm.startCycleCalculation(address(vault));
        }
    }

    /// @notice Clears the vault's initial SUBSCRIBING-phase raise (via funder2, as
    ///         _advanceToCalculating() already does) and settles/completes that cycle, so the
    ///         vault lands in OPERATING+ACCEPTING for cycle 2. StateManager.recordSubscription
    ///         only enforces walletSubscriptionCap while SUBSCRIBING — tests that need a single
    ///         deposit above that per-wallet cap must run it in a later, already-OPERATING
    ///         cycle, which this sets up.
    function _seedFirstCycle() internal {
        _advanceToCalculating();
        uint256 funderRid = vault.nextRequestId() - 1;
        _settleDeposits(_arr(funderRid));
    }

    function _completeCycle() internal {
        vm.prank(settlement);
        sm.completeCycle(address(vault));
    }

    function _settle(uint256[] memory depIds, uint256[] memory redeemIds, uint256 poolDistributedAssets) internal {
        uint256 cycleNumber = sm.currentCycleNumber(address(vault));
        vm.startPrank(settlement);
        vault.snapshotSettlementPrice(cycleNumber);
        vault.settle(cycleNumber, _toDeposits(depIds), _toRedeems(redeemIds), poolDistributedAssets);
        vm.stopPrank();
        _completeCycle();
    }

    function _settleDeposits(uint256[] memory depIds) internal {
        _settle(depIds, new uint256[](0), 0);
    }

    function _settleRedeems(uint256[] memory redeemIds, uint256 poolDistributedAssets) internal {
        _settle(new uint256[](0), redeemIds, poolDistributedAssets);
    }

    function _arr(uint256 v) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = v;
    }

    function _toDeposits(uint256[] memory ids) internal view returns (RequestSettlement[] memory out) {
        out = new RequestSettlement[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = RequestSettlement({requestId: ids[i], settleAmount: _reqAssets[ids[i]]});
        }
    }

    function _toRedeems(uint256[] memory ids) internal view returns (RequestSettlement[] memory out) {
        out = new RequestSettlement[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = RequestSettlement({requestId: ids[i], settleAmount: _reqShares[ids[i]]});
        }
    }

    function _rs1(uint256 id, uint256 amount) internal pure returns (RequestSettlement[] memory out) {
        out = new RequestSettlement[](1);
        out[0] = RequestSettlement({requestId: id, settleAmount: amount});
    }

    function _rs0() internal pure returns (RequestSettlement[] memory) {
        return new RequestSettlement[](0);
    }
}
