# HyperTessera Interactive HTML Demo V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, polished, interactive HyperTessera demo that demonstrates public products, wallet-based role workspaces, and the separate Vault listing review backend.

**Architecture:** One self-contained HTML file owns CSS, mock state, a hash router, render functions, and event delegation. A Node smoke test statically verifies the promised routes, roles, persistence contract, and credentials; browser tests verify the actual user flows.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript, Hash Router, localStorage, Node.js built-in test runner, browser interaction testing.

## Global Constraints

- Do not modify the existing React application or the old `hypertessera-role-demo.html`.
- Do not call real wallets, contracts, SDKs, APIs, or authentication services.
- Keep Web3 wallet identity and Ops account/password identity strictly separate.
- Store demo state under `hypertessera_interactive_demo_v2`.
- Use UTF-8 Chinese copy and responsive layouts for desktop and mobile.

---

### Task 1: Contract Smoke Test

**Files:**
- Create: `demo/hypertessera-interactive-demo-v2.contract.mjs`
- Test: `demo/hypertessera-interactive-demo-v2.contract.mjs`

**Interfaces:**
- Consumes: the final standalone HTML source.
- Produces: static contract checks for routes, roles, credentials, persistence, and major render functions.

- [ ] **Step 1: Write the failing test** that expects the final HTML file and all required contracts.
- [ ] **Step 2: Run `node --test demo/hypertessera-interactive-demo-v2.contract.mjs`** and verify it fails because the HTML does not exist.
- [ ] **Step 3: Keep the test unchanged while implementing Tasks 2-4.**

### Task 2: Product Shell and Mock State

**Files:**
- Create: `demo/hypertessera-interactive-demo-v2.html`

**Interfaces:**
- Produces: `DEFAULT_STATE`, `loadState()`, `saveState()`, `navigate()`, `renderApp()`, and responsive shell styles.
- Consumed by: all route renderers and browser verification.

- [ ] **Step 1: Implement design tokens, responsive shell, header, navigation, toast, modal, and drawer primitives.**
- [ ] **Step 2: Implement initial Vault, application, activity, wallet, network, and role datasets.**
- [ ] **Step 3: Implement hash routing and localStorage persistence.**
- [ ] **Step 4: Implement reset and demo guide controls.**

### Task 3: Public and Web3 User Flows

**Files:**
- Modify: `demo/hypertessera-interactive-demo-v2.html`

**Interfaces:**
- Consumes: state and router from Task 2.
- Produces: `renderHome()`, `renderProducts()`, `renderProductDetail()`, `renderAccess()`, `renderBusinessHub()`, `renderWorkspace()`, and `renderListingApplication()`.

- [ ] **Step 1: Implement the public home, Vault product list, and product detail routes.**
- [ ] **Step 2: Implement network and preset-wallet connection, including empty, single-role, and multi-role accounts.**
- [ ] **Step 3: Implement My Access and issuance/management business hubs.**
- [ ] **Step 4: Implement object-aware role navigation and role-specific workspaces for all defined roles.**
- [ ] **Step 5: Implement simulated form submission, activity creation, and transaction feedback.**
- [ ] **Step 6: Implement the Vault listing application flow.**

### Task 4: Independent Ops Review Flow

**Files:**
- Modify: `demo/hypertessera-interactive-demo-v2.html`

**Interfaces:**
- Consumes: listing applications and Vaults from Tasks 2-3.
- Produces: `renderOpsLogin()`, `renderOpsDashboard()`, `renderReviewQueue()`, `renderReviewDetail()`, `renderListings()`, and `renderReviewHistory()`.

- [ ] **Step 1: Implement guarded Ops routes and inline login validation.**
- [ ] **Step 2: Implement dashboard metrics, review filtering, and review details.**
- [ ] **Step 3: Implement needs-information, reject, approve-and-list, suspend, restore, and delist state changes.**
- [ ] **Step 4: Synchronize listing status with Products and append review history.**

### Task 5: Verification and Visual QA

**Files:**
- Create: `design-qa.md`
- Test: `demo/hypertessera-interactive-demo-v2.contract.mjs`

**Interfaces:**
- Consumes: completed HTML and visual reference from the previous demo.
- Produces: automated evidence, browser flow evidence, and a blocking design QA result.

- [ ] **Step 1: Run `node --test demo/hypertessera-interactive-demo-v2.contract.mjs`** and verify all static contract tests pass.
- [ ] **Step 2: Open the Demo in the in-app browser and verify network, wallet, role, object, and route switching.**
- [ ] **Step 3: Verify wrong and correct Ops login, review approval, Products synchronization, refresh persistence, and reset.**
- [ ] **Step 4: Inspect desktop and mobile screenshots plus browser console logs.**
- [ ] **Step 5: Record issues in `design-qa.md`, fix P0-P2 issues, and repeat until `final result: passed`.**
