// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {EarnVault} from "../src/asset-management/vaults/EarnVault.sol";
import {RWAAdapter} from "../src/asset-management/strategy/RWAAdapter.sol";
import {NAVOracle} from "../src/asset-infrastructure/NAVOracle.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mints with a configurable decimals count, to exercise realAssets()'s decimals conversion.
contract MockRWAToken is ERC20 {
    uint8 internal immutable _decimals;
    constructor(uint8 decimals_) ERC20("Mock RWA Token", "mRWA") { _decimals = decimals_; }
    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract RWAAdapterTest is Test {
    HyperAccessControl internal ac;
    StateManager internal sm;
    Queue internal queue;
    EarnVault internal vault;
    MockUSDT internal usdt;
    NAVOracle internal navOracle;
    RWAAdapter internal adapter;
    MockRWAToken internal rwaToken;

    address internal governor = makeAddr("governor");
    address internal oracleOwner = makeAddr("oracleOwner");
    address internal vaultOwner = makeAddr("vaultOwner");
    address internal curator = makeAddr("curator");
    address internal allocator = makeAddr("allocator");
    address internal guardian = makeAddr("guardian");
    address internal destination = makeAddr("destination");

    uint256 internal signerPk = 0xA11CE;
    address internal signer;

    uint256 internal constant NOW = 1_000_000;
    uint256 internal constant STALENESS_WINDOW = 36 hours;

    bytes32 internal constant NAV_UPDATE_TYPEHASH =
        keccak256("NAVUpdate(address rwaToken,uint256 price,uint256 dataTimestamp)");

    function setUp() public {
        vm.warp(NOW);
        signer = vm.addr(signerPk);

        ac = new HyperAccessControl(governor);
        sm = new StateManager(address(ac));
        queue = new Queue(address(sm));
        usdt = new MockUSDT();
        rwaToken = new MockRWAToken(6); // same decimals as asset by default

        vault = new EarnVault("Test Vault", "tVLT", address(usdt), address(sm), address(queue), vaultOwner, address(0));

        vm.startPrank(vaultOwner);
        vault.setCurator(curator);
        vault.setGuardian(guardian);
        vault.setAllocator(allocator);
        vm.stopPrank();

        navOracle = new NAVOracle(oracleOwner, 2000);
        vm.prank(oracleOwner);
        navOracle.setSigner(address(rwaToken), signer);

        adapter = new RWAAdapter(usdt, address(vault), address(rwaToken), address(navOracle), STALENESS_WINDOW);
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("NAVOracle")),
                keccak256(bytes("1")),
                block.chainid,
                address(navOracle)
            )
        );
    }

    function _pushPrice(uint256 price, uint256 dataTimestamp) internal {
        bytes32 structHash = keccak256(abi.encode(NAV_UPDATE_TYPEHASH, address(rwaToken), price, dataTimestamp));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        navOracle.updateNAV(address(rwaToken), price, dataTimestamp, abi.encodePacked(r, s, v));
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    function test_constructor_setsImmutables() public view {
        assertEq(adapter.rwaToken(), address(rwaToken));
        assertEq(adapter.navOracle(), address(navOracle));
        assertEq(adapter.vault(), address(vault));
    }

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(IAdapter.ZeroAddress.selector);
        new RWAAdapter(usdt, address(vault), address(0), address(navOracle), STALENESS_WINDOW);
    }

    // -----------------------------------------------------------------------
    // realAssets — balance*price conversion
    // -----------------------------------------------------------------------

    function test_realAssets_zeroBalance_returnsZero() public view {
        assertEq(adapter.realAssets(), 0);
    }

    function test_realAssets_zeroBalance_noOracleCallNeeded() public {
        // No price ever set for rwaToken — must NOT revert when balance is zero.
        assertEq(adapter.realAssets(), 0);
    }

    function test_realAssets_sameDecimals_convertsBalanceTimesPrice() public {
        // rwaToken has 6 decimals (same as asset). price = 2e18 means 1 whole rwaToken == 2 whole asset units.
        rwaToken.mint(address(adapter), 1_000e6); // 1,000 whole rwaTokens
        _pushPrice(2e18, block.timestamp);

        assertEq(adapter.realAssets(), 2_000e6);
    }

    function test_realAssets_rwaTokenMoreDecimalsThanAsset_converts() public {
        MockRWAToken rwa18 = new MockRWAToken(18);
        vm.prank(oracleOwner);
        navOracle.setSigner(address(rwa18), signer);
        RWAAdapter adapter18 =
            new RWAAdapter(usdt, address(vault), address(rwa18), address(navOracle), STALENESS_WINDOW);

        rwa18.mint(address(adapter18), 1_000 ether); // 1,000 whole rwaTokens, 18 decimals
        bytes32 structHash = keccak256(abi.encode(NAV_UPDATE_TYPEHASH, address(rwa18), uint256(1e18), block.timestamp));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        navOracle.updateNAV(address(rwa18), 1e18, block.timestamp, abi.encodePacked(r, s, v));

        // 1,000 whole rwaTokens at price 1.0, asset has 6 decimals -> 1,000e6.
        assertEq(adapter18.realAssets(), 1_000e6);
    }

    function test_realAssets_balanceGreaterThanZero_noPriceSet_reverts() public {
        rwaToken.mint(address(adapter), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(RWAAdapter.NAVUnavailable.selector, address(rwaToken)));
        adapter.realAssets();
    }

    function test_realAssets_addsPendingDealValue() public {
        usdt.mint(address(vault), 1_000e6);
        vm.startPrank(address(vault));
        usdt.approve(address(adapter), 1_000e6);
        adapter.deposit(1_000e6, address(vault));
        vm.stopPrank();

        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(500e6, destination, IAdapter.SettlementMode.VALUE_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        rwaToken.mint(address(adapter), 100e6);
        _pushPrice(1e18, block.timestamp);

        // 500e6 pending (VALUE_RETURN deal, unresolved) + 100e6 token value at price 1.0.
        assertEq(adapter.realAssets(), 600e6);
    }

    function test_realAssets_clearDealValue_preventsDoubleCount() public {
        usdt.mint(address(vault), 1_000e6);
        vm.startPrank(address(vault));
        usdt.approve(address(adapter), 1_000e6);
        adapter.deposit(1_000e6, address(vault));
        vm.stopPrank();

        vm.prank(curator);
        uint256 orderId = adapter.createBuyOrder(1_000e6, address(adapter), IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);

        // The RWA token has landed in the adapter — Allocator clears the pending-deal entry.
        rwaToken.mint(address(adapter), 1_000e6);
        vm.prank(allocator);
        adapter.clearDealValue(orderId);

        _pushPrice(1e18, block.timestamp);

        // Only the token's market value counts now — no leftover pending-deal double-count.
        assertEq(adapter.realAssets(), 1_000e6);
    }

    /// @dev The gap between token delivery and the Allocator's `clearDealValue` must not inflate
    ///      NAV — the delivered balance supersedes the TOKEN_RETURN order's in-flight cost.
    function test_realAssets_tokenDeliveredBeforeClear_doesNotDoubleCount() public {
        uint256 orderId = _executeTokenReturnBuy(1_000e6);

        rwaToken.mint(address(adapter), 1_000e6);
        _pushPrice(1e18, block.timestamp);

        // 1_000e6 order cost netted out against 1_000e6 of delivered token value — not 2_000e6.
        assertEq(adapter.realAssets(), 1_000e6);

        // Clearing is still the way to retire the entry, and does not change the number.
        vm.prank(allocator);
        adapter.clearDealValue(orderId);
        assertEq(adapter.realAssets(), 1_000e6);
    }

    function test_realAssets_partialDeliveryBeforeClear_countsRemainderInFlight() public {
        _executeTokenReturnBuy(1_000e6);

        // Only 40% of the position has landed so far.
        rwaToken.mint(address(adapter), 400e6);
        _pushPrice(1e18, block.timestamp);

        // 400e6 delivered + 600e6 still in flight.
        assertEq(adapter.realAssets(), 1_000e6);
    }

    function test_realAssets_priceRisesAfterDelivery_marketValueWins() public {
        _executeTokenReturnBuy(1_000e6);

        rwaToken.mint(address(adapter), 1_000e6);
        _pushPrice(1.2e18, block.timestamp);

        // Full order cost superseded; the appreciated market value is what counts.
        assertEq(adapter.realAssets(), 1_200e6);
    }

    /// @dev VALUE_RETURN deals have no on-chain balance to supersede them, so they stay additive
    ///      even when the Adapter holds a token balance from a separate TOKEN_RETURN order.
    function test_realAssets_valueReturnDealNotNettedAgainstBalance() public {
        usdt.mint(address(vault), 2_000e6);
        vm.startPrank(address(vault));
        usdt.approve(address(adapter), 2_000e6);
        adapter.deposit(2_000e6, address(vault));
        vm.stopPrank();

        vm.startPrank(curator);
        uint256 valueOrder = adapter.createBuyOrder(500e6, destination, IAdapter.SettlementMode.VALUE_RETURN);
        uint256 tokenOrder = adapter.createBuyOrder(1_000e6, address(adapter), IAdapter.SettlementMode.TOKEN_RETURN);
        vm.stopPrank();
        vm.startPrank(allocator);
        adapter.executeBuy(valueOrder);
        adapter.executeBuy(tokenOrder);
        vm.stopPrank();

        rwaToken.mint(address(adapter), 1_000e6);
        _pushPrice(1e18, block.timestamp);

        // 500e6 VALUE_RETURN (untouched) + 1_000e6 delivered tokens, with the TOKEN_RETURN
        // order's own 1_000e6 cost netted out.
        assertEq(adapter.realAssets(), 1_500e6);
    }

    function _executeTokenReturnBuy(uint256 amount) internal returns (uint256 orderId) {
        usdt.mint(address(vault), amount);
        vm.startPrank(address(vault));
        usdt.approve(address(adapter), amount);
        adapter.deposit(amount, address(vault));
        vm.stopPrank();

        vm.prank(curator);
        orderId = adapter.createBuyOrder(amount, address(adapter), IAdapter.SettlementMode.TOKEN_RETURN);
        vm.prank(allocator);
        adapter.executeBuy(orderId);
    }
}
