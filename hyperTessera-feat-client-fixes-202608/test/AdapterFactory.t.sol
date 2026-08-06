// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AdapterFactory} from "../src/asset-management/strategy/AdapterFactory.sol";
import {IAdapterFactory} from "../src/interfaces/IAdapterFactory.sol";
import {LiquidityAdapter} from "../src/asset-management/strategy/LiquidityAdapter.sol";
import {RWAAdapter} from "../src/asset-management/strategy/RWAAdapter.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract AdapterFactoryTest is Test {
    MockUSDT internal usdt;
    AdapterFactory internal factory;

    address internal attacker = makeAddr("attacker");
    address internal cashVaultStandIn = makeAddr("cashVault");
    address internal noteVaultStandIn = makeAddr("noteVault");
    address internal lpVaultStandIn = makeAddr("lpVault");
    address internal navOracleStandIn = makeAddr("navOracle");
    address internal rwaTokenStandIn = makeAddr("rwaToken");

    function setUp() public {
        usdt = new MockUSDT();
        factory = new AdapterFactory();
    }

    function _params(address vault) internal view returns (IAdapterFactory.AdapterParams memory) {
        return IAdapterFactory.AdapterParams({asset: address(usdt), vault: vault, stalenessWindow: 36 hours});
    }

    // -----------------------------------------------------------------------
    // deployAdapter — permissionless (the old Governor-only gate and NotGovernor
    // error were removed from IAdapterFactory; deploying grants no Vault authority by itself).
    // -----------------------------------------------------------------------

    function test_deployAdapter_permissionless_anyCallerSucceeds() public {
        vm.prank(attacker);
        address adapter = factory.deployAdapter(_params(cashVaultStandIn));
        assertTrue(factory.isAdapter(adapter));
    }

    function test_deployAdapter_happyPath() public {
        address adapter = factory.deployAdapter(_params(cashVaultStandIn));
        assertTrue(factory.isAdapter(adapter));
    }

    function test_deployAdapter_twoCallsDifferentVaults_produceIndependentAdapters() public {
        address cashAdapter = factory.deployAdapter(_params(cashVaultStandIn));
        address noteAdapter = factory.deployAdapter(_params(noteVaultStandIn));

        assertTrue(cashAdapter != noteAdapter);
        assertTrue(factory.isAdapter(cashAdapter));
        assertTrue(factory.isAdapter(noteAdapter));
    }

    // -----------------------------------------------------------------------
    // deployLiquidityAdapter — permissionless
    // -----------------------------------------------------------------------

    function test_deployLiquidityAdapter_permissionless_anyCallerSucceeds() public {
        vm.prank(attacker);
        address adapter = factory.deployLiquidityAdapter(_params(lpVaultStandIn));
        assertTrue(factory.isAdapter(adapter));
    }

    function test_deployLiquidityAdapter_happyPath_bridgeTargetsZero() public {
        address adapter = factory.deployLiquidityAdapter(_params(lpVaultStandIn));

        assertTrue(factory.isAdapter(adapter));
        assertEq(LiquidityAdapter(adapter).liquidityBridge(), address(0));
        assertEq(LiquidityAdapter(adapter).cashVault(), address(0));
    }

    function test_isAdapter_trueForBothTypes() public {
        address fpa = factory.deployAdapter(_params(cashVaultStandIn));
        address lqa = factory.deployLiquidityAdapter(_params(lpVaultStandIn));

        assertTrue(factory.isAdapter(fpa));
        assertTrue(factory.isAdapter(lqa));
        assertFalse(factory.isAdapter(attacker));
    }

    function test_deployAdapter_invalidParams_reverts() public {
        vm.expectRevert(IAdapterFactory.InvalidAdapterParams.selector);
        factory.deployAdapter(_params(address(0)));
    }

    function _rwaParams(address vault) internal view returns (IAdapterFactory.RWAAdapterParams memory) {
        return IAdapterFactory.RWAAdapterParams({
            asset: address(usdt),
            vault: vault,
            rwaToken: rwaTokenStandIn,
            navOracle: navOracleStandIn,
            dealDataStalenessWindow: 36 hours
        });
    }

    // -----------------------------------------------------------------------
    // deployRWAAdapter — permissionless
    // -----------------------------------------------------------------------

    function test_deployRWAAdapter_permissionless_anyCallerSucceeds() public {
        vm.prank(attacker);
        address adapter = factory.deployRWAAdapter(_rwaParams(cashVaultStandIn));
        assertTrue(factory.isAdapter(adapter));
    }

    function test_deployRWAAdapter_happyPath_setsImmutables() public {
        address adapter = factory.deployRWAAdapter(_rwaParams(cashVaultStandIn));

        assertTrue(factory.isAdapter(adapter));
        assertEq(RWAAdapter(adapter).rwaToken(), rwaTokenStandIn);
        assertEq(RWAAdapter(adapter).navOracle(), navOracleStandIn);
        assertEq(RWAAdapter(adapter).vault(), cashVaultStandIn);
    }

    function test_deployRWAAdapter_zeroRwaToken_reverts() public {
        IAdapterFactory.RWAAdapterParams memory params = _rwaParams(cashVaultStandIn);
        params.rwaToken = address(0);
        vm.expectRevert(IAdapterFactory.InvalidAdapterParams.selector);
        factory.deployRWAAdapter(params);
    }

    function test_deployRWAAdapter_zeroNavOracle_reverts() public {
        IAdapterFactory.RWAAdapterParams memory params = _rwaParams(cashVaultStandIn);
        params.navOracle = address(0);
        vm.expectRevert(IAdapterFactory.InvalidAdapterParams.selector);
        factory.deployRWAAdapter(params);
    }

    function test_isAdapter_trueForAllThreeTypes() public {
        address fpa = factory.deployAdapter(_params(cashVaultStandIn));
        address lqa = factory.deployLiquidityAdapter(_params(lpVaultStandIn));
        address rwa = factory.deployRWAAdapter(_rwaParams(noteVaultStandIn));

        assertTrue(factory.isAdapter(fpa));
        assertTrue(factory.isAdapter(lqa));
        assertTrue(factory.isAdapter(rwa));
    }
}
