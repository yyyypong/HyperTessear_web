// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IRWAToken} from "../interfaces/IRWAToken.sol";
import {IAssetRegistry} from "../interfaces/IAssetRegistry.sol";

/// @title RWAToken
/// @notice Per-asset ERC-20 implementing a lightweight ERC-1400 subset:
///         ERC-1594 (controller mint/burn) + ERC-1644 (forced transfer) + transfer path restriction.
///
///         Transfer path restriction: up to 10 rules; each rule permits transfers from any address
///         in `fromListId` to any address in `toListId`. If transferPathCount == 0 all transfers
///         are permitted. This asset's Issuer (its AssetRegistry owner) manages paths and lists;
///         the MintBurnController is fixed at deploy time by AssetRegistry — no setter, no
///         Governor involvement. (角色权限与职责修改方案 §11.4, §12.12)
///
///         One contract is deployed per assetId by AssetRegistry.registerAsset. (development-plan §3.2.1)
contract RWAToken is IRWAToken {
    // -----------------------------------------------------------------------
    // Immutable state
    // -----------------------------------------------------------------------

    IAssetRegistry public immutable assetRegistry;
    uint256 public immutable assetId;

    string private _name;
    string private _symbol;
    uint8 private immutable _decimals;

    // -----------------------------------------------------------------------
    // ERC-20 state
    // -----------------------------------------------------------------------

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // -----------------------------------------------------------------------
    // Controller (ERC-1594 / ERC-1644)
    // -----------------------------------------------------------------------

    address public immutable override mintBurnController;

    // -----------------------------------------------------------------------
    // Transfer path state (development-plan §3.2.1)
    // -----------------------------------------------------------------------

    /// @dev Fixed-size array avoids dynamic-array storage overhead; up to 10 active paths.
    TransferPath[10] private _transferPaths;
    uint8 public override transferPathCount;

    /// @dev addressLists[listId][account] — max 255 distinct lists (uint8).
    mapping(uint8 listId => mapping(address account => bool)) private _addressLists;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param assetRegistry_      This asset's AssetRegistry (also this asset's Issuer authority).
    /// @param assetId_            This token's assetId within `assetRegistry_`.
    /// @param _mintBurnController Fixed permanently at deploy time; always non-zero.
    constructor(
        address assetRegistry_,
        uint256 assetId_,
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address _mintBurnController
    ) {
        if (assetRegistry_ == address(0) || _mintBurnController == address(0)) revert ZeroAddress();
        assetRegistry = IAssetRegistry(assetRegistry_);
        assetId = assetId_;
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        mintBurnController = _mintBurnController;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _onlyIssuer() internal view {
        if (assetRegistry.ownerOf(assetId) != msg.sender) revert NotIssuer();
    }

    function _checkTransferPath(address from, address to) internal view {
        uint8 count = transferPathCount;
        if (count == 0) return; // no restrictions
        for (uint8 i = 0; i < count; ++i) {
            TransferPath storage p = _transferPaths[i];
            if (_addressLists[p.fromListId][from] && _addressLists[p.toListId][to]) return;
        }
        revert TransferRestricted(from, to);
    }

    // -----------------------------------------------------------------------
    // ERC-20 metadata
    // -----------------------------------------------------------------------

    function name() external view override returns (string memory) { return _name; }
    function symbol() external view override returns (string memory) { return _symbol; }
    function decimals() external view override returns (uint8) { return _decimals; }

    // -----------------------------------------------------------------------
    // ERC-20 standard
    // -----------------------------------------------------------------------

    function totalSupply() external view override returns (uint256) { return _totalSupply; }

    function balanceOf(address account) external view override returns (uint256) { return _balances[account]; }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _checkTransferPath(msg.sender, to);
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        _checkTransferPath(from, to);
        uint256 allowed = _allowances[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked { _allowances[from][msg.sender] = allowed - amount; }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 bal = _balances[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            _balances[from] = bal - amount;
            _balances[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    // -----------------------------------------------------------------------
    // ERC-1594 controller
    // -----------------------------------------------------------------------

    /// @inheritdoc IRWAToken
    function mint(address to, uint256 amount) external override {
        if (msg.sender != mintBurnController) revert NotController();
        _totalSupply += amount;
        unchecked { _balances[to] += amount; }
        emit Transfer(address(0), to, amount);
    }

    /// @inheritdoc IRWAToken
    function burn(address from, uint256 amount) external override {
        if (msg.sender != mintBurnController) revert NotController();
        uint256 bal = _balances[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            _balances[from] = bal - amount;
            _totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    // -----------------------------------------------------------------------
    // ERC-1644 forced transfer (bypasses transfer path check)
    // -----------------------------------------------------------------------

    /// @inheritdoc IRWAToken
    function controllerTransfer(address from, address to, uint256 amount, bytes calldata /*data*/) external override {
        if (msg.sender != mintBurnController) revert NotController();
        _transfer(from, to, amount);
        emit ControllerTransfer(msg.sender, from, to, amount, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Transfer path management — COMPLIANCE_ROLE
    // -----------------------------------------------------------------------

    /// @inheritdoc IRWAToken
    function setTransferPaths(
        uint8[] calldata indexes,
        uint8[] calldata fromListIds,
        uint8[] calldata toListIds
    ) external override {
        _onlyIssuer();
        if (indexes.length != fromListIds.length || indexes.length != toListIds.length) {
            revert ArrayLengthMismatch();
        }
        uint8 maxIndex = 0;
        for (uint256 i = 0; i < indexes.length; ++i) {
            uint8 idx = indexes[i];
            if (idx >= 10) revert InvalidPathIndex(idx);
            _transferPaths[idx] = TransferPath({fromListId: fromListIds[i], toListId: toListIds[i]});
            if (idx + 1 > maxIndex) maxIndex = idx + 1;
        }
        // Update transferPathCount to cover all configured indexes.
        if (maxIndex > transferPathCount) transferPathCount = maxIndex;
        emit TransferPathsUpdated(block.timestamp);
    }

    /// @inheritdoc IRWAToken
    function addToAddressList(uint8 listId, address[] calldata accounts) external override {
        _onlyIssuer();
        for (uint256 i = 0; i < accounts.length; ++i) {
            _addressLists[listId][accounts[i]] = true;
        }
        emit AddressListUpdated(listId, true, accounts.length, block.timestamp);
    }

    /// @inheritdoc IRWAToken
    function removeFromAddressList(uint8 listId, address[] calldata accounts) external override {
        _onlyIssuer();
        for (uint256 i = 0; i < accounts.length; ++i) {
            _addressLists[listId][accounts[i]] = false;
        }
        emit AddressListUpdated(listId, false, accounts.length, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// @inheritdoc IRWAToken
    function transferPaths(uint8 index) external view override returns (TransferPath memory) {
        return _transferPaths[index];
    }

    /// @inheritdoc IRWAToken
    function isInList(uint8 listId, address account) external view override returns (bool) {
        return _addressLists[listId][account];
    }
}
