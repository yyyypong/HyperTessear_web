import { useI18n } from '../../i18n';
import { useNetwork } from '../../contexts/NetworkContext';
import { useWallet } from '../../wallet';

/**
 * Ensures a supported business network is selected and the wallet chain matches.
 */
export default function NetworkGate({ children }) {
  const { t } = useI18n();
  const {
    supportedNetworks,
    selectedNetworkId,
    selectedNetwork,
    setSelectedNetworkId,
    mismatch,
    requestWalletSwitch,
  } = useNetwork();
  const { connected, switchChain } = useWallet();

  if (!connected) return null;

  if (!selectedNetwork) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.networkEyebrow}</div>
        <h2 className="gate__title">{t.access.selectNetworkTitle}</h2>
        <p className="gate__body">{t.access.selectNetworkBody}</p>
        <div className="gate__choices">
          {supportedNetworks.map(n => (
            <button
              key={n.id}
              type="button"
              className="btn btn--ghost"
              onClick={() => setSelectedNetworkId(n.id)}
            >
              {n.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (mismatch) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.networkEyebrow}</div>
        <h2 className="gate__title">{t.access.networkMismatchTitle}</h2>
        <p className="gate__body">
          {t.access.networkMismatchBody
            .replace('{business}', selectedNetwork.name)
            .replace('{wallet}', t.access.walletNetworkOther)}
        </p>
        <div className="gate__choices">
          <button
            type="button"
            className="btn btn--gold"
            onClick={() => requestWalletSwitch().catch(() => {})}
          >
            {t.access.switchWalletNetwork.replace('{network}', selectedNetwork.name)}
          </button>
          <div className="gate__or">{t.access.orSelectOther}</div>
          {supportedNetworks.map(n => (
            <button
              key={n.id}
              type="button"
              className={`btn btn--sm ${n.id === selectedNetworkId ? 'btn--gold' : 'btn--ghost'}`}
              onClick={async () => {
                setSelectedNetworkId(n.id);
                try { await switchChain(n.chainId); } catch { /* ignore */ }
              }}
            >
              {n.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return children;
}
