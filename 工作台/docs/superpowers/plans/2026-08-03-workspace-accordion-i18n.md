# Workspace Accordion + Chinese UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every role-workspace task module collapsed by default (accordion: one open at a time) with title + capability badge on the summary, and replace hardcoded English UI chrome with i18n (Chinese for operators; keep domain terms in English).

**Architecture:** Add `ActionAccordionItem` that renders a clickable summary and mounts `ActionPanel` only when open. Own `openActionId` in `RoleWorkspacePage`. Move ActionPanel/ActionForm/role-page chrome strings into `t.workspaces.ui` (and related keys). Extend `workspaces.css` for accordion styling. Update role-page tests to expand an item before querying the form.

**Tech Stack:** React 19, Vitest + Testing Library, existing `LocaleProvider` / `t.workspaces`, Vite app under `工作台/`.

**Spec:** `docs/superpowers/specs/2026-08-03-workspace-accordion-i18n-design.md`

**Working directory:** all paths below are relative to the `工作台/` git repo root.

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `src/workspaces/components/ActionAccordionItem.jsx` | Summary row + conditional `ActionPanel` |
| Create: `src/workspaces/components/ActionAccordionItem.test.jsx` | Accordion unit tests |
| Modify: `src/workspaces/components/ActionPanel.jsx` | i18n for chrome; keep execute/sign behavior |
| Modify: `src/workspaces/components/ActionForm.jsx` | i18n legend + default submit label |
| Modify: `src/workspaces/pages/RoleWorkspacePage.jsx` | Accordion state; i18n page chrome; Relayer blocks collapsible |
| Modify: `src/i18n/en.js` | Add `workspaces.ui`, `workspaces.page`, badge extras |
| Modify: `src/i18n/zh-CN.js` | Same keys in Chinese |
| Modify: `src/styles/workspaces.css` | Accordion / summary / dangerous styles |
| Modify: `src/workspaces/components/ActionPanel.test.jsx` | Assert i18n English strings (locale `en`) |
| Modify: `src/workspaces/pages/RoleWorkspacePage.test.jsx` | Expand helper before form queries |

---

### Task 1: Add i18n keys (en + zh-CN)

**Files:**
- Modify: `src/i18n/en.js` (inside `workspaces: { ... }`)
- Modify: `src/i18n/zh-CN.js` (inside `workspaces: { ... }`)

- [ ] **Step 1: Extend English `workspaces` object**

Inside `workspaces` in `en.js`, keep existing `roles`, `actions`, `capabilities`, `badges`, `forms`, `transaction`. Add:

