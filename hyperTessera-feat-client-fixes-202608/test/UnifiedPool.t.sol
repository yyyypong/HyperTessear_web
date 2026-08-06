// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {UnifiedPool} from "../src/asset-management/settlement/UnifiedPool.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {RevenuePool} from "../src/asset-management/settlement/RevenuePool.sol";
import {IUnifiedPool} from "../src/interfaces/IUnifiedPool.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {Tranche} from "../src/libs/Types.sol";

// Reuse mock from RevenuePool test.
contract MockUSDT2 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// Mock StateManager: whitelists specific vaults.
contract MockSM2 {
    mapping(address => bool) public registeredVaults;
    function registerVault(address v) external { registeredVaults[v] = true; }
}

// Minimal mock vault exposing the IVaultRoles.owner() / IBaseVault.settlement() surface that
// UnifiedPool now depends on (owner-gated registration, settlement-gated distribute).
contract MockVault3 {
    address public owner;
    address public settlement;

    constructor(address owner_) {
        owner = owner_;
    }

    function setSettlement(address settlement_) external {
        settlement = settlement_;
    }
}

// Minimal mock Settlement exposing isOperator(vault, account), consumed via
// ISettlement(vault.settlement()).isOperator(...) for the Settlement-Operator-gated functions.
contract MockSettlement3 {
    mapping(address => mapping(address => bool)) public isOperator;

    function setOperator(address vault, address account, bool approved) external {
        isOperator[vault][account] = approved;
    }
}

/// @notice Trivial "next implementation" used to exercise UUPS upgrade authorization end to end
///         (governor-gated `upgradeToAndCall`, storage preserved across the swap) and to confirm
///         the reentrancy guard's storage slot survives an upgrade unmoved.
contract UnifiedPoolV2Mock is UnifiedPool {
    function version() external pure returns (string memory) {
        return "v2-mock";
    }

    function reenterRepayInterest(uint256 amount) external nonReentrant {
        this.repayInterest(amount);
    }
}

