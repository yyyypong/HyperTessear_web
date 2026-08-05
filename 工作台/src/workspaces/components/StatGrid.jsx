export default function StatGrid({ items = [] }) {
  return (
    <dl className="ws-stat-grid">
      {items.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}
