# HyperTessera Full HTML Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one self-contained HTML file that demonstrates HyperTessera public pages, Web3-style workspaces, mock wallet/network behavior, password-protected internal Vault review pages, and the full mock review-to-Products-listing loop.

**Architecture:** The deliverable is a single HTML file with embedded CSS, embedded mock data, a hash router, a versioned localStorage state store, and event-delegated interactions. A Vitest file loads the HTML into jsdom and tests the exposed `window.HyperTesseraDemo` API; no production React routes, SDK adapters, or existing user changes are modified.

**Tech Stack:** HTML5, embedded CSS, vanilla JavaScript, localStorage, hash routing, Vitest 4, jsdom 29.

## Global Constraints

- Create the demo at `demo/hypertessera-full-demo.html`; the user-facing deliverable remains one HTML file with no build step.
- Create tests at `src/demo/hypertesseraFullDemo.test.js`; tests are not part of the user-facing deliverable.
- Do not modify the existing React pages, workspaces, SDK adapters, package dependencies, or dirty generated files.
- Public/Web3 pages use mock network and wallet state; they never request a real wallet signature or send a transaction.
- Internal review pages use username/password state; they never show Connect Wallet, Governor, Gas Fee, or smart-contract approval copy.
- Demo credentials are exactly `reviewer@hypertessera.demo` and `Demo2026!`.
- Vault review state is off-chain demo state only and controls Products visibility only.
- Products may render a Vault only when its `listingStatus` is exactly `listed`.
- Persist state under localStorage key `hypertessera_full_demo_v1` and recover safely from invalid or old data.
- Reuse the existing site's dark navigation, blue brand color, white panels, typography scale, Chinese product language, and real-looking content.
- All interactive controls must work by keyboard, carry visible labels, and communicate state with text as well as color.
- Desktop is the primary demo viewport; tablet and mobile must remain usable without horizontal page overflow.

---

## File Structure

### Create

- `demo/hypertessera-full-demo.html`
  - One complete demo document.
  - Contains semantic page templates, CSS, initial mock data, router, store, rendering functions, auth, review actions, and reset behavior.
  - Exposes a stable `window.HyperTesseraDemo` API for tests.
- `src/demo/hypertesseraFullDemo.test.js`
  - Loads the demo HTML into jsdom.
  - Tests route guards, mock login, persistence, review state changes, Products visibility, logout, and reset.

### Do Not Modify

- `src/App.jsx`
- `src/workspaces/**`
- `src/integrations/**`
- `src/styles/**`
- `package.json`
- `package-lock.json`
- `dist/**`
- `node_modules/**`

### Route Acceptance Matrix

| Hash route | Page | Implemented in |
| --- | --- | --- |
| `#/home` | Homepage | Task 1–2 |
| `#/products` | Products Vault list | Task 2 |
| `#/products/vault/:vaultId` | Vault product detail | Task 2 |
| `#/access` | My Access | Task 2 |
| `#/issuance` | Asset issuance overview | Task 2 |
| `#/vaults` | Vault management overview | Task 2 |
| `#/workspace/vault/:role` | Shared Vault role workspace | Task 2 |
| `#/workspace/asset/:role` | Shared asset role workspace | Task 2 |
| `#/vault-listing/:vaultId` | Vault listing application | Task 2 and Task 4 |
| `#/ops/login` | Mock Ops login | Task 3 |
| `#/ops/dashboard` | Ops dashboard | Task 3 |
| `#/ops/reviews` | Review queue | Task 3–4 |
| `#/ops/review/:applicationId` | Review detail | Task 3–4 |
| `#/ops/listings` | Listed Vault management | Task 3–4 |
| `#/ops/history` | Review history | Task 3–4 |

---

### Task 1: Create the state engine, hash router, and test harness

**Files:**
- Create: `demo/hypertessera-full-demo.html`
- Create: `src/demo/hypertesseraFullDemo.test.js`

**Interfaces:**
- Produces: `window.HyperTesseraDemo` with `getState()`, `navigate(route)`, `authenticateOps(email, password)`, `logoutOps()`, `connectWallet()`, `disconnectWallet()`, `setNetwork(network)`, `submitListingApplication(vaultId, formData)`, `reviewApplication(id, decision, note)`, `setListingStatus(vaultId, status)`, `resetDemo()`, and `render()`.
- Produces: versioned persisted state under `hypertessera_full_demo_v1`.
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write a failing state and router test**

Create `src/demo/hypertesseraFullDemo.test.js` with a loader that extracts the demo script and evaluates it after installing the HTML body:

