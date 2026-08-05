import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { useTransactions } from '../core/transactionStore';

const SUMMARY_INPUT_KEYS = new Set(['vault', 'assetId', 'adapter', 'wrapper']);

function explorerHref(explorerUrl, hash) {
  if (!explorerUrl || !hash) return null;
  return `${String(explorerUrl).replace(/\/$/, '')}/tx/${hash}`;
}

function displaySummary(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.entries(input)
    .filter(([key, value]) => SUMMARY_INPUT_KEYS.has(key) && ['string', 'number', 'bigint'].includes(typeof value))
    .map(([key, value]) => `${key}: ${value}`);
}

export default function TransactionDrawer({ open = false, onClose, explorerUrl }) {
  const { t } = useI18n();
  const { entries } = useTransactions();
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement;
      dialogRef.current?.focus();
      return undefined;
    }
    previousFocus.current?.focus?.();
    return undefined;
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside className="ws-transaction-drawer" role="dialog" aria-modal="true" aria-label="Transaction activity" tabIndex={-1} ref={dialogRef}>
      <header><h2>Transaction activity</h2><button type="button" onClick={onClose} aria-label="Close activity">×</button></header>
      <ol>{entries.slice().reverse().map(entry => {
        const href = explorerHref(explorerUrl, entry.txHash);
        const summary = displaySummary(entry.input);
        return <li key={entry.id}><strong>{entry.actionId}</strong><span>{t.workspaces.transaction[entry.status] ?? entry.status}</span>{summary.length > 0 && <small>{summary.join(' · ')}</small>}{href && <a href={href} target="_blank" rel="noreferrer">View in explorer</a>}</li>;
      })}</ol>
    </aside>
  );
}
