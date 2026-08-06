import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import { useNetwork } from '../../contexts/NetworkContext';
import { getNetworkByChainId } from '../../config/networks';

export function shortAddress(address) {
  if (!address || typeof address !== 'string') return '—';
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function CallTag({ children }) {
  return <span className="bp-call-tag">{children}</span>;
}

export function Badge({ tone = 'neutral', children }) {
  const cls = tone === 'neutral' ? 'bp-badge' : `bp-badge bp-badge--${tone}`;
  return <span className={cls}>{children}</span>;
}

const STATUS_TONES = {
  active: 'success', approved: 'success', listed: 'success',
  paused: 'danger', pending: 'warning', submitted: 'warning', executed: 'neutral',
};

export function StatusBadge({ status }) {
  const { t } = useI18n();
  const key = String(status || 'pending').toLowerCase();
  const label = t.bp?.status?.[key] ?? status;
  return <Badge tone={STATUS_TONES[key] || 'neutral'}>{label}</Badge>;
}

export function PageHead({ eyebrow, title, lede, children }) {
  return (
    <div className="bp-page-head">
      <div>
        {eyebrow && <div className="bp-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p>{lede}</p>}
      </div>
      {children && <div className="bp-row">{children}</div>}
    </div>
  );
}

export function ContextBar({ extra = [] }) {
  const { t } = useI18n();
  const { address, chainId, connected } = useWallet();
  const { selectedNetworkId } = useNetwork();
  const walletNetwork = chainId != null ? getNetworkByChainId(chainId) : null;
  const networkLabel = walletNetwork?.name ?? (connected && chainId != null ? `Chain ${chainId}` : selectedNetworkId);
  const items = [
    { label: t.bp.context.network, value: networkLabel },
    { label: t.bp.context.wallet, value: connected ? shortAddress(address) : t.bp.context.notConnected },
    ...extra,
  ];
  return (
    <div className="bp-contextbar bp-card">
      {items.map(item => (
        <div className="bp-context-item" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function SidePanel({ contract, permission, permissionNote, pre, events, next, note }) {
  const { t } = useI18n();
  return (
    <aside className="bp-side-panel">
      <h4>{t.bp.sidePanel.title}</h4>
      <p className="bp-side-panel__desc">{contract ? t.bp.sidePanel.descOnchain : t.bp.sidePanel.descLocal}</p>
      <div className="bp-kv"><span>{t.bp.sidePanel.contract}</span><strong className="bp-mono">{contract || '—'}</strong></div>
      <div className="bp-kv"><span>{t.bp.sidePanel.permission}</span><strong>{permission || '—'}</strong></div>
      {permissionNote && <div className="bp-kv"><span>{t.bp.sidePanel.permissionNote}</span><strong>{permissionNote}</strong></div>}
      {pre && <div className="bp-kv"><span>{t.bp.sidePanel.pre}</span><strong>{pre}</strong></div>}
      {events && <div className="bp-kv"><span>{t.bp.sidePanel.events}</span><strong className="bp-mono">{events}</strong></div>}
      {next && <div className="bp-kv"><span>{t.bp.sidePanel.next}</span><strong>{next}</strong></div>}
      {note && <div className="bp-alert">{note}</div>}
    </aside>
  );
}

export function WorkLayout({ main, aside }) {
  return (
    <div className="bp-work-layout">
      <div className="bp-stack">{main}</div>
      {aside}
    </div>
  );
}

export function FlowBar({ steps, current = 0 }) {
  return (
    <div className="bp-flowbar">
      {steps.map((step, i) => (
        <div
          key={step.t}
          className={`bp-flowstep${i < current ? ' bp-flowstep--done' : i === current ? ' bp-flowstep--current' : ''}`}
        >
          <span className="bp-flowstep__no">{i + 1}</span>
          <strong>{step.t}</strong>
          <span>{step.d}</span>
        </div>
      ))}
    </div>
  );
}

export function StatCards({ items }) {
  return (
    <div className="bp-stats">
      {items.map(item => (
        <div className="bp-stat" key={item.label}>
          <div className="bp-stat__label">
            <span className={`bp-stat__dot${item.dot ? ` bp-stat__dot--${item.dot}` : ''}`} />
            {item.label}
          </div>
          <div className="bp-stat__value" style={item.smallValue ? { fontSize: 20 } : undefined}>{item.value}</div>
          <div className="bp-stat__foot">{item.foot}</div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <td colSpan={12}>
      <div className="bp-empty">
        <h3>{title}</h3>
        <p>{body}</p>
        {action}
      </div>
    </td>
  );
}

export function EdgeList({ rows }) {
  return (
    <div className="bp-edge-list">
      {rows.map((row, i) => (
        <div className="bp-edge-row" key={i}>
          <div className="bp-edge-row__from">{row.from}</div>
          <div className="bp-edge-row__via">{row.via}</div>
          <div className="bp-edge-row__to">{row.to}</div>
          <div className="bp-edge-row__cond">{row.cond}</div>
        </div>
      ))}
    </div>
  );
}
