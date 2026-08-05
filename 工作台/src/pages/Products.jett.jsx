import { useMemo, useState } from 'react';
import { useI18n, fmt, Highlight } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import ProductCard from '../components/ProductCard';
import { ErrorState, Skeleton } from '../components/ui';

const EMPTY = { term: '', role: '', manager: '', network: '' };

function FilterBar({ filters, value, onChange, onReset }) {
  const { t } = useI18n();

  const groups = [
    { key: 'term', label: t.products.filterTerm, options: filters.terms },
    { key: 'role', label: t.products.filterRole, options: filters.roles },
    { key: 'manager', label: t.products.filterManager, options: filters.managers },
    { key: 'network', label: t.products.filterNetwork, options: filters.networks },
  ];

  const dirty = Object.values(value).some(Boolean);

  return (
    <div className="filterbar">
      {groups.map(g => (
        <label className="filtergrp" key={g.key}>
          <span className="filtergrp__label">{g.label}</span>
          <select
            value={value[g.key]}
            onChange={(e) => onChange({ ...value, [g.key]: e.target.value })}
          >
            <option value="">{t.products.filterAll}</option>
            {g.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      ))}
      <div className="filterbar__reset">
        <button className="btn btn--sm btn--ghost" onClick={onReset} disabled={!dirty}>
          {t.products.filterReset}
        </button>
      </div>
    </div>
  );
}

/**
 * The wireframe's four filter selects were decorative — static <option>
 * lists over three hardcoded cards. Here the options come from the API
 * and actually filter the grid.
 *
 * Note the deliberate choice NOT to build midas.app's 7-column table:
 * with three live products a table is the wrong instrument. The data
 * model supports one when the USDC series lands in phase 2.
 */
export default function Products() {
  const { t } = useI18n();
  const { data, loading, error, retry } = useApi(api.products);
  const [filters, setFilters] = useState(EMPTY);

  const all = (data?.products ?? []).filter(p => p.status === 'live');

  const shown = useMemo(() => all.filter(p =>
    (!filters.term || p.termLabel === filters.term) &&
    (!filters.role || p.roleLabel === filters.role) &&
    (!filters.manager || p.strategyManager === filters.manager) &&
    (!filters.network || p.network === filters.network)
  ), [all, filters]);

  // Live products only — coming_soon products and the Coming Soon section are removed.
  const liveAll = all;
  const live = shown;

  return (
    <div className="wrap">
      <div className="phead">
        <div className="section__eyebrow">{t.products.eyebrow}</div>
        <h1 className="phead__title">{t.products.title}</h1>
        <p className="section__lede">{t.products.lede}</p>
      </div>

      {/* Highlights — the promo slot midas.app puts above its table */}
      <div className="highlight">
        <div className="highlight__ic" />
        <div style={{ flex: 1 }}>
          <span className="highlight__badge">{t.products.highlightBadge}</span>
          <div className="highlight__title">{t.products.highlightTitle}</div>
          <div className="pcard__sub" style={{ marginTop: 3 }}>{t.products.highlightSub}</div>
        </div>
      </div>

      {loading && (
        <div className="pcards" style={{ marginTop: 30 }}>
          {[0, 1, 2].map(i => (
            <div className="pcard" key={i}>
              <Skeleton height={40} />
              <Skeleton height={30} style={{ marginTop: 14 }} />
              <Skeleton height={60} style={{ marginTop: 14 }} />
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ marginTop: 24 }}><ErrorState error={error} onRetry={retry} /></div>}

      {!loading && !error && data && (
        <>
          <FilterBar
            filters={data.filters}
            value={filters}
            onChange={setFilters}
            onReset={() => setFilters(EMPTY)}
          />
          <div className="filterbar__count">
            {fmt(t.products.resultCount, { n: live.length, total: liveAll.length })}
          </div>

          {live.length === 0 && (
            <div className="comingsoon" style={{ marginTop: 20 }}>
              <div className="comingsoon__body">{t.products.noResults}</div>
            </div>
          )}

          {live.length > 0 && (
            <div className="pcards" style={{ marginTop: 26 }}>
              {live.map(p => <ProductCard key={p.slug} product={p} />)}
            </div>
          )}
        </>
      )}

      {/* Kept from the wireframe, which surfaced this better than
          midas.app does — midas buries the equivalent in 8pt footnotes. */}
      <div className="risk">
        <div className="risk__ic">!</div>
        <div>
          <div className="risk__title">{t.products.riskTitle}</div>
          <Highlight text={t.products.riskText} as="p" className="risk__text" />
        </div>
      </div>
    </div>
  );
}
