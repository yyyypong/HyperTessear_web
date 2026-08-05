import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LocaleProvider } from './i18n';
import { MetricsProvider } from './hooks/useMetrics';
import { WalletProvider } from './wallet';
import { NetworkProvider } from './contexts/NetworkContext';
import { AccessProvider } from './contexts/AccessContext';
import Header from './components/Header';
import Footer from './components/Footer';
import WalletModal from './components/WalletModal';
import Home from './pages/Home';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Transparency from './pages/Transparency';
import Liquidity from './pages/Liquidity';
import About from './pages/About';
import WorkspaceLayout from './workspaces/WorkspaceLayout';
import WorkspaceIndexPage from './workspaces/pages/WorkspaceIndexPage';
import WorkspaceNotFoundPage from './workspaces/pages/WorkspaceNotFoundPage';
import ActivityPage from './workspaces/pages/ActivityPage';
import PublicWorkspacePage from './workspaces/pages/PublicWorkspacePage';
import RoleWorkspacePage from './workspaces/pages/RoleWorkspacePage';
// jett management / role-workspace flow (assets · vaults · workspaces · resources)
import IssueAssetTokens from './pages/assets/IssueAssetTokens';
import IssueNewAssetToken from './pages/assets/IssueNewAssetToken';
import ManageIssuedAssets from './pages/assets/ManageIssuedAssets';
import OracleData from './pages/assets/OracleData';
import WrapAssetTokens from './pages/assets/WrapAssetTokens';
import WrapUnwrapAssets from './pages/assets/WrapUnwrapAssets';
import ManageWrappedAssets from './pages/assets/ManageWrappedAssets';
import CreateVault from './pages/vaults/CreateVault';
import ManageVault from './pages/vaults/ManageVault';
import VaultWorkspace from './pages/workspace/VaultWorkspace';
import AssetIssuerWorkspace from './pages/workspace/AssetIssuerWorkspace';
import NavProviderWorkspace from './pages/workspace/NavProviderWorkspace';
import TokenAgentWorkspace from './pages/workspace/TokenAgentWorkspace';
import WrappedWorkspace from './pages/workspace/WrappedWorkspace';
import GovernorWorkspace from './pages/workspace/GovernorWorkspace';
import Dashboard from './pages/resources/Dashboard';
import DevelopmentDocs from './pages/resources/DevelopmentDocs';
import Blog from './pages/resources/Blog';

/**
 * Router keeps scroll position between routes; a product page should open at
 * the top.
 *
 * `instant` overrides the document's smooth scrolling. With smooth in effect
 * a route change animated the whole page back to the top, so clicking a
 * product from halfway down the homepage played a second of scrollback before
 * the new page appeared. Smooth still applies to in-page jumps, which is what
 * it was set for.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

/** Cross-fades the page body on navigation. Keyed on pathname so the
    animation restarts per route. */
function Page({ children, workspace = false }) {
  const { pathname } = useLocation();
  return <div className={`pagefade${workspace ? ' pagefade--workspace' : ''}`} key={pathname}>{children}</div>;
}

function AppShell() {
  const { pathname } = useLocation();
  const isWorkspace = pathname === '/workspaces' || pathname.startsWith('/workspaces/');

  return (
    <MetricsProvider>
      <ScrollToTop />
      <div className="shell">
        <Header />
        <main className="shell__main">
          <Page workspace={isWorkspace}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/products" element={<Products />} />
              {/* Transparency and liquidity moved under the products
                  section per the structure plan; the old top-level paths
                  redirect so existing links keep working. */}
              <Route path="/products/transparency" element={<Transparency />} />
              <Route path="/products/liquidity" element={<Liquidity />} />
              <Route path="/transparency" element={<Navigate to="/products/transparency" replace />} />
              <Route path="/liquidity" element={<Navigate to="/products/liquidity" replace />} />
              <Route path="/products/:slug" element={<ProductDetail />} />
              {/* The issuance page was retired; keep old links landing
                  somewhere sensible rather than on an empty route. */}
              <Route path="/issuance" element={<Navigate to="/assets/issue" replace />} />
              <Route path="/about" element={<About />} />

              {/* jett: asset issuance & wrapping */}
              <Route path="/assets/issue" element={<IssueAssetTokens />} />
              <Route path="/assets/issue/new" element={<IssueNewAssetToken />} />
              <Route path="/assets/issue/manage" element={<ManageIssuedAssets />} />
              <Route path="/assets/issue/oracle" element={<OracleData />} />
              <Route path="/assets/wrap" element={<WrapAssetTokens />} />
              <Route path="/assets/wrap/wrap" element={<WrapUnwrapAssets />} />
              <Route path="/assets/wrap/manage" element={<ManageWrappedAssets />} />

              {/* jett: vaults */}
              <Route path="/vaults/create" element={<CreateVault />} />
              <Route path="/vaults/manage" element={<ManageVault />} />

              {/* jett: role workspaces */}
              <Route path="/workspace/vault/:vaultAddress/:role" element={<VaultWorkspace />} />
              <Route path="/workspace/asset/:assetId/asset-issuer" element={<AssetIssuerWorkspace />} />
              <Route path="/workspace/asset/:assetId/nav-provider" element={<NavProviderWorkspace />} />
              <Route path="/workspace/issuance/token-agent" element={<TokenAgentWorkspace />} />
              <Route path="/workspace/wrapped/:assetId/:role" element={<WrappedWorkspace />} />
              <Route path="/workspace/protocol/governor" element={<GovernorWorkspace />} />

              {/* jett: resources */}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/development-docs" element={<DevelopmentDocs />} />
              <Route path="/blog" element={<Blog />} />

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
            </Routes>
          </Page>
        </main>
        {!isWorkspace && <Footer />}
      </div>
      <WalletModal />
    </MetricsProvider>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <WalletProvider>
        <NetworkProvider>
          <AccessProvider>
            <BrowserRouter>
              <AppShell />
            </BrowserRouter>
          </AccessProvider>
        </NetworkProvider>
      </WalletProvider>
    </LocaleProvider>
  );
}