```js
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const currentDir = dirname(fileURLToPath(import.meta.url));
const demoPath = resolve(currentDir, '../../demo/hypertessera-full-demo.html');
const storageKey = 'hypertessera_full_demo_v1';
let activeDom;

function loadDemo(hash = '#/home', storedValue) {
  const html = readFileSync(demoPath, 'utf8');
  const scriptMatch = html.match(/<script id="demo-script">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('demo-script not found');
  const bodyMatch = html.match(/<body>([\s\S]*?)<script id="demo-script">/);
  if (!bodyMatch) throw new Error('demo body not found');

  const previousValue = storedValue ?? activeDom?.window.localStorage.getItem(storageKey);
  activeDom?.window.close();
  activeDom = new JSDOM(`<!doctype html><html><body>${bodyMatch[1]}</body></html>`, {
    url: `http://localhost/${hash}`,
    runScripts: 'outside-only'
  });
  if (previousValue != null) activeDom.window.localStorage.setItem(storageKey, previousValue);
  activeDom.window.structuredClone = globalThis.structuredClone;
  activeDom.window.eval(scriptMatch[1]);
  globalThis.window = activeDom.window;
  globalThis.document = activeDom.window.document;
  return activeDom.window.HyperTesseraDemo;
}

beforeEach(() => {
  activeDom?.window.close();
  activeDom = undefined;
  delete globalThis.window;
  delete globalThis.document;
});

