import { useI18n } from '../../i18n';

/**
 * Ensures a Vault / Asset / Wrapped Asset has been selected.
 * Token Agent and Governor skip this gate.
 */
export default function ObjectGate({
  children,
  objectType = 'vault',
  selected,
  options = [],
  onSelect,
  loading = false,
}) {
  const { t } = useI18n();

  const titles = {
    vault: t.access.selectVaultTitle,
    asset: t.access.selectAssetTitle,
    wrapped: t.access.selectWrappedTitle,
  };
  const bodies = {
    vault: t.access.selectVaultBody,
    asset: t.access.selectAssetBody,
    wrapped: t.access.selectWrappedBody,
  };
  const empty = {
    vault: t.access.noVaults,
    asset: t.access.noAssets,
    wrapped: t.access.noWrapped,
  };

  if (selected) return children;

  if (loading) {
    return (
      <div className="gate">
        <p className="gate__body">{t.common.loading}</p>
      </div>
    );
  }

  if (!options.length) {
    return (
      <div className="gate">
        <div className="gate__eyebrow">{t.access.objectEyebrow}</div>
        <h2 className="gate__title">{titles[objectType]}</h2>
        <p className="gate__body">{empty[objectType]}</p>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="gate__eyebrow">{t.access.objectEyebrow}</div>
      <h2 className="gate__title">{titles[objectType]}</h2>
      <p className="gate__body">{bodies[objectType]}</p>
      <div className="objlist">
        {options.map(obj => (
          <button
            key={obj.id || obj.address}
            type="button"
            className="objlist__item"
            onClick={() => onSelect(obj)}
          >
            <span className="objlist__name">{obj.name}</span>
            <span className="objlist__meta">
              {obj.symbol ? `${obj.symbol} · ` : ''}
              {(obj.address || '').slice(0, 10)}…
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
