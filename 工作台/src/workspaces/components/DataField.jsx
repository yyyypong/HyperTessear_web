import { useI18n } from '../../i18n';

function read(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function controlFor(field, controlId, value, onChange, describedBy) {
  const common = {
    id: controlId,
    name: field.name,
    value,
    'aria-describedby': describedBy,
    'aria-invalid': Boolean(field.error),
    onChange: event => onChange(field.name, event.target.value),
  };
  if (field.type === 'json' || field.type === 'bytes-array') return <textarea {...common} rows={4} />;
  if (field.type === 'select') return <select {...common}>{(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === 'boolean') return <select {...common}>{['false', 'true'].map(option => <option key={option} value={option}>{option}</option>)}</select>;
  const type = field.type === 'datetime' ? 'datetime-local' : 'text';
  const inputMode = ['amount', 'bigint', 'integer'].includes(field.type) ? 'numeric' : undefined;
  return <input {...common} type={type} inputMode={inputMode} autoComplete="off" />;
}

export default function DataField({ field, controlId = field.name, value = '', onChange }) {
  const { t } = useI18n();
  const label = read(t, field.labelKey) ?? field.name;
  const description = read(t, field.descriptionKey) ?? '';
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = field.error ? `${descriptionId} ${errorId}` : descriptionId;

  return (
    <div className="ws-data-field">
      <label htmlFor={controlId}>{label}</label>
      <p id={descriptionId} className="ws-data-field__description">{description}</p>
      {controlFor(field, controlId, value, onChange, describedBy)}
      {field.error && <p id={errorId} className="ws-data-field__error" role="alert">{field.error}</p>}
    </div>
  );
}
