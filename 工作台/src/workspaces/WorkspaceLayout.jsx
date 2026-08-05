import { Theme } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import WorkspaceSidebar from './components/WorkspaceSidebar';
import ContextBar from './components/ContextBar';
import { TransactionProvider } from './core/transactionStore';

function useMobileViewport() {
  const query = '(max-width: 959px)';
  const [mobile, setMobile] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return mobile;
}

export default function WorkspaceLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const triggerRef = useRef(null);
  const isMobile = useMobileViewport();

  useEffect(() => {
    if (!drawerOpen) return undefined;
    drawerRef.current?.focusDrawer();
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <TransactionProvider>
    <Theme appearance="light" accentColor="blue" radius="medium" className="ht-workspaces" data-mobile={isMobile ? 'true' : 'false'}>
      <a className="ws-skip" href="#workspace-content">Skip to workspace content</a>
      <div className="ws-shell">
        <div className="ws-mobile-nav-bar">
          <button
            ref={triggerRef}
            type="button"
            className="ws-menu-button"
            aria-label="Open workspace navigation"
            aria-controls="workspace-sidebar"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
        <WorkspaceSidebar
          ref={drawerRef}
          mobile={isMobile}
          open={drawerOpen}
          onNavigate={() => setDrawerOpen(false)}
          onClose={() => {
            setDrawerOpen(false);
            triggerRef.current?.focus();
          }}
        />
        <div className="ws-main-column">
          <ContextBar />
          <main id="workspace-content" className="ws-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </Theme>
    </TransactionProvider>
  );
}
