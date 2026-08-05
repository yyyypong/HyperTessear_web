import { useI18n } from '../i18n';
import { daysSince, initials, isoDate, utilisation } from '../lib/format';

/**
 * The HyperTessera mark from the wireframes.
 *
 * `onDark` drops the navy tile and lets the chevron sit directly on the
 * field: over the dark hero the tile would read as a rectangle of slightly
 * different navy rather than as a mark.
 */
export function BrandMark({ size = 34, onDark = false }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden="true">
      {!onDark && <rect width="40" height="40" rx="11" fill="#00274E" />}
      <path
        d={onDark ? 'M8 30V10l12 9 12-9v20' : 'M12 27V13l8 6 8-6v14'}
        stroke="#C4A372"
        strokeWidth={onDark ? 2.8 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Monogram({ name, small = false }) {
  return (
    <span className={`monogram${small ? ' monogram--sm' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Skeleton({ width = '100%', height = 16, style }) {
  return <span className="skel" style={{ display: 'block', width, height, ...style }} />;
}

export function ErrorState({ error, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="errstate" role="alert">
      <strong>{t.common.errorTitle}</strong>
      {t.common.errorBody}
      {error?.message && (
        <div style={{ marginTop: 8, fontSize: 11, opacity: .8 }}>{error.message}</div>
      )}
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn--sm btn--ghost" onClick={onRetry}>{t.common.retry}</button>
        </div>
      )}
    </div>
  );
}

export function InfoTip({ children }) {
  return (
    <span className="infotip">
      <span className="infotip__mark" role="img" aria-label="info">i</span>
      <span className="infotip__body">{children}</span>
    </span>
  );
}

export function StatusPill({ status }) {
  const { t } = useI18n();
  const map = {
    live: ['pill pill--ok', t.common.statusLive],
    coming_soon: ['pill pill--gold', t.common.statusComingSoon],
    retired: ['pill pill--mut', t.common.statusRetired],
  };
  const [cls, label] = map[status] || map.live;
  return <span className={cls}>{label}</span>;
}

/**
 * A figure shown together with the date it was last updated, and — when
 * the number is not the protocol's own — whose number it is.
 *
 * This is the component that turns the {value, lastUpdated} contract from
 * "Data Table Homepage (6).pdf" into something a reader can actually
 * judge. A figure with no date is a claim; a figure with a date is data.
 */
export function ValueWithTimestamp({
  value, lastUpdated, attribution, valueClassName, staleAfterDays = 45,
}) {
  const { t } = useI18n();
  const age = daysSince(lastUpdated);
  const stale = age !== null && age > staleAfterDays;

  return (
    <span className="vwt">
      <span className={valueClassName || 'vwt__value'}>{value}</span>
      <span className="vwt__meta">
        <span className={stale ? 'vwt__stale' : undefined}>
          {t.common.asOf} {isoDate(lastUpdated)}
        </span>
        {attribution && (
          <> · <span className="vwt__attr">{t.common.attributedTo} {attribution}</span></>
        )}
      </span>
    </span>
  );
}

/** Deposited vs. capacity — the "$7.87M / $19.15M" pattern from midas.app. */
export function CapacityBar({ tvl, capacity, leftLabel, rightLabel }) {
  const pct = utilisation(tvl, capacity);
  if (pct === null) return null;
  return (
    <div className="capbar">
      <div className="capbar__track">
        <div className="capbar__fill" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>
      <div className="capbar__label">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
