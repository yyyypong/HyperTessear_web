/**
 * Central route table for public pages, management entries, and workspaces.
 * Network is never encoded in the URL — it lives in NetworkContext.
 */

export const ROUTES = Object.freeze({
  home: '/',
  products: '/products',
  productDetail: '/products/:slug',
  productsTransparency: '/products/transparency',
  productsLiquidity: '/products/liquidity',

  assetsIssue: '/assets/issue',
  assetsIssueNew: '/assets/issue/new',
  assetsIssueManage: '/assets/issue/manage',
  assetsIssueOracle: '/assets/issue/oracle',
  assetsWrap: '/assets/wrap',
  assetsWrapWrap: '/assets/wrap/wrap',
  assetsWrapManage: '/assets/wrap/manage',

  vaultsCreate: '/vaults/create',
  vaultsManage: '/vaults/manage',

  workspaceVault: '/workspace/vault/:vaultAddress/:role',
  workspaceAssetIssuer: '/workspace/asset/:assetId/asset-issuer',
  workspaceNavProvider: '/workspace/asset/:assetId/nav-provider',
  workspaceTokenAgent: '/workspace/issuance/token-agent',
  workspaceWrapped: '/workspace/wrapped/:assetId/:role',
  workspaceGovernor: '/workspace/protocol/governor',

  about: '/about',
  dashboard: '/dashboard',
  developmentDocs: '/development-docs',
  blog: '/blog',

  // Legacy redirects
  legacyTransparency: '/transparency',
  legacyLiquidity: '/liquidity',
  legacyIssuance: '/issuance',
});

export const PRIMARY_NAV = Object.freeze([
  {
    id: 'yield',
    labelKey: 'nav.yieldProducts',
    children: [
      { to: ROUTES.products, labelKey: 'nav.allProducts' },
      { to: ROUTES.productsTransparency, labelKey: 'nav.transparency' },
      { to: ROUTES.productsLiquidity, labelKey: 'nav.liquidity' },
    ],
  },
  {
    id: 'issuance',
    labelKey: 'nav.assetIssuance',
    children: [
      { to: ROUTES.assetsIssue, labelKey: 'nav.issueAssetTokens' },
      { to: ROUTES.assetsWrap, labelKey: 'nav.wrapAssetTokens' },
    ],
  },
  {
    id: 'management',
    labelKey: 'nav.assetManagement',
    children: [
      { to: ROUTES.vaultsCreate, labelKey: 'nav.createVault' },
      { to: ROUTES.vaultsManage, labelKey: 'nav.manageVault' },
    ],
  },
  {
    id: 'resources',
    labelKey: 'nav.resources',
    children: [
      { to: ROUTES.about, labelKey: 'nav.about' },
      { to: ROUTES.dashboard, labelKey: 'nav.dashboard' },
      { to: ROUTES.developmentDocs, labelKey: 'nav.docs' },
      { to: ROUTES.blog, labelKey: 'nav.blog' },
    ],
  },
]);

export const PROTOCOL_NAV = Object.freeze({
  id: 'protocol',
  labelKey: 'nav.protocolManagement',
  to: ROUTES.workspaceGovernor,
});
