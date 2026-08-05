import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useScrolled } from '../hooks/useMotion';
import { useAccess } from '../contexts/AccessContext';
import WalletButton from './WalletButton';

/* Geometric clover mark — four rounded petals around a centre point,
   the navigational signature of the new cover. */
function CloverMark({ size = 26 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <g fill="currentColor">
        <rect x="13.2" y="3" width="5.6" height="12.4" rx="2.8" />
        <rect x="13.2" y="16.6" width="5.6" height="12.4" rx="2.8" />
        <rect x="3" y="13.2" width="12.4" height="5.6" rx="2.8" />
        <rect x="16.6" y="13.2" width="12.4" height="5.6" rx="2.8" />
      </g>
    </svg>
  );
}

/* Language switcher as a dropdown select box: one quiet pill that
   opens a small glass menu. `dropUp` flips the menu upward for the
   mobile drawer, where downward space is clipped. */
function LangSelect({ dropUp = false }) {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const options = [
    { id: 'zh-CN', label: '中文' },
    { id: 'en', label: 'English' },
  ];

  return (
    <span className={`llang${open ? ' llang--open' : ''}${dropUp ? ' llang--up' : ''}`} ref={rootRef}>
      <button
        className="llang__btn"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {locale === 'zh-CN' ? '中文' : 'EN'}
        <svg className="llang__chev" width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden="true">
          <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="llang__menu" hidden={!open} role="menu">
        {options.map(opt => (
          <button
            key={opt.id}
            className="llang__opt"
            role="menuitem"
            aria-pressed={locale === opt.id}
            onClick={() => { setLocale(opt.id); setOpen(false); }}
          >
            {opt.label}
            <svg className="llang__check" width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true">
              <path d="M1 4.5L4 7.5L10 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </span>
    </span>
  );
}

function Chevron() {
  return (
    <svg className="lmore__chev" width="8" height="5" viewBox="0 0 9 6" fill="none" aria-hidden="true">
      <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* A first-level nav entry with a hover dropdown. Items with a `to`
   navigate; items without one are intentionally inert placeholders for
   pages this phase does not build yet. */
function NavMenu({ label, items, active = false }) {
  return (
    <span className="lmore">
      <span
        className={`lnav__link lmore__trigger${active ? ' lnav__link--active' : ''}`}
        tabIndex={0}
        role="button"
        aria-haspopup="menu"
        onClick={(e) => e.currentTarget.focus()}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.focus(); }}
      >
        {label}
        <Chevron />
      </span>
      <span className="lmore__menu" role="menu">
        {items.map(item => (
          item.to ? (
            <NavLink key={item.label} to={item.to} className="lmore__item lmore__item--link" role="menuitem">
              {item.label}
            </NavLink>
          ) : (
            <span key={item.label} className="lmore__item" role="menuitem" aria-disabled="true">{item.label}</span>
          )
        ))}
      </span>
    </span>
  );
}

export default function Header() {
  const { t } = useI18n();
  const { isGovernor } = useAccess();
  const scrolled = useScrolled(40);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const onHome = pathname === '/';

  /* First-level structure per the frontend-structure plan: yield
     products stay the primary entry; asset issuance and asset management
     join as protocol-function entries; resources hold the secondary
     links. The protocol-management entry only appears for a Governor. */
  const productsActive = pathname.startsWith('/products');
  const issuanceActive = pathname.startsWith('/assets') || pathname.startsWith('/workspace/issuance') || pathname.startsWith('/workspace/asset');
  const managementActive = pathname.startsWith('/vaults') || pathname.startsWith('/workspace/vault');

  const productsMenu = [
    { to: '/products', label: t.nav.allProducts },
    { to: '/products/transparency', label: t.nav.transparency },
    { to: '/products/liquidity', label: t.nav.liquidity },
  ];
  const issuanceMenu = [
    { to: '/assets/issue', label: t.nav.issueAssetTokens },
    { to: '/assets/wrap', label: t.nav.wrapAssetTokens },
  ];
  const managementMenu = [
    { to: '/vaults/create', label: t.nav.createVault },
    { to: '/vaults/manage', label: t.nav.manageVault },
  ];
  const resourcesMenu = [
    { to: '/about', label: t.nav.about },
    { to: '/dashboard', label: t.nav.dashboard },
    { to: '/development-docs', label: t.nav.docs },
    { to: '/blog', label: t.nav.blog },
  ];

  /* The home cover is a warm cream field, so there the masthead starts
     ink-on-cream; other routes still open on dark bands and keep the
     white ghost until the page scrolls under it. */
  const light = scrolled && !open;

  return (
    <header className={`lnav${onHome ? ' lnav--home' : ''}${light ? ' lnav--light' : ''}${open ? ' lnav--open' : ''}`}>
      <div className="lnav__grid">
        <Link to="/" className="lnav__brand" onClick={() => setOpen(false)}>
          <CloverMark />
          <span className="lnav__brand-name">HyperTessera</span>
        </Link>

        <nav className="lnav__links">
          <NavMenu label={t.nav.yieldProducts} items={productsMenu} active={productsActive} />
          <NavMenu label={t.nav.assetIssuance} items={issuanceMenu} active={issuanceActive} />
          <NavMenu label={t.nav.assetManagement} items={managementMenu} active={managementActive} />
          <NavMenu label={t.nav.resources} items={resourcesMenu} />
          {isGovernor && (
            <NavLink
              to="/workspaces/governor"
              className={({ isActive }) => `lnav__link${isActive ? ' lnav__link--active' : ''}`}
            >
              {t.nav.protocolManagement}
            </NavLink>
          )}
        </nav>

        <div className="lnav__right">
          <LangSelect />
          <WalletButton />
          <button
            className="lnav__burger"
            aria-label={t.nav.menu}
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="lnav__drawer">
        <div className="lnav__drawer-inner">
          <span className="lmore__drawer-label">{t.nav.products}</span>
          {productsMenu.map(item => (
            <NavLink key={item.label} to={item.to} className="lmore__drawer-item" onClick={() => setOpen(false)}>{item.label}</NavLink>
          ))}
          <span className="lmore__drawer-label">{t.nav.assetIssuance}</span>
          {issuanceMenu.map(item => (
            <NavLink key={item.label} to={item.to} className="lmore__drawer-item" onClick={() => setOpen(false)}>{item.label}</NavLink>
          ))}
          <span className="lmore__drawer-label">{t.nav.assetManagement}</span>
          {managementMenu.map(item => (
            <NavLink key={item.label} to={item.to} className="lmore__drawer-item" onClick={() => setOpen(false)}>{item.label}</NavLink>
          ))}
          {isGovernor && (
            <NavLink to="/workspaces/governor" className="lmore__drawer-item" onClick={() => setOpen(false)}>{t.nav.protocolManagement}</NavLink>
          )}
          <span className="lmore__drawer-label">{t.nav.resources}</span>
          {resourcesMenu.map(item => (
            item.to ? (
              <NavLink key={item.label} to={item.to} className="lmore__drawer-item" onClick={() => setOpen(false)}>{item.label}</NavLink>
            ) : (
              <span key={item.label} className="lmore__drawer-item" aria-disabled="true">{item.label}</span>
            )
          ))}
          <div className="lnav__drawer-foot">
            <LangSelect dropUp />
          </div>
        </div>
      </div>
    </header>
  );
}
