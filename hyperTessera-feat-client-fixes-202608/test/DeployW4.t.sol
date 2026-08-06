// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {RevenuePool} from "../src/asset-management/settlement/RevenuePool.sol";
import {UnifiedPool} from "../src/asset-management/settlement/UnifiedPool.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {NAVOracle} from "../src/asset-infrastructure/NAVOracle.sol";
import {LiquidityBridge} from "../src/asset-management/vaults/LiquidityBridge.sol";
import {VaultFactory} from "../src/asset-management/vaults/VaultFactory.sol";
import {EarnVaultDeployer} from "../src/asset-management/vaults/EarnVaultDeployer.sol";
import {LiquidityEarnVaultDeployer} from "../src/asset-management/vaults/LiquidityEarnVaultDeployer.sol";
import {AdapterRegistry} from "../src/asset-management/vaults/AdapterRegistry.sol";
import {IVaultFactory} from "../src/interfaces/IVaultFactory.sol";
import {LiquidityEarnVault} from "../src/asset-management/vaults/LiquidityEarnVault.sol";
import {IBaseVault} from "../src/interfaces/IBaseVault.sol";
import {Settlement} from "../src/asset-management/settlement/Settlement.sol";
import {AdapterFactory} from "../src/asset-management/strategy/AdapterFactory.sol";
import {IAdapterFactory} from "../src/interfaces/IAdapterFactory.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";
import {ProtocolFeeConfig} from "../src/asset-infrastructure/ProtocolFeeConfig.sol";
import {ProductState, CycleState, Tranche, FeePaymentKind} from "../src/libs/Types.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title DeployW4Test
/// @notice Wiring smoke test for the DeployW4 sequence (development-plan §3.4.3, §3.4.4).
///         Replicates DeployW3+DeployW4's logic against a fresh local W1/W2 deploy since
///         DeployW4 itself is a Script (env-var driven, not directly forge-testable).
contract DeployW4Test is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    MockUSDT internal usdt;
    RevenuePool internal revPool;
    UnifiedPool internal unifiedPool;
    NAVOracle internal navOracle;
    LiquidityBridge internal liquidityBridge;
    VaultFactory internal vaultFactory;
    AdapterRegistry internal adapterRegistry;

    address internal cashVault;
    address internal noteVault;
    address internal lpVault;

    Settlement internal settlement;
    AdapterFactory internal adapterFactory;
    address internal cashAdapter;
    address internal noteAdapter;
    address internal lpAdapter;

    address internal governor = makeAddr("governor");
    address internal operator1 = makeAddr("operator1");
    address internal operator2 = makeAddr("operator2");
    address internal dataProviderSigner = makeAddr("dataProviderSigner");

    function setUp() public {
        // --- W1/W2 ---
        ac = new HyperAccessControl(governor);
        usdt = new MockUSDT();
        sm = new StateManager(address(ac));
        revPool = new RevenuePool(address(usdt), address(ac));
        UnifiedPool unifiedPoolImpl = new UnifiedPool();
        bytes memory unifiedPoolInitData =
            abi.encodeCall(UnifiedPool.initialize, (address(usdt), address(sm), address(ac)));
        unifiedPool = UnifiedPool(address(new ERC1967Proxy(address(unifiedPoolImpl), unifiedPoolInitData)));

        vm.prank(governor);
        revPool.addAuthorizedSource(address(unifiedPool));

        // --- W3 ---
        navOracle = new NAVOracle(governor, 2000);
        queue = new Queue(address(sm));
        liquidityBridge = new LiquidityBridge(address(usdt));
        EarnVaultDeployer earnDeployer = new EarnVaultDeployer();
        LiquidityEarnVaultDeployer lpDeployer = new LiquidityEarnVaultDeployer();
        ProtocolFeeConfig vaultFeeConfig = new ProtocolFeeConfig(address(ac), makeAddr("revPool"));
        vaultFactory = new VaultFactory(address(sm), address(earnDeployer), address(lpDeployer), address(vaultFeeConfig));
        adapterRegistry = new AdapterRegistry(governor);

        vm.prank(governor);
        sm.setVaultFactory(address(vaultFactory));

        vm.startPrank(governor);
        cashVault = vaultFactory.deployVault(
            IVaultFactory.VaultParams({
                vaultType: IVaultFactory.VaultType.EARN,
                name: "HyperTessera Cash Earn",
                symbol: "htCASH",
                usdt: address(usdt),
                stateManager: address(sm),
                settlement: address(0),
                queue: address(queue),
                owner: address(0),
                adapterRegistry: address(adapterRegistry),
                liquidityBridge: address(liquidityBridge),
                cashVault: address(0),
                feeKind: FeePaymentKind.Native,
                initialProduct: ProductState.CONFIGURING,
                initialCycle: CycleState.ACCEPTING
            })
        );
        noteVault = vaultFactory.deployVault(
            IVaultFactory.VaultParams({
                vaultType: IVaultFactory.VaultType.EARN,
                name: "HyperTessera Note Earn",
                symbol: "htNOTE",
                usdt: address(usdt),
                stateManager: address(sm),
                settlement: address(0),
                queue: address(queue),
                owner: address(0),
                adapterRegistry: address(adapterRegistry),
                liquidityBridge: address(0),
                cashVault: address(0),
                feeKind: FeePaymentKind.Native,
                initialProduct: ProductState.CONFIGURING,
                initialCycle: CycleState.ACCEPTING
            })
        );
        lpVault = vaultFactory.deployVault(
            IVaultFactory.VaultParams({
                vaultType: IVaultFactory.VaultType.LP,
                name: "HyperTessera Liquidity Earn",
                symbol: "htLP",
                usdt: address(usdt),
                stateManager: address(sm),
                settlement: address(0),
                queue: address(queue),
                owner: address(0),
                adapterRegistry: address(adapterRegistry),
                liquidityBridge: address(liquidityBridge),
                cashVault: cashVault,
                feeKind: FeePaymentKind.Native,
                initialProduct: ProductState.CONFIGURING,
                initialCycle: CycleState.ACCEPTING
            })
        );

        // governor is each vault's Owner (VaultFactory defaults owner to msg.sender); wire
        // itself in as Keeper and Curator so the rest of this test bootstrap can proceed
        // single-wallet, mirroring DeployW3._grantVaultLocalRoles.
        IBaseVault(cashVault).setKeeper(governor, true);
        IBaseVault(cashVault).setCurator(governor);
        IBaseVault(noteVault).setKeeper(governor, true);
        IBaseVault(noteVault).setCurator(governor);
        IBaseVault(lpVault).setKeeper(governor, true);
        IBaseVault(lpVault).setCurator(governor);
        vm.stopPrank();

        vm.startPrank(governor);
        unifiedPool.addTrancheVault(Tranche.Cash, cashVault);
        unifiedPool.addTrancheVault(Tranche.Note, noteVault);
        unifiedPool.addTrancheVault(Tranche.LP, lpVault);
        vm.stopPrank();

        // --- W4 (DeployW4 sequence, replicated inline) ---
        vm.startPrank(governor);
        settlement = new Settlement(address(sm), address(unifiedPool), address(queue));

        IBaseVault(cashVault).setSettlement(address(settlement));
        IBaseVault(noteVault).setSettlement(address(settlement));
        IBaseVault(lpVault).setSettlement(address(settlement));

        settlement.setOperator(cashVault, operator1, true);
        settlement.setOperator(cashVault, operator2, true);
        settlement.setThreshold(cashVault, 1);
        settlement.setOperator(noteVault, operator1, true);
        settlement.setOperator(noteVault, operator2, true);
        settlement.setThreshold(noteVault, 1);
        settlement.setOperator(lpVault, operator1, true);
        settlement.setOperator(lpVault, operator2, true);
        settlement.setThreshold(lpVault, 1);

        adapterFactory = new AdapterFactory();
        cashAdapter = adapterFactory.deployAdapter(
            IAdapterFactory.AdapterParams({asset: address(usdt), vault: cashVault, stalenessWindow: 36 hours})
        );
        noteAdapter = adapterFactory.deployAdapter(
            IAdapterFactory.AdapterParams({asset: address(usdt), vault: noteVault, stalenessWindow: 36 hours})
        );
        lpAdapter = adapterFactory.deployLiquidityAdapter(
            IAdapterFactory.AdapterParams({asset: address(usdt), vault: lpVault, stalenessWindow: 36 hours})
        );

        // Each vault Owner must whitelist these Adapter implementations in its bound
        // AdapterRegistry before addAdapter/setAdapter will accept them.
        adapterRegistry.setAdapterAllowed(cashAdapter, true);
        adapterRegistry.setAdapterAllowed(noteAdapter, true);
        adapterRegistry.setAdapterAllowed(lpAdapter, true);

        LiquidityEarnVault(lpVault).setAdapter(lpAdapter);
        IBaseVault(cashVault).addAdapter(cashAdapter);
        IBaseVault(noteVault).addAdapter(noteAdapter);

        IBaseVault(cashVault).setUnifiedPool(address(unifiedPool));
        IBaseVault(noteVault).setUnifiedPool(address(unifiedPool));
        IBaseVault(lpVault).setUnifiedPool(address(unifiedPool));

        IAdapter(cashAdapter).setDataProvider(dataProviderSigner);
        IAdapter(noteAdapter).setDataProvider(dataProviderSigner);
        IAdapter(lpAdapter).setDataProvider(dataProviderSigner);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // Wiring smoke test (development-plan §3.4.3)
    // -----------------------------------------------------------------------

    function test_vaultsRegisteredInStateManager() public view {
        assertTrue(sm.registeredVaults(cashVault));
        assertTrue(sm.registeredVaults(noteVault));
        assertTrue(sm.registeredVaults(lpVault));
    }

    function test_settlementIsOperator_forConfiguredOperators() public view {
        assertTrue(settlement.isOperator(cashVault, operator1));
        assertTrue(settlement.isOperator(cashVault, operator2));
        assertTrue(settlement.isOperator(noteVault, operator1));
        assertTrue(settlement.isOperator(noteVault, operator2));
        assertTrue(settlement.isOperator(lpVault, operator1));
        assertTrue(settlement.isOperator(lpVault, operator2));
    }

    function test_adapterFactory_isAdapterTrueForAllThree() public view {
        assertTrue(adapterFactory.isAdapter(cashAdapter));
        assertTrue(adapterFactory.isAdapter(noteAdapter));
        assertTrue(adapterFactory.isAdapter(lpAdapter));
    }

    function test_lpVault_adapterMatchesDeployedLiquidityAdapter() public view {
        assertEq(LiquidityEarnVault(lpVault).adapter(), lpAdapter);
    }

    function test_vaults_adaptersRegisteredForGrossAssetAggregation() public view {
        assertTrue(IBaseVault(cashVault).isAdapter(cashAdapter));
        assertTrue(IBaseVault(noteVault).isAdapter(noteAdapter));
        assertTrue(IBaseVault(lpVault).isAdapter(lpAdapter));
    }

    function test_adapterRegistry_allowsAllThreeAdapters() public view {
        assertTrue(adapterRegistry.isAllowed(cashAdapter));
        assertTrue(adapterRegistry.isAllowed(noteAdapter));
        assertTrue(adapterRegistry.isAllowed(lpAdapter));
    }

    function test_vaults_unifiedPoolWired() public view {
        assertEq(IBaseVault(cashVault).unifiedPool(), address(unifiedPool));
        assertEq(IBaseVault(noteVault).unifiedPool(), address(unifiedPool));
        assertEq(IBaseVault(lpVault).unifiedPool(), address(unifiedPool));
    }

    function test_kytGate_isZeroAddressOnAllVaults() public view {
        // BaseVault's `gate` defaults to address(0) (open) — no KYT connection in Phase 1.
        (bool ok1, bytes memory ret1) = cashVault.staticcall(abi.encodeWithSignature("gate()"));
        (bool ok2, bytes memory ret2) = noteVault.staticcall(abi.encodeWithSignature("gate()"));
        (bool ok3, bytes memory ret3) = lpVault.staticcall(abi.encodeWithSignature("gate()"));
        assertTrue(ok1 && ok2 && ok3);
        assertEq(abi.decode(ret1, (address)), address(0));
        assertEq(abi.decode(ret2, (address)), address(0));
        assertEq(abi.decode(ret3, (address)), address(0));
    }

    function test_vaultsHaveSettlementWired() public view {
        assertEq(IBaseVault(cashVault).settlement(), address(settlement));
        assertEq(IBaseVault(noteVault).settlement(), address(settlement));
        assertEq(IBaseVault(lpVault).settlement(), address(settlement));
        assertEq(IBaseVault(cashVault).totalAssets(), 0); // sanity: vault callable
    }

    function test_dataProviderSetOnAllAdapters() public view {
        assertEq(_dataProviderOf(cashAdapter), dataProviderSigner);
        assertEq(_dataProviderOf(noteAdapter), dataProviderSigner);
        assertEq(_dataProviderOf(lpAdapter), dataProviderSigner);
    }

    /// @dev `dataProvider()` is a public state-var getter on BaseAdapter, not part of the
    ///      IAdapter interface — read it via staticcall like `gate()` above.
    function _dataProviderOf(address adapter) internal view returns (address) {
        (bool ok, bytes memory ret) = adapter.staticcall(abi.encodeWithSignature("dataProvider()"));
        assertTrue(ok);
        return abi.decode(ret, (address));
    }
}
