# HyperTessera Role Workspaces and SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 HyperTessera 前端中交付老板方案定义的全部角色工作台，并让当前 BNB Testnet 部署已支持的操作真实调用 HyperTessera SDK，尚未落地的目标权限操作以 fail-closed 状态展示。

**Architecture:** 新增独立的 `/workspaces` 产品壳，通过配置驱动的角色注册表生成 15 个身份工作台。页面只调用语义化 action executor，executor 再根据 deployment profile 选择 current SDK adapter 或 target adapter；Capability Resolver 在每次操作前重新验证钱包、网络、对象、权限、状态机和 SDK 支持情况。

**Tech Stack:** React 19.2.7、React Router 7.18.1、Vite 8.1.1、Ethers 6、Radix Themes、Vitest、Testing Library、原项目 CSS tokens、HyperTessera TypeScript SDK。

## Global Constraints

- 老板的《HyperTessera_角色权限与职责修改方案_完整版》是角色与职责的优先需求来源。
- 当前合约 profile 是 `legacy`，目标合约 profile 是 `target`。
- 当前 profile 只调用当前 SDK 已存在的方法，目标动作缺少 ABI 或 SDK 方法时必须返回 `targetOnly`。
- 页面组件不得直接实例化 ethers `Contract` 或发送交易。
- URL 不构成授权，写操作前必须重新解析 capability。
- 不保存私钥，不向分析系统记录完整敏感签名。
- 保留现有公开页面 URL、Header、Footer、品牌 Logo 和现有用户修改。
- 后台视觉参数为视觉变化 3/10、动效 2/10、信息密度 7/10。
- 只使用 Radix Themes 加项目 CSS tokens，不混入第二套组件系统。
- 所有新工作在本地提交，除非用户另行明确要求，否则不执行 `git push`。
- 每次 Git 提交只 `git add` 当前任务列出的文件，不能包含用户已有的首页和 Logo 修改。

---

## Planned File Structure

```text
src/
  App.jsx
  main.jsx
  wallet/index.jsx
  i18n/en.js
  i18n/zh-CN.js
  integrations/hypertessera/
    upstream/
      abis.json
      abis.ts
      sdk.ts
      types.ts
    upstream-meta.json
  workspaces/
    components/
      ActionForm.jsx
      ActionPanel.jsx
      CapabilityBanner.jsx
      ContextBar.jsx
      DataField.jsx
      ObjectSelector.jsx
      StatGrid.jsx
      TransactionDrawer.jsx
      WorkspaceSidebar.jsx
    config/
      deployments.js
      roleDefinitions.js
      formSchemas.js
    core/
      actionExecutors.js
      capabilityResolver.js
      capabilityStates.js
      contractErrors.js
      createSdk.js
      objectContext.js
      transactionStore.jsx
      signaturePayloads.js
      validators.js
      walletRunner.js
    sdk/
      currentAdapter.js
      targetAdapter.js
    pages/
      ActivityPage.jsx
      PublicWorkspacePage.jsx
      RoleWorkspacePage.jsx
      WorkspaceIndexPage.jsx
      WorkspaceNotFoundPage.jsx
    WorkspaceLayout.jsx
  styles/workspaces.css
  test/setup.js
  test/renderWithProviders.jsx
  workspaces/**/*.test.{js,jsx,ts}
vite.config.js
package.json
package-lock.json
tsconfig.json
```

`upstream` 目录只保存从私有合约仓库同步的 SDK 核心和 ABI；项目自己的权限、页面和交易逻辑全部位于 `workspaces`，避免修改上游 SDK 后难以再次同步。

---

### Task 1: Add the Test and Product-UI Foundation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.js`
- Create: `tsconfig.json`
- Create: `src/test/setup.js`
- Create: `src/test/renderWithProviders.jsx`
- Create: `src/workspaces/core/capabilityStates.js`
- Test: `src/workspaces/core/capabilityStates.test.js`

**Interfaces:**

- Produces: `CAPABILITY_STATES`, `isActionEnabled(state)`, `renderWithProviders(ui, options)`.
- Consumes: existing React, Router, LocaleProvider and WalletProvider.

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```powershell
npm install ethers @radix-ui/themes
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom typescript @types/react @types/react-dom
```

Expected: `package.json` and `package-lock.json` contain the new packages with no peer dependency failure.

- [ ] **Step 2: Add test scripts and Vite test configuration**

Add these scripts to `package.json`:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "verify": "npm run test && npm run typecheck && npm run build"
}
```

Extend `vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: true,
  },
});
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "allowJs": true,
    "checkJs": false,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "vite.config.js"]
}
```

- [ ] **Step 3: Write the failing capability-state test**

```js
import { describe, expect, it } from 'vitest';
import { CAPABILITY_STATES, isActionEnabled } from './capabilityStates';

