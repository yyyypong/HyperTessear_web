// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {LiquidityEarnVault} from "../src/asset-management/vaults/LiquidityEarnVault.sol";
import {LiquidityBridge} from "../src/asset-management/vaults/LiquidityBridge.sol";
import {ProductState, CycleState, ProductParams, PauseState, RequestSettlement} from "../src/libs/Types.sol";
import {IStateManager} from "../src/interfaces/IStateManager.sol";
import {IBaseVault} from "../src/interfaces/IBaseVault.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title LiquidityEarnVaultTest
/// @notice Covers LP-vault-specific behavior not exercised by EarnVault.t.sol: the old
///         share-based claim/redeem/settle surface is disabled and always reverts.
contract LiquidityEarnVaultTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    LiquidityBridge internal bridge;
    EarnVault internal cashVault;
    LiquidityEarnVault internal lpVault;

    address internal governor   = makeAddr("governor");
    address internal factory    = makeAddr("factory");
    address internal keeper     = makeAddr("keeper");
    address internal settlement = makeAddr("settlement");
    address internal guardian   = makeAddr("guardian");
    address internal alice      = makeAddr("alice");

    uint256 internal constant NOW = 1_000_000;

    function setUp() public {
        vm.warp(NOW);

        ac = new HyperAccessControl(governor);
        usdt = new MockUSDT();
        sm = new StateManager(address(ac));
        queue = new Queue(address(sm));
        bridge = new LiquidityBridge(address(usdt));

        vm.prank(governor);
        sm.setVaultFactory(factory);

        cashVault = new EarnVault(
            "Cash Earn", "htCASH", address(usdt), address(sm), address(queue), governor, address(bridge)
        );
        lpVault = new LiquidityEarnVault(
            "LP Earn", "htLP", address(usdt), address(sm), address(queue), governor,
            address(bridge), address(cashVault)
        );

        vm.startPrank(factory);
        sm.registerVault(address(cashVault), ProductState.CONFIGURING, CycleState.ACCEPTING);
        sm.registerVault(address(lpVault), ProductState.CONFIGURING, CycleState.ACCEPTING);
        vm.stopPrank();

        vm.startPrank(governor);
        lpVault.setCurator(governor); // reused as Curator here too — only used pre-launch below
        lpVault.setKeeper(keeper, true);
        lpVault.setGuardian(guardian);
        sm.setProductParams(address(lpVault), _defaultParams());
        lpVault.setSettlement(settlement);
        vm.stopPrank();

        vm.prank(keeper);
        sm.openSubscription(address(lpVault));

        usdt.mint(alice, 100_000e6);
    }

    // -----------------------------------------------------------------------
    // No-share-mint product — claim/redeem/distribute surface disabled
    // -----------------------------------------------------------------------

    function test_claimDeposit_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(LiquidityEarnVault.ActionDisabled.selector);
        lpVault.claimDeposit(rid, alice);
    }

    function test_requestRedeem_reverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidityEarnVault.ActionDisabled.selector);
        lpVault.requestRedeem(1, alice);
    }

    function test_claimRedeem_reverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidityEarnVault.ActionDisabled.selector);
        lpVault.claimRedeem(1, alice);
    }

    function test_totalSupplyAndBalancesStayZero_evenAfterDeposit() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        // Not calling settle() here — Task 8 rewrites it; this test only needs to confirm no
        // share-minting path is reachable pre-settle. totalSupply must be (and stay) zero.
        assertEq(lpVault.totalSupply(), 0);
        assertEq(lpVault.balanceOf(alice), 0);
    }

    // -----------------------------------------------------------------------
    // settle() — single-transaction cyclical pro-rata distribution
    // -----------------------------------------------------------------------

    function test_settle_distributesCashTokenAndBonusProRata_noSharesMinted() public {
        uint256 assetsAlice = 1_000e6;
        uint256 assetsBob = 3_000e6; // 3x alice's stake -> 3x share of both outputs
        address bob2 = makeAddr("bob2");
        usdt.mint(bob2, 10_000e6);

        uint256 ridAlice = _requestDeposit(alice, assetsAlice);
        uint256 ridBob = _requestDeposit(bob2, assetsBob);
        _advanceToCalculating();

        // Fund the vault with the bonus USDT UnifiedPool would have already `distribute`d in.
        uint256 bonusUsdt = 400e6;
        usdt.mint(address(lpVault), bonusUsdt);

        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));
        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        lpVault.settle(cycleNumber, _arr2(ridAlice, ridBob), new RequestSettlement[](0), bonusUsdt);
        vm.stopPrank();

        // No shares minted, ever.
        assertEq(lpVault.totalSupply(), 0);
        assertEq(lpVault.balanceOf(alice), 0);

        // USDT fully left the vault (bridged out + bonus distributed), no dust.
        assertEq(usdt.balanceOf(address(lpVault)), 0);
        assertEq(usdt.balanceOf(address(cashVault)), assetsAlice + assetsBob);

        // Cash Token pro-rata: bob2 (3/4 of total) got 3x alice's Cash Token amount.
        // cashVault starts at a fresh 0-supply, so its price-per-share is the hardcoded
        // 1_000_000 (see BaseVault._pricePerShare), and convertToShares(assets) is an exact
        // `assets * 1e12` (1e6 USDT decimals -> 1e18 share decimals) with zero truncation.
        // cashReceived = convertToShares(4_000e6) = 4_000e6 * 1e12 = 4_000e18 exactly.
        // alice (non-last, array index 0): mulDiv(4_000e18, 1_000e6, 4_000e6) = 1_000e18 exactly.
        // bob2 (last, array index 1): remainder = 4_000e18 - 1_000e18 = 3_000e18 exactly.
        uint256 cashAlice = cashVault.balanceOf(alice);
        uint256 cashBob = cashVault.balanceOf(bob2);
        assertEq(cashAlice, 1_000e18);
        assertEq(cashBob, 3_000e18);
        assertEq(cashVault.balanceOf(address(lpVault)), 0); // fully distributed, no dust left in the LP vault

        // Bonus USDT pro-rata, same ratio, same full-distribution guarantee.
        // alice (non-last): mulDiv(400e6, 1_000e6, 4_000e6) = 100e6 exactly.
        // bob2 (last): remainder = 400e6 - 100e6 = 300e6 exactly.
        assertEq(usdt.balanceOf(alice) - (100_000e6 - assetsAlice), 100e6);
        assertEq(usdt.balanceOf(bob2) - (10_000e6 - assetsBob), 300e6);

        // Liability accounting cleared for both requests.
        assertEq(lpVault.pendingDepositLiability(), 0);
        assertEq(lpVault.pendingDepositByOwner(alice), 0);
        assertEq(lpVault.pendingDepositByOwner(bob2), 0);
    }

    function test_settle_lastRequestAbsorbsRoundingRemainder() public {
        // Pick amounts that don't divide evenly to force a nonzero remainder.
        uint256 a1 = 1e6;
        uint256 a2 = 1e6;
        uint256 a3 = 1e6; // 3-way even split of an odd bonus amount -> remainder on the last request
        address u1 = alice;
        address u2 = makeAddr("u2");
        address u3 = makeAddr("u3");
        usdt.mint(u2, 10e6);
        usdt.mint(u3, 10e6);

        uint256 r1 = _requestDeposit(u1, a1);
        uint256 r2 = _requestDeposit(u2, a2);
        uint256 r3 = _requestDeposit(u3, a3);
        _advanceToCalculating();

        uint256 bonus = 10e6; // 10 / 3 doesn't divide evenly
        usdt.mint(address(lpVault), bonus);

        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));
        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        lpVault.settle(cycleNumber, _arr3(r1, r2, r3), new RequestSettlement[](0), bonus);
        vm.stopPrank();

        // Full distribution — no dust anywhere, including in the vault itself.
        assertEq(usdt.balanceOf(address(lpVault)), 0);

        // Exact per-recipient bonus split (hand-computed, not just "sums to bonus"):
        // non-last requests (r1, r2): mulDiv(10e6, 1e6, 3e6) = floor(10e6 / 3) = 3_333_333 each.
        // last request (r3, array-order-last): remainder = 10e6 - 2*3_333_333 = 3_333_334.
        assertEq(usdt.balanceOf(u1) - (100_000e6 - a1), 3_333_333);
        assertEq(usdt.balanceOf(u2) - (10e6 - a2), 3_333_333);
        assertEq(usdt.balanceOf(u3) - (10e6 - a3), 3_333_334);
    }

    function test_settle_cashTokenRemainderAbsorbedByLastRequest() public {
        // Finding 2 fix: exercise a nonzero remainder on the *Cash Token* leg specifically.
        // With a fresh (0-supply) cashVault, convertToShares(assets) = assets * 1e12 exactly
        // (see the price-1e6 reasoning in the pro-rata test above), so the per-request split
        // never truncates no matter how uneven the weights are. To force a genuine Cash Token
        // remainder we first run a seed cycle to give cashVault nonzero supply, then skew its
        // price away from the clean 1_000_000 by donating raw USDT directly into it (bypassing
        // the mint path), so the *next* cycle's convertToShares truncates for real.

        // --- Seed cycle: single depositor, price stays at the initial 1_000_000. ---
        address seed = makeAddr("seed");
        usdt.mint(seed, 3_000_000);
        uint256 ridSeed = _requestDeposit(seed, 3_000_000);
        _advanceToCalculating();
        uint256 cycle1 = sm.currentCycleNumber(address(lpVault));
        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycle1);
        lpVault.settle(cycle1, _arr(ridSeed), new RequestSettlement[](0), 0);
        sm.completeCycle(address(lpVault));
        vm.stopPrank();
        // cashVault: totalSupply = convertToShares(3_000_000) = 3_000_000 * 1e12 = 3e18.
        // cashVault USDT balance = 3_000_000.
        assertEq(cashVault.totalSupply(), 3e18);

        // --- Skew: donate 3 raw USDT units directly into cashVault (no shares minted). ---
        // cashVault.totalAssets() is now 3_000_000 + 3 = 3_000_003 against the same 3e18 supply.
        usdt.mint(address(cashVault), 3);

        // --- Cycle 2: two uneven deposits, split 1_000_000 / 2_500_000 (cycleTotal 3_500_000). ---
        address u1 = alice;
        address u2 = makeAddr("cashRemU2");
        usdt.mint(u2, 3_000_000);
        uint256 r1 = _requestDeposit(u1, 1_000_000);
        uint256 r2 = _requestDeposit(u2, 2_500_000);
        _advanceToCalculating();
        uint256 cycle2 = sm.currentCycleNumber(address(lpVault));
        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycle2);
        lpVault.settle(cycle2, _arr2(r1, r2), new RequestSettlement[](0), 0);
        vm.stopPrank();

        // EarnVault.deposit() pulls the USDT in via safeTransferFrom *before* it calls
        // convertToShares — so the price used for this mint already reflects the incoming
        // 3_500_000 cycle deposit sitting in cashVault's balance, on top of the old 3_000_003
        // and the still-unchanged old 3e18 supply:
        //   price = mulDiv(3_000_003 + 3_500_000, 1e18, 3e18) = mulDiv(6_500_003, 1e18, 3e18)
        //         = floor(6_500_003 / 3) = 2_166_667.
        //   cashReceived = mulDiv(3_500_000, 1e18, 2_166_667) = 1_615_384_366_863_943_559 (floor).
        // u1 (non-last, r1): mulDiv(1_615_384_366_863_943_559, 1_000_000, 3_500_000)
        //                   = 461_538_390_532_555_302 (floor).
        // u2 (last, r2): remainder = 1_615_384_366_863_943_559 - 461_538_390_532_555_302
        //               = 1_153_845_976_331_388_257 — one wei-unit *more* than the naive floor
        //               (1_153_845_976_331_388_256) would give, proving the remainder-absorption
        //               branch, not just the floor-division branch, actually ran.
        assertEq(cashVault.balanceOf(u1), 461_538_390_532_555_302);
        assertEq(cashVault.balanceOf(u2), 1_153_845_976_331_388_257);
        assertEq(
            cashVault.balanceOf(u1) + cashVault.balanceOf(u2),
            1_615_384_366_863_943_559
        );
        assertEq(cashVault.balanceOf(address(lpVault)), 0); // fully distributed, no dust
    }

    // -----------------------------------------------------------------------
    // evictDepositRequest — Curator-only unblock of a stuck FIFO head request
    // -----------------------------------------------------------------------

    function test_evictDepositRequest_curatorSucceeds_unblocksQueue() public {
        uint256 ridStuck = _requestDeposit(alice, 1_000e6);
        address bob2 = makeAddr("bob2");
        usdt.mint(bob2, 5_000e6);
        uint256 ridBehind = _requestDeposit(bob2, 2_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        vm.prank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);

        // Without eviction, settle() cannot skip the stuck head request — Queue.dequeue
        // enforces strict FIFO order, so submitting only ridBehind would revert upstream in
        // Settlement/Queue. Evict the stuck one first.
        vm.prank(governor); // reused as Curator in this file's setUp
        lpVault.evictDepositRequest(ridStuck);

        // Evicted request no longer blocks the queue and can now be refunded like a normal
        // FUNDING_FAILED-style refund.
        assertEq(lpVault.pendingDepositLiability(), 2_000e6);
        assertEq(lpVault.pendingDepositByOwner(alice), 0);
        assertEq(lpVault.refundableLiability(), 1_000e6);

        vm.prank(alice);
        lpVault.claimRefund(ridStuck);
        assertEq(usdt.balanceOf(alice), 100_000e6); // full principal back

        // The behind request can now settle normally — proving the queue is truly unblocked.
        vm.startPrank(settlement);
        lpVault.settle(cycleNumber, _arr(ridBehind), new RequestSettlement[](0), 0);
        vm.stopPrank();
        assertEq(lpVault.pendingDepositLiability(), 0);
    }

    function test_evictDepositRequest_revertsForNonCurator() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);

        vm.prank(alice);
        vm.expectRevert(); // Unauthorized — alice is neither Curator nor Owner
        lpVault.evictDepositRequest(rid);
    }

    function test_evictDepositRequest_revertsIfNotPending() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        lpVault.settle(cycleNumber, _arr(rid), new RequestSettlement[](0), 0);
        vm.stopPrank();

        // Already SETTLED — cannot be evicted after the fact.
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.RequestNotFound.selector, rid));
        lpVault.evictDepositRequest(rid);
    }

    function test_evictDepositRequest_emitsEvent() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);

        vm.expectEmit(true, true, false, true, address(lpVault));
        emit LiquidityEarnVault.DepositRequestEvicted(rid, alice, 1_000e6, block.timestamp);

        vm.prank(governor);
        lpVault.evictDepositRequest(rid);
    }

    function test_settle_revertsIfRedeemRequestsPassed() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        RequestSettlement[] memory fakeRedeems = new RequestSettlement[](1);
        fakeRedeems[0] = RequestSettlement({requestId: 1, settleAmount: 1});

        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        vm.expectRevert(LiquidityEarnVault.RedeemNotSupported.selector);
        lpVault.settle(cycleNumber, _arr(rid), fakeRedeems, 0);
        vm.stopPrank();
    }

    function test_settle_revertsAboveMaxCycleRequests() public {
        uint256 max = lpVault.MAX_CYCLE_REQUESTS();
        RequestSettlement[] memory items = new RequestSettlement[](max + 1);
        for (uint256 i = 0; i < items.length; i++) {
            address u = address(uint160(1000 + i));
            usdt.mint(u, 1e6);
            vm.startPrank(u);
            usdt.approve(address(lpVault), 1e6);
            uint256 rid = lpVault.requestDeposit(1e6, u);
            vm.stopPrank();
            items[i] = RequestSettlement({requestId: rid, settleAmount: 1e6});
        }
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        vm.expectRevert(abi.encodeWithSelector(LiquidityEarnVault.CycleRequestLimitExceeded.selector, items.length, max));
        lpVault.settle(cycleNumber, items, new RequestSettlement[](0), 0);
        vm.stopPrank();
    }

    function test_settle_partialSettleAmount_reverts() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        RequestSettlement[] memory partialSettle = new RequestSettlement[](1);
        partialSettle[0] = RequestSettlement({requestId: rid, settleAmount: 500e6}); // less than the full 1_000e6

        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        vm.expectRevert(abi.encodeWithSelector(IBaseVault.InvalidSettleAmount.selector, rid));
        lpVault.settle(cycleNumber, partialSettle, new RequestSettlement[](0), 0);
        vm.stopPrank();
    }

    function test_settle_recordsCycleAndAllowsImmediateReopen() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        lpVault.settle(cycleNumber, _arr(rid), new RequestSettlement[](0), 0);
        vm.stopPrank();
        vm.prank(settlement);
        sm.completeCycle(address(lpVault)); // CALCULATING -> ... -> ACCEPTING, next cycle open

        (uint256 acceptedTotal, uint256 cashOut, uint256 bonusOut, bool completed) = lpVault.cycleRecords(cycleNumber);
        assertEq(acceptedTotal, 1_000e6);
        assertGt(cashOut, 0);
        assertEq(bonusOut, 0);
        assertTrue(completed);

        // Second cycle: same vault, fresh ACCEPTING window, deposit works again.
        assertEq(uint8(sm.getCycleState(address(lpVault))), uint8(CycleState.ACCEPTING));
        uint256 rid2 = _requestDeposit(alice, 500e6);
        assertGt(rid2, rid);
    }

    function test_settle_reverts_when_vault_paused() public {
        uint256 rid = _requestDeposit(alice, 1_000e6);
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));
        vm.prank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);

        vm.prank(guardian);
        sm.pause(address(lpVault), PauseState.PAUSED_BY_GUARDIAN);

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(
            IStateManager.VaultPausedError.selector, address(lpVault), PauseState.PAUSED_BY_GUARDIAN
        ));
        lpVault.settle(cycleNumber, _arr(rid), new RequestSettlement[](0), 0);
    }

    function test_settle_emptyBatch_recordsZeroCycleAndDoesNotRevert() public {
        _advanceToCalculating();
        uint256 cycleNumber = sm.currentCycleNumber(address(lpVault));

        vm.startPrank(settlement);
        lpVault.snapshotSettlementPrice(cycleNumber);
        lpVault.settle(cycleNumber, new RequestSettlement[](0), new RequestSettlement[](0), 0);
        vm.stopPrank();

        (uint256 acceptedTotal,,, bool completed) = lpVault.cycleRecords(cycleNumber);
        assertEq(acceptedTotal, 0);
        assertTrue(completed);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _defaultParams() internal pure returns (ProductParams memory) {
        return ProductParams({
            subscriptionStart:    NOW,
            subscriptionEnd:      NOW + 7 days,
            subscriptionCap:      0,
            walletSubscriptionCap: 0,
            minRaiseAmount:       0,
            firstCycleStart:      NOW + 7 days,
            cycleDuration:        7 days,
            maturityTimestamp:    NOW + 365 days,
            claimingStart:        NOW + 370 days,
            claimingEnd:          NOW + 400 days,
            feeParams:            0
        });
    }

    mapping(uint256 => uint256) internal _reqAssets;

    function _requestDeposit(address user, uint256 amount) internal returns (uint256) {
        vm.startPrank(user);
        usdt.approve(address(lpVault), amount);
        uint256 rid = lpVault.requestDeposit(amount, user);
        vm.stopPrank();
        _reqAssets[rid] = amount;
        return rid;
    }

    function _arr(uint256 v) internal view returns (RequestSettlement[] memory a) {
        a = new RequestSettlement[](1);
        a[0] = RequestSettlement({requestId: v, settleAmount: _reqAssets[v]});
    }

    function _arr2(uint256 a, uint256 b) internal view returns (RequestSettlement[] memory arr) {
        arr = new RequestSettlement[](2);
        arr[0] = RequestSettlement({requestId: a, settleAmount: _reqAssets[a]});
        arr[1] = RequestSettlement({requestId: b, settleAmount: _reqAssets[b]});
    }

    function _arr3(uint256 a, uint256 b, uint256 c) internal view returns (RequestSettlement[] memory arr) {
        arr = new RequestSettlement[](3);
        arr[0] = RequestSettlement({requestId: a, settleAmount: _reqAssets[a]});
        arr[1] = RequestSettlement({requestId: b, settleAmount: _reqAssets[b]});
        arr[2] = RequestSettlement({requestId: c, settleAmount: _reqAssets[c]});
    }

    function _advanceToCalculating() internal {
        ProductParams memory p = sm.getParams(address(lpVault));

        if (uint8(sm.getProductState(address(lpVault))) == uint8(ProductState.SUBSCRIBING)) {
            uint256 target = p.firstCycleStart + p.cycleDuration + 1;
            if (block.timestamp < target) vm.warp(target);
            vm.prank(keeper); sm.finalizeSubscription(address(lpVault));
        }

        if (uint8(sm.getProductState(address(lpVault))) == uint8(ProductState.OPERATING) &&
            uint8(sm.getCycleState(address(lpVault))) == uint8(CycleState.ACCEPTING)) {
            uint256 cycleStart = sm.currentCycleStart(address(lpVault));
            uint256 target = cycleStart + p.cycleDuration + 1;
            if (block.timestamp < target) vm.warp(target);
            vm.prank(keeper); sm.startCycleCalculation(address(lpVault));
        }
    }
}
