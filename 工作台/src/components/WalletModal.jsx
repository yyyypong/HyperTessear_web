import { useEffect } from 'react';
import {
  WalletMetamask, WalletOkx, WalletCoinbase, WalletTrust,
  WalletPhantom, WalletRabby, WalletRainbow, WalletZerion,
} from '@web3icons/react';
import { useI18n } from '../i18n';
import { useWallet } from '../wallet';

/* ----------------------------------------------------------------
   The mainstream wallet shelf.

   Every row carries the wallet's official brand mark (web3icons). A
   wallet the browser has actually announced (EIP-6963) connects in
   place; one that is not installed links out to its official install
   page instead of failing opaquely after the click. `match` is the
   substring looked for in the announced provider's name / rdns.
   ---------------------------------------------------------------- */
const WALLET_SHELF = [
  { key: 'metamask', name: 'MetaMask', Icon: WalletMetamask,
    url: 'https://metamask.io/download/' },
  { key: 'okx', name: 'OKX Wallet', Icon: WalletOkx,
    url: 'https://www.okx.com/web3' },
  { key: 'coinbase', name: 'Coinbase Wallet', Icon: WalletCoinbase,
    url: 'https://www.coinbase.com/wallet/downloads' },
  { key: 'trust', name: 'Trust Wallet', Icon: WalletTrust,
    url: 'https://trustwallet.com/browser-extension' },
  { key: 'rabby', name: 'Rabby', Icon: WalletRabby,
    url: 'https://rabby.io' },
  { key: 'phantom', name: 'Phantom', Icon: WalletPhantom,
    url: 'https://phantom.com/download' },
  { key: 'rainbow', name: 'Rainbow', Icon: WalletRainbow,
    url: 'https://rainbow.me/extension' },
  { key: 'zerion', name: 'Zerion', Icon: WalletZerion,
    url: 'https://zerion.io/download' },
];

function findProvider(providers, key) {
  const k = key.toLowerCase();
  return providers.find(p => (
    (p.info?.name || '').toLowerCase().includes(k)
    || (p.info?.rdns || '').toLowerCase().includes(k)
  ));
}

function WalletGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2Z" />
      <circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function WalletModal() {
  const { t } = useI18n();
  const {
    providers, modalOpen, closeModal, connect, connecting, error,
    demoWallets, connectDemo,
  } = useWallet();

  /* Esc closes; the page behind is frozen while the sheet is up. */
  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [modalOpen, closeModal]);

  if (!modalOpen) return null;

  /* Announced providers that are not on the shelf get their own rows so
     a niche wallet is never hidden just because it is unlisted. */
  const shelfProviders = WALLET_SHELF.map(w => findProvider(providers, w.key)).filter(Boolean);
  const otherProviders = providers.filter(p => !shelfProviders.includes(p));

  return (
    <div className="lwmodal" role="dialog" aria-modal="true" aria-label={t.wallet.title}>
      <button className="lwmodal__scrim" onClick={closeModal} aria-label={t.wallet.title} tabIndex={-1} />
      <div className="lwmodal__panel">
        <div className="lwmodal__head">
          <div>
            <h2 className="lwmodal__title">{t.wallet.title}</h2>
            <p className="lwmodal__sub">{t.wallet.subtitle}</p>
          </div>
          <button className="lwmodal__close" onClick={closeModal} aria-label="Close" autoFocus>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {otherProviders.length > 0 && (
          <>
            <div className="lwmodal__section-label">{t.wallet.otherDetected}</div>
            <div className="lwmodal__list">
              {otherProviders.map(detail => {
                const busy = connecting === detail.info.uuid;
                return (
                  <button
                    key={detail.info.uuid}
                    className="lwrow"
                    onClick={() => connect(detail)}
                    disabled={Boolean(connecting)}
                  >
                    <span className="lwrow__icon">
                      {detail.info.icon
                        ? <img src={detail.info.icon} alt="" width="24" height="24" />
                        : <WalletGlyph />}
                    </span>
                    <span className="lwrow__name">{detail.info.name || t.wallet.browserWallet}</span>
                    <span className="lwrow__tag">{t.wallet.detected}</span>
                    <span className="lwrow__state">{busy ? t.wallet.connecting : '→'}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="lwmodal__section-label">{t.wallet.popular}</div>
        <div className="lwmodal__list">
          {WALLET_SHELF.map(({
            key, name, Icon, url,
          }) => {
            const detail = findProvider(providers, key);
            const busy = detail && connecting === detail.info.uuid;

            if (detail) {
              return (
                <button
                  key={key}
                  className="lwrow"
                  onClick={() => connect(detail)}
                  disabled={Boolean(connecting)}
                >
                  <span className="lwrow__icon"><Icon size={22} variant="branded" /></span>
                  <span className="lwrow__name">{name}</span>
                  <span className="lwrow__tag">{t.wallet.detected}</span>
                  <span className="lwrow__state">{busy ? t.wallet.connecting : '→'}</span>
                </button>
              );
            }
            return (
              <a key={key} className="lwrow" href={url} target="_blank" rel="noreferrer">
                <span className="lwrow__icon"><Icon size={22} variant="branded" /></span>
                <span className="lwrow__name">{name}</span>
                <span className="lwrow__state">{t.wallet.get} →</span>
              </a>
            );
          })}
        </div>

        {error && <p className="lwmodal__error">{t.wallet.rejected}</p>}

        <div className="lwmodal__section-label">{t.access.demoWallets}</div>
        <p className="lwmodal__hint">{t.access.demoHint}</p>
        <div className="lwmodal__list">
          {demoWallets.map(w => (
            <button
              key={w.id}
              type="button"
              className="lwrow lwrow--demo"
              onClick={() => connectDemo(w.address)}
            >
              <span className="lwrow__icon"><WalletGlyph /></span>
              <span className="lwrow__name">
                {w.label}
                <span className="lwrow__sub">{w.description}</span>
              </span>
              <span className="lwrow__tag lwrow__tag--demo">{t.access.demo}</span>
              <span className="lwrow__state">→</span>
            </button>
          ))}
        </div>

        <p className="lwmodal__note">{t.detail?.connectNote ?? ''}</p>
      </div>
    </div>
  );
}