describe('isActionEnabled', () => {
  it('only enables available actions', () => {
    expect(isActionEnabled(CAPABILITY_STATES.AVAILABLE)).toBe(true);
    for (const state of Object.values(CAPABILITY_STATES).filter(value => value !== 'available')) {
      expect(isActionEnabled(state)).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Run the test and verify the expected failure**

Run: `npm test -- src/workspaces/core/capabilityStates.test.js`

Expected: FAIL because `capabilityStates.js` does not exist.

- [ ] **Step 5: Implement capability states and shared test setup**

```js
export const CAPABILITY_STATES = Object.freeze({
  AVAILABLE: 'available',
  READ_ONLY: 'readOnly',
  UNAUTHORIZED: 'unauthorized',
  WRONG_NETWORK: 'wrongNetwork',
  WALLET_REQUIRED: 'walletRequired',
  OBJECT_REQUIRED: 'objectRequired',
  TARGET_ONLY: 'targetOnly',
  PAUSED: 'paused',
  INVALID_STATE: 'invalidState',
  UNSUPPORTED_DEPLOYMENT: 'unsupportedDeployment',
});

export function isActionEnabled(state) {
  return state === CAPABILITY_STATES.AVAILABLE;
}
```

`src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
```

`renderWithProviders.jsx` must wrap `MemoryRouter` and expose `initialEntries`; tests that need wallet or locale pass explicit context doubles instead of using the real browser extension.

- [ ] **Step 6: Run the test suite and commit**

Run:

```powershell
npm test -- src/workspaces/core/capabilityStates.test.js
npm run typecheck
```

Expected: PASS.

Commit:

```powershell
git add package.json package-lock.json vite.config.js tsconfig.json src/test src/workspaces/core/capabilityStates.js src/workspaces/core/capabilityStates.test.js
git commit -m "test: add workspace test foundation"
```

---

### Task 2: Vendor the Exact Current SDK for Browser Use

**Files:**

- Create: `src/integrations/hypertessera/upstream/sdk.ts`
- Create: `src/integrations/hypertessera/upstream/types.ts`
- Create: `src/integrations/hypertessera/upstream/abis.json`
- Create: `src/integrations/hypertessera/upstream/abis.ts`
- Create: `src/integrations/hypertessera/upstream-meta.json`
- Test: `src/integrations/hypertessera/upstream/abis.test.ts`

**Interfaces:**

- Produces: `HyperTesseraSDK`, `HyperTesseraAddresses`, `getAbi(name)`, SDK enums and instruction types.
- Consumes: exact source from private repository commit `7a49a6f5668e2ea9e76938a20535eabb6b99e552`.

- [ ] **Step 1: Verify upstream files before copying**

Compare the private GitHub commit with:

```text
offchain/src/sdk.ts
offchain/src/types.ts
control-panel/abis.json
```

Record the commit and source paths in `upstream-meta.json`:

```json
{
  "repository": "alliancechuan/hyperTessera",
  "commit": "7a49a6f5668e2ea9e76938a20535eabb6b99e552",
  "sdkSource": "offchain/src/sdk.ts",
  "typesSource": "offchain/src/types.ts",
  "abiSource": "control-panel/abis.json",
  "browserAdaptation": "abis.ts replaces the Node fs loader with a Vite JSON import"
}
```

- [ ] **Step 2: Copy SDK sources and ABI**

Copy the verified files into `src/integrations/hypertessera/upstream`. In `sdk.ts`, change only the browser-resolved imports:

```ts
import { getAbi, type ContractName } from './abis';
import {
  ProductState,
  CycleState,
  PauseState,
  Tranche,
  QueueType,
  AssetMode,
  type Address,
  type Hex,
  type StateContext,
  type NAVData,
  type AssetInfo,
  type SettlementInstruction,
} from './types';
```

Do not alter SDK method bodies.

- [ ] **Step 3: Write the failing browser ABI test**

```ts
import { describe, expect, it } from 'vitest';
import { getAbi } from './abis';

describe('browser ABI loader', () => {
  it('returns current SDK contract ABIs without Node fs', () => {
    expect(getAbi('HyperAccessControl')).toEqual(expect.any(Array));
    expect(getAbi('Settlement')).toEqual(expect.any(Array));
    expect(getAbi('ReservePSM')).toEqual(expect.any(Array));
  });

  it('rejects an unknown contract name at runtime', () => {
    expect(() => getAbi('MissingContract' as never)).toThrow('No ABI found');
  });
});
```

- [ ] **Step 4: Run the test and verify the expected failure**

Run: `npm test -- src/integrations/hypertessera/upstream/abis.test.ts`

Expected: FAIL because the browser ABI loader does not exist.

- [ ] **Step 5: Implement the browser-safe ABI loader**

```ts
import abiMap from './abis.json';
import type { InterfaceAbi } from 'ethers';

export type ContractName = keyof typeof abiMap;

export function getAbi(name: ContractName): InterfaceAbi {
  const abi = abiMap[name];
  if (!abi) throw new Error(`No ABI found for contract "${name}"`);
  return abi as InterfaceAbi;
}
```

- [ ] **Step 6: Verify source integrity and commit**

Run:

```powershell
npm test -- src/integrations/hypertessera/upstream/abis.test.ts
npm run typecheck
npm run build
```

Expected: SDK imports compile in the browser build and no `node:fs` bundle error occurs.

Commit:

```powershell
git add src/integrations/hypertessera
git commit -m "feat: vendor browser-compatible hypertessera sdk"
```

---

### Task 3: Add Deployment Profiles and Wallet Runners

**Files:**

- Create: `src/workspaces/config/deployments.js`
- Create: `src/workspaces/core/walletRunner.js`
- Create: `src/workspaces/core/createSdk.js`
- Modify: `src/wallet/index.jsx`
- Test: `src/workspaces/config/deployments.test.js`
- Test: `src/workspaces/core/walletRunner.test.js`

**Interfaces:**

- Produces:
  `getDeployment(chainId)`,
  `createReadSdk(deployment, eip1193Provider)`,
  `getWriteSigner(eip1193Provider)`,
  wallet context method `switchChain(chainId)`.
- Consumes: `HyperTesseraSDK`, ethers `BrowserProvider`, current EIP-6963 session.

- [ ] **Step 1: Write failing deployment tests**

```js
import { describe, expect, it } from 'vitest';
import { getDeployment } from './deployments';

describe('getDeployment', () => {
  it('returns the legacy BNB testnet profile', () => {
    const deployment = getDeployment(97);
    expect(deployment.profile).toBe('legacy');
    expect(deployment.addresses.hyperAccessControl).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(deployment.addresses.settlement).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('returns null for unsupported networks', () => {
    expect(getDeployment(1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/config/deployments.test.js`

Expected: FAIL because `deployments.js` does not exist.

- [ ] **Step 3: Implement the chain 97 legacy deployment**

Create an immutable deployment map using the addresses from `control-panel/config.js`.
Map SDK keys exactly:

```js
export const DEPLOYMENTS = Object.freeze({
  97: {
    chainId: 97,
    chainName: 'BNB Smart Chain Testnet',
    explorerUrl: 'https://testnet.bscscan.com',
    profile: 'legacy',
    sourceCommit: '7a49a6f5668e2ea9e76938a20535eabb6b99e552',
    navVault: '0x73ceDE1e2f51F8FA5448454225d9DB68aEcB8317',
    addresses: {
      hyperAccessControl: '0x9bbefE25f656732015969778dF26e104D2394Bb8',
      stateManager: '0x2a9bb2053dD14b36652f1F6Bc2511b3Eb31b1DCd',
      navOracle: '0x009F0F9507E4e3Fda5159e85fa2f6c19875A3154',
      mintBurnController: '0x563f4C2e62B4917860a4435Da0bF6615648aF28e',
      assetRegistry: '0x50222D8849f44F90fCd911fC5f36387Db8EAD429',
      reservePSM: '0x67D10e814B57E381cE020697eF14CCDf922Dd654',
      poRRegistry: '0x581A7604f9429fF52fa378f2548c28B817e68d17',
      queue: '0xCAd26BEF4ef0E71d2d54b11C1930df2F37bB1080',
      revenuePool: '0x19801Db23a0572dE445c2E73b52b71ff85914EF3',
      unifiedPool: '0x14E9ef574ABd6de2548eDe365F06AA4378010D6a',
      settlement: '0x11df11aC61D5Aa880Fd17A0cf50Be0C22277916c',
      vaultFactory: '0x63089ad3826ee02f95819e4c0d10C1080a131a0D',
      adapterFactory: '0x4514Cf0cacEeC515596c0F0EF13eB1290D482860',
      liquidityBridge: '0x7800eBf939427bA561d2d7Ff5Bf6393730A9E101',
      cashVault: '0xe0FDa7F2572c5B98D3B82DB50685A8F3685D20ea',
      noteVault: '0xf95F69488393d73D0cDbFB40e6D6B3494b832242',
      lpVault: '0x6AAAaAe6c30997D7c36E4297b0e44B3eC6126335',
      cashAdapter: '0x19643C2CFE2CE3AEAabD28e6ffC58A6c2A3bb7f4',
      noteAdapter: '0x7ddFB27c9AC47265Fd861A092050c0041A54067c',
      lpAdapter: '0xeEdBb2E9Baae30f450a9D2Ce35286d7CcF132ba1'
    }
  }
});

export function getDeployment(chainId) {
  return DEPLOYMENTS[Number(chainId)] ?? null;
}
```

- [ ] **Step 4: Write wallet-runner tests**

Use an EIP-1193 provider double that records `request` calls. Assert that:

- `getWriteSigner` creates an ethers signer for the connected account.
- `switchChain(97)` sends `wallet_switchEthereumChain` with `0x61`.
- user rejection code `4001` is rethrown unchanged for the error mapper.

- [ ] **Step 5: Implement wallet runner and SDK factory**

```js
import { BrowserProvider } from 'ethers';

export function createBrowserProvider(eip1193Provider) {
  if (!eip1193Provider) throw new Error('walletRequired');
  return new BrowserProvider(eip1193Provider);
}

export async function getWriteSigner(eip1193Provider) {
  return createBrowserProvider(eip1193Provider).getSigner();
}

export async function requestChain(eip1193Provider, chainId) {
  return eip1193Provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${Number(chainId).toString(16)}` }],
  });
}
```

`createSdk.js` constructs `HyperTesseraSDK(deployment.addresses, BrowserProvider)` for reads and constructs a second instance with the ethers signer for writes.

- [ ] **Step 6: Expose network switching from WalletProvider**

Add a memoized `switchChain(chainId)` method to the wallet context that calls the active EIP-1193 provider. Do not change the existing discovery, reconnect or disconnect behavior.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/config/deployments.test.js src/workspaces/core/walletRunner.test.js
npm run typecheck
```