```js
badges: {
  legacyCompatible: 'Legacy Compatible',
  target: 'Target',
  stateEligible: 'State-eligible',
  highRisk: 'High risk',
},
ui: {
  actionInputs: 'Action inputs',
  executeAction: 'Execute action',
  signPayload: 'Sign payload',
  switchNetwork: 'Switch network',
  target: 'Target',
  function: 'Function',
  parameters: 'Parameters',
  network: 'Network',
  notSupplied: 'Not supplied',
  submitting: 'Submitting action…',
  actionSubmitted: 'Action submitted.',
  payloadSigned: 'Payload signed.',
  actionFailed: 'Action could not be submitted.',
  requiredMethod: 'Required method',
  module: 'module',
  connectedAddress: 'Connected address',
  unknown: 'unknown',
  unavailable: 'unavailable',
  warning: 'Warning',
  dangerConfirmBody: 'This action can change on-chain state. Type the final four characters of the target address to confirm.',
  confirmation: 'Confirmation',
  targetEnding: 'Target ending',
  noCanonicalTarget: 'No canonical target address was supplied, so this dangerous action cannot be submitted.',
  stateEligibleDetail: 'Timestamp and other preconditions are validated onchain at execution.',
  yes: 'Yes',
  no: 'No',
  valueUnavailable: 'Unavailable',
},
page: {
  eyebrow: 'Administrative workspace',
  notAvailable: 'This operational workspace is not available yet.',
  invalidObjectRoute: 'Invalid {label} route. No chain request was made.',
  chainDataFailed: 'Current chain data could not be loaded. Actions fail closed.',
  psmSignerUnavailable: 'Legacy PSM signing is unavailable because the deployed contract signature does not authenticate documentId.',
  pauseException: 'Pause-management controls remain operable so an authorized role can unpause. Every other action stays gated by the live pause state.',
  signatureImportTitle: 'Validated signature import',
  signatureImportBody: 'Import one signer envelope, or a Settlement envelope array meeting the live threshold. Chain, contract, scope, signer and the protocol\'s real replay/expiry fields are revalidated before submission.',
  signedPayloadImport: 'Signed payload import',
  validateSignedPayload: 'Validate signed payload',
  signatureExportTitle: 'Signed payload handoff',
  signatureExportBody: 'The full signature remains in memory until you explicitly export it for a Relayer.',
  navExportNote: 'Legacy NAV has no contract deadline: its signed dataTimestamp is the real monotonic replay boundary, and deadline is exported as null.',
  settlementExportNote: 'One operator envelope is not a threshold claim. The Relayer must combine enough unique signatures for the exact same batch.',
  exportSignedPayload: 'Export signed payload',
  exportedSignedPayload: 'Exported signed payload',
  importCouldNotSubmit: 'Signed payload could not be submitted.',
  importSubmitted: 'Imported payload submitted.',
},
```

Also ensure `capabilities` already has the keys used by `CapabilityBanner` (no change required if present).

- [ ] **Step 2: Mirror Chinese keys in `zh-CN.js`**

Same structure; use these Chinese values (keep English terms inside sentences where they are product terms):

```js
badges: {
  legacyCompatible: '兼容旧版',
  target: '目标版本',
  stateEligible: '状态可用',
  highRisk: '高风险',
},
ui: {
  actionInputs: '操作参数',
  executeAction: '执行操作',
  signPayload: '签署载荷',
  switchNetwork: '切换网络',
  target: '目标',
  function: '函数',
  parameters: '参数',
  network: '网络',
  notSupplied: '未提供',
  submitting: '正在提交操作…',
  actionSubmitted: '操作已提交。',
  payloadSigned: '载荷已签署。',
  actionFailed: '操作未能提交。',
  requiredMethod: '所需方法',
  module: '模块',
  connectedAddress: '已连接地址',
  unknown: '未知',
  unavailable: '不可用',
  warning: '警告',
  dangerConfirmBody: '此操作会改变链上状态。请输入目标地址最后四位字符以确认。',
  confirmation: '确认',
  targetEnding: '目标地址末四位',
  noCanonicalTarget: '未提供规范目标地址，无法提交此高风险操作。',
  stateEligibleDetail: '时间戳及其他前置条件将在链上执行时校验。',
  yes: '是',
  no: '否',
  valueUnavailable: '暂无',
},
page: {
  eyebrow: '管理端工作台',
  notAvailable: '此运营工作台尚未开放。',
  invalidObjectRoute: '无效的 {label} 路由，未发起链上请求。',
  chainDataFailed: '无法加载当前链上数据。操作默认失败关闭。',
  psmSignerUnavailable: '旧版 PSM 签名不可用：已部署合约签名未对 documentId 做认证。',
  pauseException: '暂停管理控件仍可操作，以便授权角色恢复运行。其他操作继续受实时暂停状态约束。',
  signatureImportTitle: '已校验签名导入',
  signatureImportBody: '导入一份签名信封，或满足实时阈值的 Settlement 信封数组。提交前将重新校验链、合约、作用域、签名者以及协议真实的重放/过期字段。',
  signedPayloadImport: '签名载荷导入',
  validateSignedPayload: '校验签名载荷',
  signatureExportTitle: '已签载荷交接',
  signatureExportBody: '完整签名仅保存在内存中，直到你显式导出给 Relayer。',
  navExportNote: '旧版 NAV 无合约 deadline：已签 dataTimestamp 是真实的单调重放边界，导出的 deadline 为 null。',
  settlementExportNote: '单份运营方信封不构成阈值主张。Relayer 必须为同一批次合并足够多的唯一签名。',
  exportSignedPayload: '导出已签载荷',
  exportedSignedPayload: '已导出的签名载荷',
  importCouldNotSubmit: '签名载荷未能提交。',
  importSubmitted: '已导入载荷并提交。',
},
```

