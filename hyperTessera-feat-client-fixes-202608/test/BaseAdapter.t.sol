// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {FirstPeriodAdapter} from "../src/asset-management/strategy/FirstPeriodAdapter.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract BaseAdapterTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    EarnVault internal vault;
    MockUSDT internal usdt;
    FirstPeriodAdapter internal adapter;

    address internal governor = makeAddr("governor");
    address internal vaultOwner = makeAddr("vaultOwner");
    address internal curator = makeAddr("curator");
    address internal allocator = makeAddr("allocator");
    address internal guardian = makeAddr("guardian");
    address internal dataProvider = makeAddr("dataProvider");
    address internal vaultAddr;
    address internal destination = makeAddr("destination");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant NOW = 1_000_000;
    uint256 internal constant STALENESS_WINDOW = 36 hours;

    function setUp() public {
        vm.warp(NOW);
        ac = new HyperAccessControl(governor);
        sm = new StateManager(address(ac));
        queue = new Queue(address(sm));
        usdt = new MockUSDT();

        // Vault stays in its default ProductState.CONFIGURING (never registered with `sm`),
        // which is all BaseAdapter's Curator-class setters (setStalenessWindow/setDataProvider)
        // need to allow direct Curator calls.
        vault = new EarnVault("Test Vault", "tVLT", address(usdt), address(sm), address(queue), vaultOwner, address(0));
        vaultAddr = address(vault);

        vm.startPrank(vaultOwner);
        vault.setCurator(curator);
        vault.setGuardian(guardian);
        vault.setAllocator(allocator);
        vm.stopPrank();

        adapter = new FirstPeriodAdapter(usdt, vaultAddr, STALENESS_WINDOW);

        vm.prank(curator);
        adapter.setDataProvider(dataProvider);

        usdt.mint(vaultAddr, 1_000_000e6);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _fundAdapterViaVaultDeposit(uint256 amount) internal {
        vm.startPrank(vaultAddr);
        usdt.approve(address(adapter), amount);
        adapter.deposit(amount, vaultAddr);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(IAdapter.ZeroAddress.selector);
        new FirstPeriodAdapter(usdt, address(0), STALENESS_WINDOW);
    }

    function test_constructor_defaultStalenessWindow() public view {
        assertEq(adapter.defaultStalenessWindow(), STALENESS_WINDOW);
    }

    // -----------------------------------------------------------------------
    // ERC-4626 deposit
    // -----------------------------------------------------------------------

    function test_vaultDeposit_pullsUsdt_mintsAdapterShares() public {
        uint256 amount = 5_000e6;
        _fundAdapterViaVaultDeposit(amount);
        assertEq(usdt.balanceOf(address(adapter)), amount);
        assertGt(adapter.balanceOf(vaultAddr), 0);
    }

    // -----------------------------------------------------------------------
    // createBuyOrder / executeBuy — TOKEN_RETURN
    // -----------------------------------------------------------------------

    function test_createBuyOrder_onlyCurator() public {
        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotCurator.selector);
        adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
    }

    function test_createBuyOrder_sequentialIds_recordsFields() public {
        vm.startPrank(curator);
        uint256 id0 = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        uint256 id1 = adapter.createBuyOrder(2_000e6, destination, IAdapter.SettlementMode.VALUE_RETURN);
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);
        (uint256 amount,, , IAdapter.SettlementMode mode,,) = adapter.buyOrders(id1);
        assertEq(amount, 2_000e6);
        assertEq(uint8(mode), uint8(IAdapter.SettlementMode.VALUE_RETURN));
    }

    function test_executeBuy_happyPath_deploysCapital_andInitializesDealData() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.expectEmit(true, false, false, true);
        emit IAdapter.CapitalDeployed(destination, amount, block.timestamp);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        assertEq(usdt.balanceOf(destination), amount);
        (uint256 dealValue, uint256 updatedAt,) = adapter.pendingDeposits(orderId);
        assertEq(dealValue, amount);
        assertEq(updatedAt, block.timestamp);
        assertEq(adapter.realAssets(), amount);
    }

    function test_executeBuy_onlyAllocator() public {
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotAllocator.selector);
        adapter.executeBuy(orderId);
    }

    function test_executeBuy_unknownOrderId_reverts() public {
        vm.prank(allocator);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.OrderDoesNotExist.selector, 999));
        adapter.executeBuy(999);
    }

    function test_executeBuy_cancelledOrder_reverts() public {
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(curator);
        adapter.cancelBuyOrder(orderId);

        vm.prank(allocator);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.OrderAlreadyCancelled.selector, orderId));
        adapter.executeBuy(orderId);
    }

    function test_executeBuy_twice_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(allocator);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.OrderAlreadyExecuted.selector, orderId));
        adapter.executeBuy(orderId);
    }

    function test_executeBuy_selector_takesOnlyOrderId() public pure {
        assertEq(IAdapter.executeBuy.selector, bytes4(keccak256("executeBuy(uint256)")));
    }

    function test_executeSell_selector_takesOnlyOrderId() public pure {
        assertEq(IAdapter.executeSell.selector, bytes4(keccak256("executeSell(uint256)")));
    }

    function test_executeRebalance_selector_takesOnlyOrderId() public pure {
        assertEq(IAdapter.executeRebalance.selector, bytes4(keccak256("executeRebalance(uint256)")));
    }

    // -----------------------------------------------------------------------
    // clearDealValue — TOKEN_RETURN
    // -----------------------------------------------------------------------

    function test_clearDealValue_happyPath_zeroesAndRemovesFromLiveDeals() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(allocator);
        adapter.clearDealValue(orderId);

        (uint256 dealValue,,) = adapter.pendingDeposits(orderId);
        assertEq(dealValue, 0);
        assertEq(adapter.realAssets(), 0);
    }

    // clearDealValue is now Allocator-ONLY — the old `_onlyAllocatorOrDataProvider()` path and
    // its `NotAllocatorOrDataProvider` error were removed, so the Data Provider can no longer
    // clear a deal value. Flipped from "byDataProvider_alsoSucceeds" to a revert expectation.
    function test_clearDealValue_byDataProvider_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(dataProvider);
        vm.expectRevert(IAdapter.NotAllocator.selector);
        adapter.clearDealValue(orderId);
    }

    function test_clearDealValue_nonAuthorized_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotAllocator.selector);
        adapter.clearDealValue(orderId);
    }

    function test_clearDealValue_onValueReturnOrder_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.VALUE_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(allocator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapter.WrongSettlementMode.selector,
                orderId,
                uint8(IAdapter.SettlementMode.TOKEN_RETURN),
                uint8(IAdapter.SettlementMode.VALUE_RETURN)
            )
        );
        adapter.clearDealValue(orderId);
    }

    // -----------------------------------------------------------------------
    // updateDealData — VALUE_RETURN
    // -----------------------------------------------------------------------

    function test_updateDealData_happyPath_refreshesPendingDeposits() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.VALUE_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(dataProvider);
        adapter.updateDealData(orderId, 1_500e6);

        (uint256 dealValue, uint256 updatedAt,) = adapter.pendingDeposits(orderId);
        assertEq(dealValue, 1_500e6);
        assertEq(updatedAt, block.timestamp);
        assertEq(adapter.realAssets(), 1_500e6);
    }

    function test_updateDealData_onTokenReturnOrder_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(dataProvider);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAdapter.WrongSettlementMode.selector,
                orderId,
                uint8(IAdapter.SettlementMode.VALUE_RETURN),
                uint8(IAdapter.SettlementMode.TOKEN_RETURN)
            )
        );
        adapter.updateDealData(orderId, 2_000e6);
    }

    function test_updateDealData_unexecutedOrder_reverts() public {
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.VALUE_RETURN);

        vm.prank(dataProvider);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.OrderDoesNotExist.selector, orderId));
        adapter.updateDealData(orderId, 2_000e6);
    }

    function test_updateDealData_nonDataProvider_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.VALUE_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotDataProvider.selector);
        adapter.updateDealData(orderId, 2_000e6);
    }

    // -----------------------------------------------------------------------
    // realAssets — staleness + mixed orders
    // -----------------------------------------------------------------------

    function test_realAssets_staleEntry_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.warp(block.timestamp + STALENESS_WINDOW + 1);

        vm.expectRevert(abi.encodeWithSelector(IAdapter.StaleAdapterData.selector, NOW, STALENESS_WINDOW));
        adapter.realAssets();
    }

    function test_realAssets_mixedOrders_sumsOnlyRemainingLive() public {
        uint256 amount = 2_000e6;
        _fundAdapterViaVaultDeposit(amount);

        vm.startPrank(curator);
        uint256 tokenOrder = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        uint256 valueOrder = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.VALUE_RETURN);
        vm.stopPrank();

        vm.startPrank(allocator);
        adapter.executeBuy(tokenOrder);
        adapter.executeBuy(valueOrder);
        adapter.clearDealValue(tokenOrder);
        vm.stopPrank();

        vm.prank(dataProvider);
        adapter.updateDealData(valueOrder, 1_200e6);

        assertEq(adapter.realAssets(), 1_200e6);
    }

    // -----------------------------------------------------------------------
    // setStalenessWindow — Curator-direct while CONFIGURING (Timelock-gated after)
    // -----------------------------------------------------------------------

    function test_setStalenessWindow_onlyCurator() public {
        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotCurator.selector);
        adapter.setStalenessWindow(1 hours);

        vm.prank(curator);
        adapter.setStalenessWindow(1 hours);
        assertEq(adapter.defaultStalenessWindow(), 1 hours);
    }

    // -----------------------------------------------------------------------
    // createSellOrder / executeSell
    // -----------------------------------------------------------------------

    function test_createSellOrder_onlyCurator() public {
        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotCurator.selector);
        adapter.createSellOrder(1_000e6);
    }

    function test_executeSell_happyPath_pullsUsdtBackIntoAdapter() public {
        uint256 amount = 1_000e6;
        vm.prank(curator);
        uint256 orderId = adapter.createSellOrder(amount);

        usdt.mint(allocator, amount);
        vm.startPrank(allocator);
        usdt.approve(address(adapter), amount);

        vm.expectEmit(false, false, false, true);
        emit IAdapter.CapitalRecalled(amount, block.timestamp);
        adapter.executeSell(orderId);
        vm.stopPrank();

        assertEq(usdt.balanceOf(address(adapter)), amount);
    }

    function test_executeSell_onlyAllocator() public {
        vm.prank(curator);
        uint256 orderId = adapter.createSellOrder(1_000e6);

        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotAllocator.selector);
        adapter.executeSell(orderId);
    }

    // -----------------------------------------------------------------------
    // createRebalanceOrder / executeRebalance
    // -----------------------------------------------------------------------

    function test_createRebalanceOrder_onlyCurator_recordsSourceAndDestination() public {
        address source = makeAddr("source");
        vm.prank(curator);
        uint256 orderId = adapter.createRebalanceOrder(500e6, source, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        (uint256 amount, address dest, address src,,,) = adapter.rebalanceOrders(orderId);
        assertEq(amount, 500e6);
        assertEq(dest, destination);
        assertEq(src, source);
    }

    function test_executeRebalance_happyPath_pullsFromSourceThenDeploysToDestination() public {
        address source = makeAddr("source");
        uint256 amount = 500e6;
        usdt.mint(source, amount);

        vm.prank(curator);
        uint256 orderId = adapter.createRebalanceOrder(amount, source, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(source);
        usdt.approve(address(adapter), amount);

        vm.prank(allocator);
        adapter.executeRebalance(orderId);

        assertEq(usdt.balanceOf(destination), amount);
        assertEq(usdt.balanceOf(source), 0);
        (uint256 dealValue,,) = adapter.pendingDeposits(orderId);
        assertEq(dealValue, amount);
    }

    function test_executeRebalance_onlyAllocator() public {
        address source = makeAddr("source");
        vm.prank(curator);
        uint256 orderId = adapter.createRebalanceOrder(500e6, source, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotAllocator.selector);
        adapter.executeRebalance(orderId);
    }

    // -----------------------------------------------------------------------
    // cancel*
    // -----------------------------------------------------------------------

    function test_cancelBuyOrder_byCuratorOrGuardian() public {
        vm.prank(curator);
        uint256 orderId1 = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(curator);
        adapter.cancelBuyOrder(orderId1);

        vm.prank(curator);
        uint256 orderId2 = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(guardian);
        adapter.cancelBuyOrder(orderId2);
    }

    function test_cancelBuyOrder_nonAuthorized_reverts() public {
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotCuratorOrGuardian.selector);
        adapter.cancelBuyOrder(orderId);
    }

    function test_cancelBuyOrder_alreadyExecuted_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.OrderAlreadyExecuted.selector, orderId));
        adapter.cancelBuyOrder(orderId);
    }

    function test_cancelBuyOrder_alreadyCancelled_reverts() public {
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(curator);
        adapter.cancelBuyOrder(orderId);

        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.OrderAlreadyCancelled.selector, orderId));
        adapter.cancelBuyOrder(orderId);
    }

    // -----------------------------------------------------------------------
    // freezeAllocator / unfreezeAllocator (GUARDIAN_ROLE emergency freeze;
    // unfreezeAllocator is now Curator-gated, not Governor-gated)
    // -----------------------------------------------------------------------

    function test_freezeAllocator_onlyGuardian() public {
        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotGuardian.selector);
        adapter.freezeAllocator();
    }

    function test_freezeAllocator_setsFlagAndEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IAdapter.AllocatorFrozen(guardian, block.timestamp);
        vm.prank(guardian);
        adapter.freezeAllocator();

        assertTrue(adapter.allocatorFrozen());
    }

    function test_frozen_executeBuy_reverts() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(guardian);
        adapter.freezeAllocator();

        vm.prank(allocator);
        vm.expectRevert(IAdapter.AllocatorIsFrozen.selector);
        adapter.executeBuy(orderId);
    }

    function test_frozen_executeSell_reverts() public {
        vm.prank(curator);
        uint256 orderId = adapter.createSellOrder(100e6);

        vm.prank(guardian);
        adapter.freezeAllocator();

        vm.prank(allocator);
        vm.expectRevert(IAdapter.AllocatorIsFrozen.selector);
        adapter.executeSell(orderId);
    }

    function test_frozen_executeRebalance_reverts() public {
        vm.prank(curator);
        uint256 orderId = adapter.createRebalanceOrder(100e6, destination, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(guardian);
        adapter.freezeAllocator();

        vm.prank(allocator);
        vm.expectRevert(IAdapter.AllocatorIsFrozen.selector);
        adapter.executeRebalance(orderId);
    }

    function test_frozen_curatorCanStillCreateAndCancelOrders() public {
        vm.prank(guardian);
        adapter.freezeAllocator();

        vm.startPrank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, destination, IAdapter.SettlementMode.TOKEN_RETURN);
        adapter.cancelBuyOrder(orderId);
        vm.stopPrank();
    }

    function test_unfreezeAllocator_onlyCurator() public {
        vm.prank(guardian);
        adapter.freezeAllocator();

        vm.prank(guardian);
        vm.expectRevert(IAdapter.NotCurator.selector);
        adapter.unfreezeAllocator();
    }

    function test_unfreezeAllocator_restoresExecution() public {
        uint256 amount = 1_000e6;
        _fundAdapterViaVaultDeposit(amount);
        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(amount, destination, IAdapter.SettlementMode.TOKEN_RETURN);

        vm.prank(guardian);
        adapter.freezeAllocator();

        vm.expectEmit(true, false, false, true);
        emit IAdapter.AllocatorUnfrozen(curator, block.timestamp);
        vm.prank(curator);
        adapter.unfreezeAllocator();

        assertFalse(adapter.allocatorFrozen());

        vm.prank(allocator);
        adapter.executeBuy(orderId);
        assertEq(usdt.balanceOf(destination), amount);
    }
}
