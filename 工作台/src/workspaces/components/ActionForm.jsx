import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import DataField from './DataField';

function initialValues(fields) {
  return Object.fromEntries(fields.map(field => [field.name, field.type === 'boolean' ? 'false' : '']));
}

export default function ActionForm({ fields = [], disabled = false, confirmation = null, submitLabel, onSubmit }) {
  const { t } = useI18n();
  const resolvedSubmitLabel = submitLabel ?? t.workspaces.ui.executeAction;
  const formId = useId().replaceAll(':', '');
  const [values, setValues] = useState(() => initialValues(fields));
  const [errors, setErrors] = useState({});
  const firstInvalid = useRef(null);

  useEffect(() => setValues(initialValues(fields)), [fields]);
  useEffect(() => {
    if (firstInvalid.current) document.getElementById(firstInvalid.current)?.focus();
  }, [errors]);

  const change = (name, value) => {
    setValues(current => ({ ...current, [name]: value }));
    setErrors(current => ({ ...current, [name]: undefined }));
  };
  const submit = async event => {
    event.preventDefault();
    if (disabled) return;
    const next = Object.fromEntries(fields.filter(field => field.required !== false && String(values[field.name] ?? '').trim() === '').map(field => [field.name, t.workspaces.forms.validation.required]));
    firstInvalid.current = Object.keys(next)[0] ? `${formId}-${Object.keys(next)[0]}` : null;
    setErrors(next);
    if (Object.keys(next).length) return;
    await onSubmit?.(values);
  };

  return (
    <form className="ws-action-form" onSubmit={submit} noValidate>
      <fieldset disabled={disabled}>
        <legend>{t.workspaces.ui.actionInputs}</legend>
        {fields.map(field => <DataField key={field.name} controlId={`${formId}-${field.name}`} field={{ ...field, error: errors[field.name] }} value={values[field.name] ?? ''} onChange={change} />)}
      </fieldset>
      {confirmation}
      <button className="ws-action-form__submit" type="submit" disabled={disabled}>{resolvedSubmitLabel}</button>
    </form>
  );
}
