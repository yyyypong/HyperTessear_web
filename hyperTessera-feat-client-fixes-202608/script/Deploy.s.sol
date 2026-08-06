// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {HyperAccessControl} from "../src/governance/HyperAccessControl.sol";
import {AssetRegistry} from "../src/asset-infrastructure/AssetRegistry.sol";
import {ProtocolFeeConfig} from "../src/asset-infrastructure/ProtocolFeeConfig.sol";
import {NAVOracle} from "../src/asset-infrastructure/NAVOracle.sol";
import {MintBurnController} from "../src/asset-infrastructure/MintBurnController.sol";
import {PoRRegistry} from "../src/asset-infrastructure/PoRRegistry.sol";
import {ClaimRegistry} from "../src/asset-infrastructure/ClaimRegistry.sol";
import {ReservePSM} from "../src/wrapped-assets/ReservePSM.sol";
import {IReservePSM} from "../src/interfaces/IReservePSM.sol";
import {Queue} from "../src/asset-management/settlement/Queue.sol";
import {RevenuePool} from "../src/asset-management/settlement/RevenuePool.sol";
import {UnifiedPool} from "../src/asset-management/settlement/UnifiedPool.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {StubStateManager} from "./StubStateManager.sol";
import {StateManager} from "../src/asset-management/StateManager.sol";
import {LiquidityBridge} from "../src/asset-management/vaults/LiquidityBridge.sol";
import {VaultFactory} from "../src/asset-management/vaults/VaultFactory.sol";
import {EarnVaultDeployer} from "../src/asset-management/vaults/EarnVaultDeployer.sol";
import {LiquidityEarnVaultDeployer} from "../src/asset-management/vaults/LiquidityEarnVaultDeployer.sol";
import {AdapterRegistry} from "../src/asset-management/vaults/AdapterRegistry.sol";
import {IVaultFactory} from "../src/interfaces/IVaultFactory.sol";
import {IBaseVault} from "../src/interfaces/IBaseVault.sol";
import {LiquidityEarnVault} from "../src/asset-management/vaults/LiquidityEarnVault.sol";
import {Settlement} from "../src/asset-management/settlement/Settlement.sol";
import {AdapterFactory} from "../src/asset-management/strategy/AdapterFactory.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";
import {IAdapterFactory} from "../src/interfaces/IAdapterFactory.sol";
import {ProductState, CycleState, Tranche, FeePaymentKind} from "../src/libs/Types.sol";

