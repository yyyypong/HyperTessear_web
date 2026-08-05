import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { useWallet } from '../wallet';
import { useNetwork } from '../contexts/NetworkContext';

function NetworkPicker() {
  const { t } = useI18n();
  const {
    supportedNetworks,
    selectedNetworkId,
    setSelectedNetworkId,
    mismatch,
  } = useNetwork();
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

function DemoModal() {
  const { t } = useI18n();
  const { demoOpen, setDemoOpen, demoWallets, connectDemo, providers, connectWithProvider } = useWallet();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!demoOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDemoOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [demoOpen, setDemoOpen]);

  if (!demoOpen) return null;

  // Portal to <body>: the sticky header's backdrop-filter creates a containing
  // block, which would anchor this fixed-position overlay to the header bar.
  return createPortal(
    <div className="wmodal" role="dialog" aria-modal="true" onClick={() => setDemoOpen(false)}>
      <div className="wmodal__panel" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="wmodal__head">
          <h3>{t.access.connectTitle}</h3>
          <button type="button" className="wmodal__close" onClick={() => setDemoOpen(false)}>×</button>
        </div>
        {providers.length > 0 && (
          <div className="wmodal__section">
            <div className="wmodal__label">{t.access.injectedWallets}</div>
            {providers.map(p => (
              <button
                key={p.info.uuid}
                type="button"
                className="wmodal__item"
                onClick={() => connectWithProvider(p)}
              >
                {p.info.name}
              </button>
            ))}
          </div>
        )}
        <div className="wmodal__section">
          <div className="wmodal__label">{t.access.demoWallets}</div>
          <p className="wmodal__hint">{t.access.demoHint}</p>
          {demoWallets.map(w => (
            <button
              key={w.id}
              type="button"
              className="wmodal__item"
              onClick={() => connectDemo(w.address)}
            >
              <span className="wmodal__item-title">{w.label}</span>
              <span className="wmodal__item-sub">{w.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Displays wallet state, selected business network, and mismatch status.
 */
export default function WalletButton() {
  const { t } = useI18n();
  const {
    connected, connect, connecting, disconnect, shortAddress, isDemo, setDemoOpen,
  } = useWallet();
  const { mismatch } = useNetwork();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!connected) {
    return (
      <>
        <button
          type="button"
          className="btn btn--sm btn--gold"
          onClick={() => {
            if (!window.ethereum && !connecting) setDemoOpen(true);
            else connect();
          }}
          disabled={connecting}
        >
          {connecting ? t.access.connecting : t.nav.connect}
        </button>
        <DemoModal />
      </>
    );
  }

  return (
    <>
      <NetworkPicker />
      <div className="wbtn">
        <button
          type="button"
          className={`btn btn--sm ${mismatch ? 'btn--ghost wbtn--warn' : 'btn--ghost'}`}
          onClick={() => setMenuOpen(v => !v)}
        >
          {isDemo ? `${t.access.demo} · ` : ''}{shortAddress}
        </button>
        {menuOpen && (
          <div className="wbtn__menu">
            <button type="button" className="wbtn__menu-item" onClick={() => { setDemoOpen(true); setMenuOpen(false); }}>
              {t.access.switchAccount}
            </button>
            <button type="button" className="wbtn__menu-item" onClick={() => { disconnect(); setMenuOpen(false); }}>
              {t.access.disconnect}
            </button>
          </div>
        )}
      </div>
      <DemoModal />
    </>
  );
}