For `invalidObjectRoute`, keep a `{label}` placeholder; replace at call site with `selected.label` (label may remain English term like `Vault`).

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=* add src/i18n/en.js src/i18n/zh-CN.js
git -c safe.directory=* commit -m "feat(i18n): add workspace UI chrome strings for accordion work"
```

---

### Task 2: Wire ActionForm + ActionPanel to i18n

**Files:**
- Modify: `src/workspaces/components/ActionForm.jsx`
- Modify: `src/workspaces/components/ActionPanel.jsx`
- Modify: `src/workspaces/components/ActionPanel.test.jsx` (only if assertions break; prefer keeping English locale expectations)

- [ ] **Step 1: Update `ActionForm.jsx`**

Replace hardcoded legend and default submit:

```jsx
export default function ActionForm({
  fields = [],
  disabled = false,
  confirmation = null,
  submitLabel,
  onSubmit,
}) {
  const { t } = useI18n();
  const resolvedSubmit = submitLabel ?? t.workspaces.ui.executeAction;
  // ...
  return (
    <form className="ws-action-form" onSubmit={submit} noValidate>
      <fieldset disabled={disabled}>
        <legend>{t.workspaces.ui.actionInputs}</legend>
        {/* unchanged fields map */}
      </fieldset>
      {confirmation}
      <button className="ws-action-form__submit" type="submit" disabled={disabled}>
        {resolvedSubmit}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Update `ActionPanel.jsx` chrome**

Key replacements (keep logic identical):

```jsx
function supportBadge(t, action, capability) {
  const badge = capability?.badge ?? capability?.profile?.badge ?? action?.capability?.legacy?.badge
    ?? (capability?.state === CAPABILITY_STATES.TARGET_ONLY ? 'target' : null);
  if (badge === 'legacyCompatible') return t.workspaces.badges.legacyCompatible;
  if (badge === 'target') return t.workspaces.badges.target;
  return null;
}

function Detail({ capability, onSwitchNetwork, t }) {
  const detail = capability?.detail ?? {};
  if (capability?.state === CAPABILITY_STATES.TARGET_ONLY) {
    return (
      <p className="ws-action-panel__detail">
        {t.workspaces.ui.requiredMethod}: <code>{detail.requiredMethod ?? t.workspaces.ui.unavailable}</code>; {t.workspaces.ui.module}: <code>{detail.requiredModule ?? t.workspaces.ui.unavailable}</code>.
      </p>
    );
  }
  if (capability?.state === CAPABILITY_STATES.UNAUTHORIZED) {
    return (
      <p className="ws-action-panel__detail">
        {t.workspaces.ui.connectedAddress}: <code>{detail.address ?? detail.connectedAddress ?? t.workspaces.ui.unknown}</code>.
      </p>
    );
  }
  if (capability?.state === CAPABILITY_STATES.WRONG_NETWORK && typeof onSwitchNetwork === 'function') {
    return (
      <button type="button" className="ws-action-panel__switch" onClick={onSwitchNetwork}>
        {t.workspaces.ui.switchNetwork}
      </button>
    );
  }
  return null;
}

function Preview({ targetAddress, preview, t }) {
  if (!targetAddress && !preview) return null;
  return (
    <dl className="ws-action-preview">
      <div><dt>{t.workspaces.ui.target}</dt><dd>{targetAddress ?? preview?.target ?? t.workspaces.ui.notSupplied}</dd></div>
      {preview?.functionName && <div><dt>{t.workspaces.ui.function}</dt><dd>{preview.functionName}</dd></div>}
      {preview?.params && <div><dt>{t.workspaces.ui.parameters}</dt><dd>{preview.params}</dd></div>}
      {preview?.network && <div><dt>{t.workspaces.ui.network}</dt><dd>{preview.network}</dd></div>}
    </dl>
  );
}
```

In the main component:

```jsx
const badge = supportBadge(t, action, capability);
const submitLabel = isBuiltInSignatureAction(action.id)
  ? t.workspaces.ui.signPayload
  : t.workspaces.ui.executeAction;
// outcomes:
setOutcome(t.workspaces.ui.submitting);
setOutcome(isBuiltInSignatureAction(action.id) ? t.workspaces.ui.payloadSigned : t.workspaces.ui.actionSubmitted);
setOutcome(t.workspaces.ui.actionFailed);
// danger copy → t.workspaces.ui.warning / dangerConfirmBody / confirmation / targetEnding / noCanonicalTarget
// CapabilityBanner label for stateEligible → t.workspaces.badges.stateEligible
// stateEligibleDetail paragraph → t.workspaces.ui.stateEligibleDetail
```

- [ ] **Step 3: Run ActionPanel tests**

```bash
npm test -- src/workspaces/components/ActionPanel.test.jsx
```

Expected: PASS (locale stays `en` via `beforeEach` localStorage).

If any assertion still matches old wording but you changed English copy slightly, update the test string to match `t.workspaces.ui.*` English values exactly.

- [ ] **Step 4: Commit**

```bash
git -c safe.directory=* add src/workspaces/components/ActionForm.jsx src/workspaces/components/ActionPanel.jsx src/workspaces/components/ActionPanel.test.jsx
git -c safe.directory=* commit -m "feat(workspaces): localize ActionPanel and ActionForm chrome"
```

---

### Task 3: `ActionAccordionItem` (TDD)

**Files:**
- Create: `src/workspaces/components/ActionAccordionItem.test.jsx`
- Create: `src/workspaces/components/ActionAccordionItem.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../i18n';
import { CAPABILITY_STATES } from '../core/capabilityStates';
import ActionAccordionItem from './ActionAccordionItem';

const action = {
  id: 'vault.pause',
  title: 'Pause vault',
  description: 'Pause a selected vault.',
  capability: { legacy: { badge: 'legacyCompatible' } },
};

function renderItem(overrides = {}) {
  const props = {
    action,
    capability: { state: CAPABILITY_STATES.AVAILABLE },
    open: false,
    onToggle: vi.fn(),
    onExecute: vi.fn(),
    ...overrides,
  };
  return { ...render(<LocaleProvider><ActionAccordionItem {...props} /></LocaleProvider>), props };
}

beforeEach(() => localStorage.setItem('hyt.locale', 'en'));
afterEach(cleanup);

describe('ActionAccordionItem', () => {
  it('shows title and capability badge while hiding the form when closed', () => {
    renderItem({ open: false });
    expect(screen.getByRole('button', { name: /Pause vault/i })).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute action' })).not.toBeInTheDocument();
  });

  it('mounts ActionPanel when open', () => {
    renderItem({ open: true });
    expect(screen.getByRole('button', { name: 'Execute action' })).toBeInTheDocument();
  });

  it('calls onToggle when the summary is clicked', async () => {
    const { props } = renderItem({ open: false });
    await userEvent.click(screen.getByRole('button', { name: /Pause vault/i }));
    expect(props.onToggle).toHaveBeenCalledWith('vault.pause');
  });

  it('marks dangerous actions with a high-risk badge on the summary', () => {
    renderItem({ dangerous: true, open: false });
    expect(screen.getByText('High risk')).toBeInTheDocument();
  });
});
```

Note: capability banner text for `available` comes from `t.workspaces.capabilities.available` (`Available` in en). Put that badge on the **summary** (not only inside the closed-away panel).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- src/workspaces/components/ActionAccordionItem.test.jsx
```

Expected: FAIL (module not found / component missing).

- [ ] **Step 3: Implement `ActionAccordionItem.jsx`**

```jsx
import { useI18n } from '../../i18n';
import ActionPanel from './ActionPanel';

function actionCopy(t, action) {
  const configured = t.workspaces.actions?.[action.id.replaceAll('.', '-')];
  return {
    title: action.title ?? configured?.title ?? action.id,
    description: action.description ?? configured?.description ?? '',
  };
}

export default function ActionAccordionItem({
  action,
  capability,
  open,
  onToggle,
  dangerous = false,
  ...panelProps
}) {
  const { t } = useI18n();
  const { title } = actionCopy(t, action);
  const stateLabel = t.workspaces.capabilities[capability?.state] ?? t.workspaces.capabilities.unsupportedDeployment;
  const summaryId = `ws-action-summary-${action.id}`;
  const panelId = `ws-action-panel-${action.id}`;

  return (
    <div
      className={`ws-accordion-item${open ? ' is-open' : ''}${dangerous ? ' is-dangerous' : ''}`}
      data-testid="workspace-action"
      data-action-id={action.id}
    >
      <button
        type="button"
        id={summaryId}
        className="ws-accordion-item__summary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle?.(action.id)}
      >
        <span className="ws-accordion-item__title">{title}</span>
        <span className="ws-accordion-item__badges">
          {dangerous && <span className="ws-accordion-item__risk">{t.workspaces.badges.highRisk}</span>}
          <span className={`ws-capability ws-capability--${capability?.state ?? 'unsupportedDeployment'}`}>{stateLabel}</span>
        </span>
        <span className="ws-accordion-item__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id={panelId} role="region" aria-labelledby={summaryId} data-testid={`workspace-action-${action.id}`}>
          <ActionPanel action={action} capability={capability} dangerous={dangerous} {...panelProps} />
        </div>
      )}
      {!open && <div data-testid={`workspace-action-${action.id}`} hidden />}
    </div>
  );
}
```

**Important for existing role tests:** keep `data-testid="workspace-action"` and `data-action-id` on the outer item always. Keep `data-testid={workspace-action-${action.id}}` always present (use `hidden` empty stub when closed so `getByTestId` still finds the node; when open, the region wraps the panel). Prefer **one** `data-testid={`workspace-action-${action.id}`}` on the outer wrapper instead of the stub pattern:

```jsx
<div
  className={...}
  data-testid={`workspace-action-${action.id}`}
  data-action-id={action.id}