Commit:

```powershell
git add src/workspaces/config src/workspaces/core/walletRunner.js src/workspaces/core/walletRunner.test.js src/workspaces/core/createSdk.js src/wallet/index.jsx
git commit -m "feat: add deployment and wallet sdk runners"
```

---

### Task 4: Build the Complete Role and Action Registry

**Files:**

- Create: `src/workspaces/config/roleDefinitions.js`
- Create: `src/workspaces/config/formSchemas.js`
- Test: `src/workspaces/config/roleDefinitions.test.js`
- Modify: `src/i18n/zh-CN.js`
- Modify: `src/i18n/en.js`

**Interfaces:**

- Produces:
  `ROLE_DEFINITIONS`,
  `ACTION_DEFINITIONS`,
  `getRoleDefinition(roleId)`,
  `getActionDefinition(actionId)`,
  `FORM_SCHEMAS`.
- Consumes: stable capability-state strings from Task 1.

- [ ] **Step 1: Write the failing role-coverage test**

```js
import { describe, expect, it } from 'vitest';
import { ROLE_DEFINITIONS, ACTION_DEFINITIONS } from './roleDefinitions';

const REQUIRED_ROLES = [
  'governor',
  'vault-owner',
  'curator',
  'guardian',
  'allocator',
  'settlement-operator',
  'keeper',
  'asset-owner',
  'token-agent',
  'proof-publisher',
  'wrapper-controller',
  'nav-signer',
  'adapter-data-provider',
  'psm-authorized-signer',
  'relayer',
];

describe('role registry', () => {
  it('covers every boss-document identity once', () => {
    expect(Object.keys(ROLE_DEFINITIONS).sort()).toEqual(REQUIRED_ROLES.sort());
  });

  it('references real actions and explicit scope', () => {
    for (const role of Object.values(ROLE_DEFINITIONS)) {
      expect(['protocol', 'vault', 'asset', 'wrapper', 'adapter', 'permissionless'])
        .toContain(role.scope);
      for (const actionId of role.actions) {
        expect(ACTION_DEFINITIONS[actionId]).toBeDefined();
      }
    }
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/config/roleDefinitions.test.js`

Expected: FAIL because the role registry does not exist.

- [ ] **Step 3: Implement all role definitions**

Each definition has:

```js
{
  id: 'curator',
  path: '/workspaces/curator/:vault',
  scope: 'vault',
  titleKey: 'workspaces.roles.curator.title',
  descriptionKey: 'workspaces.roles.curator.description',
  actions: ['fees.set', 'adapters.manage', 'orders.manage', 'data-policy.set']
}
```

The registry must contain these exact action groups:

```text
governor:
  governor.members.manage
  protocol.modules.pause
  psm.protocol.pause
  revenue.treasury.set

vault-owner:
  vault.roles.set
  vault.settlement.configure
  vault.modules.bind
  vault.adapters.configure
  vault.timelock.manage
  vault.owner.transfer

curator:
  vault.fees.set
  vault.adapters.manage
  vault.orders.manage
  vault.data-policy.set

guardian:
  vault.pause
  vault.order.cancel
  vault.allocator.freeze
  vault.timelock.cancel

allocator:
  vault.buy
  vault.sell
  vault.rebalance
  vault.deal.clear
  vault.bridge

settlement-operator:
  settlement.instruction.sign

keeper:
  lifecycle.open-subscription
  lifecycle.finalize-subscription
  lifecycle.start-calculation
  lifecycle.enter-final-settlement
  lifecycle.enter-maturing
  lifecycle.enter-claiming
  lifecycle.close-product
  request.mark-refundable
  claim.record

asset-owner:
  asset.register
  asset.metadata.update
  asset.owner.transfer
  asset.deactivate
  asset.roles.set
  mint.initiate
  burn.initiate

token-agent:
  mint.approve
  burn.approve

proof-publisher:
  proof.publish

wrapper-controller:
  wrapper.deploy
  wrapper.signer.set
  wrapper.asset.pause

nav-signer:
  nav.sign

adapter-data-provider:
  adapter.deal-data.update

psm-authorized-signer:
  psm.authorization.sign

relayer:
  settlement.batch.submit
  nav.update.submit
  psm.authorization.submit
  vault.timelock.execute
```

