import { useMemo, useState } from 'react';
import { useI18n, fmt, Highlight } from '../i18n';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import ProductCard from '../components/ProductCard';
import PageHead from '../components/PageHead';
import Reveal from '../components/Reveal';
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

  const all = data?.products ?? [];

  const shown = useMemo(() => all.filter(p =>
    (!filters.term || p.termLabel === filters.term) &&
    (!filters.role || p.roleLabel === filters.role) &&
    (!filters.manager || p.strategyManager === filters.manager) &&
    (!filters.network || p.network === filters.network)
  ), [all, filters]);

  const live = shown.filter(p => p.status === 'live');
  const soon = shown.filter(p => p.status === 'coming_soon');

  return (
    <>
      <PageHead
        eyebrow={t.products.eyebrow}
        title={t.products.title}
        lede={t.products.lede}
      />

      <section className="band band--paper">
        <div className="wrap">
          {/* Highlights — the promo slot midas.app puts above its table */}
          <Reveal className="highlight">
            <div className="highlight__ic" />
            <div style={{ flex: 1 }}>
              <span className="highlight__badge">{t.products.highlightBadge}</span>
              <div className="highlight__title">{t.products.highlightTitle}</div>
              <div className="pcard__sub" style={{ marginTop: 4 }}>{t.products.highlightSub}</div>
            </div>
          </Reveal>

          {loading && (
            <div className="pcards" style={{ marginTop: 32 }}>
              {[0, 1, 2].map(i => (
                <div className="pcard" key={i}>
                  <Skeleton height={44} />
                  <Skeleton height={34} style={{ marginTop: 18 }} />
                  <Skeleton height={70} style={{ marginTop: 18 }} />
                </div>
              ))}
            </div>
          )}

          {error && <div style={{ marginTop: 28 }}><ErrorState error={error} onRetry={retry} /></div>}

          {!loading && !error && data && (
            <>
              <div style={{ marginTop: 32 }}>
                <FilterBar
                  filters={data.filters}
                  value={filters}
                  onChange={setFilters}
                  onReset={() => setFilters(EMPTY)}
                />
              </div>
              <div className="filterbar__count">
                {fmt(t.products.resultCount, { n: shown.length, total: all.length })}
              </div>

              {shown.length === 0 && (
                <div className="comingsoon" style={{ marginTop: 20 }}>
                  <div className="comingsoon__body">{t.products.noResults}</div>
                </div>
              )}

              {live.length > 0 && (
                <div className="pcards" style={{ marginTop: 28 }}>
                  {live.map((p, i) => (
                    <Reveal step={i} key={p.slug}><ProductCard product={p} /></Reveal>
                  ))}
                </div>
              )}

              {soon.length > 0 && (
                <div className="pcards" style={{ marginTop: 20 }}>
                  {soon.map((p, i) => (
                    <Reveal step={i} key={p.slug}><ProductCard product={p} /></Reveal>
                  ))}
                </div>
              )}
            </>
          )}

          <Reveal className="comingsoon" style={{ marginTop: 48 }}>
            <div className="section__eyebrow" style={{ marginBottom: 8 }}>
              {t.products.comingSoonEyebrow}
            </div>
            <div className="comingsoon__body">{t.products.comingSoonBody}</div>
          </Reveal>

          {/* Kept from the wireframe, which surfaced this better than
              midas.app does — midas buries the equivalent in 8pt footnotes. */}
          <Reveal className="risk" style={{ marginTop: 20 }}>
            <div className="risk__ic">!</div>
            <div>
              <div className="risk__title">{t.products.riskTitle}</div>
              <Highlight text={t.products.riskText} as="p" className="risk__text" />
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
