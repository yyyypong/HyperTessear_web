export function TabNav({ tabs, active, onSelect, ariaLabel }) {
  return (
    <div className="bp-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`bp-tab${active === tab.id ? ' bp-tab--active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.icon ? `${tab.icon} ` : ''}{tab.label}
        </button>
      ))}
    </div>
  );
}