- [ ] **Step 4: Define form schemas**

Each write action references a schema with explicit fields, parser and validation. For example:

```js
export const FORM_SCHEMAS = {
  'mint.initiate': {
    fields: [
      { name: 'assetId', type: 'bigint', required: true },
      { name: 'amount', type: 'amount', decimals: 18, required: true },
      { name: 'to', type: 'address', required: true },
      { name: 'issuerSig', type: 'bytes', required: true },
    ],
  },
  'settlement.batch.submit': {
    fields: [
      { name: 'instruction', type: 'json', required: true },
      { name: 'signatures', type: 'bytes-array', required: true },
    ],
  },
};
```

Define schemas for every current executable action. Target-only actions may have display fields, but still require an explicit schema id so the disabled panel can explain the future interface.

- [ ] **Step 5: Add Chinese and English workspace strings**

Add translations for:

- all 15 roles
- all action titles and descriptions
- all capability states
- form labels and validation messages
- Legacy Compatible and Target badges
- transaction lifecycle messages

Do not modify existing marketing copy keys.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/config/roleDefinitions.test.js
npm run typecheck
```

Commit:

```powershell
git add src/workspaces/config/roleDefinitions.js src/workspaces/config/roleDefinitions.test.js src/workspaces/config/formSchemas.js src/i18n/zh-CN.js src/i18n/en.js
git commit -m "feat: define complete role action registry"
```

---

### Task 5: Implement Capability Resolution and SDK Adapters

**Files:**

- Create: `src/workspaces/sdk/currentAdapter.js`
- Create: `src/workspaces/sdk/targetAdapter.js`
- Create: `src/workspaces/core/capabilityResolver.js`
- Create: `src/workspaces/core/objectContext.js`
- Test: `src/workspaces/core/capabilityResolver.test.js`
- Test: `src/workspaces/sdk/currentAdapter.test.js`

**Interfaces:**

- Produces:
  `resolveCapability(context, action)`,
  `createCurrentAdapter({ readSdk, writeSdk })`,
  `createTargetAdapter()`.
- Consumes:
  deployment profile,
  wallet address,
  object context,
  role/action registry,
  current SDK.

- [ ] **Step 1: Write failing precedence tests**

```js
import { describe, expect, it } from 'vitest';
import { resolveCapability } from './capabilityResolver';

const action = {
  id: 'vault.fees.set',
  scope: 'vault',
  support: { legacy: 'setVaultFees', target: 'setVaultFees' },
};

