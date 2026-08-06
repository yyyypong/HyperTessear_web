// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RWAToken} from "../src/asset-infrastructure/RWAToken.sol";
import {IRWAToken} from "../src/interfaces/IRWAToken.sol";
import {AssetRegistry} from "../src/asset-infrastructure/AssetRegistry.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {ProtocolFeeConfig} from "../src/asset-infrastructure/ProtocolFeeConfig.sol";
import {FeePaymentKind} from "../src/libs/Types.sol";

/// @title RWAToken Tests
/// @notice Suite for the per-assetId ERC-20 RWAToken with transfer path restriction.
///         (development-plan §3.2.1). Authority for compliance actions is now this asset's
///         AssetRegistry owner (the "Issuer") rather than a global COMPLIANCE_ROLE, and the
///         MintBurnController is fixed immutably at construction rather than set later.
contract RWATokenTest is Test {
    AssetRegistry internal assetRegistry;
    RWAToken internal token;
    uint256 internal assetId;
    address internal controller;
    HyperAccessControl internal ac;
    ProtocolFeeConfig internal feeConfig;

    address internal issuer = makeAddr("issuer"); // AssetRegistry owner for `assetId`
    address internal attacker = makeAddr("attacker");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        ac = new HyperAccessControl(makeAddr("governor"));
        feeConfig = new ProtocolFeeConfig(address(ac), makeAddr("revPool"));
        assetRegistry = new AssetRegistry(address(feeConfig));
        controller = assetRegistry.mintBurnController();

        vm.prank(issuer);
        (uint256 id, address tokenAddr) =
            assetRegistry.registerAsset(keccak256("meta"), "S Token", "S-TKN", 6, FeePaymentKind.Native);
        assetId = id;
        token = RWAToken(tokenAddr);
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    function test_constructor_metadata() public view {
        assertEq(token.name(), "S Token");
        assertEq(token.symbol(), "S-TKN");
        assertEq(token.decimals(), 6);
    }

    function test_constructor_assetRegistryAndAssetIdAreSet() public view {
        assertEq(address(token.assetRegistry()), address(assetRegistry));
        assertEq(token.assetId(), assetId);
    }

    function test_constructor_mintBurnControllerIsSet() public view {
        assertEq(token.mintBurnController(), controller);
    }

    function test_constructor_revertsOnZeroAssetRegistry() public {
        vm.expectRevert(IRWAToken.ZeroAddress.selector);
        new RWAToken(address(0), 1, "X", "X", 18, controller);
    }

    function test_constructor_revertsOnZeroMintBurnController() public {
        vm.expectRevert(IRWAToken.ZeroAddress.selector);
        new RWAToken(address(assetRegistry), 1, "X", "X", 18, address(0));
    }

    function test_constructor_transferPathCountIsZero() public view {
        assertEq(token.transferPathCount(), 0);
    }

    // NOTE: setMintBurnController was removed — mintBurnController is now immutable and always
    // non-zero from construction, so the old "controller starts zero / can be set later by
    // Governor" tests no longer apply.

    // -----------------------------------------------------------------------
    // ERC-20 mint / burn (controller only)
    // -----------------------------------------------------------------------

    function test_mint_increasesBalanceAndTotalSupply() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        assertEq(token.balanceOf(alice), 1_000e6);
        assertEq(token.totalSupply(), 1_000e6);
    }

    function test_mint_revertsForNonController() public {
        vm.prank(attacker);
        vm.expectRevert(IRWAToken.NotController.selector);
        token.mint(alice, 1_000e6);
    }

    function test_burn_decreasesBalanceAndTotalSupply() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(controller);
        token.burn(alice, 400e6);

        assertEq(token.balanceOf(alice), 600e6);
        assertEq(token.totalSupply(), 600e6);
    }

    function test_burn_revertsForNonController() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(attacker);
        vm.expectRevert(IRWAToken.NotController.selector);
        token.burn(alice, 1_000e6);
    }

    function test_burn_revertsOnInsufficientBalance() public {
        vm.prank(controller);
        vm.expectRevert(IRWAToken.InsufficientBalance.selector);
        token.burn(alice, 1);
    }

    // -----------------------------------------------------------------------
    // ERC-20 transfer (no paths configured → all permitted)
    // -----------------------------------------------------------------------

    function test_transfer_succeeds_whenNoPathsConfigured() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(alice);
        bool ok = token.transfer(bob, 300e6);

        assertTrue(ok);
        assertEq(token.balanceOf(alice), 700e6);
        assertEq(token.balanceOf(bob), 300e6);
    }

    function test_transfer_revertsOnInsufficientBalance() public {
        vm.prank(controller);
        token.mint(alice, 100e6);

        vm.prank(alice);
        vm.expectRevert(IRWAToken.InsufficientBalance.selector);
        token.transfer(bob, 101e6);
    }

    // -----------------------------------------------------------------------
    // ERC-20 approve / transferFrom
    // -----------------------------------------------------------------------

    function test_approve_setsAllowance() public {
        vm.prank(alice);
        token.approve(bob, 500e6);
        assertEq(token.allowance(alice, bob), 500e6);
    }

    function test_transferFrom_deductsAllowanceAndTransfers() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(alice);
        token.approve(bob, 500e6);

        vm.prank(bob);
        token.transferFrom(alice, bob, 200e6);

        assertEq(token.balanceOf(bob), 200e6);
        assertEq(token.allowance(alice, bob), 300e6);
    }

    function test_transferFrom_maxAllowanceNotDecremented() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(alice);
        token.approve(bob, type(uint256).max);

        vm.prank(bob);
        token.transferFrom(alice, bob, 500e6);

        assertEq(token.allowance(alice, bob), type(uint256).max);
    }

    function test_transferFrom_revertsOnInsufficientAllowance() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(alice);
        token.approve(bob, 100e6);

        vm.prank(bob);
        vm.expectRevert(IRWAToken.InsufficientAllowance.selector);
        token.transferFrom(alice, bob, 101e6);
    }

    // -----------------------------------------------------------------------
    // Transfer path management — asset Issuer (AssetRegistry owner) only
    // -----------------------------------------------------------------------

    function _setupList0WithAlice() internal {
        // listId=0 contains alice; listId=1 contains bob.
        address[] memory a = new address[](1);
        a[0] = alice;
        vm.prank(issuer);
        token.addToAddressList(0, a);

        address[] memory b = new address[](1);
        b[0] = bob;
        vm.prank(issuer);
        token.addToAddressList(1, b);
    }

    function test_setTransferPaths_updatesCount() public {
        uint8[] memory idxs = new uint8[](1);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);
        idxs[0] = 0; froms[0] = 0; tos[0] = 1;

        vm.prank(issuer);
        token.setTransferPaths(idxs, froms, tos);

        assertEq(token.transferPathCount(), 1);
        IRWAToken.TransferPath memory p = token.transferPaths(0);
        assertEq(p.fromListId, 0);
        assertEq(p.toListId, 1);
    }

    function test_setTransferPaths_revertsForNonIssuer() public {
        uint8[] memory idxs = new uint8[](1);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);
        idxs[0] = 0; froms[0] = 0; tos[0] = 1;

        vm.prank(attacker);
        vm.expectRevert(IRWAToken.NotIssuer.selector);
        token.setTransferPaths(idxs, froms, tos);
    }

    function test_setTransferPaths_revertsOnMismatchedArrays() public {
        uint8[] memory idxs = new uint8[](2);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);

        vm.prank(issuer);
        vm.expectRevert(IRWAToken.ArrayLengthMismatch.selector);
        token.setTransferPaths(idxs, froms, tos);
    }

    function test_setTransferPaths_revertsOnInvalidIndex() public {
        uint8[] memory idxs = new uint8[](1);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);
        idxs[0] = 10; // max index is 9

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.InvalidPathIndex.selector, 10));
        token.setTransferPaths(idxs, froms, tos);
    }

    function test_addToAddressList_setsIsInList() public {
        address[] memory accounts = new address[](2);
        accounts[0] = alice;
        accounts[1] = bob;

        vm.prank(issuer);
        token.addToAddressList(0, accounts);

        assertTrue(token.isInList(0, alice));
        assertTrue(token.isInList(0, bob));
    }

    function test_addToAddressList_revertsForNonIssuer() public {
        address[] memory accounts = new address[](1);
        accounts[0] = alice;

        vm.prank(attacker);
        vm.expectRevert(IRWAToken.NotIssuer.selector);
        token.addToAddressList(0, accounts);
    }

    function test_removeFromAddressList_clearsIsInList() public {
        address[] memory accounts = new address[](1);
        accounts[0] = alice;

        vm.prank(issuer);
        token.addToAddressList(0, accounts);
        assertTrue(token.isInList(0, alice));

        vm.prank(issuer);
        token.removeFromAddressList(0, accounts);
        assertFalse(token.isInList(0, alice));
    }

    // -----------------------------------------------------------------------
    // Transfer path enforcement
    // -----------------------------------------------------------------------

    function test_transfer_revertsWhenPathConfiguredAndSenderNotInList() public {
        // Configure path: list0 → list1.
        uint8[] memory idxs = new uint8[](1);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);
        idxs[0] = 0; froms[0] = 0; tos[0] = 1;

        vm.prank(issuer);
        token.setTransferPaths(idxs, froms, tos);

        // Only add bob to list1 (recipient) but alice (sender) not in list0.
        address[] memory b = new address[](1);
        b[0] = bob;
        vm.prank(issuer);
        token.addToAddressList(1, b);

        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.TransferRestricted.selector, alice, bob));
        token.transfer(bob, 100e6);
    }

    function test_transfer_succeedsWhenPathAllows() public {
        _setupList0WithAlice();

        uint8[] memory idxs = new uint8[](1);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);
        idxs[0] = 0; froms[0] = 0; tos[0] = 1;

        vm.prank(issuer);
        token.setTransferPaths(idxs, froms, tos);

        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(alice);
        token.transfer(bob, 300e6);

        assertEq(token.balanceOf(bob), 300e6);
    }

    // -----------------------------------------------------------------------
    // controllerTransfer (ERC-1644) — bypasses path check
    // -----------------------------------------------------------------------

    function test_controllerTransfer_bypassesPathRestriction() public {
        // Set a restrictive path.
        uint8[] memory idxs = new uint8[](1);
        uint8[] memory froms = new uint8[](1);
        uint8[] memory tos = new uint8[](1);
        idxs[0] = 0; froms[0] = 0; tos[0] = 1;
        vm.prank(issuer);
        token.setTransferPaths(idxs, froms, tos);
        // alice and bob are NOT in any list.

        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(controller);
        token.controllerTransfer(alice, bob, 500e6, "");

        assertEq(token.balanceOf(alice), 500e6);
        assertEq(token.balanceOf(bob), 500e6);
    }

    function test_controllerTransfer_revertsForNonController() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.prank(attacker);
        vm.expectRevert(IRWAToken.NotController.selector);
        token.controllerTransfer(alice, bob, 500e6, "");
    }

    // -----------------------------------------------------------------------
    // ERC-20 Transfer event
    // -----------------------------------------------------------------------

    function test_mint_emitsTransferFromZero() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit IRWAToken.Transfer(address(0), alice, 1_000e6);

        vm.prank(controller);
        token.mint(alice, 1_000e6);
    }

    function test_burn_emitsTransferToZero() public {
        vm.prank(controller);
        token.mint(alice, 1_000e6);

        vm.expectEmit(true, true, false, true, address(token));
        emit IRWAToken.Transfer(alice, address(0), 1_000e6);

        vm.prank(controller);
        token.burn(alice, 1_000e6);
    }
}