describe('HyperTessera demo state engine', () => {
  it('starts on the home route with disconnected mock wallet and unauthenticated ops session', () => {
    const demo = loadDemo();
    expect(demo.getState().wallet.connected).toBe(false);
    expect(demo.getState().opsSession.authenticated).toBe(false);
    expect(document.querySelector('[data-page="home"]').hidden).toBe(false);
  });

  it('guards internal routes and sends unauthenticated users to ops login', () => {
    loadDemo('#/ops/reviews');
    expect(window.location.hash).toBe('#/ops/login');
    expect(document.querySelector('[data-page="ops-login"]').hidden).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: FAIL because `demo/hypertessera-full-demo.html` and `demo-script` do not exist.

- [ ] **Step 3: Create the HTML shell and initial state**

Create `demo/hypertessera-full-demo.html` with:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HyperTessera Full Demo</title>
  <style>
    :root {
      --ink: #172033;
      --muted: #69758a;
      --line: #dce2ea;
      --surface: #ffffff;
      --soft: #f4f7fa;
      --nav: #111a2b;
      --brand: #2557d6;
      --brand-soft: #eaf0ff;
      --ops: #6941c6;
      --success: #15754a;
      --warning: #a35f00;
      --danger: #b42318;
    }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--soft); font-family: Inter, "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
  </style>
</head>
<body>
  <div id="demo-app">
    <div id="global-live-region" aria-live="polite" class="sr-only"></div>
    <main id="page-root">
      <section data-page="home"><h1>HyperTessera</h1></section>
      <section data-page="ops-login" hidden><h1>HyperTessera Ops</h1></section>
      <section data-page="not-found" hidden><h1>Page not found</h1></section>
    </main>
  </div>

  <script id="demo-script">
  (() => {
    'use strict';

    const STORAGE_KEY = 'hypertessera_full_demo_v1';
    const STATE_VERSION = 1;
    const OPS_EMAIL = 'reviewer@hypertessera.demo';
    const OPS_PASSWORD = 'Demo2026!';

    const initialState = () => ({
      version: STATE_VERSION,
      wallet: { connected: false, network: 'Ethereum', address: '0x71A4...92C8' },
      opsSession: { authenticated: false, reviewerName: 'Demo Reviewer' },
      vaults: [],
      assets: [],
      accessInventory: [],
      listingApplications: [],
      reviewHistory: []
    });

    function loadState() {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (!stored || stored.version !== STATE_VERSION) return initialState();
        return stored;
      } catch {
        return initialState();
      }
    }

    let state = loadState();

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function routeName() {
      return (window.location.hash || '#/home').slice(2).split('?')[0];
    }

    function isOpsRoute(route) {
      return route === 'ops' || route.startsWith('ops/');
    }

    function pageForRoute(route) {
      if (route === 'home') return 'home';
      if (route === 'ops/login') return 'ops-login';
      return 'not-found';
    }

    function render() {
      let route = routeName();
      if (isOpsRoute(route) && route !== 'ops/login' && !state.opsSession.authenticated) {
        window.location.hash = '#/ops/login';
        route = 'ops/login';
      }
      const activePage = pageForRoute(route);
      document.querySelectorAll('[data-page]').forEach((page) => {
        page.hidden = page.dataset.page !== activePage;
      });
    }

    function navigate(route) {
      window.location.hash = `#/${route.replace(/^#?\//, '')}`;
      render();
    }

    function authenticateOps(email, password) {
      const ok = email === OPS_EMAIL && password === OPS_PASSWORD;
      state.opsSession.authenticated = ok;
      saveState();
      return ok;
    }

    function logoutOps() {
      state.opsSession.authenticated = false;
      saveState();
      navigate('ops/login');
    }

    function connectWallet() { state.wallet.connected = true; saveState(); render(); }
    function disconnectWallet() { state.wallet.connected = false; saveState(); render(); }
    function setNetwork(network) { state.wallet.network = network; saveState(); render(); }
    function submitListingApplication() { return null; }
    function reviewApplication() { return false; }
    function setListingStatus() { return false; }
    function resetDemo() { state = initialState(); saveState(); navigate('home'); }
    function getState() { return structuredClone(state); }

    window.addEventListener('hashchange', render);
    window.HyperTesseraDemo = {
      getState, navigate, authenticateOps, logoutOps,
      connectWallet, disconnectWallet, setNetwork,
      submitListingApplication, reviewApplication, setListingStatus, resetDemo, render
    };
    render();
  })();
  </script>
</body>
</html>
```

- [ ] **Step 4: Run the state and router tests**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: both tests PASS.

- [ ] **Step 5: Commit the isolated shell**

```powershell
git add -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
git commit -m "feat: add standalone HyperTessera demo shell"
```

---

### Task 2: Build the public site, mock wallet, My Access, and workspace pages

**Files:**
- Modify: `demo/hypertessera-full-demo.html`
- Modify: `src/demo/hypertesseraFullDemo.test.js`

**Interfaces:**
- Consumes: Task 1 `state`, `navigate()`, `connectWallet()`, `disconnectWallet()`, `setNetwork()`, and `render()`.
- Produces: routes `home`, `products`, `products/vault/:vaultId`, `access`, `issuance`, `vaults`, `workspace/vault/:role`, `workspace/asset/:role`, and `vault-listing/:vaultId`.
- Produces: renderers `renderPublicHeader()`, `renderProducts()`, `renderMyAccess()`, `renderWorkspace()`, and `renderListingApplication()`.

- [ ] **Step 1: Add failing tests for wallet state, routing, and listed-only Products**

Append:

```js
describe('public and Web3 demo pages', () => {
  it('connects the mock wallet and changes network without a provider', () => {
    const demo = loadDemo('#/access');
    demo.connectWallet();
    demo.setNetwork('Base');
    expect(demo.getState().wallet).toMatchObject({ connected: true, network: 'Base' });
    expect(document.body.textContent).toContain('0x71A4...92C8');
  });

  it('filters My Access objects to the selected network', () => {
    const demo = loadDemo('#/access');
    demo.connectWallet();
    expect(document.body.textContent).toContain('Atlas Income Vault');
    demo.setNetwork('Base');
    expect(document.body.textContent).toContain('Liquidity Earn Vault');
    expect(document.body.textContent).not.toContain('Atlas Income Vault');
  });

  it('shows only listed vaults on Products', () => {
    loadDemo('#/products');
    expect(document.body.textContent).toContain('Atlas Income Vault');
    expect(document.body.textContent).not.toContain('Nova Credit Vault');
  });

  it('renders the requested vault workspace role in the shared workspace shell', () => {
    loadDemo('#/workspace/vault/curator');
    expect(document.body.textContent).toContain('Curator Workspace');
    expect(document.body.textContent).toContain('Atlas Income Vault');
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: FAIL because the mock objects, public routes, and renderers are not implemented.

- [ ] **Step 3: Add realistic initial mock data**

Replace the empty arrays in `initialState()` with exact records:

```js
vaults: [
  {
    id: 'atlas-income', name: 'Atlas Income Vault', network: 'Ethereum',
    address: '0xA81F...120E', type: 'Earn Vault', underlying: 'USDT',
    apy: '8.42%', tvl: '$12.8M', risk: 'Moderate', listingStatus: 'listed',
    roles: ['Vault Owner', 'Curator', 'Settlement Operator']
  },
  {
    id: 'nova-credit', name: 'Nova Credit Vault', network: 'Ethereum',
    address: '0xB672...41D9', type: 'Credit Vault', underlying: 'USDT',
    apy: '10.10%', tvl: '$4.3M', risk: 'Elevated', listingStatus: 'unlisted',
    roles: ['Vault Owner', 'Guardian']
  },
  {
    id: 'liquidity-earn', name: 'Liquidity Earn Vault', network: 'Base',
    address: '0xC44A...8F20', type: 'Liquidity Vault', underlying: 'USDC',
    apy: '6.95%', tvl: '$7.6M', risk: 'Moderate', listingStatus: 'listed',
    roles: ['Allocator', 'Keeper']
  }
],
assets: [
  { id: '1042', name: 'Orion Receivables 2026-A', symbol: 'OR26A', network: 'Ethereum', roles: ['Asset Owner / Issuer', 'Token Agent'] },
  { id: '2088', name: 'Harbor Warehouse Notes', symbol: 'HWN', network: 'Base', roles: ['Proof Publisher'] }
],
accessInventory: [
  { scope: 'vault', objectId: 'atlas-income', roles: ['Vault Owner', 'Curator', 'Guardian', 'Allocator', 'Settlement Operator', 'Keeper'] },
  { scope: 'vault', objectId: 'liquidity-earn', roles: ['Allocator', 'Keeper'] },
  { scope: 'asset', objectId: '1042', roles: ['Asset Owner / Issuer', 'Token Agent', 'Wrapper Controller', 'PSM Authorized Signer', 'Adapter Data Provider'] },
  { scope: 'asset', objectId: '2088', roles: ['Proof Publisher'] },
  { scope: 'identity', objectId: 'atlas-income', roles: ['NAV Signer'] }
],
```

- [ ] **Step 4: Add page sections and route mapping**

Add semantic sections for every produced route and update `pageForRoute()`:

```js
function pageForRoute(route) {
  if (route === 'home') return 'home';
  if (route === 'products') return 'products';
  if (route.startsWith('products/vault/')) return 'product-detail';
  if (route === 'access') return 'access';
  if (route === 'issuance') return 'issuance';
  if (route === 'vaults') return 'vaults';
  if (route.startsWith('workspace/vault/')) return 'vault-workspace';
  if (route.startsWith('workspace/asset/')) return 'asset-workspace';
  if (route.startsWith('vault-listing/')) return 'vault-listing';
  if (route === 'ops/login') return 'ops-login';
  return 'not-found';
}
```

Each page must include real Chinese copy and `data-nav` links. Add a shared Header with Products, 资产发行, Vault 管理, Resources, a network selector, wallet control, and My Access.

- [ ] **Step 5: Add the complete role catalog and implement the renderers**

Define one role catalog used by the role switcher and workspace shell so the Demo can demonstrate all architecture roles without duplicating pages:

```js
const ROLE_CATALOG = {
  vault: [
    ['vault-owner', 'Vault Owner'],
    ['curator', 'Curator'],
    ['guardian', 'Guardian'],
    ['allocator', 'Allocator'],
    ['settlement-operator', 'Settlement Operator'],
    ['keeper', 'Keeper']
  ],
  asset: [
    ['asset-owner', 'Asset Owner / Issuer'],
    ['token-agent', 'Token Agent'],
    ['proof-publisher', 'Proof Publisher'],
    ['wrapper-controller', 'Wrapper Controller'],
    ['nav-signer', 'NAV Signer'],
    ['adapter-data-provider', 'Adapter Data Provider'],
    ['psm-authorized-signer', 'PSM Authorized Signer']
  ]
};
```

The role switcher must contain all 13 workspace roles above. Selecting one updates the hash route and shared workspace content. The page copy must explicitly describe Proof Publisher as the role that publishes Proof of Reserve data; do not label it as “replayer”.

Use listed-only filtering and route-derived roles:

```js
function renderProducts() {
  const list = state.vaults.filter((vault) => vault.listingStatus === 'listed');
  document.querySelector('[data-products-grid]').innerHTML = list.map((vault) => `
    <article class="product-card">
      <div class="product-card__meta">${vault.network} · ${vault.type}</div>
      <h3>${vault.name}</h3>
      <p>${vault.underlying} · ${vault.risk} risk</p>
      <dl><div><dt>Indicative APY</dt><dd>${vault.apy}</dd></div><div><dt>TVL</dt><dd>${vault.tvl}</dd></div></dl>
      <button data-nav="products/vault/${vault.id}">查看产品</button>
    </article>`).join('');
}

function renderWorkspace(scope) {
  const role = decodeURIComponent(routeName().split('/').at(-1));
  const title = scope === 'vault' ? 'Atlas Income Vault' : 'Orion Receivables 2026-A';
  const label = ROLE_CATALOG[scope].find(([slug]) => slug === role)?.[1] || 'Unknown Role';
  document.querySelector(`[data-${scope}-workspace-title]`).textContent = `${label} Workspace`;
  document.querySelector(`[data-${scope}-workspace-object]`).textContent = title;
}
```

`renderMyAccess()` must show a wallet-connect empty state when disconnected and the grouped access inventory when connected. Resolve each inventory item to its Vault or Asset, filter resolved objects by `state.wallet.network`, and render a clear no-permissions state when the selected network has no matching roles.

- [ ] **Step 6: Add event delegation**

```js
document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { navigate(nav.dataset.nav); return; }
  if (event.target.closest('[data-connect-wallet]')) { connectWallet(); return; }
  if (event.target.closest('[data-disconnect-wallet]')) { disconnectWallet(); return; }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-network-select]')) setNetwork(event.target.value);
});
```

- [ ] **Step 7: Run the focused tests**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: all public/Web3 tests PASS.

- [ ] **Step 8: Commit the public and workspace demo**

```powershell
git add -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
git commit -m "feat: add public and workspace demo pages"
```

---

### Task 3: Implement mock Ops authentication and protected internal pages

**Files:**
- Modify: `demo/hypertessera-full-demo.html`
- Modify: `src/demo/hypertesseraFullDemo.test.js`

**Interfaces:**
- Consumes: Task 1 `authenticateOps()`, `logoutOps()`, route guard, state persistence, and Task 2 shared render lifecycle.
- Produces: routes `ops/login`, `ops/dashboard`, `ops/reviews`, `ops/review/:applicationId`, `ops/listings`, and `ops/history`.
- Produces: form handlers `handleOpsLogin(form)` and `renderOpsShell()`.

- [ ] **Step 1: Add failing authentication and protected-route tests**

Append:

```js
describe('internal review authentication', () => {
  it('rejects incorrect credentials and keeps the user on login', () => {
    const demo = loadDemo('#/ops/login');
    expect(demo.authenticateOps('reviewer@hypertessera.demo', 'wrong')).toBe(false);
    demo.navigate('ops/dashboard');
    expect(window.location.hash).toBe('#/ops/login');
  });

  it('accepts the demo credentials and opens the dashboard', () => {
    const demo = loadDemo('#/ops/login');
    expect(demo.authenticateOps('reviewer@hypertessera.demo', 'Demo2026!')).toBe(true);
    demo.navigate('ops/dashboard');
    expect(document.querySelector('[data-page="ops-dashboard"]').hidden).toBe(false);
    expect(document.body.textContent).toContain('Vault 审核概览');
  });

  it('persists the authenticated session across a reload', () => {
    let demo = loadDemo('#/ops/login');
    demo.authenticateOps('reviewer@hypertessera.demo', 'Demo2026!');
    demo = loadDemo('#/ops/reviews');
    expect(demo.getState().opsSession.authenticated).toBe(true);
    expect(document.querySelector('[data-page="ops-reviews"]').hidden).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm protected pages are missing**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: incorrect credentials test passes; dashboard, persistence, and protected page tests FAIL because Ops pages are not implemented.

- [ ] **Step 3: Add the Ops login form and independent Ops shell**

The login page must contain:

```html
<form data-ops-login-form novalidate>
  <p class="demo-flag">Demo authentication only</p>
  <label>账号<input name="email" type="email" autocomplete="username" required></label>
  <p data-email-error class="field-error" hidden></p>
  <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
  <p data-password-error class="field-error" hidden></p>
  <p data-login-error class="form-error" role="alert" hidden></p>
  <button type="submit">登录演示后台</button>
  <div class="demo-credentials">
    <strong>演示账号</strong>
    <code>reviewer@hypertessera.demo</code>
    <code>Demo2026!</code>
  </div>
</form>
```

Protected pages must use an internal sidebar with 审核概览、Vault 申请、待补充材料、已上架 Vault、审核记录、退出登录. Do not reuse the public wallet header.

- [ ] **Step 4: Implement form validation and protected rendering**

```js
function handleOpsLogin(form) {
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  form.querySelector('[data-email-error]').hidden = Boolean(email);
  form.querySelector('[data-password-error]').hidden = Boolean(password);
  if (!email || !password) return false;
  const ok = authenticateOps(email, password);
  const error = form.querySelector('[data-login-error]');
  error.hidden = ok;
  error.textContent = ok ? '' : '演示账号或密码错误';
  if (ok) navigate('ops/dashboard');
  return ok;
}

document.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-ops-login-form]')) return;
  event.preventDefault();
  handleOpsLogin(event.target);
});
```

Update `pageForRoute()` for every Ops route and render Dashboard statistics from application state rather than hard-coded counts.

- [ ] **Step 5: Run authentication tests**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: all authentication and protected-route tests PASS.

- [ ] **Step 6: Commit mock authentication and Ops navigation**

```powershell
git add -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
git commit -m "feat: add mock review authentication"
```

---

### Task 4: Implement the Vault review-to-Products listing workflow

**Files:**
- Modify: `demo/hypertessera-full-demo.html`
- Modify: `src/demo/hypertesseraFullDemo.test.js`

**Interfaces:**
- Consumes: Task 2 `state.vaults`, `renderProducts()`, Task 3 protected Ops routes.
- Produces: `listingApplications`, `reviewHistory`, `submitListingApplication(vaultId, formData)`, `reviewApplication(id, decision, note)`, `setListingStatus(vaultId, status)`, `renderReviewQueue()`, `renderReviewDetail()`, `renderListings()`, and `renderReviewHistory()`.

- [ ] **Step 1: Add failing workflow tests**

Append:

```js
describe('Vault review and Products listing workflow', () => {
  function authenticatedDemo(route = '#/ops/reviews') {
    const demo = loadDemo('#/ops/login');
    demo.authenticateOps('reviewer@hypertessera.demo', 'Demo2026!');
    demo.navigate(route.replace('#/', ''));
    return demo;
  }

  it('lists Nova after an approved review and records one history event', () => {
    const demo = authenticatedDemo();
    expect(demo.reviewApplication('APP-2026-041', 'approve', '材料完整，可以上架')).toBe(true);
    expect(demo.getState().vaults.find((vault) => vault.id === 'nova-credit').listingStatus).toBe('listed');
    expect(demo.getState().reviewHistory.filter((item) => item.applicationId === 'APP-2026-041')).toHaveLength(1);
    demo.navigate('products');
    expect(document.body.textContent).toContain('Nova Credit Vault');
  });

  it('does not duplicate history when approval is repeated', () => {
    const demo = authenticatedDemo();
    demo.reviewApplication('APP-2026-041', 'approve', '第一次批准');
    expect(demo.reviewApplication('APP-2026-041', 'approve', '重复批准')).toBe(false);
    expect(demo.getState().reviewHistory.filter((item) => item.applicationId === 'APP-2026-041')).toHaveLength(1);
  });

  it('can request information, reject, suspend, restore, and delist without changing wallet roles', () => {
    const demo = authenticatedDemo();
    const rolesBefore = demo.getState().accessInventory;
    expect(demo.reviewApplication('APP-2026-040', 'needs_information', '请补充风险文件')).toBe(true);
    expect(demo.reviewApplication('APP-2026-039', 'reject', '不符合展示要求')).toBe(true);
    expect(demo.setListingStatus('atlas-income', 'suspended')).toBe(true);
    expect(demo.setListingStatus('atlas-income', 'listed')).toBe(true);
    expect(demo.setListingStatus('atlas-income', 'delisted')).toBe(true);
    expect(demo.getState().accessInventory).toEqual(rolesBefore);
  });

  it('submits a Vault Owner listing application without writing on-chain', () => {
    const demo = loadDemo('#/vault-listing/nova-credit');
    demo.connectWallet();
    const applicationId = demo.submitListingApplication('nova-credit', {
      summary: 'Updated income strategy materials',
      documents: ['Updated Risk Disclosure.pdf']
    });
    const application = demo.getState().listingApplications.find((item) => item.id === applicationId);
    expect(application).toMatchObject({ vaultId: 'nova-credit', status: 'submitted' });
    expect(demo.getState().vaults.find((vault) => vault.id === 'nova-credit').listingStatus).toBe('unlisted');
  });
});
```

- [ ] **Step 2: Run the tests and confirm workflow failures**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: FAIL because listing applications and workflow functions are not implemented.

- [ ] **Step 3: Add exact initial applications**

```js
listingApplications: [
  {
    id: 'APP-2026-041', vaultId: 'nova-credit', applicant: '0x54B8...810A',
    submittedAt: '2026-08-03T08:00:00Z', updatedAt: '2026-08-03T08:00:00Z',
    status: 'submitted', summary: 'Tokenized private credit strategy',
    documents: ['Risk Disclosure.pdf', 'Vault Overview.pdf'], reviewNote: ''
  },
  {
    id: 'APP-2026-039', vaultId: 'atlas-income', applicant: '0x18C4...44A0',
    submittedAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-02T09:30:00Z',
    status: 'needs_information', summary: 'Income-focused receivables strategy',
    documents: ['Vault Overview.pdf'], reviewNote: '请补充最新版风险披露'
  },
  {
    id: 'APP-2026-040', vaultId: 'liquidity-earn', applicant: '0x90F1...119C',
    submittedAt: '2026-08-02T04:00:00Z', updatedAt: '2026-08-02T04:00:00Z',
    status: 'submitted', summary: 'Short-duration liquidity strategy',
    documents: ['Product Brief.pdf'], reviewNote: ''
  }
],
```

- [ ] **Step 4: Implement application submission, review state transitions, and idempotency**

```js
const REVIEW_STATUS_BY_DECISION = {
  approve: 'listed',
  needs_information: 'needs_information',
  reject: 'rejected'
};

function submitListingApplication(vaultId, formData = {}) {
  if (!state.wallet.connected) return null;
  const vault = state.vaults.find((item) => item.id === vaultId);
  if (!vault) return null;

  let application = state.listingApplications.find((item) =>
    item.vaultId === vaultId && ['draft', 'submitted', 'needs_information'].includes(item.status)
  );
  const now = new Date().toISOString();
  if (!application) {
    application = {
      id: `APP-DEMO-${Date.now()}`,
      vaultId,
      applicant: state.wallet.address,
      submittedAt: now,
      updatedAt: now,
      status: 'draft',
      summary: '',
      documents: [],
      reviewNote: ''
    };
    state.listingApplications.unshift(application);
  }

  application.status = 'submitted';
  application.summary = String(formData.summary || application.summary).trim();
  application.documents = Array.isArray(formData.documents) && formData.documents.length
    ? [...formData.documents]
    : application.documents;
  application.updatedAt = now;
  saveState();
  render();
  return application.id;
}

function reviewApplication(id, decision, note) {
  if (!state.opsSession.authenticated) return false;
  const application = state.listingApplications.find((item) => item.id === id);
  const nextStatus = REVIEW_STATUS_BY_DECISION[decision];
  if (!application || !nextStatus || application.status === nextStatus) return false;

  application.status = nextStatus;
  application.reviewNote = note.trim();
  application.updatedAt = new Date().toISOString();
  if (decision === 'approve') {
    const vault = state.vaults.find((item) => item.id === application.vaultId);
    if (vault) vault.listingStatus = 'listed';
  }
  state.reviewHistory.unshift({
    id: `HIST-${Date.now()}`,
    applicationId: id,
    vaultId: application.vaultId,
    action: nextStatus,
    note: application.reviewNote,
    reviewer: state.opsSession.reviewerName,
    at: application.updatedAt
  });
  saveState();
  render();
  return true;
}

function setListingStatus(vaultId, status) {
  if (!state.opsSession.authenticated) return false;
  if (!['listed', 'suspended', 'delisted'].includes(status)) return false;
  const vault = state.vaults.find((item) => item.id === vaultId);
  if (!vault || vault.listingStatus === status) return false;
  vault.listingStatus = status;
  state.reviewHistory.unshift({
    id: `HIST-${Date.now()}`,
    applicationId: null,
    vaultId,
    action: status,
    note: `Listing status changed to ${status}`,
    reviewer: state.opsSession.reviewerName,
    at: new Date().toISOString()
  });
  saveState();
  render();
  return true;
}
```

- [ ] **Step 5: Build Review Queue, Review Detail, Listings, and History views**

Requirements:

- Queue filters: all, submitted, needs_information, listed, rejected.
- Detail shows network, Vault address, Owner, type, underlying, risk, APY, TVL, role snapshot, documents, Products preview, timeline, note field, and three decision buttons.
- Approve button copy: `通过并上架到网站`.
- Needs information button copy: `要求补充材料`.
- Reject button copy: `驳回申请`.
- Listings view supports `暂停展示`, `恢复上架`, and `下架`.
- History renders newest first and always displays reviewer, action, note, and time.
- Vault Listing Application submits through `submitListingApplication()` only after the mock wallet is connected, displays an explicit “off-chain demo submission” notice, and never changes the Vault's `listingStatus`; only an Ops approval can list it.

Use `data-review-action`, `data-application-id`, `data-listing-action`, and `data-vault-id` attributes so event delegation stays centralized.

- [ ] **Step 6: Connect decision and listing controls**

```js
const reviewControl = event.target.closest('[data-review-action]');
if (reviewControl) {
  const note = document.querySelector('[data-review-note]').value;
  reviewApplication(reviewControl.dataset.applicationId, reviewControl.dataset.reviewAction, note);
  return;
}

const listingControl = event.target.closest('[data-listing-action]');
if (listingControl) {
  setListingStatus(listingControl.dataset.vaultId, listingControl.dataset.listingAction);
  return;
}

```

Add the application form to the centralized `submit` listener, not the click listener:

```js
document.addEventListener('submit', (event) => {
  const listingForm = event.target.closest('[data-listing-application-form]');
  if (!listingForm) return;
  event.preventDefault();
  const formData = new FormData(listingForm);
  submitListingApplication(listingForm.dataset.vaultId, {
    summary: formData.get('summary'),
    documents: [...listingForm.querySelectorAll('[data-document]:checked')].map((item) => item.value)
  });
});
```

- [ ] **Step 7: Run workflow tests**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: all workflow tests PASS.

- [ ] **Step 8: Commit the complete review workflow**

```powershell
git add -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
git commit -m "feat: add mock Vault review and listing flow"
```

---

### Task 5: Add persistence recovery, reset, accessibility, responsive layout, and demo polish

**Files:**
- Modify: `demo/hypertessera-full-demo.html`
- Modify: `src/demo/hypertesseraFullDemo.test.js`

**Interfaces:**
- Consumes: all prior state and render interfaces.
- Produces: robust `loadState()`, `resetDemo()`, toast/live-region feedback, responsive navigation, accessible modal/dialog behavior, and final Demo disclosure.

- [ ] **Step 1: Add failing recovery, reset, logout, and copy-boundary tests**

Append:

```js
describe('demo resilience and product boundaries', () => {
  it('recovers from invalid persisted JSON', () => {
    const demo = loadDemo('#/home', '{broken');
    expect(demo.getState().version).toBe(1);
    expect(demo.getState().vaults.length).toBeGreaterThan(0);
  });

  it('logs out without deleting review data', () => {
    const demo = loadDemo('#/ops/login');
    demo.authenticateOps('reviewer@hypertessera.demo', 'Demo2026!');
    demo.reviewApplication('APP-2026-041', 'approve', '批准');
    demo.logoutOps();
    expect(demo.getState().opsSession.authenticated).toBe(false);
    expect(demo.getState().vaults.find((vault) => vault.id === 'nova-credit').listingStatus).toBe('listed');
  });

  it('resets all demo state and returns home', () => {
    const demo = loadDemo('#/ops/login');
    demo.authenticateOps('reviewer@hypertessera.demo', 'Demo2026!');
    demo.reviewApplication('APP-2026-041', 'approve', '批准');
    demo.resetDemo();
    expect(window.location.hash).toBe('#/home');
    expect(demo.getState().vaults.find((vault) => vault.id === 'nova-credit').listingStatus).toBe('unlisted');
    expect(demo.getState().opsSession.authenticated).toBe(false);
  });

  it('does not describe review as Governor or on-chain approval', () => {
    loadDemo('#/ops/login');
    const copy = document.querySelector('[data-page="ops-login"]').textContent;
    expect(copy).not.toMatch(/Governor|链上批准|Gas Fee|Connect Wallet/);
    expect(copy).toContain('Demo authentication only');
  });
});
```

- [ ] **Step 2: Run the tests and confirm reset/recovery gaps**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: boundary copy test may pass; reset and recovery tests FAIL until full initial data and state replacement are applied consistently.

- [ ] **Step 3: Make state recovery and reset deterministic**

`initialState()` must always return a fresh deep structure. `resetDemo()` must remove the old key before saving defaults:

```js
function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  state = initialState();
  saveState();
  navigate('home');
  announce('演示数据已重置');
}
```

Add a reset button to the public footer and Ops sidebar, with a confirmation dialog before reset.

- [ ] **Step 4: Add accessible live feedback and dialog behavior**

```js
function announce(message) {
  const region = document.querySelector('#global-live-region');
  region.textContent = '';
  const schedule = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
  schedule(() => { region.textContent = message; });
}

function openDialog(dialog) {
  dialog.hidden = false;
  dialog.setAttribute('aria-modal', 'true');
  dialog.querySelector('button, input, textarea, select')?.focus();
}

function closeDialog(dialog, trigger) {
  dialog.hidden = true;
  dialog.removeAttribute('aria-modal');
  trigger?.focus();
}
```

Every status change calls `announce()` with explicit text. Dialogs close on Escape and return focus to their trigger.

- [ ] **Step 5: Finish responsive CSS and visual hierarchy**

Implement exact breakpoints:

```css
@media (max-width: 1080px) {
  .product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .workspace-shell, .ops-shell { grid-template-columns: 180px minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .marketing-nav__links { display: none; }
  .product-grid, .metric-grid, .review-detail { grid-template-columns: 1fr; }
  .workspace-shell, .ops-shell { grid-template-columns: 1fr; }
  .workspace-sidebar, .ops-sidebar { position: static; width: 100%; }
  .data-table { display: block; overflow-x: auto; }
}
```

Ensure every button has `min-height: 40px`, focus styles use `outline: 3px solid rgba(37,87,214,.3)`, and status chips include readable text.

- [ ] **Step 6: Run all demo tests**

Run:

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Run project verification without modifying generated output**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
git diff --check -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
```

Expected: typecheck PASS, demo tests PASS, diff check emits no errors.

- [ ] **Step 8: Commit the polished standalone demo**

```powershell
git add -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
git commit -m "feat: finish standalone HyperTessera demo"
```

---

### Task 6: Perform browser acceptance testing and document the demo handoff

**Files:**
- Modify: `demo/hypertessera-full-demo.html` only if acceptance testing finds a defect.
- Modify: `src/demo/hypertesseraFullDemo.test.js` only when a discovered defect needs regression coverage.

**Interfaces:**
- Consumes: complete Task 1–5 demo.
- Produces: verified user-visible demonstration flow and final handoff path.

- [ ] **Step 1: Start a local static preview**

Run from `webpage/工作台`:

```powershell
npx.cmd vite --host 127.0.0.1 --port 5175
```

Open:

```text
http://127.0.0.1:5175/demo/hypertessera-full-demo.html#/home
```

Expected: Homepage renders with no console errors.

- [ ] **Step 2: Walk the public and wallet demo path**

Verify in order:

1. Products initially shows Atlas Income Vault and Liquidity Earn Vault, not Nova Credit Vault.
2. My Access shows a connect-wallet empty state.
3. Connect Mock Wallet reveals the access inventory.
4. Switch network to Base and verify visible objects update.
5. Open a Vault workspace, change roles, and verify the shared shell updates.
6. Open a Vault Listing Application and submit the mock application.

Expected: every navigation and control updates without reload or console errors.

- [ ] **Step 3: Walk the internal review path**

Verify in order:

1. Directly open `#/ops/reviews` while logged out; confirm redirect to `#/ops/login`.
2. Enter a wrong password; confirm visible error.
3. Enter `reviewer@hypertessera.demo` / `Demo2026!`; confirm Dashboard opens.
4. Open `APP-2026-041` and select `通过并上架到网站`.
5. Open Products; confirm Nova Credit Vault appears.
6. Refresh; confirm Nova remains listed.
7. Suspend Nova; confirm it disappears from Products.
8. Restore Nova; confirm it reappears.
9. Delist Nova; confirm it disappears and History records the action.
10. Logout; confirm review data remains.
11. Reset demo data; confirm Nova returns to unlisted and Ops session clears.

Expected: the complete loop succeeds and no copy suggests smart-contract approval.

- [ ] **Step 4: Check desktop, tablet, and mobile layouts**

Viewports:

- Desktop: `1440 × 900`.
- Tablet: `1024 × 768`.
- Mobile: `390 × 844`.

Expected: no horizontal page overflow, no clipped buttons, labels remain readable, sidebar transforms correctly, dialogs remain usable.

- [ ] **Step 5: Add regression coverage for any defect found**

For each defect, first add a failing test to `src/demo/hypertesseraFullDemo.test.js`, run it to confirm the failure, patch the HTML, and rerun the focused test. Do not change the React app to fix a standalone demo defect.

- [ ] **Step 6: Run final verification**

```powershell
npm.cmd test -- src/demo/hypertesseraFullDemo.test.js
npm.cmd run typecheck
git diff --check -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
```

Expected: all commands PASS.

- [ ] **Step 7: Commit acceptance fixes if any**

```powershell
git add -- demo/hypertessera-full-demo.html src/demo/hypertesseraFullDemo.test.js
git commit -m "fix: address standalone demo acceptance findings"
```

Skip this commit when Task 6 required no file changes.
