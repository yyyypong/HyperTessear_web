// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {LiquidityBridge} from "../src/asset-management/vaults/LiquidityBridge.sol";
import {LiquidityEarnVault} from "../src/asset-management/vaults/LiquidityEarnVault.sol";
import {AdapterRegistry} from "../src/asset-management/vaults/AdapterRegistry.sol";
import {LiquidityAdapter} from "../src/asset-management/strategy/LiquidityAdapter.sol";
import {ILiquidityAdapter} from "../src/interfaces/ILiquidityAdapter.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";
import {ProductState, CycleState} from "../src/libs/Types.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract LiquidityAdapterTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    LiquidityBridge internal bridge;
    EarnVault internal cashVault;
    LiquidityEarnVault internal lpVaultContract;
    LiquidityAdapter internal adapter;

    address internal governor = makeAddr("governor");
    address internal cashVaultOwner = makeAddr("cashVaultOwner");
    address internal lpVaultOwner = makeAddr("lpVaultOwner");
    address internal curator = makeAddr("curator");
    address internal lpVault; // = address(lpVaultContract) — the LiquidityAdapter's bound vault
    address internal attacker = makeAddr("attacker");

    uint256 internal constant NOW = 1_000_000;
    uint256 internal constant STALENESS_WINDOW = 36 hours;

    function setUp() public {
        vm.warp(NOW);

        ac = new HyperAccessControl(governor);
        sm = new StateManager(address(ac));
        usdt = new MockUSDT();
        queue = new Queue(address(sm));
        bridge = new LiquidityBridge(address(usdt));

        cashVault = new EarnVault(
            "Cash Earn", "htCASH", address(usdt), address(sm), address(queue), cashVaultOwner, address(bridge)
        );
        // registerVault is now gated to the one-time-wired VaultFactory, not directly to Governor.
        vm.prank(governor);
        sm.setVaultFactory(governor);
        vm.prank(governor);
        sm.registerVault(address(cashVault), ProductState.CONFIGURING, CycleState.ACCEPTING);

        // The LP vault this adapter serves must itself implement IVaultRoles (curator/allocator/
        // stateManager/etc.) — a plain mock address no longer works since BaseAdapter's role
        // checks now read directly from `vault`. Use a real LiquidityEarnVault, kept in its
        // default ProductState.CONFIGURING (never registered with `sm`) so Curator-class
        // setters (setBridgeTarget) can be called directly.
        lpVaultContract = new LiquidityEarnVault(
            "LP Earn", "htLP", address(usdt), address(sm), address(queue), lpVaultOwner,
            address(bridge), address(cashVault)
        );
        lpVault = address(lpVaultContract);

        vm.prank(lpVaultOwner);
        lpVaultContract.setCurator(curator);

        adapter = new LiquidityAdapter(usdt, lpVault, STALENESS_WINDOW);

        usdt.mint(lpVault, 1_000_000e6);
    }

    // -----------------------------------------------------------------------
    // setBridgeTarget
    // -----------------------------------------------------------------------

    function test_setBridgeTarget_onlyCurator() public {
        vm.prank(attacker);
        vm.expectRevert(IAdapter.NotCurator.selector);
        adapter.setBridgeTarget(address(bridge), address(cashVault));
    }

    function test_setBridgeTarget_happyPath() public {
        vm.expectEmit(false, false, false, true);
        emit ILiquidityAdapter.BridgeTargetSet(address(bridge), address(cashVault), block.timestamp);
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));

        assertEq(adapter.liquidityBridge(), address(bridge));
        assertEq(adapter.cashVault(), address(cashVault));
    }

    // setBridgeTarget now validates its params: ZeroAddress on either arg, and InvalidCashVault
    // if newCashVault isn't registered in this vault's StateManager. New coverage below.
    function test_setBridgeTarget_zeroLiquidityBridge_reverts() public {
        vm.prank(curator);
        vm.expectRevert(IAdapter.ZeroAddress.selector);
        adapter.setBridgeTarget(address(0), address(cashVault));
    }

    function test_setBridgeTarget_zeroCashVault_reverts() public {
        vm.prank(curator);
        vm.expectRevert(IAdapter.ZeroAddress.selector);
        adapter.setBridgeTarget(address(bridge), address(0));
    }

    function test_setBridgeTarget_unregisteredCashVault_reverts() public {
        address unregisteredCashVault = makeAddr("unregisteredCashVault");
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(ILiquidityAdapter.InvalidCashVault.selector, unregisteredCashVault));
        adapter.setBridgeTarget(address(bridge), unregisteredCashVault);
    }

    // -----------------------------------------------------------------------
    // bridgeToCash
    // -----------------------------------------------------------------------

    function test_bridgeToCash_beforeTargetSet_reverts() public {
        vm.prank(lpVault);
        vm.expectRevert(ILiquidityAdapter.BridgeTargetNotSet.selector);
        adapter.bridgeToCash(1_000e6);
    }

    function test_bridgeToCash_onlySettlementOrVault() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));

        vm.prank(attacker);
        vm.expectRevert(ILiquidityAdapter.NotSettlementOrVault.selector);
        adapter.bridgeToCash(1_000e6);
    }

    function test_bridgeToCash_happyPath() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));

        uint256 amount = 5_000e6;
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), amount);

        vm.expectEmit(false, false, false, false);
        emit ILiquidityAdapter.BridgedToCash(0, 0, 0);
        uint256 shares = adapter.bridgeToCash(amount);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(cashVault.balanceOf(address(adapter)), shares);
        assertEq(adapter.cashTokenBalance(), shares);
        assertEq(usdt.balanceOf(lpVault), 1_000_000e6 - amount);
    }

    // -----------------------------------------------------------------------
    // recallCashTokens
    // -----------------------------------------------------------------------

    function test_recallCashTokens_onlyVault() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 1_000e6);
        uint256 shares = adapter.bridgeToCash(1_000e6);
        vm.stopPrank();

        vm.prank(attacker);
        vm.expectRevert(ILiquidityAdapter.NotVault.selector);
        adapter.recallCashTokens(shares);
    }

    function test_recallCashTokens_insufficientBalance_reverts() public {
        vm.prank(lpVault);
        vm.expectRevert(abi.encodeWithSelector(IAdapter.InsufficientAdapterBalance.selector, 0, 1));
        adapter.recallCashTokens(1);
    }

    function test_recallCashTokens_happyPath() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 1_000e6);
        uint256 shares = adapter.bridgeToCash(1_000e6);
        vm.stopPrank();

        vm.expectEmit(false, false, false, true);
        emit ILiquidityAdapter.CashTokensRecalled(shares, block.timestamp);
        vm.prank(lpVault);
        adapter.recallCashTokens(shares);

        assertEq(adapter.cashTokenBalance(), 0);
        assertEq(cashVault.balanceOf(lpVault), shares);
    }

    // -----------------------------------------------------------------------
    // realAssets
    // -----------------------------------------------------------------------

    function test_realAssets_cashOnly() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 1_000e6);
        uint256 shares = adapter.bridgeToCash(1_000e6);
        vm.stopPrank();

        uint256 expected = cashVault.convertToAssets(shares);
        assertEq(adapter.realAssets(), expected);
    }

    function test_realAssets_cashPlusRwaOrder_sumsBothLegs() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 1_000e6);
        uint256 shares = adapter.bridgeToCash(1_000e6);
        vm.stopPrank();
        uint256 cashLeg = cashVault.convertToAssets(shares);

        // Fund the adapter for an RWA buy order via the inherited ERC-4626 deposit path.
        address allocator = makeAddr("allocator");
        address dest = makeAddr("dest");
        vm.prank(lpVaultOwner);
        lpVaultContract.setAllocator(allocator);

        usdt.mint(lpVault, 500e6);
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 500e6);
        adapter.deposit(500e6, lpVault);
        vm.stopPrank();

        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(500e6, dest, IAdapter.SettlementMode.VALUE_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        assertEq(adapter.realAssets(), cashLeg + 500e6);
    }

    function test_realAssets_cashPlusStaleRwaOrder_reverts() public {
        vm.prank(curator);
        adapter.setBridgeTarget(address(bridge), address(cashVault));
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 1_000e6);
        adapter.bridgeToCash(1_000e6);
        vm.stopPrank();

        address allocator = makeAddr("allocator");
        address dest = makeAddr("dest");
        vm.prank(lpVaultOwner);
        lpVaultContract.setAllocator(allocator);

        usdt.mint(lpVault, 500e6);
        vm.startPrank(lpVault);
        usdt.approve(address(adapter), 500e6);
        adapter.deposit(500e6, lpVault);
        vm.stopPrank();

        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(500e6, dest, IAdapter.SettlementMode.VALUE_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        vm.warp(block.timestamp + STALENESS_WINDOW + 1);

        vm.expectRevert(abi.encodeWithSelector(IAdapter.StaleAdapterData.selector, NOW, STALENESS_WINDOW));
        adapter.realAssets();
    }

    // -----------------------------------------------------------------------
    // LiquidityEarnVault.adapter wiring — setAdapter is now Curator-gated (direct while
    // CONFIGURING) via the inherited addAdapter(), not Governor-gated, and additionally
    // requires the adapter be whitelisted in the vault's bound AdapterRegistry.
    // -----------------------------------------------------------------------

    function test_liquidityEarnVault_setAdapter_onlyCurator_andOnce() public {
        address otherOwner = makeAddr("otherLpVaultOwner");
        LiquidityEarnVault lpEarnVault = new LiquidityEarnVault(
            "LP Earn", "htLP", address(usdt), address(sm), address(queue), otherOwner,
            address(bridge), address(cashVault)
        );

        address otherCurator = makeAddr("otherCurator");
        vm.prank(otherOwner);
        lpEarnVault.setCurator(otherCurator);

        AdapterRegistry registry = new AdapterRegistry(otherCurator);
        address vaultTimelockStandIn = makeAddr("vaultTimelockStandIn");
        lpEarnVault.bindGovernance(vaultTimelockStandIn, address(registry));

        // addAdapter() requires the adapter be bound to the calling vault — the shared
        // `adapter` fixture is bound to `lpVault`, so this test needs its own adapter bound to
        // `lpEarnVault`.
        LiquidityAdapter lpAdapter = new LiquidityAdapter(usdt, address(lpEarnVault), STALENESS_WINDOW);
        vm.prank(otherCurator);
        registry.setAdapterAllowed(address(lpAdapter), true);

        vm.prank(attacker);
        vm.expectRevert(); // Unauthorized (not Curator)
        lpEarnVault.setAdapter(address(lpAdapter));

        vm.prank(otherCurator);
        lpEarnVault.setAdapter(address(lpAdapter));
        assertEq(lpEarnVault.adapter(), address(lpAdapter));

        LiquidityAdapter otherAdapter = new LiquidityAdapter(usdt, address(lpEarnVault), STALENESS_WINDOW);
        vm.prank(otherCurator);
        registry.setAdapterAllowed(address(otherAdapter), true);
        vm.prank(otherCurator);
        vm.expectRevert(); // AdapterAlreadySet
        lpEarnVault.setAdapter(address(otherAdapter));
    }
}
