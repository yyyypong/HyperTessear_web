import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import { getDeployment } from '../config/deployments';
import { useTransactions } from '../core/transactionStore';
import TransactionDrawer from '../components/TransactionDrawer';

export default function ActivityPage({ explorerUrl }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const { session } = useWallet();
  const { entries } = useTransactions();
  const resolvedExplorerUrl = explorerUrl ?? getDeployment(session?.chainId)?.explorerUrl;
  return (
    <section className="ws-page ws-activity-page">
      <p className="ws-eyebrow">Workspaces</p>
      <h1>Activity</h1>
      <p>Prepared transactions and signature outcomes from this workspace session.</p>
      <button className="ws-activity-page__open" type="button" onClick={() => setOpen(true)}>Open transaction activity ({entries.length})</button>
      <ul aria-label="Recent workspace activity">{entries.slice().reverse().map(entry => <li key={entry.id}><strong>{entry.actionId}</strong><span>{t.workspaces.transaction[entry.status] ?? entry.status}</span></li>)}</ul>
      <TransactionDrawer open={open} onClose={() => setOpen(false)} explorerUrl={resolvedExplorerUrl} />
    </section>
  );
}
