import { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useMetrics } from '../hooks/useMetrics';
import { useAccess } from '../contexts/AccessContext';
import { currencyCompact } from '../lib/format';
import { BrandMark, Skeleton } from './ui';
import WalletButton from './WalletButton';
import { PRIMARY_NAV, PROTOCOL_NAV, ROUTES } from '../config/routes';

function TvlBadge() {
  const { t } = useI18n();
  const { data, loading } = useMetrics();

  if (loading) return <Skeleton width={130} height={28} style={{ borderRadius: 20 }} />;
  if (!data?.currentTVL) return null;

  const isLive = data.protocolLiveStatus?.value !== false;

  return (
    <span className="tvlbadge" title={`${t.nav.tvlLabel} · ${t.common.asOf} ${data.currentTVL.lastUpdated}`}>
      <span className={`tvlbadge__dot${isLive ? '' : ' tvlbadge__dot--off'}`} />
      <span>TVL</span>
      <span className="tvlbadge__value">{currencyCompact(data.currentTVL.value)}</span>
    </span>
  );
}

function LangToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <span className="langtoggle">
      <button type="button" onClick={() => setLocale('zh-CN')} aria-pressed={locale === 'zh-CN'}>中</button>
      <button type="button" onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>EN</button>
    </span>
  );
}

function labelFor(t, key) {
  const [ns, leaf] = key.split('.');
  return t[ns]?.[leaf] || key;
}

function NavDropdown({ item, onNavigate }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const childActive = item.children?.some(c => pathname === c.to || pathname.startsWith(`${c.to}/`));

  return (
    <span className={`hdr__link hdr__drop${childActive ? ' hdr__link--active' : ''}`}>
      {labelFor(t, item.labelKey)}
      <span className="hdr__drop-menu">
        {item.children.map(child => (
          <Link
            key={child.to}
            className="hdr__drop-item"
            to={child.to}
            onClick={onNavigate}
          >
            {labelFor(t, child.labelKey)}
          </Link>
        ))}
      </span>
    </span>
  );
}

export default function Header() {
  const { t } = useI18n();
  const { isGovernor } = useAccess();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="hdr">
      <div className="wrap hdr__inner">
        <Link to="/" className="hdr__brand" onClick={closeMobile}>
          <BrandMark size={32} />
          <span className="hdr__brand-name">{t.brand}</span>
        </Link>

        <nav className="hdr__nav">
          {PRIMARY_NAV.map(item => (
            <NavDropdown key={item.id} item={item} />
          ))}
          {isGovernor && (
            <NavLink
              to={PROTOCOL_NAV.to}
              className={({ isActive }) => `hdr__link${isActive ? ' hdr__link--active' : ''}`}
            >
              {labelFor(t, PROTOCOL_NAV.labelKey)}
            </NavLink>
          )}
        </nav>

        <span className="hdr__spacer" />

        <div className="hdr__right">
          <TvlBadge />
          <LangToggle />
          <WalletButton />
          <button
            type="button"
            className="hdr__burger"
            aria-label={t.nav.menu}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(v => !v)}
          >
            <span />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="hdr__mobile">
          <div className="wrap">
            {PRIMARY_NAV.map(item => (
              <div key={item.id} className="hdr__mobile-group">
                <div className="hdr__mobile-title">{labelFor(t, item.labelKey)}</div>
                {item.children.map(child => (
                  <Link
                    key={child.to}
                    to={child.to}
                    className="hdr__mobile-link"
                    onClick={closeMobile}
                  >
                    {labelFor(t, child.labelKey)}
                  </Link>
                ))}
              </div>
            ))}
            {isGovernor && (
              <Link
                to={ROUTES.workspaceGovernor}
                className="hdr__mobile-link hdr__mobile-link--accent"
                onClick={closeMobile}
              >
                {labelFor(t, PROTOCOL_NAV.labelKey)}
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