contract UnifiedPoolTest is Test {
    HyperAccessControl internal ac;
    MockUSDT2 internal usdt;
    MockSM2 internal sm;
    RevenuePool internal revPool;
    UnifiedPool internal pool;
    MockSettlement3 internal mockSettlement;
    MockVault3 internal vaultMock;

    address internal governor = makeAddr("governor");
    address internal vaultOwner = makeAddr("vaultOwner");
    address internal operator = makeAddr("operator");
    address internal payer = makeAddr("payer");
    address internal vault;
    address internal settlement;
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        ac = new HyperAccessControl(governor);
        usdt = new MockUSDT2();
        sm = new MockSM2();
        revPool = new RevenuePool(address(usdt), address(ac));

        UnifiedPool poolImpl = new UnifiedPool();
        bytes memory poolInitData = abi.encodeCall(UnifiedPool.initialize, (address(usdt), address(sm), address(ac)));
        pool = UnifiedPool(address(new ERC1967Proxy(address(poolImpl), poolInitData)));

        vm.prank(governor);
        revPool.addAuthorizedSource(address(pool));

        mockSettlement = new MockSettlement3();
        settlement = address(mockSettlement);

        vaultMock = new MockVault3(vaultOwner);
        vaultMock.setSettlement(settlement);
        vault = address(vaultMock);

        sm.registerVault(vault);
        mockSettlement.setOperator(vault, operator, true);

        vm.prank(vaultOwner);
        pool.addTrancheVault(Tranche.Cash, vault);
    }

    function _makeVault(address owner_) internal returns (address v, MockVault3 mock) {
        mock = new MockVault3(owner_);
        mock.setSettlement(settlement);
        v = address(mock);
    }

    // -----------------------------------------------------------------------
    // Constructor / initialize
    // -----------------------------------------------------------------------

    function test_initialize_revertsOnZeroAddresses() public {
        UnifiedPool poolImpl = new UnifiedPool();
        bytes memory badInitData = abi.encodeCall(UnifiedPool.initialize, (address(0), address(sm), address(ac)));
        vm.expectRevert(IUnifiedPool.ZeroAddress.selector);
        new ERC1967Proxy(address(poolImpl), badInitData);
    }

    function test_initialize_cannotBeCalledTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pool.initialize(address(usdt), address(sm), address(ac));
    }

    // -----------------------------------------------------------------------
    // UUPS upgrade authorization
    // -----------------------------------------------------------------------

    function test_upgradeToAndCall_byGovernor_succeeds() public {
        UnifiedPoolV2Mock newImpl = new UnifiedPoolV2Mock();

        vm.prank(governor);
        pool.upgradeToAndCall(address(newImpl), "");

        // State survives the upgrade (proxy storage, not implementation, holds it).
        assertTrue(pool.vaultConfigured(vault));
        assertEq(UnifiedPoolV2Mock(address(pool)).version(), "v2-mock");
    }

    function test_upgradeToAndCall_byNonGovernor_reverts() public {
        UnifiedPoolV2Mock newImpl = new UnifiedPoolV2Mock();

        vm.prank(attacker);
        vm.expectRevert(IUnifiedPool.NotGovernor.selector);
        pool.upgradeToAndCall(address(newImpl), "");
    }

    /// @notice Guards against a state-variable insertion between the reentrancy-guard fields and
    ///         `__gap` silently corrupting the storage layout on a future upgrade.
    function test_reentrancyGuard_stillGatesReentrancy_afterUpgrade() public {
        UnifiedPoolV2Mock newImpl = new UnifiedPoolV2Mock();
        vm.prank(governor);
        pool.upgradeToAndCall(address(newImpl), "");

        vm.prank(payer);
        vm.expectRevert(UnifiedPool.ReentrancyGuardReentrantCall.selector);
        UnifiedPoolV2Mock(address(pool)).reenterRepayInterest(1);
    }

    // -----------------------------------------------------------------------
    // addTrancheVault / deactivate / reactivate / getTrancheVaults
    // -----------------------------------------------------------------------

    function test_addTrancheVault_setsConfiguredAndActive() public {
        assertTrue(pool.vaultConfigured(vault));
        assertTrue(pool.vaultActive(vault));
        assertTrue(pool.isTrancheVault(Tranche.Cash, vault));
        assertEq(uint8(pool.vaultTranche(vault)), uint8(Tranche.Cash));
    }

    function test_addTrancheVault_multipleVaultsPerTranche() public {
        (address vault2,) = _makeVault(vaultOwner);
        vm.prank(vaultOwner);
        pool.addTrancheVault(Tranche.Cash, vault2);

        address[] memory vaults = pool.getTrancheVaults(Tranche.Cash);
        assertEq(vaults.length, 2);
        assertEq(vaults[0], vault);
        assertEq(vaults[1], vault2);
    }

    function test_addTrancheVault_revertsIfAlreadyConfigured() public {
        vm.prank(vaultOwner);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.VaultAlreadyConfigured.selector, vault));
        pool.addTrancheVault(Tranche.Note, vault);
    }

    function test_addTrancheVault_revertsForNonOwner() public {
        (address vault2,) = _makeVault(vaultOwner);
        vm.prank(attacker);
        vm.expectRevert(IUnifiedPool.NotVaultOwner.selector);
        pool.addTrancheVault(Tranche.Note, vault2);
    }

    function test_addTrancheVault_revertsOnZeroAddress() public {
        vm.prank(vaultOwner);
        vm.expectRevert(IUnifiedPool.ZeroAddress.selector);
        pool.addTrancheVault(Tranche.Note, address(0));
    }

    function test_deactivateTrancheVault_setsInactive() public {
        vm.prank(vaultOwner);
        pool.deactivateTrancheVault(vault);
        assertFalse(pool.vaultActive(vault));
    }

    function test_deactivateTrancheVault_revertsForNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert(IUnifiedPool.NotVaultOwner.selector);
        pool.deactivateTrancheVault(vault);
    }

    function test_reactivateTrancheVault_restoresActive() public {
        vm.startPrank(vaultOwner);
        pool.deactivateTrancheVault(vault);
        pool.reactivateTrancheVault(vault);
        vm.stopPrank();
        assertTrue(pool.vaultActive(vault));
    }

    function test_deactivatedVault_stillDistributable() public {
        // Fund pending, then deactivate — distribute must still work against historical pending.
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);

        vm.prank(operator);
        pool.attributePrincipal(vault, 1_000e6);

        vm.prank(vaultOwner);
        pool.deactivateTrancheVault(vault);

        vm.prank(settlement);
        pool.distribute(vault, 500e6);
        assertEq(pool.pending(vault), 500e6);
    }

    // -----------------------------------------------------------------------
    // repayInterest / repayPrincipal — permissionless deposits into the unattributed pools
    // (SET-06: no longer credit any vault's pending directly; repayInterestBatch was removed
    // entirely since attribution is now a separate, per-vault Settlement-Operator-gated step).
    // -----------------------------------------------------------------------

    function test_repayInterest_creditsUnattributedPool_noVaultAttribution() public {
        uint256 amount = 1_000e6;
        usdt.mint(payer, amount);
        vm.prank(payer);
        usdt.approve(address(pool), amount);

        vm.prank(payer);
        pool.repayInterest(amount);

        assertEq(pool.unattributedInterest(), amount);
        assertEq(pool.pending(vault), 0);
        assertEq(pool.totalPending(), 0);
    }

    function test_repayInterest_isPermissionless() public {
        // No role/authorization required — any real payer may deposit.
        usdt.mint(attacker, 1_000e6);
        vm.prank(attacker);
        usdt.approve(address(pool), 1_000e6);

        vm.prank(attacker);
        pool.repayInterest(1_000e6);

        assertEq(pool.unattributedInterest(), 1_000e6);
    }

    function test_repayInterest_revertsForZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(IUnifiedPool.ZeroAmount.selector);
        pool.repayInterest(0);
    }

    function test_repayInterest_emitsInterestDeposited() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IUnifiedPool.InterestDeposited(payer, 1_000e6, block.timestamp);

        vm.prank(payer);
        pool.repayInterest(1_000e6);
    }

    function test_repayPrincipal_creditsUnattributedPool() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);

        vm.prank(payer);
        pool.repayPrincipal(1_000e6);

        assertEq(pool.unattributedPrincipal(), 1_000e6);
        assertEq(pool.pending(vault), 0);
        assertEq(pool.totalPending(), 0);
    }

    function test_repayPrincipal_revertsForZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(IUnifiedPool.ZeroAmount.selector);
        pool.repayPrincipal(0);
    }

    // -----------------------------------------------------------------------
    // attributeInterest / attributePrincipal — that vault's Settlement Operator moves funds
    // from the unattributed pool into pending[vault]. New surface replacing the old
    // vault-scoped repayInterest/repayInterestBatch/repayPrincipal.
    // -----------------------------------------------------------------------

    function test_attributeInterest_movesFromUnattributedToPending() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayInterest(1_000e6);

        vm.prank(operator);
        pool.attributeInterest(vault, 600e6);

        assertEq(pool.unattributedInterest(), 400e6);
        assertEq(pool.pending(vault), 600e6);
        assertEq(pool.totalPending(), 600e6);
    }

    function test_attributeInterest_emitsInterestRepaid() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayInterest(1_000e6);

        vm.expectEmit(true, true, false, true, address(pool));
        emit IUnifiedPool.InterestRepaid(Tranche.Cash, vault, 600e6, block.timestamp);

        vm.prank(operator);
        pool.attributeInterest(vault, 600e6);
    }

    function test_attributeInterest_revertsForNonSettlementOperator() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.NotSettlementOperator.selector, vault));
        pool.attributeInterest(vault, 1);
    }

    function test_attributeInterest_revertsForZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert(IUnifiedPool.ZeroAmount.selector);
        pool.attributeInterest(vault, 0);
    }

    function test_attributeInterest_revertsForUnconfiguredVault() public {
        (address unknown,) = _makeVault(vaultOwner);
        mockSettlement.setOperator(unknown, operator, true);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.VaultNotConfigured.selector, unknown));
        pool.attributeInterest(unknown, 1);
    }

    function test_attributeInterest_revertsForInactiveVault() public {
        vm.prank(vaultOwner);
        pool.deactivateTrancheVault(vault);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.VaultInactive.selector, vault));
        pool.attributeInterest(vault, 1);
    }

    function test_attributeInterest_revertsIfExceedsUnattributedPool() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.InsufficientUnattributedInterest.selector, 0, 1));
        pool.attributeInterest(vault, 1);
    }

    function test_attributePrincipal_movesFromUnattributedToPending() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);

        vm.prank(operator);
        pool.attributePrincipal(vault, 700e6);

        assertEq(pool.unattributedPrincipal(), 300e6);
        assertEq(pool.pending(vault), 700e6);
        assertEq(pool.totalPending(), 700e6);
    }

    function test_attributePrincipal_revertsForNonSettlementOperator() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.NotSettlementOperator.selector, vault));
        pool.attributePrincipal(vault, 1);
    }

    function test_attributePrincipal_revertsIfExceedsUnattributedPool() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.InsufficientUnattributedPrincipal.selector, 0, 1));
        pool.attributePrincipal(vault, 1);
    }

    // -----------------------------------------------------------------------
    // receiveVaultPrincipal
    // -----------------------------------------------------------------------

    function test_receiveVaultPrincipal_pullsUSDTAndCreditsCallingVault() public {
        // `vault` is already StateManager-registered and UnifiedPool-configured (Cash tranche)
        // from setUp() — receiveVaultPrincipal no longer restricts by Tranche.
        usdt.mint(vault, 800e6);
        vm.prank(vault);
        usdt.approve(address(pool), 800e6);

        vm.prank(vault);
        pool.receiveVaultPrincipal(800e6);

        assertEq(pool.pending(vault), 800e6);
        assertEq(pool.totalPending(), 800e6);
        assertEq(usdt.balanceOf(address(pool)), 800e6);
        // Does not touch the unattributed pool — this is direct attribution, not a permissionless deposit.
        assertEq(pool.unattributedPrincipal(), 0);
    }

    function test_receiveVaultPrincipal_revertsForUnregisteredCaller() public {
        address unregistered = makeAddr("unregistered");
        vm.prank(unregistered);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.UnregisteredVault.selector, unregistered));
        pool.receiveVaultPrincipal(100e6);
    }

    function test_receiveVaultPrincipal_revertsIfCallerNotConfiguredInPool() public {
        // Registered in StateManager but never added as a tranche vault in UnifiedPool.
        address registeredOnly = makeAddr("registeredOnly");
        sm.registerVault(registeredOnly);

        vm.prank(registeredOnly);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.VaultNotConfigured.selector, registeredOnly));
        pool.receiveVaultPrincipal(100e6);
    }

    function test_receiveVaultPrincipal_emitsEvent() public {
        usdt.mint(vault, 800e6);
        vm.prank(vault);
        usdt.approve(address(pool), 800e6);

        vm.expectEmit(true, false, false, true, address(pool));
        emit IUnifiedPool.VaultPrincipalReceived(vault, 800e6, block.timestamp);

        vm.prank(vault);
        pool.receiveVaultPrincipal(800e6);
    }

    // -----------------------------------------------------------------------
    // distribute / availableToDistribute
    // -----------------------------------------------------------------------

    function test_distribute_transfersUSDT() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);
        vm.prank(operator);
        pool.attributePrincipal(vault, 1_000e6);

        vm.prank(settlement);
        pool.distribute(vault, 600e6);

        assertEq(pool.pending(vault), 400e6);
        assertEq(pool.totalPending(), 400e6);
        assertEq(usdt.balanceOf(vault), 600e6);
    }

    function test_distribute_revertsIfInsufficientPending() public {
        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.InsufficientPending.selector, vault, 0, 1));
        pool.distribute(vault, 1);
    }

    function test_distribute_revertsIfInsufficientCash() public {
        // Pending exceeds actual cash on hand — operatorTransfer drained the cash out first.
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);
        vm.prank(operator);
        pool.attributePrincipal(vault, 1_000e6);

        vm.prank(operator);
        pool.operatorTransfer(vault, makeAddr("sink"), 700e6, bytes32(0));

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.InsufficientCash.selector, 300e6, 1_000e6));
        pool.distribute(vault, 1_000e6);
    }

    function test_distribute_revertsForNonSettlement() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.NotVaultSettlement.selector, vault));
        pool.distribute(vault, 1);
    }

    function test_availableToDistribute_boundedByCash() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);
        vm.prank(operator);
        pool.attributePrincipal(vault, 1_000e6);

        vm.prank(operator);
        pool.operatorTransfer(vault, makeAddr("sink"), 600e6, bytes32(0));

        assertEq(pool.availableToDistribute(vault), 400e6);
    }

    // -----------------------------------------------------------------------
    // operatorTransfer / operatorTransferToRevenuePool — that vault's Settlement Operator only
    // -----------------------------------------------------------------------

    function test_operatorTransfer_movesCash_doesNotTouchPending() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);
        vm.prank(operator);
        pool.attributePrincipal(vault, 1_000e6);

        address recipient = makeAddr("recipient");
        vm.prank(operator);
        pool.operatorTransfer(vault, recipient, 400e6, bytes32("ref1"));

        assertEq(usdt.balanceOf(recipient), 400e6);
        assertEq(pool.pending(vault), 1_000e6);
        assertEq(pool.totalPending(), 1_000e6);
    }

    function test_operatorTransfer_revertsForNonSettlementOperator() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IUnifiedPool.NotSettlementOperator.selector, vault));
        pool.operatorTransfer(vault, makeAddr("recipient"), 1, bytes32(0));
    }

    function test_operatorTransfer_revertsOnZeroRecipient() public {
        vm.prank(operator);
        vm.expectRevert(IUnifiedPool.InvalidRecipient.selector);
        pool.operatorTransfer(vault, address(0), 1, bytes32(0));
    }

    function test_operatorTransferToRevenuePool_callsReceiveFee() public {
        usdt.mint(payer, 1_000e6);
        vm.prank(payer);
        usdt.approve(address(pool), 1_000e6);
        vm.prank(payer);
        pool.repayPrincipal(1_000e6);
        vm.prank(operator);
        pool.attributePrincipal(vault, 1_000e6);

        vm.prank(operator);
        pool.operatorTransferToRevenuePool(vault, address(revPool), 250e6, bytes32("ref2"));

        assertEq(usdt.balanceOf(address(revPool)), 250e6);
        assertEq(revPool.totalFeesReceived(), 250e6);
        // pending untouched — this isn't a Vault repayment.
        assertEq(pool.pending(vault), 1_000e6);
    }
}
