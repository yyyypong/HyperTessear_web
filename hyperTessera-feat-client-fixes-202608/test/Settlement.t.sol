// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {IStateManager} from "../src/interfaces/IStateManager.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {UnifiedPool} from "../src/asset-management/settlement/UnifiedPool.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RevenuePool} from "../src/asset-management/settlement/RevenuePool.sol";
import {Settlement} from "../src/asset-management/settlement/Settlement.sol";
import {ISettlement} from "../src/interfaces/ISettlement.sol";
import {IBaseVault} from "../src/interfaces/IBaseVault.sol";
import {IStateManager} from "../src/interfaces/IStateManager.sol";
import {IQueue} from "../src/interfaces/IQueue.sol";
import {IUnifiedPool} from "../src/interfaces/IUnifiedPool.sol";
import {
    ProductState, CycleState, PauseState, ProductParams, Tranche, QueueType, RequestSettlement
} from "../src/libs/Types.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title SettlementTest
/// @notice Net-settlement Settlement.sol suite (development-plan §8): M-of-N signatures,
///         per-vault cycle-state check, and pool-cash conservation (availableToDistribute +
///         aggregate batch-vs-actual-cash). No NAVOracle consistency step — BaseVault computes
///         its own on-chain settlement price via snapshotSettlementPrice.
contract SettlementTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    RevenuePool internal revPool;
    UnifiedPool internal unifiedPool;
    EarnVault internal vault;
    Settlement internal settlement;

    address internal governor = makeAddr("governor");
    address internal keeper = makeAddr("keeper");
    address internal issuer = makeAddr("issuer");
    address internal alice = makeAddr("alice");
    address internal attacker = makeAddr("attacker");

    uint256 internal operator1Pk = 0xBEEF1;
    uint256 internal operator2Pk = 0xBEEF2;
    address internal operator1;
    address internal operator2;

    uint256 internal constant NOW = 1_000_000;
    uint256 internal constant INITIAL_PRICE = 1_000_000; // 1.0 in 6-dec

    function setUp() public {
        vm.warp(NOW);
        operator1 = vm.addr(operator1Pk);
        operator2 = vm.addr(operator2Pk);

        ac = new HyperAccessControl(governor);
        usdt = new MockUSDT();
        sm = new StateManager(address(ac));
        queue = new Queue(address(sm));
        revPool = new RevenuePool(address(usdt), address(ac));
        UnifiedPool unifiedPoolImpl = new UnifiedPool();
        bytes memory unifiedPoolInitData =
            abi.encodeCall(UnifiedPool.initialize, (address(usdt), address(sm), address(ac)));
        unifiedPool = UnifiedPool(address(new ERC1967Proxy(address(unifiedPoolImpl), unifiedPoolInitData)));

        // `governor` doubles as this vault's Owner (IVaultRoles) — Vault-local roles
        // (Owner/Curator/Keeper) are no longer HyperAccessControl-granted; the deploying
        // account is simply passed in as owner_ and appoints the rest itself below.
        vault = new EarnVault(
            "HyperTessera Cash Earn", "htCASH", address(usdt), address(sm), address(queue), governor, address(0)
        );

        settlement = new Settlement(address(sm), address(unifiedPool), address(queue));

        vm.startPrank(governor);
        revPool.addAuthorizedSource(address(unifiedPool));
        unifiedPool.addTrancheVault(Tranche.Cash, address(vault));

        sm.setVaultFactory(governor);
        sm.registerVault(address(vault), ProductState.CONFIGURING, CycleState.ACCEPTING);
        vault.setCurator(governor);
        sm.setProductParams(address(vault), _defaultParams());
        vault.setKeeper(keeper, true);
        vault.setSettlement(address(settlement));

        settlement.setOperator(address(vault), operator1, true);
        settlement.setOperator(address(vault), operator2, true);
        settlement.setThreshold(address(vault), 1);
        vm.stopPrank();

        vm.prank(keeper);
        sm.openSubscription(address(vault));

        usdt.mint(alice, 100_000e6);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _defaultParams() internal view returns (ProductParams memory) {
        return ProductParams({
            subscriptionStart: NOW,
            subscriptionEnd: NOW + 7 days,
            subscriptionCap: 1_000_000e6,
            walletSubscriptionCap: 1_000_000e6,
            minRaiseAmount: 0,
            firstCycleStart: NOW + 7 days,
            cycleDuration: 7 days,
            maturityTimestamp: NOW + 365 days,
            claimingStart: NOW + 370 days,
            claimingEnd: NOW + 400 days,
            feeParams: 0
        });
    }

    function _requestDeposit(address who, uint256 assets) internal returns (uint256 rid) {
        vm.startPrank(who);
        usdt.approve(address(vault), assets);
        rid = vault.requestDeposit(assets, who);
        vm.stopPrank();
    }

    function _advanceToOperating() internal {
        vm.warp(NOW + 7 days);
        vm.prank(keeper);
        sm.finalizeSubscription(address(vault));
    }

    function _advanceToCalculating() internal {
        uint256 cycleStart = sm.currentCycleStart(address(vault));
        ProductParams memory p = sm.getParams(address(vault));
        uint256 target = cycleStart + p.cycleDuration + 1;
        if (block.timestamp < target) vm.warp(target);
        vm.prank(keeper);
        sm.startCycleCalculation(address(vault));
    }

    function _advanceToSettling() internal {
        _advanceToOperating();
        ProductParams memory p = sm.getParams(address(vault));
        vm.warp(p.maturityTimestamp + 1);
        vm.prank(keeper);
        sm.enterFinalSettlement(address(vault));
    }

    function _arr(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function _empty() internal pure returns (uint256[] memory out) {
        out = new uint256[](0);
    }

    function _signOperator(uint256 pk, bytes32 batchHash) internal pure returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", batchHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _instruction(ISettlement.Distribution memory dist)
        internal
        view
        returns (ISettlement.SettlementInstruction memory instr)
    {
        ISettlement.VaultSettlement[] memory vs = new ISettlement.VaultSettlement[](1);
        vs[0] = ISettlement.VaultSettlement({
            distribution: dist,
            deposits: new RequestSettlement[](0),
            redeems: new RequestSettlement[](0)
        });
        instr = ISettlement.SettlementInstruction({
            vaultSettlements: vs,
            cycleNumber: sm.currentCycleNumber(address(vault)),
            validUntil: block.timestamp + 3600
        });
    }

    function _sigsFor(ISettlement.SettlementInstruction memory instr, uint256 signerPk)
        internal
        pure
        returns (bytes[] memory sigs)
    {
        bytes32 hash = keccak256(abi.encode(instr));
        sigs = new bytes[](1);
        sigs[0] = _signOperator(signerPk, hash);
    }

    function _submit(ISettlement.SettlementInstruction memory instr, uint256 signerPk) internal {
        settlement.submitBatch(instr, _sigsFor(instr, signerPk));
    }

    function _instructionWithRequests(
        ISettlement.Distribution memory dist,
        RequestSettlement[] memory deposits,
        RequestSettlement[] memory redeems
    ) internal view returns (ISettlement.SettlementInstruction memory instr) {
        ISettlement.VaultSettlement[] memory vs = new ISettlement.VaultSettlement[](1);
        vs[0] = ISettlement.VaultSettlement({distribution: dist, deposits: deposits, redeems: redeems});
        instr = ISettlement.SettlementInstruction({
            vaultSettlements: vs,
            cycleNumber: sm.currentCycleNumber(address(vault)),
            validUntil: block.timestamp + 3600
        });
    }

    function _rs1(uint256 id, uint256 amount) internal pure returns (RequestSettlement[] memory out) {
        out = new RequestSettlement[](1);
        out[0] = RequestSettlement({requestId: id, settleAmount: amount});
    }

    // -----------------------------------------------------------------------
    // Happy path — empty batch
    // -----------------------------------------------------------------------

    function test_submitBatch_happyPath_emptyBatch_cycleCompletes() public {
        // Cycle 0 auto-transitions straight to CALCULATING on subscription finalization
        // (StateManager.finalizeSubscription) — no explicit startCycleCalculation needed here.
        _advanceToOperating();

        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        uint256 cycleBefore = sm.currentCycleNumber(address(vault));
        _submit(instr, operator1Pk);

        assertEq(uint8(sm.getCycleState(address(vault))), uint8(CycleState.ACCEPTING));
        assertEq(sm.currentCycleNumber(address(vault)), cycleBefore + 1);
    }

    // -----------------------------------------------------------------------
    // Step 1 — signatures
    // -----------------------------------------------------------------------

    function test_submitBatch_replayGuard_reverts() public {
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);
        bytes32 hash = settlement.hashInstruction(instr);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, hash);

        settlement.submitBatch(instr, sigs);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.BatchAlreadyExecuted.selector, hash));
        settlement.submitBatch(instr, sigs);
    }

    function test_submitBatch_expiredValidUntil_reverts() public {
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);
        instr.validUntil = block.timestamp - 1;

        bytes32 hash = settlement.hashInstruction(instr);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, hash);

        vm.expectRevert(
            abi.encodeWithSelector(ISettlement.BatchExpired.selector, instr.validUntil, block.timestamp)
        );
        settlement.submitBatch(instr, sigs);
    }

    function test_submitBatch_fewerSignaturesThanThreshold_reverts() public {
        vm.prank(governor);
        settlement.setThreshold(address(vault), 2);

        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.SignatureValidationFailed.selector, address(vault)));
        _submit(instr, operator1Pk);
    }

    function test_submitBatch_duplicateSigner_reverts() public {
        vm.prank(governor);
        settlement.setThreshold(address(vault), 2);

        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        bytes32 hash = settlement.hashInstruction(instr);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signOperator(operator1Pk, hash);
        sigs[1] = _signOperator(operator1Pk, hash);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.SignatureValidationFailed.selector, address(vault)));
        settlement.submitBatch(instr, sigs);
    }

    function test_submitBatch_nonOperatorSigner_reverts() public {
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.SignatureValidationFailed.selector, address(vault)));
        _submit(instr, 0xDEAD);
    }

    function test_submitBatch_badSig_revertReason_isSignatureValidationFailed() public {
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.SignatureValidationFailed.selector, address(vault)));
        _submit(instr, attacker == address(0) ? 1 : 0xC0FFEE);
    }

    function test_submitBatch_unconfiguredVaultThreshold_reverts() public {
        // A Vault whose Owner never called `setThreshold` has threshold 0. An empty signature
        // array must NOT satisfy the M-of-N check for it.
        address unconfigured = makeAddr("unconfiguredVault");
        _advanceToOperating();

        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: unconfigured, amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        assertEq(settlement.threshold(unconfigured), 0);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.SignatureValidationFailed.selector, unconfigured));
        settlement.submitBatch(instr, new bytes[](0));
    }

    // -----------------------------------------------------------------------
    // Step 2 — state
    // -----------------------------------------------------------------------

    function test_submitBatch_vaultNotCalculating_reverts() public {
        // Cycle 0 auto-transitions straight to CALCULATING on subscription finalization, so
        // settle it first — cycle 1 then starts ACCEPTING (not CALCULATING) as the normal case.
        _advanceToOperating();
        _submit(_instruction(ISettlement.Distribution({vault: address(vault), amount: 0})), operator1Pk);

        // Cycle 1: still ACCEPTING, not CALCULATING.
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        vm.expectRevert(
            abi.encodeWithSelector(
                IStateManager.CycleStateMismatch.selector, address(vault), CycleState.CALCULATING, CycleState.ACCEPTING
            )
        );
        _submit(instr, operator1Pk);
    }

    function test_submitBatch_cycleNumberMismatch_reverts() public {
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);
        instr.cycleNumber = instr.cycleNumber + 1;

        vm.expectRevert(abi.encodeWithSelector(ISettlement.StateValidationFailed.selector, address(vault)));
        _submit(instr, operator1Pk);
    }

    // -----------------------------------------------------------------------
    // Step 3 — pool-cash conservation
    // -----------------------------------------------------------------------

    function test_submitBatch_insufficientPending_reverts() public {
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 1e6});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.ConservationCheckFailed.selector, address(vault), 0, 1e6));
        _submit(instr, operator1Pk);
    }

    function test_submitBatch_batchExceedsPoolCash_reverts() public {
        // Two vaults each individually within their own pending, but pool cash can't cover both.
        EarnVault vault2 = new EarnVault(
            "HyperTessera Cash Earn 2", "htCASH2", address(usdt), address(sm), address(queue), governor, address(0)
        );
        vm.startPrank(governor);
        sm.registerVault(address(vault2), ProductState.CONFIGURING, CycleState.ACCEPTING);
        vault2.setCurator(governor);
        sm.setProductParams(address(vault2), _defaultParams());
        vault2.setKeeper(keeper, true);
        vault2.setSettlement(address(settlement));
        unifiedPool.addTrancheVault(Tranche.Note, address(vault2));
        vm.stopPrank();
        vm.prank(keeper);
        sm.openSubscription(address(vault2));

        // Credit both vaults' pending, but only fund the pool with cash for one of them
        // (simulating pending accrued from an inflow accounted for but not yet reflected).
        usdt.mint(issuer, 1_000e6);
        vm.prank(issuer);
        usdt.approve(address(unifiedPool), 1_000e6);
        vm.prank(issuer);
        unifiedPool.repayInterest(1_000e6);
        vm.prank(operator1);
        unifiedPool.attributeInterest(address(vault), 1_000e6);

        // Drain the pool's actual cash out from under the ledger via an unrelated Settlement
        // Operator transfer, leaving pending > cash on hand.
        vm.prank(operator1);
        unifiedPool.operatorTransfer(address(vault), makeAddr("sink"), 700e6, bytes32(0));

        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 1_000e6});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.ConservationCheckFailed.selector, address(vault), 300e6, 1_000e6));
        _submit(instr, operator1Pk);
    }

    // -----------------------------------------------------------------------
    // Happy path — deposits + redeems with real USDT flow
    // -----------------------------------------------------------------------

    function test_submitBatch_happyPath_settleDeposits_sharesMinted() public {
        uint256 assets = 2_000e6;
        uint256 rid = _requestDeposit(alice, assets);

        _advanceToOperating();

        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);
        instr.vaultSettlements[0].deposits = _rs1(rid, assets);

        _submit(instr, operator1Pk);

        vm.prank(alice);
        vault.claimDeposit(rid, alice);
        assertEq(vault.balanceOf(alice), assets * 1e18 / INITIAL_PRICE);
    }

    function test_submitBatch_happyPath_distributeMovesUsdt_queueDequeued_conservation() public {
        // Fund alice with shares first via a deposit cycle.
        uint256 assets = 2_000e6;
        uint256 depRid = _requestDeposit(alice, assets);
        _advanceToOperating();
        ISettlement.Distribution memory dist0 = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr0 = _instruction(dist0);
        instr0.vaultSettlements[0].deposits = _rs1(depRid, assets);
        _submit(instr0, operator1Pk);
        vm.prank(alice);
        vault.claimDeposit(depRid, alice);

        // Request a redeem.
        uint256 shares = vault.balanceOf(alice);
        vm.startPrank(alice);
        vault.approve(address(vault), shares);
        uint256 redeemId = vault.requestRedeem(shares, alice);
        vm.stopPrank();
        assertTrue(queue.isInQueue(address(vault), QueueType.REDEEM, redeemId));

        // Fund UnifiedPool with USDT for the payout via repayInterest + attributeInterest (no
        // fee deduction under net settlement — full amount credited).
        uint256 payout = shares * INITIAL_PRICE / 1e18;
        usdt.mint(issuer, payout);
        vm.prank(issuer);
        usdt.approve(address(unifiedPool), payout);
        vm.prank(issuer);
        unifiedPool.repayInterest(payout);
        vm.prank(operator1);
        unifiedPool.attributeInterest(address(vault), payout);
        uint256 pendingBefore = unifiedPool.pending(address(vault));

        _advanceToCalculating();

        ISettlement.Distribution memory dist1 = ISettlement.Distribution({vault: address(vault), amount: pendingBefore});
        ISettlement.SettlementInstruction memory instr1 = _instruction(dist1);
        instr1.vaultSettlements[0].redeems = _rs1(redeemId, shares);

        uint256 vaultUsdtBefore = usdt.balanceOf(address(vault));
        _submit(instr1, operator1Pk);

        assertFalse(queue.isInQueue(address(vault), QueueType.REDEEM, redeemId));
        assertEq(usdt.balanceOf(address(vault)), vaultUsdtBefore + pendingBefore);
        assertEq(unifiedPool.pending(address(vault)), 0);
    }

    // NOTE: test_submitBatch_sumRedeemAmountsMismatchDistribution_reverts and
    // test_submitBatch_wrongRedeemAmount_reverts were removed — both tested the gross-settlement
    // equality checks (ConservationFailed / WrongRedeemAmount) that net settlement deletes.
    // test_submitBatch_navDeviationExceedsTolerance_reverts and test_submitBatch_staleNav_reverts
    // were removed — Settlement no longer validates against NAVOracle; BaseVault computes its
    // own on-chain settlement price via snapshotSettlementPrice (development-plan §8).

    function test_settle_alreadySettledDeposit_reverts() public {
        uint256 assets = 2_000e6;
        uint256 depRid = _requestDeposit(alice, assets);
        _advanceToOperating();
        ISettlement.Distribution memory dist = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr = _instruction(dist);
        instr.vaultSettlements[0].deposits = _rs1(depRid, assets);
        _submit(instr, operator1Pk);

        // Same requestId again in a fresh batch (different validUntil/cycle to avoid the batch-hash replay guard).
        // The deposit FIFO queue now catches this before BaseVault does: depRid was already
        // dequeued in the first batch, so resubmitting it is an out-of-order dequeue, not a
        // BaseVault-level RequestAlreadySettled (Queue.sol is now the first line of defense for
        // both deposit and redeem FIFO, per the net-settlement conversion).
        _advanceToCalculating();
        ISettlement.SettlementInstruction memory instr2 = _instruction(dist);
        instr2.vaultSettlements[0].deposits = _rs1(depRid, assets);

        vm.expectRevert(abi.encodeWithSelector(IQueue.OutOfOrderDequeue.selector, address(vault), QueueType.DEPOSIT, 0, depRid));
        _submit(instr2, operator1Pk);
    }

    // -----------------------------------------------------------------------
    // Operator / threshold management — now per-vault, gated by that vault's Owner rather than
    // a global Governor role. addOperator/removeOperator were replaced by a single
    // setOperator(vault, operator, approved) toggle.
    // -----------------------------------------------------------------------

    function test_setOperator_onlyVaultOwner() public {
        address newOp = makeAddr("newOp");
        vm.prank(attacker);
        vm.expectRevert(ISettlement.NotVaultOwner.selector);
        settlement.setOperator(address(vault), newOp, true);

        vm.prank(governor);
        settlement.setOperator(address(vault), newOp, true);
        assertTrue(settlement.isOperator(address(vault), newOp));

        vm.prank(attacker);
        vm.expectRevert(ISettlement.NotVaultOwner.selector);
        settlement.setOperator(address(vault), newOp, false);

        vm.prank(governor);
        settlement.setOperator(address(vault), newOp, false);
        assertFalse(settlement.isOperator(address(vault), newOp));
    }

    function test_setThreshold_exceedsOperatorCount_reverts() public {
        vm.prank(governor);
        vm.expectRevert(abi.encodeWithSelector(ISettlement.ThresholdExceedsOperatorCount.selector, 10, 2));
        settlement.setThreshold(address(vault), 10);
    }

    function test_setThreshold_onlyVaultOwner() public {
        vm.prank(attacker);
        vm.expectRevert(ISettlement.NotVaultOwner.selector);
        settlement.setThreshold(address(vault), 1);
    }

    // -----------------------------------------------------------------------
    // confirmFinalSettlement — same per-vault M-of-N gate as submitBatch
    // -----------------------------------------------------------------------

    function test_confirmFinalSettlement_happyPath() public {
        _advanceToSettling();

        bytes32 confirmationHash =
            keccak256(abi.encode("FINAL_SETTLEMENT", address(vault), address(settlement), block.chainid));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, confirmationHash);

        settlement.confirmFinalSettlement(address(vault), sigs);

        assertTrue(sm.isFinalSettlementComplete(address(vault)));
    }

    function test_hashFinalSettlementConfirmation_matchesTheGatingHash() public {
        _advanceToSettling();

        bytes32 confirmationHash = settlement.hashFinalSettlementConfirmation(address(vault));
        assertEq(
            confirmationHash, keccak256(abi.encode("FINAL_SETTLEMENT", address(vault), address(settlement), block.chainid))
        );

        // A signature over the view helper's output must satisfy confirmFinalSettlement's own check.
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, confirmationHash);

        settlement.confirmFinalSettlement(address(vault), sigs);

        assertTrue(sm.isFinalSettlementComplete(address(vault)));
    }

    function test_confirmFinalSettlement_insufficientSignaturesReverts() public {
        vm.prank(governor);
        settlement.setThreshold(address(vault), 2);

        _advanceToSettling();

        bytes32 confirmationHash =
            keccak256(abi.encode("FINAL_SETTLEMENT", address(vault), address(settlement), block.chainid));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, confirmationHash);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.SignatureValidationFailed.selector, address(vault)));
        settlement.confirmFinalSettlement(address(vault), sigs);
    }

    function test_confirmFinalSettlement_wrongProductStateReverts() public {
        // vault still OPERATING (via _advanceToOperating), never advanced to SETTLING.
        _advanceToOperating();

        bytes32 confirmationHash =
            keccak256(abi.encode("FINAL_SETTLEMENT", address(vault), address(settlement), block.chainid));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, confirmationHash);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.StateValidationFailed.selector, address(vault)));
        settlement.confirmFinalSettlement(address(vault), sigs);
    }

    function test_confirmFinalSettlement_replayReverts() public {
        _advanceToSettling();

        bytes32 confirmationHash =
            keccak256(abi.encode("FINAL_SETTLEMENT", address(vault), address(settlement), block.chainid));
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signOperator(operator1Pk, confirmationHash);

        settlement.confirmFinalSettlement(address(vault), sigs);

        vm.expectRevert(abi.encodeWithSelector(ISettlement.FinalSettlementAlreadyConfirmed.selector, address(vault)));
        settlement.confirmFinalSettlement(address(vault), sigs);
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert(ISettlement.ZeroAddress.selector);
        new Settlement(address(0), address(unifiedPool), address(queue));
    }

    // -----------------------------------------------------------------------
    // Partial-settlement conditional redeem dequeue
    // -----------------------------------------------------------------------

    function test_submitBatch_partialDeposit_coversRedeem_dequeuesOnlyRedeem() public {
        // Bob deposits, settles, redeems in full via a first (empty-fee) submitBatch cycle.
        uint256 bobAssets = 350_000e6;
        address bob = makeAddr("bob");
        usdt.mint(bob, bobAssets);
        uint256 bobRid = _requestDeposit(bob, bobAssets);
        _advanceToOperating(); // cycle 0 auto-transitions straight to CALCULATING here

        ISettlement.Distribution memory dist0 = ISettlement.Distribution({vault: address(vault), amount: 0});
        _submit(_instructionWithRequests(dist0, _rs1(bobRid, bobAssets), new RequestSettlement[](0)), operator1Pk);

        vm.prank(bob); vault.claimDeposit(bobRid, bob);
        uint256 bobShares = vault.balanceOf(bob);
        vm.startPrank(bob);
        vault.approve(address(vault), bobShares);
        uint256 redeemId = vault.requestRedeem(bobShares, bob);
        vm.stopPrank();

        // Alice's 400k deposit request is next; only enough to cover bob's redeem is accepted.
        uint256 aliceRequested = 400_000e6;
        usdt.mint(alice, aliceRequested);
        uint256 aliceRid = _requestDeposit(alice, aliceRequested);
        _advanceToCalculating();

        uint256 redeemAssets = bobShares * 1e6 / 1e18; // 1:1 price in this test — matches _assetsFor in EarnVault.t.sol
        ISettlement.Distribution memory dist1 = ISettlement.Distribution({vault: address(vault), amount: 0});
        uint256 aliceBalBefore = usdt.balanceOf(alice);

        _submit(
            _instructionWithRequests(dist1, _rs1(aliceRid, redeemAssets), _rs1(redeemId, bobShares)),
            operator1Pk
        );

        // Alice: partial accept + immediate refund of the untouched portion — never re-queued.
        assertEq(usdt.balanceOf(alice), aliceBalBefore + (aliceRequested - redeemAssets));
        assertFalse(queue.isInQueue(address(vault), QueueType.DEPOSIT, aliceRid));

        // Bob's redeem: fully cleared this cycle, dequeued.
        assertFalse(queue.isInQueue(address(vault), QueueType.REDEEM, redeemId));
        vm.prank(bob);
        uint256 bobAssetsOut = vault.claimRedeem(redeemId, bob);
        assertEq(bobAssetsOut, redeemAssets);
    }

    /// @notice Documents the FIFO constraint noted on ISettlement.submitBatch / IBaseVault.settle:
    ///         Queue.dequeue is strict FIFO-from-head, so a batch that only partially fills the
    ///         head redeem while fully clearing a later redeem in the same batch must revert —
    ///         the later redeem can't be dequeued while the earlier one is still at the head.
    function test_submitBatch_partialRedeemThenLaterFullRedeem_reverts() public {
        uint256 bobAssets = 350_000e6;
        address bob = makeAddr("bob");
        usdt.mint(bob, bobAssets);
        uint256 bobRid = _requestDeposit(bob, bobAssets);
        _advanceToOperating(); // cycle 0 auto-transitions straight to CALCULATING here

        ISettlement.Distribution memory dist0 = ISettlement.Distribution({vault: address(vault), amount: 0});
        _submit(_instructionWithRequests(dist0, _rs1(bobRid, bobAssets), new RequestSettlement[](0)), operator1Pk);

        vm.prank(bob); vault.claimDeposit(bobRid, bob);
        uint256 bobShares = vault.balanceOf(bob);

        // Two separate redeem requests, queued in FIFO order: redeemId1 first, redeemId2 second.
        vm.startPrank(bob);
        vault.approve(address(vault), bobShares);
        uint256 redeemId1 = vault.requestRedeem(bobShares / 2, bob);
        uint256 redeemId2 = vault.requestRedeem(bobShares - bobShares / 2, bob);
        vm.stopPrank();

        // Fund the vault with enough free USDT to cover both via a covering deposit.
        uint256 aliceRequested = bobAssets;
        usdt.mint(alice, aliceRequested);
        uint256 aliceRid = _requestDeposit(alice, aliceRequested);
        _advanceToCalculating();

        RequestSettlement[] memory redeems = new RequestSettlement[](2);
        // redeemId1 only partially filled (leaves remainingShares > 0)...
        redeems[0] = RequestSettlement({requestId: redeemId1, settleAmount: (bobShares / 2) / 2});
        // ...while redeemId2, queued after it, is fully cleared in the same batch.
        redeems[1] = RequestSettlement({requestId: redeemId2, settleAmount: bobShares - bobShares / 2});

        ISettlement.Distribution memory dist1 = ISettlement.Distribution({vault: address(vault), amount: 0});
        ISettlement.SettlementInstruction memory instr1 =
            _instructionWithRequests(dist1, _rs1(aliceRid, aliceRequested), redeems);

        vm.expectRevert(
            abi.encodeWithSelector(IQueue.OutOfOrderDequeue.selector, address(vault), QueueType.REDEEM, redeemId1, redeemId2)
        );
        _submit(instr1, operator1Pk);
    }
}
