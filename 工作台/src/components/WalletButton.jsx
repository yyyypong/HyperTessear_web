import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { chainName, truncateAddress, useWallet } from '../wallet';
import { useNetwork } from '../contexts/NetworkContext';

/* Business-network picker shown once a wallet is connected. Selecting a
   network drives role resolution in AccessContext. */
function NetworkPicker() {
  const { t } = useI18n();
  const { supportedNetworks, selectedNetworkId, setSelectedNetworkId, mismatch } = useNetwork();
  const { connected } = useWallet();
  if (!connected) return null;
  return (
    <label className="netpick" title={mismatch ? t.access.networkMismatchHint : undefined}>
      <span className="netpick__label">{t.access.network}</span>
      <select
        value={selectedNetworkId}
        onChange={(e) => setSelectedNetworkId(e.target.value)}
        className={mismatch ? 'netpick__select netpick__select--warn' : 'netpick__select'}
      >
        {supportedNetworks.map(n => (
          <option key={n.id} value={n.id}>{n.name}</option>
        ))}
      </select>
      {mismatch && <span className="netpick__warn" title={t.access.networkMismatchHint}>!</span>}
    </label>
  );
}

/**
 * The masthead wallet control.
 *
 * Disconnected: the gold "Connect Wallet" button opens the wallet sheet.
 * Connected: a business-network picker plus a quiet address pill that
 * opens an account menu — wallet, network, copy, switch, disconnect.
 */
export default function WalletButton() {
  const { t } = useI18n();
  const { session, openModal, disconnect, isDemo, shortAddress } = useWallet();
  const { mismatch } = useNetwork();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (!session) {
    return (
      <button className="lnav__cta" onClick={openModal}>
        {t.nav.connect}
        <span className="arw" aria-hidden="true">→</span>
      </button>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the address is visible to select */ }
  };

  return (
    <>
      <NetworkPicker />
      <span className="wbtn" ref={rootRef}>
        <button
          className={`lnav__cta lnav__cta--addr${mismatch ? ' lnav__cta--warn' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <span className="statusdot" />
          <span className="wbtn__addr">{isDemo ? `${t.access.demo} · ` : ''}{shortAddress || truncateAddress(session.address)}</span>
        </button>

        <span className="wbtn__menu" hidden={!menuOpen} role="menu">
          <span className="wbtn__meta">
            <b>{session.info?.name || t.wallet.browserWallet}</b>
            <span>{t.wallet.network} · {session.chainId ? chainName(session.chainId) : '—'}</span>
          </span>
          <button className="wbtn__item" onClick={copy} role="menuitem">
            {copied ? t.wallet.copied : t.wallet.copy}
            <span className="wbtn__mono">{truncateAddress(session.address)}</span>
          </button>
          <button
            className="wbtn__item"
            onClick={() => { setMenuOpen(false); openModal(); }}
            role="menuitem"
          >
            {t.access.switchAccount}
          </button>
          <button
            className="wbtn__item wbtn__item--danger"
            onClick={() => { setMenuOpen(false); disconnect(); }}
            role="menuitem"
          >
            {t.wallet.disconnect}
          </button>
        </span>
      </span>
    </>
  );
}