/// @notice Minimal ERC-20 USDT mock for the deploy demo (testnet / Anvil).
///         Non-standard transfer (no bool return) to mirror real USDT behaviour.
contract MockUSDT {
    string public name = "Mock USDT";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 all = allowance[from][msg.sender];
        if (all != type(uint256).max) {
            require(all >= amount, "MockUSDT: allowance");
            allowance[from][msg.sender] = all - amount;
        }
        _move(from, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "MockUSDT: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @title Deploy — Week 2 governance + asset + settlement infrastructure
/// @notice Deploys and wires the full W2 contract set, registers two demo assets, grants demo
///         roles, and writes `control-panel/{deployments.json,config.js}` for the wallet console.
///
///         Usage:
///           Local:   anvil &  ;  forge script script/Deploy.s.sol --tc Deploy --rpc-url http://localhost:8545 --broadcast
///           Testnet: forge script script/Deploy.s.sol --tc Deploy --rpc-url <bnb-testnet-rpc> --broadcast --legacy
///                    (key from TEST_PK or PRIVATE_KEY in .env)
///
/// @dev    StateManager is still deferred; StubStateManager stands in for the pause gate.
contract Deploy is Script {
    // Deterministic Anvil accounts (mnemonic "test test ... junk").
    uint256 internal constant ANVIL_PK0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant ANVIL_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // curator
    address internal constant ANVIL_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // guardian
    address internal constant ANVIL_3 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // issuer
    address internal constant ANVIL_4 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; // tokenAgent
    address internal constant ANVIL_5 = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc; // nav signer
    address internal constant ANVIL_6 = 0x976EA74026E726554dB657fA54763abd0C3a0aa9; // data provider
    address internal constant ANVIL_7 = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955; // compliance

    // Deployed contract set.
    address internal governor;
    HyperAccessControl internal ac;
    StubStateManager internal stub;
    AssetRegistry internal registry;
    ProtocolFeeConfig internal feeConfig;
    MintBurnController internal mbc;
    NAVOracle internal nav;
    PoRRegistry internal por;
    MockUSDT internal usdt;
    RevenuePool internal revenuePool;
    UnifiedPool internal unifiedPool;
    Queue internal queue;
    ReservePSM internal psm;
    AdapterFactory internal adapterFactory;

    // Per-asset demo tokens (deployed by registerAsset).
    address internal sToken;
    address internal jToken;
    address internal rwaAdapter;

    function run() external {
        uint256 pk = vm.envOr("TEST_PK", vm.envOr("PRIVATE_KEY", ANVIL_PK0));
        governor = vm.addr(pk);

        vm.startBroadcast(pk);

        // --- Governance ---
        ac = new HyperAccessControl(governor);
        stub = new StubStateManager(address(ac));
        // NOTE: ProtocolTimelock removed — Vault-local VaultTimelock instances are deployed per
        // Vault by VaultFactory now (task: full Deploy.s.sol rework for the new RBAC model).

        // --- Settlement infra (constructed early: ProtocolFeeConfig needs the real RevenuePool) ---
        usdt = new MockUSDT();
        revenuePool = new RevenuePool(address(usdt), address(ac));

        // --- Asset infra ---
        feeConfig = new ProtocolFeeConfig(address(ac), address(revenuePool));
        registry = new AssetRegistry(address(feeConfig)); // deploys and owns its own MintBurnController internally
        mbc = MintBurnController(registry.mintBurnController());
        nav = new NAVOracle(governor, 2000);
        por = new PoRRegistry(address(registry));
        // ClaimRegistry is NOT deployed here: its StateManager is fixed at construction (G-08 —
        // no runtime configuration role), and the real StateManager only exists in W3. Same
        // reason Queue is deployed in W3 rather than reused from this stage.

        // Register demo assets — each call deploys a dedicated RWAToken ERC-20.
        (, sToken) = registry.registerAsset(keccak256("DEMO-S-ASSET"), "S Token", "S-TKN", 6, FeePaymentKind.Native); // id 1
        (, jToken) = registry.registerAsset(keccak256("DEMO-J-ASSET"), "J Token", "J-TKN", 6, FeePaymentKind.Native); // id 2

        // --- Settlement infra (cont'd — usdt/revenuePool constructed above, before ProtocolFeeConfig) ---
        // UnifiedPool: standalone — no PSM dependency for the demo.
        // UUPS upgradeable: deploy implementation behind an ERC1967Proxy, then initialize.
        UnifiedPool unifiedPoolImpl = new UnifiedPool();
        bytes memory unifiedPoolInitData = abi.encodeCall(
            UnifiedPool.initialize, (address(usdt), address(stub), address(ac))
        );
        unifiedPool = UnifiedPool(address(new ERC1967Proxy(address(unifiedPoolImpl), unifiedPoolInitData)));
        queue = new Queue(address(stub));

        // ReservePSM: independent asset wrap/unwrap module (no Vault/Settlement coupling).
        psm = new ReservePSM(address(ac));

        // Authorise UnifiedPool to call RevenuePool.receiveFee.
        revenuePool.addAuthorizedSource(address(unifiedPool));

        // Deploy a Wrapped Asset for demo asset 1 (S Token), Token Custody Mode backed by USDT.
        psm.deployWrappedToken(1, IReservePSM.AssetMode.TOKEN_CUSTODY, address(usdt), "Wrapped S Token", "wS-TKN", 6, true);

        // Local-devnet demo of the new RWA valuation path: sToken (already deployed above via
        // registerAsset) stands in for an externally-issued RWA Token.
        adapterFactory = new AdapterFactory();
        rwaAdapter = adapterFactory.deployRWAAdapter(
            IAdapterFactory.RWAAdapterParams({
                asset: address(usdt),
                vault: governor,
                rwaToken: sToken,
                navOracle: address(nav),
                dealDataStalenessWindow: 36 hours
            })
        );

        _grantDemoRoles();
        vm.stopBroadcast();

        _writeDeployments();
    }

    /// @dev Under the Vault-local/Asset-local RBAC model, Curator/Guardian/Allocator/Operator/
    ///      Settlement Operator only exist once a real Vault is deployed (W3+); Issuer is simply
    ///      each asset's AssetRegistry owner (the deployer here, since it called registerAsset).
    ///      Only the asset-local Token Agent and the demo NAV signer are wired at this stage.
    function _grantDemoRoles() internal {
        address tokenAgent = block.chainid == 31337 ? ANVIL_4 : governor;
        address navSigner = block.chainid == 31337 ? ANVIL_5 : governor;

        mbc.setTokenAgent(1, tokenAgent);
        mbc.setTokenAgent(2, tokenAgent);
        nav.setSigner(sToken, navSigner);
    }

    function _roleHolder(address anvilAcct) internal view returns (address) {
        return block.chainid == 31337 ? anvilAcct : governor;
    }

    function _writeDeployments() internal {
        string memory a = "addresses";
        vm.serializeAddress(a, "HyperAccessControl", address(ac));
        vm.serializeAddress(a, "AssetRegistry", address(registry));
        vm.serializeAddress(a, "ProtocolFeeConfig", address(feeConfig));
        vm.serializeAddress(a, "MintBurnController", address(mbc));
        vm.serializeAddress(a, "NAVOracle", address(nav));
        vm.serializeAddress(a, "PoRRegistry", address(por));
        vm.serializeAddress(a, "ReservePSM", address(psm));
        vm.serializeAddress(a, "Queue", address(queue));
        vm.serializeAddress(a, "RevenuePool", address(revenuePool));
        vm.serializeAddress(a, "UnifiedPool", address(unifiedPool));
        vm.serializeAddress(a, "MockUSDT", address(usdt));
        vm.serializeAddress(a, "StubStateManager", address(stub));
        vm.serializeAddress(a, "SToken", sToken);
        vm.serializeAddress(a, "JToken", jToken);
        // RWAToken key kept for panel backwards-compat — points to demo S Token.
        vm.serializeAddress(a, "RWAToken", sToken);
        string memory addrs = vm.serializeAddress(a, "RWAAdapter", rwaAdapter);

        // Curator/Guardian/Allocator/Operator/Settlement Operator are Vault-local (W3+ scripts);
        // Issuer/Compliance are simply each asset's AssetRegistry owner (the deployer).
        string memory r = "roles";
        vm.serializeAddress(r, "GOVERNOR", governor);
        vm.serializeAddress(r, "ISSUER", governor);
        vm.serializeAddress(r, "TOKEN_AGENT", _roleHolder(ANVIL_4));
        string memory roles = vm.serializeAddress(r, "NAV_SIGNER", _roleHolder(ANVIL_5));

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "addresses", addrs);
        string memory out = vm.serializeString(root, "roles", roles);

        vm.writeJson(out, "./control-panel/deployments.json");
        vm.writeFile("./control-panel/config.js", string.concat("window.HT_DEPLOYMENTS = ", out, ";\n"));
    }
}

// ---------------------------------------------------------------------------
// W3 deploy wiring (development-plan §3.3.1)
// ---------------------------------------------------------------------------
// Usage: forge script script/Deploy.s.sol --tc DeployW3 --rpc-url <rpc> --broadcast [--legacy]
//
// Reads addresses of already-deployed W1/W2 contracts from environment variables:
//   HYPER_ACCESS_CONTROL, UNIFIED_POOL, USDT, PROTOCOL_FEE_CONFIG
// All four must be set; otherwise the script reverts. PROTOCOL_FEE_CONFIG is the ProtocolFeeConfig
// deployed by Deploy (W2) for AssetRegistry — VaultFactory reuses that same instance rather than
// deploying its own, so the protocol has exactly one fee table.
//
// Deploys its own NAVOracle AND Queue rather than reusing an already-deployed instance: both are
// wired to the real StateManager deployed in this script (Queue's `sm` binding is set once at
// construction and has no setter, so a Queue deployed against the earlier StubStateManager would
// reject the real vaults registered here — `enqueue` reverts UnregisteredVault for every one of
// them). ClaimRegistry is deployed here for the same reason: its StateManager is a constructor
// immutable (G-08 — no runtime configuration role), so it cannot be built before StateManager.
//
// On completion, adds W3 addresses (including the new Queue) to control-panel/deployments-w3.json.
// ---------------------------------------------------------------------------
contract DeployW3 is Script {
    uint256 internal constant ANVIL_PK0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    struct W3Inputs {
        address governor;
        address accessControl;
        address unifiedPool;
        address usdt;
        address feeConfig;
    }

    // Deployed addresses (set during run, used in _writeOutput)
    address internal stateManagerAddr;
    address internal claimRegistryAddr;
    address internal navOracleAddr;
    address internal queueAddr;
    address internal liquidityBridgeAddr;
    address internal vaultFactoryAddr;
    address internal adapterRegistryAddr;
    address internal cashVaultAddr;
    address internal noteVaultAddr;
    address internal lpVaultAddr;
    address internal cashVaultTimelockAddr;
    address internal noteVaultTimelockAddr;
    address internal lpVaultTimelockAddr;

    function run() external {
        uint256 pk = vm.envOr("TEST_PK", vm.envOr("PRIVATE_KEY", ANVIL_PK0));

        W3Inputs memory in_ = W3Inputs({
            governor: vm.addr(pk),
            accessControl: vm.envAddress("HYPER_ACCESS_CONTROL"),
            unifiedPool: vm.envAddress("UNIFIED_POOL"),
            usdt: vm.envAddress("USDT"),
            feeConfig: vm.envAddress("PROTOCOL_FEE_CONFIG")
        });

        vm.startBroadcast(pk);
        _deploy(in_);
        vm.stopBroadcast();

        _writeOutput();
    }

    function _deploy(W3Inputs memory in_) internal {
        StateManager stateManager    = new StateManager(in_.accessControl);
        ClaimRegistry claimRegistry  = new ClaimRegistry(address(stateManager));
        NAVOracle navOracle          = new NAVOracle(in_.governor, 2000);
        Queue queue                  = new Queue(address(stateManager));
        LiquidityBridge liqBridge    = new LiquidityBridge(in_.usdt);
        VaultFactory vaultFactory    = _newVaultFactory(address(stateManager), in_.feeConfig);
        // Shared AdapterRegistry — Vault Owners may instead deploy and manage their own.
        AdapterRegistry adapterRegistry = new AdapterRegistry(in_.governor);

        stateManager.setVaultFactory(address(vaultFactory));

        address cashVault = _deployCashVault(vaultFactory, address(queue), address(adapterRegistry), in_.usdt, address(stateManager), address(liqBridge));
        address noteVault = _deployNoteVault(vaultFactory, address(queue), address(adapterRegistry), in_.usdt, address(stateManager));
        address lpVault   = _deployLPVault(vaultFactory, address(queue), address(adapterRegistry), in_.usdt, address(stateManager), address(liqBridge), cashVault);

        // governor is each vault's Owner (VaultFactory defaults owner to msg.sender); wire itself
        // in as Keeper and Curator so the rest of this demo bootstrap can proceed single-wallet.
        _grantVaultLocalRoles(cashVault, in_.governor);
        _grantVaultLocalRoles(noteVault, in_.governor);
        _grantVaultLocalRoles(lpVault, in_.governor);

        UnifiedPool(in_.unifiedPool).addTrancheVault(Tranche.Cash, cashVault);
        UnifiedPool(in_.unifiedPool).addTrancheVault(Tranche.Note, noteVault);
        UnifiedPool(in_.unifiedPool).addTrancheVault(Tranche.LP,   lpVault);

        stateManagerAddr     = address(stateManager);
        claimRegistryAddr    = address(claimRegistry);
        navOracleAddr         = address(navOracle);
        queueAddr             = address(queue);
        liquidityBridgeAddr  = address(liqBridge);
        vaultFactoryAddr     = address(vaultFactory);
        adapterRegistryAddr  = address(adapterRegistry);
        cashVaultAddr        = cashVault;
        noteVaultAddr        = noteVault;
        lpVaultAddr          = lpVault;
        // Each Vault's own Timelock is deployed and bound by VaultFactory; export the addresses
        // so the control panel can reach the per-Vault governance surface.
        cashVaultTimelockAddr = IBaseVault(cashVault).vaultTimelock();
        noteVaultTimelockAddr = IBaseVault(noteVault).vaultTimelock();
        lpVaultTimelockAddr   = IBaseVault(lpVault).vaultTimelock();
    }

    /// @dev Deployed independently (not `new`'d inside VaultFactory's own constructor) to avoid
    ///      transitively embedding EarnVault/LiquidityEarnVault's full creation bytecode into
    ///      VaultFactory's init code — see VaultFactory.sol's storage-section comment.
    function _newVaultFactory(address stateManager_, address feeConfig_) internal returns (VaultFactory) {
        EarnVaultDeployer earnDeployer = new EarnVaultDeployer();
        LiquidityEarnVaultDeployer lpDeployer = new LiquidityEarnVaultDeployer();
        return new VaultFactory(stateManager_, address(earnDeployer), address(lpDeployer), feeConfig_);
    }

    function _grantVaultLocalRoles(address vault, address governor) internal {
        IBaseVault(vault).setKeeper(governor, true);
        IBaseVault(vault).setCurator(governor);
    }

    function _deployCashVault(
        VaultFactory vf, address q, address adapterRegistry, address usdt, address sm, address lb
    ) internal returns (address) {
        return vf.deployVault(IVaultFactory.VaultParams({
            vaultType: IVaultFactory.VaultType.EARN, name: "HyperTessera Cash Earn", symbol: "htCASH",
            usdt: usdt, stateManager: sm, settlement: address(0), queue: q,
            owner: address(0), adapterRegistry: adapterRegistry, liquidityBridge: lb, cashVault: address(0),
            feeKind: FeePaymentKind.Native,
            initialProduct: ProductState.CONFIGURING, initialCycle: CycleState.ACCEPTING
        }));
    }

    function _deployNoteVault(
        VaultFactory vf, address q, address adapterRegistry, address usdt, address sm
    ) internal returns (address) {
        return vf.deployVault(IVaultFactory.VaultParams({
            vaultType: IVaultFactory.VaultType.EARN, name: "HyperTessera Note Earn", symbol: "htNOTE",
            usdt: usdt, stateManager: sm, settlement: address(0), queue: q,
            owner: address(0), adapterRegistry: adapterRegistry, liquidityBridge: address(0), cashVault: address(0),
            feeKind: FeePaymentKind.Native,
            initialProduct: ProductState.CONFIGURING, initialCycle: CycleState.ACCEPTING
        }));
    }

    function _deployLPVault(
        VaultFactory vf, address q, address adapterRegistry, address usdt, address sm, address lb, address cv
    ) internal returns (address) {
        return vf.deployVault(IVaultFactory.VaultParams({
            vaultType: IVaultFactory.VaultType.LP, name: "HyperTessera Liquidity Earn", symbol: "htLP",
            usdt: usdt, stateManager: sm, settlement: address(0), queue: q,
            owner: address(0), adapterRegistry: adapterRegistry, liquidityBridge: lb, cashVault: cv,
            feeKind: FeePaymentKind.Native,
            initialProduct: ProductState.CONFIGURING, initialCycle: CycleState.ACCEPTING
        }));
    }

    function _writeOutput() internal {
        string memory a = "addresses";
        vm.serializeAddress(a, "StateManager",    stateManagerAddr);
        vm.serializeAddress(a, "ClaimRegistry",   claimRegistryAddr);
        vm.serializeAddress(a, "NAVOracle",       navOracleAddr);
        vm.serializeAddress(a, "Queue",           queueAddr);
        vm.serializeAddress(a, "LiquidityBridge", liquidityBridgeAddr);
        vm.serializeAddress(a, "VaultFactory",    vaultFactoryAddr);
        vm.serializeAddress(a, "AdapterRegistry", adapterRegistryAddr);
        vm.serializeAddress(a, "CashVault",       cashVaultAddr);
        vm.serializeAddress(a, "NoteVault",       noteVaultAddr);
        vm.serializeAddress(a, "LPVault",         lpVaultAddr);
        vm.serializeAddress(a, "CashVaultTimelock", cashVaultTimelockAddr);
        vm.serializeAddress(a, "NoteVaultTimelock", noteVaultTimelockAddr);
        string memory addrs = vm.serializeAddress(a, "LPVaultTimelock", lpVaultTimelockAddr);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        string memory out = vm.serializeString(root, "addresses", addrs);

        vm.writeJson(out, "./control-panel/deployments-w3.json");
    }
}

// ---------------------------------------------------------------------------
// W4 deploy wiring (development-plan §3.4.4)
// ---------------------------------------------------------------------------
// Usage: forge script script/Deploy.s.sol --tc DeployW4 --rpc-url <rpc> --broadcast [--legacy]
//
// Reads addresses of already-deployed W1-W3 contracts from environment variables:
//   HYPER_ACCESS_CONTROL, STATE_MANAGER, QUEUE, UNIFIED_POOL, NAV_ORACLE, USDT,
//   CASH_VAULT, NOTE_VAULT, LP_VAULT
// All nine must be set; otherwise the script reverts. SETTLEMENT_OPERATORS is a
// comma-separated address list; SETTLEMENT_THRESHOLD and DATA_PROVIDER_SIGNER are also required.
// QUEUE and STATE_MANAGER must be the W3 addresses (DeployW3's output) — Queue's `sm` binding is
// set once at construction, so passing an earlier (W1/W2) Queue here would reject every real
// vault's enqueue/dequeue calls with UnregisteredVault.
//
// On completion, writes W4 addresses to control-panel/deployments-w4.json.
//
// Note: lpAdapter.setBridgeTarget(liquidityBridge, cashVault) is deliberately NOT called here —
// it is Curator's own initial parameter configuration (client feedback 2026-07-10, §3.4.1
// LiquidityAdapter), not a GOVERNOR_ROLE deploy step.
// ---------------------------------------------------------------------------
contract DeployW4 is Script {
    uint256 internal constant ANVIL_PK0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    struct W4Inputs {
        address accessControl;
        address stateManager;
        address queue;
        address unifiedPool;
        address usdt;
        address cashVault;
        address noteVault;
        address lpVault;
        address[] operators;
        uint256 threshold;
        address dataProviderSigner;
    }

    address internal settlementAddr;
    address internal adapterFactoryAddr;
    address internal cashAdapterAddr;
    address internal noteAdapterAddr;
    address internal lpAdapterAddr;

    function run() external {
        uint256 pk = vm.envOr("TEST_PK", vm.envOr("PRIVATE_KEY", ANVIL_PK0));

        W4Inputs memory in_ = W4Inputs({
            accessControl: vm.envAddress("HYPER_ACCESS_CONTROL"),
            stateManager: vm.envAddress("STATE_MANAGER"),
            queue: vm.envAddress("QUEUE"),
            unifiedPool: vm.envAddress("UNIFIED_POOL"),
            usdt: vm.envAddress("USDT"),
            cashVault: vm.envAddress("CASH_VAULT"),
            noteVault: vm.envAddress("NOTE_VAULT"),
            lpVault: vm.envAddress("LP_VAULT"),
            operators: vm.envAddress("SETTLEMENT_OPERATORS", ","),
            threshold: vm.envUint("SETTLEMENT_THRESHOLD"),
            dataProviderSigner: vm.envAddress("DATA_PROVIDER_SIGNER")
        });

        vm.startBroadcast(pk);
        _deploySettlement(in_);
        _deployAdapters(in_);
        _wireVaults(in_);
        vm.stopBroadcast();

        _writeOutput();
    }

    function _deploySettlement(W4Inputs memory in_) internal {
        Settlement settlement = new Settlement(in_.stateManager, in_.unifiedPool, in_.queue);

        // Wire this Settlement as each vault's bound settlement contract first (Owner-gated,
        // direct while CONFIGURING), then each vault's Owner configures its own operator set.
        IBaseVault(in_.cashVault).setSettlement(address(settlement));
        IBaseVault(in_.noteVault).setSettlement(address(settlement));
        IBaseVault(in_.lpVault).setSettlement(address(settlement));

        _addOperators(settlement, in_.cashVault, in_.operators, in_.threshold);
        _addOperators(settlement, in_.noteVault, in_.operators, in_.threshold);
        _addOperators(settlement, in_.lpVault, in_.operators, in_.threshold);

        settlementAddr = address(settlement);
    }

    function _addOperators(Settlement settlement, address vault, address[] memory operators, uint256 threshold) internal {
        for (uint256 i = 0; i < operators.length; i++) {
            settlement.setOperator(vault, operators[i], true);
        }
        settlement.setThreshold(vault, threshold);
    }

    function _deployAdapters(W4Inputs memory in_) internal {
        AdapterFactory adapterFactory = new AdapterFactory();

        address cashAdapter = adapterFactory.deployAdapter(
            IAdapterFactory.AdapterParams({asset: in_.usdt, vault: in_.cashVault, stalenessWindow: 36 hours})
        );
        address noteAdapter = adapterFactory.deployAdapter(
            IAdapterFactory.AdapterParams({asset: in_.usdt, vault: in_.noteVault, stalenessWindow: 36 hours})
        );
        address lpAdapter = adapterFactory.deployLiquidityAdapter(
            IAdapterFactory.AdapterParams({asset: in_.usdt, vault: in_.lpVault, stalenessWindow: 36 hours})
        );

        adapterFactoryAddr = address(adapterFactory);
        cashAdapterAddr = cashAdapter;
        noteAdapterAddr = noteAdapter;
        lpAdapterAddr = lpAdapter;
    }

    function _wireVaults(W4Inputs memory in_) internal {
        // Each vault's Owner must first whitelist these Adapter implementations in its bound
        // AdapterRegistry before addAdapter/setAdapter will accept them.
        address cashRegistry = IBaseVault(in_.cashVault).adapterRegistry();
        address noteRegistry = IBaseVault(in_.noteVault).adapterRegistry();
        address lpRegistry = IBaseVault(in_.lpVault).adapterRegistry();
        AdapterRegistry(cashRegistry).setAdapterAllowed(cashAdapterAddr, true);
        AdapterRegistry(noteRegistry).setAdapterAllowed(noteAdapterAddr, true);
        AdapterRegistry(lpRegistry).setAdapterAllowed(lpAdapterAddr, true);

        // LiquidityEarnVault.setAdapter registers the LiquidityAdapter into BaseVault.adapters[]
        // internally; Cash/Note vaults' plain Adapters need addAdapter called explicitly so
        // grossManagedAssets() aggregates their realAssets().
        LiquidityEarnVault(in_.lpVault).setAdapter(lpAdapterAddr);
        IBaseVault(in_.cashVault).addAdapter(cashAdapterAddr);
        IBaseVault(in_.noteVault).addAdapter(noteAdapterAddr);

        // Wire UnifiedPool so grossManagedAssets() also counts each vault's pool receivable.
        IBaseVault(in_.cashVault).setUnifiedPool(in_.unifiedPool);
        IBaseVault(in_.noteVault).setUnifiedPool(in_.unifiedPool);
        IBaseVault(in_.lpVault).setUnifiedPool(in_.unifiedPool);

        // Data Provider is per-Adapter now (set by that Vault's Curator), not a global role.
        IAdapter(cashAdapterAddr).setDataProvider(in_.dataProviderSigner);
        IAdapter(noteAdapterAddr).setDataProvider(in_.dataProviderSigner);
        IAdapter(lpAdapterAddr).setDataProvider(in_.dataProviderSigner);
    }

    function _writeOutput() internal {
        string memory a = "addresses";
        vm.serializeAddress(a, "Settlement", settlementAddr);
        vm.serializeAddress(a, "AdapterFactory", adapterFactoryAddr);
        vm.serializeAddress(a, "CashAdapter", cashAdapterAddr);
        vm.serializeAddress(a, "NoteAdapter", noteAdapterAddr);
        string memory addrs = vm.serializeAddress(a, "LPAdapter", lpAdapterAddr);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        string memory out = vm.serializeString(root, "addresses", addrs);

        vm.writeJson(out, "./control-panel/deployments-w4.json");
    }
}
