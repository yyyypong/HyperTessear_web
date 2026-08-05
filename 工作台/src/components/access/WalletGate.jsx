import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';

/** Requires a connected wallet before rendering children. */
export default function WalletGate({ children }) {
  const { t } = useI18n();
  const { connected, connect, connecting } = useWallet();

  if (connected) return children;

  return (
    <div className="gate">
      <div className="gate__eyebrow">{t.access.walletRequiredEyebrow}</div>
      <h2 className="gate__title">{t.access.walletRequiredTitle}</h2>
      <p className="gate__body">{t.access.walletRequiredBody}</p>
      <button
        type="button"
        className="btn btn--gold"
        onClick={connect}
        disabled={connecting}
      >
        {connecting ? t.access.connecting : t.nav.connect}
      </button>
    </div>
  );
}