describe('resolveCapability', () => {
  it('requires wallet before checking authorization', async () => {
    const result = await resolveCapability({
      wallet: null,
      deployment: { chainId: 97, profile: 'legacy' },
      chainId: 97,
      object: { vault: '0x0000000000000000000000000000000000000001' },
      adapter: {},
    }, action);
    expect(result.state).toBe('walletRequired');
  });

  it('returns targetOnly before attempting a missing method', async () => {
    const result = await resolveCapability({
      wallet: '0x0000000000000000000000000000000000000002',
      deployment: { chainId: 97, profile: 'legacy' },
      chainId: 97,
      object: { vault: '0x0000000000000000000000000000000000000001' },
      adapter: { supports: () => false },
    }, { ...action, support: { legacy: null, target: 'setVaultFees' } });
    expect(result.state).toBe('targetOnly');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/core/capabilityResolver.test.js`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement resolver precedence**

Resolve in this exact order:

```text
walletRequired
wrongNetwork
unsupportedDeployment
objectRequired
targetOnly
paused
invalidState
unauthorized
available
```

Return:

```js
{
  state: 'targetOnly',
  reasonKey: 'workspaces.capabilities.targetOnly',
  detail: {
    actionId: 'vault.roles.set',
    requiredMethod: 'setCurator',
    requiredModule: 'Vault local roles'
  }
}
```

- [ ] **Step 4: Implement the current adapter**

The adapter exposes semantic methods and delegates only to current SDK methods:

```js
export function createCurrentAdapter({ readSdk, writeSdk }) {
  const methods = {
    'lifecycle.open-subscription': input =>
      writeSdk.openSubscription(input.vault, input.signer),
    'lifecycle.finalize-subscription': input =>
      writeSdk.finalizeSubscription(input.vault, input.signer),
    'lifecycle.start-calculation': input =>
      writeSdk.startCycleCalculation(input.vault, input.signer),
    'lifecycle.enter-final-settlement': input =>
      writeSdk.enterFinalSettlement(input.vault, input.signer),
    'lifecycle.enter-maturing': input =>
      writeSdk.enterMaturing(input.vault, input.signer),
    'lifecycle.enter-claiming': input =>
      writeSdk.enterClaiming(input.vault, input.signer),
    'lifecycle.close-product': input =>
      writeSdk.closeProduct(input.vault, input.signer),
    'mint.initiate': input =>
      writeSdk.initiateMint(input.assetId, input.amount, input.to, input.issuerSig, input.signer),
    'burn.initiate': input =>
      writeSdk.initiateBurn(input.assetId, input.amount, input.from, input.issuerSig, input.signer),
    'mint.approve': input =>
      writeSdk.approveMint(input.nonce, input.tokenAgentSig, input.signer),
    'burn.approve': input =>
      writeSdk.approveBurn(input.nonce, input.tokenAgentSig, input.signer),
    'settlement.batch.submit': input =>
      writeSdk.submitBatch(input.instruction, input.signatures, input.signer),
    'nav.update.submit': input =>
      writeSdk.updateNAV(input.vault, input.nav, input.dataTimestamp, input.sig, input.signer),
    'wrapper.deploy': input =>
      writeSdk.deployWrappedToken(
        input.assetId,
        input.mode,
        input.underlyingToken,
        input.name,
        input.symbol,
        input.decimals,
        input.allowPartialUnwrap,
        input.signer,
      ),
    'psm.authorization.submit': input =>
      writeSdk.mintWithAuthorization(
        input.assetId,
        input.amount,
        input.to,
        input.nonce,
        input.expiry,
        input.signature,
        input.documentId,
        input.signer,
      ),
  };

  return {
    supports: actionId => typeof methods[actionId] === 'function',
    execute: (actionId, input) => methods[actionId](input),
    readSdk,
  };
}
```

Also map current public `wrap`, `unwrap`, deposit/redeem request, claim, cancel and refund methods in the same explicit table.

For current methods exposed through the SDK's `getContract` escape hatch, use these exact ABI mappings:

```text
governor.members.manage       HyperAccessControl.grantRole/revokeRole
protocol.modules.pause       StateManager.pauseModule/unpauseModule
psm.protocol.pause           ReservePSM.pause/unpause
vault.fees.set               BaseVault.setPerformanceFeeBps/setPerformanceFeeRecipient
vault.orders.manage          BaseAdapter.createBuyOrder/createSellOrder/createRebalanceOrder
vault.data-policy.set        BaseAdapter.setStalenessWindow
vault.pause                  StateManager.pause
vault.order.cancel           BaseAdapter.cancelBuyOrder/cancelSellOrder/cancelRebalanceOrder
vault.allocator.freeze       BaseAdapter.freezeAllocator/unfreezeAllocator
vault.buy                    BaseAdapter.executeBuy
vault.sell                   BaseAdapter.executeSell
vault.rebalance              BaseAdapter.executeRebalance
vault.deal.clear             BaseAdapter.clearDealValue
vault.bridge                 LiquidityAdapter.bridgeToCash
request.mark-refundable      BaseVault.markRefundable
claim.record                 ClaimRegistry.recordClaim
asset.register               AssetRegistry.registerAsset
asset.metadata.update        AssetRegistry.updateMetadataHash
asset.owner.transfer         AssetRegistry.transferAssetOwnership
asset.deactivate             AssetRegistry.deactivateAsset
proof.publish                PoRRegistry.publishReserveProof
wrapper.signer.set           ReservePSM.setAuthorizedSigner
wrapper.asset.pause          ReservePSM.pauseAsset/unpauseAsset
adapter.deal-data.update     BaseAdapter.updateDealData
```

Before enabling these mappings, the capability resolver checks the current global role or object owner expected by the legacy contract. The UI labels the result `Legacy Compatible`; it never describes the legacy global role as target-local authorization.

- [ ] **Step 5: Implement the target adapter as fail-closed**

```js
export function createTargetAdapter() {
  return {
    supports: () => false,
    async execute(actionId) {
      throw new Error(`Target SDK method unavailable for ${actionId}`);
    },
  };
}
```

This adapter remains intentionally unavailable until real target ABI and SDK methods exist.

- [ ] **Step 6: Test current-method mapping**

Use mocked SDK methods and assert exact argument order for lifecycle, mint, burn, Settlement, NAV, Wrapper, PSM and queue operations. Assert unsupported actions never call a mock.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/core/capabilityResolver.test.js src/workspaces/sdk/currentAdapter.test.js
npm run typecheck
```

Commit:

```powershell
git add src/workspaces/sdk src/workspaces/core/capabilityResolver.js src/workspaces/core/capabilityResolver.test.js src/workspaces/core/objectContext.js
git commit -m "feat: add capability and sdk adapter layers"
```

---

### Task 6: Build Transaction Safety, Validation, and Signing

**Files:**

- Create: `src/workspaces/core/validators.js`
- Create: `src/workspaces/core/signaturePayloads.js`
- Create: `src/workspaces/core/contractErrors.js`
- Create: `src/workspaces/core/actionExecutors.js`
- Create: `src/workspaces/core/transactionStore.jsx`
- Test: `src/workspaces/core/validators.test.js`
- Test: `src/workspaces/core/signaturePayloads.test.js`
- Test: `src/workspaces/core/actionExecutors.test.js`

**Interfaces:**

- Produces:
  `validateActionInput`,
  `buildLegacyNavDigest`,
  `buildLegacyPsmDigest`,
  `buildSettlementDigest`,
  `buildTargetTypedData`,
  `executeAction`,
  `TransactionProvider`,
  `useTransactions`.
- Consumes: form schemas, capability resolver, adapters and wallet signer.

- [ ] **Step 1: Write failing validation tests**

Cover:

- invalid checksum or short address
- negative amount
- decimals overflow
- deadline in the past
- nonce not bytes32 when required
- malformed JSON instruction
- empty signature array
- cross-chain signature payload

Example:

```js
expect(() => validateActionInput('mint.initiate', {
  assetId: '1',
  amount: '-1',
  to: '0x123',
  issuerSig: '0x',
})).toThrow('invalidAddress');
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
npm test -- src/workspaces/core/validators.test.js src/workspaces/core/signaturePayloads.test.js
```

Expected: FAIL because validators and signature-payload builders do not exist.

- [ ] **Step 3: Implement validators**

Use ethers `getAddress`, `parseUnits`, `isHexString` and `toBigInt`. Return normalized values rather than raw strings. Every validation error contains a stable `code` and optional `field`.

- [ ] **Step 4: Implement exact legacy signature payloads**

The current contracts use EIP-191 `signMessage`, not EIP-712.

NAV digest:

```js
export function buildLegacyNavDigest({ vault, nav, dataTimestamp }) {
  return solidityPackedKeccak256(
    ['address', 'uint256', 'uint256'],
    [vault, nav, dataTimestamp],
  );
}
```

PSM digest:

```js
export function buildLegacyPsmDigest({
  assetId,
  amount,
  to,
  nonce,
  expiry,
  reservePsm,
  chainId,
}) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'address', 'uint256', 'uint256', 'address', 'uint256'],
    [assetId, amount, to, nonce, expiry, reservePsm, chainId],
  ));
}
```

Settlement uses `sdk.hashInstruction(instruction)`. All three digests are signed with:

```js
const signature = await signer.signMessage(getBytes(digest));
```

Tests use ethers `verifyMessage(getBytes(digest), signature)` with a fixed test wallet and assert the recovered signer. `buildTargetTypedData` returns an unsupported result until the target adapter supplies an exact EIP-712 domain and type definition.

- [ ] **Step 5: Implement executeAction**

Execution order:

```js
export async function executeAction({
  action,
  rawInput,
  capabilityContext,
  adapter,
  signer,
  transactions,
}) {
  const capability = await resolveCapability(capabilityContext, action);
  if (capability.state !== 'available') {
    throw Object.assign(new Error(capability.reasonKey), { capability });
  }
  const input = validateActionInput(action.id, rawInput);
  const pendingId = transactions.prepare(action.id, input);
  try {
    const result = await adapter.execute(action.id, { ...input, signer });
    const tx = result?.wait ? result : null;
    transactions.submitted(pendingId, tx?.hash ?? null);
    const receipt = tx ? await tx.wait() : result;
    transactions.confirmed(pendingId, receipt);
    return receipt;
  } catch (error) {
    transactions.failed(pendingId, mapContractError(error));
    throw error;
  }
}
```

Offline-sign actions use a separate `executeSignatureAction` and are marked `signed`, never `confirmed`.

- [ ] **Step 6: Implement transaction store**

State transitions:

```text
prepared -> awaitingWallet -> submitted -> confirmed
prepared -> awaitingWallet -> rejected
submitted -> failed
prepared -> signed
```

Store only sanitized summaries in `sessionStorage`; do not persist full signatures.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/core
npm run typecheck
```

Commit:

```powershell
git add src/workspaces/core
git commit -m "feat: add safe transaction and signing pipeline"
```

---

### Task 7: Build the Workspace Shell and All Routes

**Files:**

- Create: `src/workspaces/WorkspaceLayout.jsx`
- Create: `src/workspaces/components/WorkspaceSidebar.jsx`
- Create: `src/workspaces/components/ContextBar.jsx`
- Create: `src/workspaces/components/ObjectSelector.jsx`
- Create: `src/workspaces/components/CapabilityBanner.jsx`
- Create: `src/workspaces/pages/WorkspaceIndexPage.jsx`
- Create: `src/workspaces/pages/WorkspaceNotFoundPage.jsx`
- Create: `src/styles/workspaces.css`
- Modify: `src/App.jsx`
- Modify: `src/main.jsx`
- Modify: `src/components/Header.jsx`
- Test: `src/workspaces/WorkspaceLayout.test.jsx`
- Test: `src/workspaces/workspaceRoutes.test.jsx`

**Interfaces:**

- Produces: nested workspace router, common layout and role/object navigation.
- Consumes: role registry, wallet context, deployment profile and translations.

- [ ] **Step 1: Write failing route tests**

Assert that:

- `/workspaces` renders the selector.
- every role path resolves to the correct role title.
- vault routes require a vault parameter.
- asset routes require an assetId.
- unknown role routes render WorkspaceNotFoundPage.
- public marketing routes still render unchanged.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/workspaceRoutes.test.jsx`

Expected: FAIL because the workspace routes do not exist.

- [ ] **Step 3: Implement nested routes**

Add:

```jsx
<Route path="/workspaces" element={<WorkspaceLayout />}>
  <Route index element={<WorkspaceIndexPage />} />
  <Route path="activity" element={<ActivityPage />} />
  <Route path="public" element={<PublicWorkspacePage />} />
  <Route path="governor" element={<RoleWorkspacePage roleId="governor" />} />
  <Route path="vault-owner/:vault" element={<RoleWorkspacePage roleId="vault-owner" />} />
  <Route path="curator/:vault" element={<RoleWorkspacePage roleId="curator" />} />
  <Route path="guardian/:vault" element={<RoleWorkspacePage roleId="guardian" />} />
  <Route path="allocator/:vault" element={<RoleWorkspacePage roleId="allocator" />} />
  <Route path="settlement-operator/:vault" element={<RoleWorkspacePage roleId="settlement-operator" />} />
  <Route path="keeper/:vault" element={<RoleWorkspacePage roleId="keeper" />} />
  <Route path="asset-owner/:assetId" element={<RoleWorkspacePage roleId="asset-owner" />} />
  <Route path="token-agent/:assetId" element={<RoleWorkspacePage roleId="token-agent" />} />
  <Route path="proof-publisher/:assetId" element={<RoleWorkspacePage roleId="proof-publisher" />} />
  <Route path="wrapper-controller/:assetId" element={<RoleWorkspacePage roleId="wrapper-controller" />} />
  <Route path="nav-signer/:vault" element={<RoleWorkspacePage roleId="nav-signer" />} />
  <Route path="adapter-data-provider/:adapter" element={<RoleWorkspacePage roleId="adapter-data-provider" />} />
  <Route path="psm-authorized-signer/:assetId" element={<RoleWorkspacePage roleId="psm-authorized-signer" />} />
  <Route path="relayer" element={<RoleWorkspacePage roleId="relayer" />} />
  <Route path="*" element={<WorkspaceNotFoundPage />} />
</Route>
```

- [ ] **Step 4: Implement the workspace shell**

`WorkspaceLayout` uses its own dense sidebar and context header while retaining the site Header. The marketing Footer is hidden inside `/workspaces` because it competes with the persistent product navigation.

`ContextBar` shows:

- connected address
- wallet name
- chain name
- deployment profile
- selected object
- network-switch action

- [ ] **Step 5: Apply the product design system**

Import `@radix-ui/themes/styles.css` once in `main.jsx`.
Scope Radix theme and all workspace styles under `.ht-workspaces`.

Add workspace tokens derived from existing variables:

```css
.ht-workspaces {
  --ws-sidebar: 16rem;
  --ws-panel: var(--surface);
  --ws-border: var(--line);
  --ws-accent: var(--navy-2);
  --ws-warning: var(--gold-deep);
  min-height: calc(100dvh - var(--hdr-h));
  background: var(--canvas);
  color: var(--ink);
}
```

Desktop uses persistent sidebar; below 960px it becomes an accessible drawer. Respect `prefers-reduced-motion`.

- [ ] **Step 6: Add the workspace navigation entry**

Add one Header link for “工作台 / Workspaces”. Do not rename existing nav labels or routes.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/WorkspaceLayout.test.jsx src/workspaces/workspaceRoutes.test.jsx
npm run build
```

Commit:

```powershell
git add src/App.jsx src/main.jsx src/components/Header.jsx src/workspaces/WorkspaceLayout.jsx src/workspaces/components src/workspaces/pages/WorkspaceIndexPage.jsx src/workspaces/pages/WorkspaceNotFoundPage.jsx src/styles/workspaces.css
git commit -m "feat: add role workspace shell and routes"
```

---

### Task 8: Build Reusable Data, Action, and Transaction UI

**Files:**

- Create: `src/workspaces/components/DataField.jsx`
- Create: `src/workspaces/components/StatGrid.jsx`
- Create: `src/workspaces/components/ActionForm.jsx`
- Create: `src/workspaces/components/ActionPanel.jsx`
- Create: `src/workspaces/components/TransactionDrawer.jsx`
- Create: `src/workspaces/pages/ActivityPage.jsx`
- Test: `src/workspaces/components/ActionPanel.test.jsx`
- Test: `src/workspaces/components/TransactionDrawer.test.jsx`

**Interfaces:**

- Produces:
  schema-driven action forms,
  capability-aware action panels,
  transaction progress UI,
  activity page.
- Consumes:
  form schemas,
  capability result,
  executeAction,
  transaction store.

- [ ] **Step 1: Write failing ActionPanel tests**

Assert:

- `available` renders an enabled submit button.
- `targetOnly` disables submit and names required method/module.
- `unauthorized` disables submit and shows the connected address.
- `wrongNetwork` renders the network switch button.
- disabled panels never call `executeAction`.
- dangerous actions require the user to type the final four characters of the target address.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/components/ActionPanel.test.jsx`

Expected: FAIL because ActionPanel does not exist.

- [ ] **Step 3: Implement schema-driven fields**

Support:

```text
address
amount
bigint
integer
text
bytes
bytes32
bytes-array
datetime
json
select
boolean
```

Every input has a visible label, description, error relation through `aria-describedby`, and error focus after failed submission.

- [ ] **Step 4: Implement ActionPanel**

Render:

- action title and description
- Legacy/Target support badge
- capability banner
- current on-chain context
- schema fields
- preview summary
- submit or sign button

Call only the injected `onExecute(actionId, rawInput)` callback.

- [ ] **Step 5: Implement transaction drawer and activity**

The drawer lists prepared, awaiting wallet, submitted, confirmed, signed, rejected and failed states. Explorer links are derived from deployment config, never hardcoded inside components.

- [ ] **Step 6: Verify accessibility and commit**

Run:

```powershell
npm test -- src/workspaces/components
npm run typecheck
```

Commit:

```powershell
git add src/workspaces/components src/workspaces/pages/ActivityPage.jsx
git commit -m "feat: add capability-aware workspace actions"
```

---

### Task 9: Implement Protocol and Vault-Scoped Workspaces

**Files:**

- Create: `src/workspaces/pages/RoleWorkspacePage.jsx`
- Create: `src/workspaces/core/workspaceQueries.js`
- Test: `src/workspaces/pages/RoleWorkspacePage.test.jsx`
- Test: `src/workspaces/core/workspaceQueries.test.js`

**Interfaces:**

- Produces: Governor, Vault Owner, Curator, Guardian, Allocator, Settlement Operator and Keeper workspaces.
- Consumes: common workspace shell, current adapter, capability resolver, action registry and SDK read methods.

- [ ] **Step 1: Write failing workspace rendering tests**

For each protocol/Vault role, assert:

- correct title and object scope
- correct action ids
- legacy-supported actions are not mislabeled as target-native
- target-only actions name the missing target module
- Keeper only enables state transitions valid for mocked `ProductState`
- Settlement Operator signs but does not submit batches

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/pages/RoleWorkspacePage.test.jsx`

Expected: FAIL because RoleWorkspacePage does not exist.

- [ ] **Step 3: Implement common chain queries**

Provide:

```js
loadVaultOverview({ sdk, vault })
loadSettlementOverview({ sdk, account })
loadRoleOverview({ sdk, account, roleIds })
loadPoolOverview({ sdk, vault })
```

Each returns `{ status, data, error, refreshedAt }`. Abort stale requests when the account, network or object changes.

- [ ] **Step 4: Implement Governor workspace**

Display current global roles and protocol module status. Current actions only enable when the current SDK/ABI has an explicit adapter method; the target boundary statement remains visible.

- [ ] **Step 5: Implement all six Vault-local workspaces**

Render these exact action sets from the registry:

- Vault Owner: local roles, Settlement config, module binding, AdapterRegistry, VaultTimelock, owner transfer.
- Curator: fees, adapters, orders, data policy.
- Guardian: pause, cancel order, freeze Allocator, cancel Timelock.
- Allocator: buy, sell, rebalance, clear deal, bridge.
- Settlement Operator: digest preview and offline signing.
- Keeper: seven lifecycle transitions, refundable and claim maintenance.

On legacy profile, Vault Owner and target-local actions stay disabled. Keeper lifecycle methods use the current SDK when authorized by the legacy role model.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/pages/RoleWorkspacePage.test.jsx src/workspaces/core/workspaceQueries.test.js
npm run build
```

Commit:

```powershell
git add src/workspaces/pages/RoleWorkspacePage.jsx src/workspaces/core/workspaceQueries.js src/workspaces/pages/RoleWorkspacePage.test.jsx src/workspaces/core/workspaceQueries.test.js
git commit -m "feat: add protocol and vault role workspaces"
```

---

### Task 10: Implement Asset, Wrapper, Signer, and Relayer Workspaces

**Files:**

- Modify: `src/workspaces/pages/RoleWorkspacePage.jsx`
- Create: `src/workspaces/core/signatureExchange.js`
- Test: `src/workspaces/pages/assetWorkspaces.test.jsx`
- Test: `src/workspaces/pages/signerWorkspaces.test.jsx`
- Test: `src/workspaces/core/signatureExchange.test.js`

**Interfaces:**

- Produces:
  Asset Owner,
  Token Agent,
  Proof Publisher,
  Wrapper Controller,
  NAV Signer,
  Adapter Data Provider,
  PSM Authorized Signer,
  Relayer workspaces,
  sanitized signature import/export.
- Consumes: current AssetRegistry, MintBurnController, ReservePSM, Wrapper, NAV and Settlement SDK methods.

- [ ] **Step 1: Write failing Asset workspace tests**

Assert:

- Asset Owner shows asset metadata and mint/burn initiation.
- Token Agent shows approval actions but no initiation action.
- Proof Publisher does not guess an unsupported write method.
- Wrapper Controller enables current deploy only when the current adapter supports it.
- every asset route rejects a non-integer or negative assetId before an RPC call.

- [ ] **Step 2: Write failing signer/Relayer tests**

Assert:

- NAV Signer signs and exports but never submits `updateNAV`.
- PSM Signer signs and exports but never calls `mintWithAuthorization`.
- Settlement Operator exports a batch signature.
- Relayer imports signatures and submits the matching current SDK method.
- exported data contains chainId, verifying contract, object id, nonce and deadline.
- expired and wrong-chain imports are rejected.

- [ ] **Step 3: Run and verify failures**

Run:

```powershell
npm test -- src/workspaces/pages/assetWorkspaces.test.jsx src/workspaces/pages/signerWorkspaces.test.jsx
```

- [ ] **Step 4: Implement Asset and Wrapper workspaces**

Use `getAssetInfo(assetId)`, `wrappedTokenOf(assetId)` and current Mint/Burn/Wrapper methods. Show owner and active status. Local Token Agent, Proof Publisher and Wrapper Controller configuration remains target-only until the target ABI exists.

- [ ] **Step 5: Implement signature exchange**

Export:

```js
{
  version: 1,
  kind: 'nav' | 'psm' | 'settlement',
  chainId: 97,
  verifyingContract: '0x...',
  scope: { vault: '0x...' } | { assetId: '1' },
  payload: {},
  signature: '0x...',
  signer: '0x...',
  createdAt: '2026-07-31T00:00:00.000Z'
}
```

Before import, recover the signer and validate chain, contract, object, nonce and deadline. Keep the full signature in memory; download/export only after an explicit user click.

- [ ] **Step 6: Implement functional identities and Relayer**

- Legacy NAV Signer calls `signMessage(getBytes(buildLegacyNavDigest(...)))` only; Target mode uses `signTypedData` only after the target adapter supplies the exact domain and types.
- Adapter Data Provider enables a write only if an exact current or target adapter method exists.
- Legacy PSM Authorized Signer calls `signMessage(getBytes(buildLegacyPsmDigest(...)))` only; Target mode uses `signTypedData` only after the target adapter supplies the exact domain and types.
- Relayer calls `submitBatch`, `updateNAV`, `mintWithAuthorization` or target Timelock execute after import validation.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/pages/assetWorkspaces.test.jsx src/workspaces/pages/signerWorkspaces.test.jsx src/workspaces/core/signatureExchange.test.js
npm run typecheck
npm run build
```

Commit:

```powershell
git add src/workspaces/pages/RoleWorkspacePage.jsx src/workspaces/pages/assetWorkspaces.test.jsx src/workspaces/pages/signerWorkspaces.test.jsx src/workspaces/core/signatureExchange.js src/workspaces/core/signatureExchange.test.js
git commit -m "feat: add asset signer and relayer workspaces"
```

---

### Task 11: Implement the Permissionless Public Workspace

**Files:**

- Create: `src/workspaces/pages/PublicWorkspacePage.jsx`
- Test: `src/workspaces/pages/PublicWorkspacePage.test.jsx`
- Modify: `src/workspaces/config/formSchemas.js`
- Modify: `src/workspaces/sdk/currentAdapter.js`

**Interfaces:**

- Produces: public Vault/Asset/Wrapper creation status, deposits, redemptions, claims, refunds, wrap and unwrap.
- Consumes: permissionless current SDK methods and target-only creation definitions.

- [ ] **Step 1: Write failing public-workspace tests**

Assert:

- Asset Creator, Vault Creator and Wrapper Creator appear as public functions, not roles.
- current wrap/unwrap and queue methods call the current adapter.
- target-only Vault creation is disabled if the current adapter has no safe method.
- regular user request, claim, cancel and refund forms validate tranche and request id.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- src/workspaces/pages/PublicWorkspacePage.test.jsx`

- [ ] **Step 3: Implement public actions**

Expose current SDK methods:

```text
requestDeposit
claimDeposit
requestRedeem
claimRedeem
cancelRequest
claimRefund
wrap
unwrap
deployWrappedToken
```

Asset and Vault creation only become available when an explicit safe adapter mapping exists. Do not infer a factory signature from the ABI name.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- src/workspaces/pages/PublicWorkspacePage.test.jsx
npm run build
```

Commit:

```powershell
git add src/workspaces/pages/PublicWorkspacePage.jsx src/workspaces/pages/PublicWorkspacePage.test.jsx src/workspaces/config/formSchemas.js src/workspaces/sdk/currentAdapter.js
git commit -m "feat: add public protocol workspace"
```

---

### Task 12: Integration, Accessibility, and Final Verification

**Files:**

- Create: `src/workspaces/workspaces.integration.test.jsx`
- Modify: workspace files found by failed tests only
- Modify: `docs/superpowers/specs/2026-07-31-role-workspaces-sdk-design.md` only if implementation reveals a factual correction
- Create: `docs/workspaces-operations.md`

**Interfaces:**

- Produces: verified end-to-end local delivery and operator documentation.
- Consumes: all previous tasks.

- [ ] **Step 1: Write the integration test**

Using a deterministic EIP-1193 provider double:

1. open `/workspaces`
2. connect account
3. detect chain 97 legacy profile
4. open Keeper workspace
5. select a Vault
6. resolve a valid lifecycle action
7. submit through the adapter
8. render submitted and confirmed states
9. open Vault Owner action
10. assert target-only and zero `eth_sendTransaction` calls

- [ ] **Step 2: Run the full suite and record failures**

Run:

```powershell
npm run test
npm run typecheck
npm run build
```

Expected: all commands pass. Fix only issues tied to the workspace implementation.

- [ ] **Step 3: Run manual browser smoke tests**

Check at 1440px, 1024px, 768px and 390px:

- Header and workspace navigation
- sidebar/drawer
- all 15 role routes
- public workspace
- disconnected wallet
- wrong network
- chain 97 legacy profile
- unauthorized wallet
- target-only action
- wallet rejection
- submitted transaction
- signed payload export/import
- keyboard-only navigation
- reduced motion

- [ ] **Step 4: Verify role and action coverage mechanically**

Run:

```powershell
rg -n \"governor|vault-owner|curator|guardian|allocator|settlement-operator|keeper|asset-owner|token-agent|proof-publisher|wrapper-controller|nav-signer|adapter-data-provider|psm-authorized-signer|relayer\" src/workspaces/config/roleDefinitions.js
rg -n \"targetOnly|supports\\(|execute\\(\" src/workspaces
git diff --check
```

Expected:

- all 15 role ids are present
- all actions pass through adapter/capability code
- no whitespace errors

- [ ] **Step 5: Write operator documentation**

`docs/workspaces-operations.md` must explain:

- how to open `/workspaces`
- supported chain 97 deployment
- Legacy Compatible versus Target
- wallet and network requirements
- how signatures move from signer workspaces to Relayer
- why target-only buttons are disabled
- how to update deployment addresses and upstream SDK provenance
- that no private key should be pasted into the frontend

- [ ] **Step 6: Run final verification and inspect Git scope**

Run:

```powershell
npm run verify
git status --short
git diff --name-only HEAD
```

Confirm the user's pre-existing `src/components/home.jsx`, `src/pages/Home.jsx`,
`src/styles/landing.css` and Logo changes were not overwritten or accidentally staged.

- [ ] **Step 7: Commit the verified delivery**

```powershell
git add src/workspaces docs/workspaces-operations.md
git commit -m "test: verify role workspace delivery"
```

Do not push.
