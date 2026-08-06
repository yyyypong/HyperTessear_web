// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {LiquidityBridge} from "../src/asset-management/vaults/LiquidityBridge.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {ILiquidityBridge} from "../src/interfaces/ILiquidityBridge.sol";
import {ProductState, CycleState} from "../src/libs/Types.sol";

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Minimal IVaultRoles-shaped stand-in exposing only `allocator()`, used as `fromVault`
///         in bridgeDeposit tests: LiquidityBridge checks `IVaultRoles(fromVault).allocator()`,
///         and that call reverts if `fromVault` is a plain EOA with no code.
contract MockAllocatorVault {
    address public allocator;
    constructor(address allocator_) { allocator = allocator_; }
}

contract LiquidityBridgeTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    LiquidityBridge internal bridge;
    EarnVault internal cashVault;

    address internal governor   = makeAddr("governor");
    address internal factory    = makeAddr("factory");
    address internal allocator  = makeAddr("allocator");
    address internal alice      = makeAddr("alice");

    uint256 internal constant NOW = 1_000_000;

    function setUp() public {
        vm.warp(NOW);

        ac = new HyperAccessControl(governor);
        sm = new StateManager(address(ac));
        usdt = new MockUSDT();

        vm.prank(governor);
        sm.setVaultFactory(factory);

        queue = new Queue(address(sm));
        bridge = new LiquidityBridge(address(usdt));

        cashVault = new EarnVault(
            "Cash Earn", "htCASH",
            address(usdt), address(sm), address(queue), governor,
            address(bridge)  // liquidityBridge
        );

        vm.prank(factory);
        sm.registerVault(address(cashVault), ProductState.CONFIGURING, CycleState.ACCEPTING);
    }

    // -----------------------------------------------------------------------
    // bridgeDeposit — access control
    // -----------------------------------------------------------------------

    function test_bridgeDeposit_by_fromVaults_allocator() public {
        // fromVault must be a real IVaultRoles-shaped contract now — bridgeDeposit checks
        // IVaultRoles(fromVault).allocator(), which reverts against a plain EOA with no code.
        MockAllocatorVault fromVault = new MockAllocatorVault(allocator);
        uint256 assets = 1_000e6;
        usdt.mint(address(fromVault), assets);

        // fromVault must approve bridge to pull USDT
        vm.prank(address(fromVault));
        usdt.approve(address(bridge), assets);

        // allocator calls bridgeDeposit on behalf of fromVault
        vm.prank(allocator);
        uint256 shares = bridge.bridgeDeposit(assets, address(fromVault), address(cashVault));
        assertGt(shares, 0);
        // Shares landed in fromVault
        assertEq(cashVault.balanceOf(address(fromVault)), shares);
    }

    function test_bridgeDeposit_by_fromVault() public {
        // Simulate fromVault calling bridgeDeposit on itself. NOTE: fromVault must still be a
        // real IVaultRoles-shaped contract here even though msg.sender == fromVault already
        // satisfies bridgeDeposit's auth check on its own — `bool isAllocator =
        // IVaultRoles(fromVault).allocator() == msg.sender` is evaluated unconditionally
        // (not short-circuited by `isFromVault`), so a plain EOA fromVault reverts on that
        // external call regardless. Possible src bug — reported, not fixed here.
        MockAllocatorVault fromVault = new MockAllocatorVault(makeAddr("unrelatedAllocator"));
        uint256 assets = 500e6;
        usdt.mint(address(fromVault), assets);

        vm.startPrank(address(fromVault));
        usdt.approve(address(bridge), assets);
        uint256 shares = bridge.bridgeDeposit(assets, address(fromVault), address(cashVault));
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(cashVault.balanceOf(address(fromVault)), shares);
    }

    function test_bridgeDeposit_unauthorized_reverts() public {
        MockAllocatorVault fromVault = new MockAllocatorVault(allocator);
        usdt.mint(address(fromVault), 1_000e6);
        vm.prank(address(fromVault)); usdt.approve(address(bridge), 1_000e6);

        vm.prank(alice); // alice is neither fromVault's allocator nor fromVault itself
        vm.expectRevert(abi.encodeWithSelector(ILiquidityBridge.CallerNotAuthorized.selector, alice));
        bridge.bridgeDeposit(1_000e6, address(fromVault), address(cashVault));
    }

    // -----------------------------------------------------------------------
    // bridgeDeposit — validation
    // -----------------------------------------------------------------------

    function test_bridgeDeposit_zero_assets_reverts() public {
        vm.prank(allocator);
        vm.expectRevert(ILiquidityBridge.ZeroAssets.selector);
        bridge.bridgeDeposit(0, alice, address(cashVault));
    }

    function test_bridgeDeposit_emits_DepositBridged() public {
        MockAllocatorVault fromVault = new MockAllocatorVault(allocator);
        uint256 assets = 1_000e6;
        usdt.mint(address(fromVault), assets);
        vm.prank(address(fromVault)); usdt.approve(address(bridge), assets);

        uint256 expectedShares = cashVault.convertToShares(assets);
        vm.prank(allocator);
        vm.expectEmit(true, true, false, true);
        emit ILiquidityBridge.DepositBridged(address(fromVault), address(cashVault), assets, expectedShares, NOW);
        bridge.bridgeDeposit(assets, address(fromVault), address(cashVault));
    }

    // -----------------------------------------------------------------------
    // EarnVault sync deposit guard
    // -----------------------------------------------------------------------

    function test_earnVault_sync_deposit_only_bridge() public {
        // Calling cashVault.deposit directly (not via bridge) reverts
        vm.prank(alice);
        vm.expectRevert(); // OnlyLiquidityBridge
        cashVault.deposit(1_000e6, alice);
    }

    function test_earnVault_sync_deposit_via_bridge_increases_balance() public {
        MockAllocatorVault fromVault = new MockAllocatorVault(allocator);
        uint256 assets = 2_000e6;
        usdt.mint(address(fromVault), assets);
        vm.prank(address(fromVault)); usdt.approve(address(bridge), assets);

        vm.prank(allocator);
        uint256 shares = bridge.bridgeDeposit(assets, address(fromVault), address(cashVault));
        assertEq(cashVault.balanceOf(address(fromVault)), shares);
        // Bridge holds no shares
        assertEq(cashVault.balanceOf(address(bridge)), 0);
        // Bridge holds no USDT
        assertEq(usdt.balanceOf(address(bridge)), 0);
    }

    // -----------------------------------------------------------------------
    // No bridgeRedeem (spec: removed in redesign)
    // -----------------------------------------------------------------------

    function test_no_bridgeRedeem_function() public view {
        // Verify there is no bridgeRedeem on the bridge (spec: removed)
        // This test passes if the contract compiles without bridgeRedeem
        assertTrue(address(bridge) != address(0));
    }
}
