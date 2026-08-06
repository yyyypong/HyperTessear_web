// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {VaultFactory} from "../src/asset-management/vaults/VaultFactory.sol";
import {EarnVaultDeployer} from "../src/asset-management/vaults/EarnVaultDeployer.sol";
import {LiquidityEarnVaultDeployer} from "../src/asset-management/vaults/LiquidityEarnVaultDeployer.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {LiquidityEarnVault} from "../src/asset-management/vaults/LiquidityEarnVault.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {AdapterRegistry} from "../src/asset-management/vaults/AdapterRegistry.sol";
import {IVaultFactory} from "../src/interfaces/IVaultFactory.sol";
import {IStateManager} from "../src/interfaces/IStateManager.sol";
import {ProtocolFeeConfig} from "../src/asset-infrastructure/ProtocolFeeConfig.sol";
import {ProductState, CycleState, StateContext, CreationFeeAction, FeePaymentKind} from "../src/libs/Types.sol";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockERC20Fee is ERC20 {
    constructor() ERC20("MockFeeToken", "FEE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract VaultFactoryTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    VaultFactory internal factory;
    AdapterRegistry internal adapterRegistry;
    ProtocolFeeConfig internal feeConfig;

    address internal governor    = makeAddr("governor");
    address internal nonGov      = makeAddr("nonGov");
    address internal bridge      = makeAddr("bridge");
    address internal cashVault   = makeAddr("cashVault");
    address internal registryOwner = makeAddr("registryOwner");

    uint256 internal constant NOW = 1_000_000;

    IVaultFactory.VaultParams internal baseEarnParams;
    IVaultFactory.VaultParams internal baseNoteParams;
    IVaultFactory.VaultParams internal baseLPParams;

    /// @dev The two deployer helpers must be deployed independently (not `new`'d inside
    ///      VaultFactory's own constructor) — see VaultFactory.sol's storage-section comment on
    ///      why that would push VaultFactory's init code over the EIP-3860 limit.
    function _newVaultFactory(address sm_) internal returns (VaultFactory) {
        EarnVaultDeployer earnDeployer = new EarnVaultDeployer();
        LiquidityEarnVaultDeployer lpDeployer = new LiquidityEarnVaultDeployer();
        return new VaultFactory(sm_, address(earnDeployer), address(lpDeployer), address(feeConfig));
    }

    function setUp() public {
        vm.warp(NOW);

        ac = new HyperAccessControl(governor);
        feeConfig = new ProtocolFeeConfig(address(ac), makeAddr("revPool"));
        sm = new StateManager(address(ac));
        usdt = new MockUSDT();
        queue = new Queue(address(sm));
        factory = _newVaultFactory(address(sm));
        adapterRegistry = new AdapterRegistry(registryOwner);

        // VaultFactory must be the wired official factory for sm.registerVault to accept it.
        vm.prank(governor);
        sm.setVaultFactory(address(factory));

        // Base parameter templates
        baseEarnParams = IVaultFactory.VaultParams({
            vaultType:      IVaultFactory.VaultType.EARN,
            name:           "Cash Earn",
            symbol:         "htCASH",
            usdt:           address(usdt),
            stateManager:   address(sm),
            settlement:     address(0),
            queue:          address(queue),
            owner:          address(0), // defaults to msg.sender
            adapterRegistry: address(adapterRegistry),
            liquidityBridge: bridge,
            cashVault:      address(0),
            feeKind:        FeePaymentKind.Native,
            initialProduct: ProductState.CONFIGURING,
            initialCycle:   CycleState.ACCEPTING
        });

        baseNoteParams = IVaultFactory.VaultParams({
            vaultType:      IVaultFactory.VaultType.EARN,
            name:           "Note Earn",
            symbol:         "htNOTE",
            usdt:           address(usdt),
            stateManager:   address(sm),
            settlement:     address(0),
            queue:          address(queue),
            owner:          address(0),
            adapterRegistry: address(adapterRegistry),
            liquidityBridge: address(0),  // no bridge for Note tranche
            cashVault:      address(0),
            feeKind:        FeePaymentKind.Native,
            initialProduct: ProductState.CONFIGURING,
            initialCycle:   CycleState.ACCEPTING
        });

        baseLPParams = IVaultFactory.VaultParams({
            vaultType:      IVaultFactory.VaultType.LP,
            name:           "LP Earn",
            symbol:         "htLP",
            usdt:           address(usdt),
            stateManager:   address(sm),
            settlement:     address(0),
            queue:          address(queue),
            owner:          address(0),
            adapterRegistry: address(adapterRegistry),
            liquidityBridge: bridge,
            cashVault:      cashVault,
            feeKind:        FeePaymentKind.Native,
            initialProduct: ProductState.CONFIGURING,
            initialCycle:   CycleState.ACCEPTING
        });
    }

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    function test_constructor_stores_addresses() public view {
        assertEq(factory.stateManager(), address(sm));
    }

    function test_constructor_zero_stateManager_reverts() public {
        EarnVaultDeployer earnDeployer = new EarnVaultDeployer();
        LiquidityEarnVaultDeployer lpDeployer = new LiquidityEarnVaultDeployer();
        vm.expectRevert(IVaultFactory.ZeroAddress.selector);
        new VaultFactory(address(0), address(earnDeployer), address(lpDeployer), address(feeConfig));
    }

    // -----------------------------------------------------------------------
    // deployVault — EARN (Cash)
    // -----------------------------------------------------------------------

    function test_deploy_earn_cash_vault() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseEarnParams);

        assertFalse(vault == address(0));
        // Registered in StateManager
        assertTrue(sm.isVaultRegistered(vault));
    }

    function test_deploy_earn_cash_vault_initial_state() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseEarnParams);

        StateContext memory ctx = sm.getState(vault);
        assertEq(uint8(ctx.product), uint8(ProductState.CONFIGURING));
        assertEq(uint8(ctx.cycle),   uint8(CycleState.ACCEPTING));
    }

    function test_deploy_earn_cash_vault_emits_event() public {
        // vault address and vaultTimelock address aren't known ahead of time, so we only
        // check the indexed topics we do know (vaultType, owner) and skip data verification.
        vm.expectEmit(true, false, true, false);
        emit IVaultFactory.VaultDeployed(
            IVaultFactory.VaultType.EARN,
            address(0),   // not checked (topic2 check disabled)
            governor,     // owner == msg.sender since params.owner == address(0)
            address(0),   // not checked (data check disabled)
            "Cash Earn",
            "htCASH",
            NOW
        );
        vm.prank(governor);
        factory.deployVault(baseEarnParams);
    }

    function test_deploy_earn_cash_vault_has_bridge() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseEarnParams);

        EarnVault ev = EarnVault(vault);
        assertEq(ev.liquidityBridge(), bridge);
    }

    // -----------------------------------------------------------------------
    // deployVault — EARN (Note, no bridge)
    // -----------------------------------------------------------------------

    function test_deploy_earn_note_vault() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseNoteParams);

        assertFalse(vault == address(0));
        assertTrue(sm.isVaultRegistered(vault));

        EarnVault ev = EarnVault(vault);
        assertEq(ev.liquidityBridge(), address(0));
    }

    // -----------------------------------------------------------------------
    // deployVault — LP
    // -----------------------------------------------------------------------

    function test_deploy_lp_vault() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseLPParams);

        assertFalse(vault == address(0));
        assertTrue(sm.isVaultRegistered(vault));
    }

    function test_deploy_lp_vault_has_cash_vault() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseLPParams);

        LiquidityEarnVault lp = LiquidityEarnVault(vault);
        assertEq(lp.cashVault(), cashVault);
    }

    function test_deploy_lp_vault_initial_state() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseLPParams);

        StateContext memory ctx = sm.getState(vault);
        assertEq(uint8(ctx.product), uint8(ProductState.CONFIGURING));
        assertEq(uint8(ctx.cycle),   uint8(CycleState.ACCEPTING));
    }

    // -----------------------------------------------------------------------
    // deployVault — access control
    // -----------------------------------------------------------------------

    // deployVault is now permissionless (removed: old test_deploy_non_governor_reverts,
    // which asserted a Governor-only gate that no longer exists). Anyone may deploy, and
    // becomes the vault's Owner (since params.owner == address(0) defaults to msg.sender).
    function test_deploy_permissionless_nonGovernor_succeeds() public {
        vm.prank(nonGov);
        address vault = factory.deployVault(baseEarnParams);

        assertTrue(sm.isVaultRegistered(vault));
        assertEq(EarnVault(vault).owner(), nonGov);
    }

    function test_deploy_explicit_owner_used_over_msgSender() public {
        address explicitOwner = makeAddr("explicitOwner");
        IVaultFactory.VaultParams memory p = baseEarnParams;
        p.owner = explicitOwner;

        vm.prank(nonGov);
        address vault = factory.deployVault(p);

        assertEq(EarnVault(vault).owner(), explicitOwner);
    }

    function test_deploy_zero_adapterRegistry_reverts() public {
        IVaultFactory.VaultParams memory p = baseEarnParams;
        p.adapterRegistry = address(0);

        vm.prank(governor);
        vm.expectRevert(IVaultFactory.ZeroAddress.selector);
        factory.deployVault(p);
    }

    // Without StateManager.setVaultFactory wiring, even a permissionless deploy fails —
    // registerVault propagates NotVaultFactory from StateManager.
    function test_deploy_reverts_if_factory_not_wired_in_stateManager() public {
        StateManager freshSm = new StateManager(address(ac));
        VaultFactory unwiredFactory = _newVaultFactory(address(freshSm));

        IVaultFactory.VaultParams memory p = baseEarnParams;
        p.stateManager = address(freshSm);

        vm.prank(governor);
        vm.expectRevert(IStateManager.NotVaultFactory.selector);
        unwiredFactory.deployVault(p);
    }

    // -----------------------------------------------------------------------
    // deployVault — governance wiring (VaultTimelock bound automatically)
    // -----------------------------------------------------------------------

    function test_deploy_binds_vaultTimelock_and_adapterRegistry() public {
        vm.prank(governor);
        address vault = factory.deployVault(baseEarnParams);

        EarnVault ev = EarnVault(vault);
        assertTrue(ev.vaultTimelock() != address(0));
        assertEq(ev.adapterRegistry(), address(adapterRegistry));
    }

    // -----------------------------------------------------------------------
    // deployVault — multiple vaults registered independently
    // -----------------------------------------------------------------------

    function test_deploy_multiple_vaults() public {
        vm.startPrank(governor);
        address cash = factory.deployVault(baseEarnParams);
        address note = factory.deployVault(baseNoteParams);
        address lp   = factory.deployVault(baseLPParams);
        vm.stopPrank();

        assertTrue(sm.isVaultRegistered(cash));
        assertTrue(sm.isVaultRegistered(note));
        assertTrue(sm.isVaultRegistered(lp));
        // All different addresses
        assertTrue(cash != note && note != lp && cash != lp);
    }

    // -----------------------------------------------------------------------
    // deployVault — initial state variations
    // -----------------------------------------------------------------------

    function test_deploy_with_subscribing_state() public {
        IVaultFactory.VaultParams memory p = baseEarnParams;
        p.initialProduct = ProductState.SUBSCRIBING;
        p.initialCycle   = CycleState.ACCEPTING;

        vm.prank(governor);
        address vault = factory.deployVault(p);

        StateContext memory ctx = sm.getState(vault);
        assertEq(uint8(ctx.product), uint8(ProductState.SUBSCRIBING));
    }

    // -----------------------------------------------------------------------
    // deployVault — creation fee
    // -----------------------------------------------------------------------

    function test_deployVault_zeroFee_native_succeeds() public {
        IVaultFactory.VaultParams memory p = baseEarnParams;
        address vault = factory.deployVault(p);
        assertTrue(vault != address(0));
    }

    function test_deployVault_nativeFee_exactValue_succeeds() public {
        vm.prank(governor);
        feeConfig.setFee(CreationFeeAction.DeployVault, FeePaymentKind.Native, 1 ether);

        vm.deal(address(this), 1 ether);
        factory.deployVault{value: 1 ether}(baseEarnParams);
        assertEq(feeConfig.revenuePool().balance, 1 ether);
    }

    function test_deployVault_nativeFee_wrongValue_reverts() public {
        vm.prank(governor);
        feeConfig.setFee(CreationFeeAction.DeployVault, FeePaymentKind.Native, 1 ether);

        vm.deal(address(this), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IVaultFactory.IncorrectNativeFee.selector, 1 ether, 0));
        factory.deployVault(baseEarnParams);
    }

    function test_deployVault_stableFee_pullsExactAmountAndDeploys() public {
        MockERC20Fee stable = new MockERC20Fee();
        vm.startPrank(governor);
        feeConfig.setPaymentToken(FeePaymentKind.Stable, address(stable));
        feeConfig.setFee(CreationFeeAction.DeployVault, FeePaymentKind.Stable, 50e6);
        vm.stopPrank();

        stable.mint(address(this), 50e6);
        stable.approve(address(factory), 50e6);

        IVaultFactory.VaultParams memory p = baseEarnParams;
        p.feeKind = FeePaymentKind.Stable;
        address vault = factory.deployVault(p);

        assertTrue(vault != address(0));
        assertEq(stable.balanceOf(feeConfig.revenuePool()), 50e6);
    }
}
