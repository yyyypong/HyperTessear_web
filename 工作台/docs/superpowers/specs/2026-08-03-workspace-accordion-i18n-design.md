# Workspace Accordion + Chinese UI Copy Design

**Date:** 2026-08-03  
**Scope:** Role administrative workspaces under `工作台` (`/workspaces/:role…`)  
**Status:** Approved for implementation planning

## Goal

Improve operator readability on protocol management (role workspace) pages by:

1. Collapsing every task/action module by default; expand only on click.
2. Localizing UI chrome and non-terminology labels to Chinese when locale is `zh-CN`, while keeping domain terms in English.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Expand model | Accordion — at most one action open; click open item again to collapse |
| Collapsed row | Title + capability status badge |
| Implementation approach | Light wrap of existing `ActionPanel` (no full rewrite) |
| Chinese rule | Full Chinese for UI verbs/labels/messages; keep English terms (Vault, NAV, PSM, Keeper, Relayer, Governor, Timelock, SDK, Adapter, Cash/Note/LP, etc.) |

## Non-goals

- No changes to capability resolution, wallet execution, or on-chain adapters
- No sidebar / routing redesign
- No full visual re-skin; reuse existing `workspaces.css` tokens
- Public / permissionless workspace pages are out of scope except shared string keys that naturally benefit when `ActionPanel` is i18n’d

## Architecture

### Page stack (top → bottom)

1. Eyebrow + role title + role description  
2. Object scope line (when applicable)  
3. Error / pause exception alerts (always visible)  
4. `StatGrid` overview (always expanded; not in accordion)  
5. Relayer signature import block (if role = relayer): separately collapsible, default collapsed  
6. Task list: accordion of actions  
7. Signed payload export block: rendered only when a signed envelope exists; shown as a separately collapsible section that defaults to collapsed

### State

- `openActionId: string | null` owned by `RoleWorkspacePage`  
- Initial value: `null` (all collapsed)  
- Toggle: same id → `null`; different id → that id  

### New component: `ActionAccordionItem`

**Props (conceptual):** `action`, `capability`, `open`, `onToggle`, plus pass-through props currently given to `ActionPanel` (`onExecute`, `dangerous`, `targetAddress`, …).

**Collapsed header shows:**

- Action title (from i18n / action copy)
- Capability badge (available / unauthorized / paused / read-only / …)
- Optional「高风险」tag when `dangerous`
- Chevron ▸ / ▾

**Expanded body:**

- Mount existing `ActionPanel` only when `open === true`
- Avoid duplicating a heavy page-level H2; panel header may stay for accessibility (`aria-labelledby`) but visual weight should not compete with the accordion summary

### Existing components

- `ActionPanel` / `ActionForm` / `CapabilityBanner` / `DataField`: keep behavior; replace hardcoded English with `t.workspaces.*`
- `roleDefinitions.js`: unchanged action IDs and capability wiring

## Chinese copy inventory

Hardcoded English to move into i18n (non-exhaustive but required):

| Surface | Examples → Chinese |
|---------|-------------------|
| `ActionForm` | Action inputs → 操作参数; Execute action → 执行操作 |
| `ActionPanel` | Sign payload → 签署载荷; Switch network → 切换网络; Target / Function / Parameters / Network → 目标 / 函数 / 参数 / 网络; Warning / confirmation copy → 警告与确认文案 |
| `RoleWorkspacePage` | Administrative workspace → 管理端工作台; chain/load errors; Relayer import/export titles and buttons |
| Display helpers | Yes / No / Unavailable → 是 / 否 / 暂无 |
| Badges | Legacy Compatible / Target / State-eligible → use `t.workspaces.badges` (+ new keys as needed) |

**Keep English:** role/module/product technical nouns listed in Decisions; contract method names; addresses; hex / numeric chain values.

Keys live under `t.workspaces` in `zh-CN.js` and mirrored in `en.js`. Prefer extending the existing `workspaces` tree over scattering new top-level namespaces.

## Styling

File: `src/styles/workspaces.css` (extend, don’t fork).

- Collapsed row: same panel surface/border/radius as `ws-action-panel`; hover slightly stronger border
- Open row: navy left accent border
- Badges: extend `ws-capability--*` palette (available green, unauthorized orange, paused gold, read-only muted)
- Dangerous: thin red leading edge +「高风险」chip on the summary
- Touch: summary min-height ≥ 44px; whole summary is the hit target
- Respect reduced motion if project already does elsewhere; no new gratuitous animation beyond chevron/open

## Testing

- Update / add tests around accordion: default closed; opening one closes another; open panel content present only when expanded
- Keep capability and execute tests pointed at expanded panel (tests may need to click summary first)
- Smoke: locale `zh-CN` renders Chinese submit labels from i18n keys

## Acceptance criteria

1. Opening any operational role workspace shows all task modules collapsed.  
2. At most one action module expanded; clicking the open summary collapses it.  
3. Collapsed summary shows Chinese title + capability badge.  
4. In `zh-CN`, UI chrome (buttons, legends, alerts, confirmation copy) has no English operator wording except approved terms.  
5. Existing workspace unit tests pass after minimal selector updates.

## Implementation sketch (for planning)

1. Add i18n keys (zh + en) for chrome strings.  
2. Wire `ActionPanel` / `ActionForm` / role page alerts / Relayer blocks to i18n.  
3. Add `ActionAccordionItem` + accordion state in `RoleWorkspacePage`.  
4. CSS for summary / open / dangerous / badges.  
5. Adjust tests; manual check on a multi-action role (e.g. governor, keeper).