>
  {/* also keep a marker for list length tests: */}
```

Role tests use both:
- `getAllByTestId('workspace-action')` → need `data-testid="workspace-action"` on each item
- `getByTestId('workspace-action-${id}')` → need per-action test id

So outer element:

```jsx
<div
  className={...}
  data-testid="workspace-action"
  data-action-id={action.id}
>
  ...
  <div data-testid={`workspace-action-${action.id}`}>
    {open ? <ActionPanel ... /> : null}
  </div>
</div>
```

When closed, `within(panel).getByRole('button', { name: 'Execute action' })` will fail until tests expand — that is intended (Task 5).

- [ ] **Step 4: Run accordion tests — expect PASS**

```bash
npm test -- src/workspaces/components/ActionAccordionItem.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git -c safe.directory=* add src/workspaces/components/ActionAccordionItem.jsx src/workspaces/components/ActionAccordionItem.test.jsx
git -c safe.directory=* commit -m "feat(workspaces): add ActionAccordionItem for collapsed task modules"
```

---

### Task 4: Accordion state + page i18n in `RoleWorkspacePage`

**Files:**
- Modify: `src/workspaces/pages/RoleWorkspacePage.jsx`
- Modify: `src/styles/workspaces.css`

- [ ] **Step 1: Add accordion state and map actions through `ActionAccordionItem`**

Near other `useState` hooks:

```jsx
const [openActionId, setOpenActionId] = useState(null);
const [relayerImportOpen, setRelayerImportOpen] = useState(false);
const [exportOpen, setExportOpen] = useState(false);

