# HyperTessera Interactive Demo V2 Design QA

## Evidence

- Source visual truth: `qa-interactive-demo-v2/source-old-demo-home.png`
- Implementation desktop: `qa-interactive-demo-v2/implementation-v2-home.png`
- Implementation mobile: `qa-interactive-demo-v2/implementation-v2-mobile-products.png`
- Combined comparison: `qa-interactive-demo-v2/comparison-desktop.png`
- Desktop source pixels: 1280 x 720
- Desktop implementation pixels: 1265 x 712
- Mobile implementation pixels: 375 x 812 from a 390 x 844 browser viewport override
- Density normalization: browser screenshots captured at the same native browser density; desktop comparison scales both captures into equal-width columns without cropping.
- Desktop state: public home, light theme, wallet-connected header in V2.
- Mobile state: Products list, light theme, wallet connected, navigation available.

## Full-view Comparison

The combined desktop comparison confirms that V2 retains the previous demo's light blue-gray product language, rounded white surfaces, navy text and blue emphasis. The hierarchy is intentionally expanded from a form-first utility screen to a complete product shell: persistent navigation, product-level hero, guided flow and clear separation between public, Web3 and internal operations surfaces.

The change in hero scale and information density is intentional and directly serves the approved requirement that the demo be clearer during presentation. It is not treated as fidelity drift.

## Focused Region Comparison

Focused browser inspections covered the header controls, wallet selector, My Access permission groups, Vault Owner workspace, listing application, Ops login error, Ops dashboard, review detail, Products synchronization and the mobile Products header. Separate image crops were not required because text, controls and spacing were readable in the browser captures at native scale.

## Required Fidelity Surfaces

- Fonts and typography: Segoe UI with Chinese system fallbacks renders consistently. Display headings, body copy, labels, metrics and monospace addresses have distinct hierarchy. No clipped or ambiguous text was observed.
- Spacing and layout rhythm: desktop uses a stable 1360px shell, 14px surface radius, 16-28px content rhythm and a consistent 70px header. Workspace and Ops sidebars retain their own predictable grids. Mobile cards collapse without horizontal page overflow.
- Colors and visual tokens: navy, white, blue-gray, success, warning and danger tokens stay consistent across public, Web3 and Ops surfaces. Status contrast is readable and semantics are not conveyed by color alone because every status includes text.
- Image quality and asset fidelity: neither the source demo nor V2 depends on product imagery, illustrations or decorative icons. No missing image asset, placeholder image, inline SVG substitute or low-quality raster was introduced.
- Copy and content: visible copy consistently distinguishes website listing from chain state, Mock operations from SDK calls, wallet identity from Ops authentication, and Proof Publisher from Relayer.

## Findings and Comparison History

### Iteration 1

- [P1] Mobile navigation disappeared below 1020px.
  - Evidence: the first 390px Products capture showed only the brand and wallet control, with no path to Products, asset issuance, asset management or My Access.
  - Impact: mobile users could not traverse the core demo.
  - Fix: added a responsive `data-mobile-nav` select with the four primary destinations, and retained the wallet control beside it.

### Iteration 2

- Post-fix evidence: `qa-interactive-demo-v2/implementation-v2-mobile-products.png` shows the visible navigation control, readable header, stacked filters and complete product card.
- Browser interaction verified that selecting My Access changes the route and renders the connected account's seven roles.

### Iteration 3

- [P1] Modal backdrop delegated-click handling intercepted controls inside the modal.
  - Evidence: selecting an account or reset from the modal closed the surface before executing the requested action.
  - Impact: the primary wallet connection route and demo reset control required an unintended second attempt.
  - Fix: changed backdrop dismissal from ancestor matching to direct event-target matching and added a regression contract test.
- Post-fix evidence: the guide reset control restores the disconnected initial state on the first click, the wallet selector accepts an account on the first click, and the browser console remains clean.
- No remaining P0, P1 or P2 issue was observed.

## Primary Interactions Tested

1. Open wallet selector and connect Alice multi-role account.
2. Open My Access and verify seven Ethereum roles.
3. Enter Vault Owner workspace.
4. Open and submit the Vault website listing application.
5. Attempt Ops login with an incorrect password and verify inline error.
6. Log in with the provided demo credentials.
7. Open the T-Bill review record and approve it for website listing.
8. Open Products and verify T-Bill Income Vault is visible.
9. Navigate from Products to My Access using the mobile navigation.
10. Reload routed pages and verify state persistence.

## Browser Health

- Console errors: 0
- Console warnings: 0
- Automated contract tests: 6 passing

## Follow-up Polish

- [P3] A future branded font can replace system fonts after the production brand typography is finalized.
- [P3] Production integration can add real transaction hashes and loading states when SDK calls replace Mock actions.

final result: passed
