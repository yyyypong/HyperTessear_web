import { useMemo } from 'react';
import { useI18n, fmt } from '../i18n';
import { isoDate } from '../lib/format';
import TimeSeriesChart from './TimeSeriesChart';

/**
 * Product NAV history. A thin adapter over TimeSeriesChart — the only
 * product-specific parts are the NAV formatting and the "since <date>"
 * sub-label.
 */
export default function NavChart({ history, inceptionDate }) {
  const { t } = useI18n();

  const data = useMemo(
    () => (history ?? []).map(p => ({ date: p.date, value: p.nav })),
    [history]
  );

  if (data.length < 2) return null;

  return (
    <div className="dcard">
      <TimeSeriesChart
        data={data}
        label={t.detail.navCurrent}
        tooltipLabel="NAV"
        formatValue={(v) => v.toFixed(6)}
        formatAxis={(v) => v.toFixed(4)}
        ranges={[
          { label: t.detail.range30, days: 30 },
          { label: t.detail.range90, days: 90 },
          { label: t.detail.rangeAll, days: 'all' },
        ]}
        defaultRangeIndex={1}
        subLabel={(first) => (
          <>
            {fmt(t.detail.navSince, { date: isoDate(first.date) })}
            {inceptionDate && ` · ${isoDate(inceptionDate)}`}
          </>
        )}
      />
    </div>
  );
}
