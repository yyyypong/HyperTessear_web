import WalletGate from './WalletGate';
import NetworkGate from './NetworkGate';

/** Standard entry wrapper: WalletGate → NetworkGate → children. */
export default function ManagementEntry({ children }) {
  return (
    <WalletGate>
      <NetworkGate>
        {children}
      </NetworkGate>
    </WalletGate>
  );
}