const toggleAction = (actionId) => {
  setOpenActionId(current => (current === actionId ? null : actionId));
};
```

Replace the action list render:

```jsx
{!invalidObject && (
  <div className="ws-action-list">
    {actions.map(action => (
      <ActionAccordionItem
        key={action.id}
        action={action}
        open={openActionId === action.id}
        onToggle={toggleAction}
        capability={
          roleId === 'relayer' && action.id !== 'vault.timelock.execute'
            ? { ...capabilities[action.id], state: CAPABILITY_STATES.READ_ONLY }
            : capabilities[action.id]
        }
        onExecute={onExecute}
        onSwitchNetwork={() => wallet.switchChain(deployment.chainId)}
        context={selected && canonicalObject ? [{ label: selected.label, value: canonicalObject }] : []}
        dangerous={DANGEROUS_ACTIONS.has(action.id)}
        targetAddress={actionTarget(action.id, deployment, object)}
      />
    ))}
  </div>
)}
```

Import `ActionAccordionItem`.

- [ ] **Step 2: Replace hardcoded page strings with `t.workspaces.page.*` / `t.workspaces.ui.*`**

Examples:

```jsx
<p className="ws-eyebrow">{t.workspaces.page.eyebrow}</p>
// not available:
<p>{t.workspaces.page.notAvailable}</p>
// invalid object:
<p>{t.workspaces.page.invalidObjectRoute.replace('{label}', selected.label.toLowerCase())}</p>
// query error / psm / pauseException → corresponding page keys
// Relayer import/export titles, buttons, labels → page keys
// importStatus messages when setting English literals → use page.importSubmitted / importCouldNotSubmit
```

Update `display()` helper to use i18n — it currently returns `'Yes'|'No'|'Unavailable'`. Change call sites to pass `t` or move inside the component:

```jsx
function display(value, t) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? t.workspaces.ui.yes : t.workspaces.ui.no;
  return value ?? t.workspaces.ui.valueUnavailable;
}
```

- [ ] **Step 3: Make Relayer import + export sections collapsible (default collapsed)**

Wrap Relayer import in a details-like block:

```jsx
{roleId === 'relayer' && !invalidObject && (
  <section className={`ws-signature-exchange${relayerImportOpen ? ' is-open' : ''}`}>
    <button type="button" className="ws-accordion-item__summary" aria-expanded={relayerImportOpen} onClick={() => setRelayerImportOpen(v => !v)}>
      <span className="ws-accordion-item__title">{t.workspaces.page.signatureImportTitle}</span>
      <span className="ws-accordion-item__chevron" aria-hidden="true">{relayerImportOpen ? '▾' : '▸'}</span>
    </button>
    {relayerImportOpen && (
      <>
        {/* existing import body, using t.workspaces.page.* */}
      </>
    )}
  </section>
)}
```

For export block: only when `signedEnvelope` exists; default `exportOpen` false; same summary pattern with `signatureExportTitle`.

- [ ] **Step 4: Add CSS to `workspaces.css`**

Append:

```css
.ht-workspaces .ws-accordion-item {
  border: 1px solid var(--ws-border);
  border-radius: var(--r);
  background: var(--ws-panel);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.ht-workspaces .ws-accordion-item.is-open {
  border-left: 3px solid var(--ws-accent);
}
.ht-workspaces .ws-accordion-item.is-dangerous {
  border-left: 3px solid var(--danger);
}
.ht-workspaces .ws-accordion-item__summary {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ht-workspaces .ws-accordion-item__summary:hover {
  background: var(--canvas);
}
.ht-workspaces .ws-accordion-item__title {
  flex: 1;
  min-width: 0;
  color: var(--navy);
  font-weight: 650;
}
.ht-workspaces .ws-accordion-item__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.ht-workspaces .ws-accordion-item__risk {
  border-radius: var(--r-pill);
  padding: 4px 8px;
  background: color-mix(in srgb, var(--danger) 14%, #fff);
  color: var(--danger);
  font-size: var(--fs-xs);
  font-weight: 700;
}
.ht-workspaces .ws-accordion-item__chevron {
  color: var(--mut);
  font-size: 14px;
}
.ht-workspaces .ws-accordion-item .ws-action-panel {
  border: 0;
  border-top: 1px solid var(--ws-border);
  border-radius: 0;
  box-shadow: none;
}
.ht-workspaces .ws-capability--available { background: #e8f5e9; color: #2e7d32; }
.ht-workspaces .ws-capability--unauthorized { background: #fff3e0; color: #e65100; }
.ht-workspaces .ws-capability--paused { background: var(--gold-soft); color: var(--ws-warning); }
.ht-workspaces .ws-capability--readOnly { background: var(--canvas); color: var(--mut); }
.ht-workspaces .ws-capability--wrongNetwork,
.ht-workspaces .ws-capability--walletRequired,
.ht-workspaces .ws-capability--objectRequired,
.ht-workspaces .ws-capability--invalidState,
.ht-workspaces .ws-capability--targetOnly,
.ht-workspaces .ws-capability--unsupportedDeployment {
  background: var(--gold-soft);
  color: var(--ws-warning);
}
```

- [ ] **Step 5: Commit page + CSS (tests still expected failing until Task 5)**

```bash
git -c safe.directory=* add src/workspaces/pages/RoleWorkspacePage.jsx src/styles/workspaces.css
git -c safe.directory=* commit -m "feat(workspaces): accordion role tasks and localize role page chrome"
```

---

### Task 5: Fix `RoleWorkspacePage` tests for accordion

**Files:**
- Modify: `src/workspaces/pages/RoleWorkspacePage.test.jsx`

- [ ] **Step 1: Add expand helper next to `executeKeeper`**

```jsx
async function expandAction(actionId) {
  const item = screen.getByTestId(`workspace-action-${actionId}`);
  const summary = item.parentElement?.querySelector('.ws-accordion-item__summary')
    ?? screen.getByRole('button', { name: /.*/, /* too loose */ });
}
```

Prefer a stable query. After Task 3 outer structure, summary is **inside** the item that has `data-testid="workspace-action"` and contains child `data-testid={workspace-action-${id}}`. Cleanest helper:

```jsx
async function expandAction(actionId) {
  const row = screen.getByTestId('workspace-action').ownerDocument
    .querySelector(`[data-action-id="${CSS.escape(actionId)}"] .ws-accordion-item__summary`);
  // Better:
  const host = screen.getAllByTestId('workspace-action').find(node => node.dataset.actionId === actionId);
  const summary = within(host).getByRole('button', { expanded: false });
  // If already open, expanded:true — use:
  const button = within(host).getByRole('button', { name: /.+/ });
  if (button.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(button);
  }
  return within(host).getByTestId(`workspace-action-${actionId}`);
}
```

Simplest robust version:

```jsx
async function expandAction(actionId) {
  const host = screen.getAllByTestId('workspace-action').find(node => node.dataset.actionId === actionId);
  expect(host).toBeTruthy();
  const summary = within(host).getByRole('button', { expanded: /true|false/ });
  if (summary.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(summary);
  }
  return within(host).getByTestId(`workspace-action-${actionId}`);
}
```

Update `executeKeeper`:

```jsx
async function executeKeeper(actionId = 'lifecycle.open-subscription') {
  const panel = await expandAction(actionId);
  const vaultInput = within(panel).getByLabelText(/Vault/i);
  await userEvent.clear(vaultInput);
  await userEvent.type(vaultInput, addresses.cashVault);
  await userEvent.click(within(panel).getByRole('button', { name: 'Execute action' }));
}
```

- [ ] **Step 2: Update every test that queries Execute/Sign/form details inside an action**

Pattern before assert:

```jsx
const open = await expandAction('lifecycle.open-subscription');
await waitFor(() => expect(within(open).getByRole('button', { name: 'Execute action' })).toBeEnabled());
```

For tests that compare enabled vs disabled on two actions **at once** (keeper state gating): expand **both** (accordion allows only one open). Spec says only one open — so change that test to:

1. Expand `open-subscription` → assert Execute enabled  
2. Expand `finalize-subscription` (auto-closes previous) → assert Execute disabled  
OR expand one at a time without needing both panels mounted.

**Do not** change accordion to multi-open to satisfy the old test.

Example rewrite for the keeper gating test:

```jsx
it('enables only the keeper transition allowed by the current product and cycle state', async () => {
  sdk = makeSdk({ product: 0, cycle: 0 });
  renderRole('keeper');
  const openPanel = await expandAction('lifecycle.open-subscription');
  await waitFor(() => expect(within(openPanel).getByRole('button', { name: 'Execute action' })).toBeEnabled());
  const finalizePanel = await expandAction('lifecycle.finalize-subscription');
  await waitFor(() => expect(within(finalizePanel).getByRole('button', { name: 'Execute action' })).toBeDisabled());
});
```

For the curator badge test that looked inside the panel for `ws-action-panel__detail`: expand the action first, then query.

For list-length tests (`getAllByTestId('workspace-action')`): no expand needed.

Add one new test:

```jsx
it('keeps action forms collapsed until a summary is opened and only one panel open', async () => {
  renderRole('governor');
  await waitFor(() => expect(screen.getAllByTestId('workspace-action')).toHaveLength(4));
  expect(screen.queryByRole('button', { name: 'Execute action' })).not.toBeInTheDocument();
  await expandAction('protocol.modules.pause');
  expect(screen.getAllByRole('button', { name: 'Execute action' })).toHaveLength(1);
  await expandAction('psm.protocol.pause');
  expect(screen.getAllByRole('button', { name: 'Execute action' })).toHaveLength(1);
});
```

- [ ] **Step 3: Run role workspace tests**

```bash
npm test -- src/workspaces/pages/RoleWorkspacePage.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Run full workspace-related suite**

```bash
npm test -- src/workspaces
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c safe.directory=* add src/workspaces/pages/RoleWorkspacePage.test.jsx
git -c safe.directory=* commit -m "test(workspaces): expand accordion before asserting action panels"
```

---

### Task 6: Manual verification (zh-CN)

- [ ] **Step 1: Ensure app running on 5175**

```bash
npm run dev
```

Open `http://localhost:5175/workspaces/governor` (or via sidebar). Locale = 中文.

- [ ] **Step 2: Checklist**

1. All task rows collapsed; each shows Chinese title + status badge  
2. Opening one closes another  
3. Buttons read 执行操作 / 切换网络 / 操作参数 — not English chrome  
4. Terms like Vault / Governor / PSM remain English where they are titles/terms  
5. Spot-check `keeper` and `relayer` (import section collapsed by default)

- [ ] **Step 3: Final commit only if leftover fixes**

```bash
git -c safe.directory=* status
# commit any small copy/CSS fixes if needed
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Accordion, one open, click to collapse | 3, 4, 5 |
| Summary = title + capability badge | 3 |
| High-risk tag | 3 |
| StatGrid always open | 4 (unchanged placement) |
| Relayer import/export collapsible default closed | 4 |
| Chinese UI chrome / keep terms | 1, 2, 4, 6 |
| CSS tokens / accent / touch 44px | 4 |
| Tests updated + accordion test | 3, 5 |
| No capability/adapter rewrites | — out of scope |

## Placeholder scan

No TBD / “similar to Task N” without code. Commands and key code paths are explicit.
