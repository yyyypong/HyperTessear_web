// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISettlement} from "../../interfaces/ISettlement.sol";
import {IStateManager} from "../../interfaces/IStateManager.sol";
import {IUnifiedPool} from "../../interfaces/IUnifiedPool.sol";
import {IQueue} from "../../interfaces/IQueue.sol";
import {IBaseVault} from "../../interfaces/IBaseVault.sol";
import {IVaultRoles} from "../../interfaces/IVaultRoles.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CycleState, ProductState, QueueType, RequestSettlement} from "../../libs/Types.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Settlement
/// @notice Translates the Company's off-chain per-cycle FIFO-prefix selection into on-chain
///         share mint/burn and USDT movement, behind M-of-N multi-sig and pool-cash conservation.
///         Redeem payouts and share pricing are computed entirely on-chain by BaseVault from its
///         own per-cycle price snapshot. May serve many Vaults; each Vault's signer set/threshold
///         is independent, managed by that Vault's own Owner.
///         (development-plan §3.4.1, §8 — net settlement conversion; 角色权限与职责修改方案 §9.1)
contract Settlement is ISettlement {
    using ECDSA for bytes32;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    IStateManager public immutable sm;
    IUnifiedPool public immutable unifiedPool;
    IQueue public immutable queue;

    mapping(bytes32 batchHash => bool) public override executed;
    mapping(address vault => address[]) public operatorsOf;
    mapping(address vault => mapping(address => bool)) public override isOperator;
    mapping(address vault => uint256) public override threshold;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address stateManager_, address unifiedPool_, address queue_) {
        if (stateManager_ == address(0) || unifiedPool_ == address(0) || queue_ == address(0)) revert ZeroAddress();

        sm = IStateManager(stateManager_);
        unifiedPool = IUnifiedPool(unifiedPool_);
        queue = IQueue(queue_);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _onlyVaultOwner(address vault) internal view {
        if (IVaultRoles(vault).owner() != msg.sender) revert NotVaultOwner();
    }

    function _depositIds(RequestSettlement[] calldata items) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            ids[i] = items[i].requestId;
        }
    }

    // -----------------------------------------------------------------------
    // submitBatch — signature, state, and pool-cash conservation validation
    // -----------------------------------------------------------------------

    /// @inheritdoc ISettlement
    function submitBatch(SettlementInstruction calldata instruction, bytes[] calldata signatures) external override {
        bytes32 batchHash = keccak256(abi.encode(instruction));
        if (executed[batchHash]) revert BatchAlreadyExecuted(batchHash);
        if (block.timestamp > instruction.validUntil) revert BatchExpired(instruction.validUntil, block.timestamp);

        // Step 1 — signature validation, independently per Vault represented in the batch
        for (uint256 i = 0; i < instruction.vaultSettlements.length; i++) {
            _validateSignatures(instruction.vaultSettlements[i].distribution.vault, batchHash, signatures);
        }

        // Step 2 — state validation
        for (uint256 i = 0; i < instruction.vaultSettlements.length; i++) {
            address v = instruction.vaultSettlements[i].distribution.vault;
            sm.requireCycleState(v, CycleState.CALCULATING);
            if (sm.currentCycleNumber(v) != instruction.cycleNumber) revert StateValidationFailed(v);
        }

        // Step 3 — pool-cash conservation (dedup by vault, plus an aggregate check against the
        // pool's actual USDT balance — availableToDistribute alone doesn't catch a batch whose
        // per-vault amounts each fit individually but collectively exceed what's on hand).
        _validateConservation(instruction);

        // Execute
        executed[batchHash] = true;
        for (uint256 i = 0; i < instruction.vaultSettlements.length; i++) {
            VaultSettlement calldata vs = instruction.vaultSettlements[i];
            address v = vs.distribution.vault;

            if (vs.deposits.length > 0) {
                queue.dequeue(v, QueueType.DEPOSIT, _depositIds(vs.deposits));
            }
            if (vs.distribution.amount > 0) unifiedPool.distribute(v, vs.distribution.amount);
            IBaseVault(v).snapshotSettlementPrice(instruction.cycleNumber);
            uint256[] memory clearedRedeemIds =
                IBaseVault(v).settle(instruction.cycleNumber, vs.deposits, vs.redeems, vs.distribution.amount);
            if (clearedRedeemIds.length > 0) {
                queue.dequeue(v, QueueType.REDEEM, clearedRedeemIds);
            }
            sm.completeCycle(v);
        }

        emit SettlementExecuted(batchHash, instruction.cycleNumber, block.timestamp);
    }

    /// @notice Confirms to StateManager that this Vault's final settlement (the redemption/payout
    ///         round that happens while the Vault is SETTLING, before it can enter MATURING) is
    ///         complete. Reuses the same per-vault M-of-N signature verification as `submitBatch` —
    ///         any Relayer may submit, but the signed message must come from that Vault's own
    ///         registered Settlement Operators.
    /// @inheritdoc ISettlement
    function confirmFinalSettlement(address vault, bytes[] calldata signatures) external override {
        bytes32 confirmationHash = _hashFinalSettlementConfirmation(vault);
        if (executed[confirmationHash]) revert FinalSettlementAlreadyConfirmed(vault);
        if (sm.getProductState(vault) != ProductState.SETTLING) revert StateValidationFailed(vault);

        _validateSignatures(vault, confirmationHash, signatures);

        executed[confirmationHash] = true;
        sm.completeFinalSettlement(vault);

        emit FinalSettlementConfirmed(vault, block.timestamp);
    }

    function _hashFinalSettlementConfirmation(address vault) internal view returns (bytes32) {
        return keccak256(abi.encode("FINAL_SETTLEMENT", vault, address(this), block.chainid));
    }

    function _validateSignatures(address vault, bytes32 batchHash, bytes[] calldata signatures) internal view {
        // An unconfigured Vault (Owner never called `setThreshold`) has threshold 0, which would
        // otherwise let an empty signature array satisfy the M-of-N check. Treat "not yet
        // configured" as "never valid" rather than "always valid".
        if (threshold[vault] == 0) revert SignatureValidationFailed(vault);

        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(batchHash);
        uint256 validSigners = 0;
        address[] memory seen = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethHash.recover(signatures[i]);

            bool dup = false;
            for (uint256 j = 0; j < validSigners; j++) {
                if (seen[j] == signer) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;
            if (!isOperator[vault][signer]) continue;

            seen[validSigners] = signer;
            validSigners++;
        }

        if (validSigners < threshold[vault]) revert SignatureValidationFailed(vault);
    }

    function _validateConservation(SettlementInstruction calldata instruction) internal view {
        uint256 len = instruction.vaultSettlements.length;
        address[] memory vaults = new address[](len);
        uint256[] memory totals = new uint256[](len);
        uint256 uniqueCount = 0;

        for (uint256 i = 0; i < len; i++) {
            address v = instruction.vaultSettlements[i].distribution.vault;
            uint256 amount = instruction.vaultSettlements[i].distribution.amount;

            uint256 idx = type(uint256).max;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (vaults[j] == v) {
                    idx = j;
                    break;
                }
            }
            if (idx == type(uint256).max) {
                vaults[uniqueCount] = v;
                totals[uniqueCount] = amount;
                uniqueCount++;
            } else {
                totals[idx] += amount;
            }
        }

        uint256 batchTotal;
        for (uint256 i = 0; i < uniqueCount; i++) {
            uint256 available = unifiedPool.availableToDistribute(vaults[i]);
            if (available < totals[i]) revert ConservationCheckFailed(vaults[i], available, totals[i]);
            batchTotal += totals[i];
        }

        uint256 poolCashBalance = unifiedPool.usdt().balanceOf(address(unifiedPool));
        if (batchTotal > poolCashBalance) revert BatchExceedsPoolCash(batchTotal, poolCashBalance);
    }

    // -----------------------------------------------------------------------
    // Operator management — that Vault's Owner only
    // -----------------------------------------------------------------------

    /// @inheritdoc ISettlement
    function setOperator(address vault, address operator, bool approved) external override {
        _onlyVaultOwner(vault);
        if (operator == address(0)) revert ZeroAddress();

        if (approved && !isOperator[vault][operator]) {
            isOperator[vault][operator] = true;
            operatorsOf[vault].push(operator);
        } else if (!approved && isOperator[vault][operator]) {
            isOperator[vault][operator] = false;
            address[] storage ops = operatorsOf[vault];
            uint256 len = ops.length;
            for (uint256 i = 0; i < len; i++) {
                if (ops[i] == operator) {
                    ops[i] = ops[len - 1];
                    ops.pop();
                    break;
                }
            }
            if (threshold[vault] > ops.length) revert ThresholdExceedsOperatorCount(threshold[vault], ops.length);
        }

        emit OperatorSet(vault, operator, approved, block.timestamp);
    }

    /// @inheritdoc ISettlement
    function setThreshold(address vault, uint256 newThreshold) external override {
        _onlyVaultOwner(vault);
        uint256 signerCount = operatorsOf[vault].length;
        if (newThreshold == 0 || newThreshold > signerCount) {
            revert ThresholdExceedsOperatorCount(newThreshold, signerCount);
        }
        uint256 old = threshold[vault];
        threshold[vault] = newThreshold;
        emit ThresholdUpdated(vault, old, newThreshold, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// @inheritdoc ISettlement
    function hashInstruction(SettlementInstruction calldata instruction) external pure override returns (bytes32) {
        return keccak256(abi.encode(instruction));
    }

    /// @inheritdoc ISettlement
    function hashFinalSettlementConfirmation(address vault) external view override returns (bytes32) {
        return _hashFinalSettlementConfirmation(vault);
    }
}
