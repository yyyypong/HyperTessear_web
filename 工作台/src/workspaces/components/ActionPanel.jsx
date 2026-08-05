import { useState } from 'react';
import { getAddress } from 'ethers';
import { useI18n } from '../../i18n';
import { FORM_SCHEMAS } from '../config/formSchemas';
import { CAPABILITY_STATES } from '../core/capabilityStates';
import { isBuiltInSignatureAction } from '../core/signaturePayloads';
import CapabilityBanner from './CapabilityBanner';
import ActionForm from './ActionForm';

function actionCopy(t, action) {
  const configured = t.workspaces.actions?.[action.id.replaceAll('.', '-')];
  return { title: action.title ?? configured?.title ?? action.id, description: action.description ?? configured?.description ?? '' };
}

function supportBadge(t, action, capability) {
  const badge = capability?.badge ?? capability?.profile?.badge ?? action?.capability?.legacy?.badge ?? (capability?.state === CAPABILITY_STATES.TARGET_ONLY ? 'target' : null);
  return badge === 'legacyCompatible' ? t.workspaces.badges.legacyCompatible : badge === 'target' ? t.workspaces.badges.target : null;
}

function canonicalTargetAddress(targetAddress) {
  if (typeof targetAddress !== 'string') return null;
  try { return getAddress(targetAddress); } catch { return null; }
}

function Detail({ t, capability, onSwitchNetwork }) {
  const detail = capability?.detail ?? {};
  if (capability?.state === CAPABILITY_STATES.TARGET_ONLY) {
    return (
      <p className="ws-action-panel__detail">
        {t.workspaces.ui.requiredMethod}: <code>{detail.requiredMethod ?? t.workspaces.ui.unavailable}</code>; {t.workspaces.ui.module}: <code>{detail.requiredModule ?? t.workspaces.ui.unavailable}</code>.
      </p>
    );
  }
  if (capability?.state === CAPABILITY_STATES.UNAUTHORIZED) {
    return (
      <p className="ws-action-panel__detail">
        {t.workspaces.ui.connectedAddress}: <code>{detail.address ?? detail.connectedAddress ?? t.workspaces.ui.unknown}</code>.
      </p>
    );
  }
  if (capability?.state === CAPABILITY_STATES.WRONG_NETWORK && typeof onSwitchNetwork === 'function') {
    return <button type="button" className="ws-action-panel__switch" onClick={onSwitchNetwork}>{t.workspaces.ui.switchNetwork}</button>;
  }
  return null;
}

function Preview({ t, targetAddress, preview }) {
  if (!targetAddress && !preview) return null;
  return (
    <dl className="ws-action-preview">
      <div><dt>{t.workspaces.ui.target}</dt><dd>{targetAddress ?? preview?.target ?? t.workspaces.ui.notSupplied}</dd></div>
      {preview?.functionName && <div><dt>{t.workspaces.ui.function}</dt><dd>{preview.functionName}</dd></div>}
      {preview?.params && <div><dt>{t.workspaces.ui.parameters}</dt><dd>{preview.params}</dd></div>}
      {preview?.network && <div><dt>{t.workspaces.ui.network}</dt><dd>{preview.network}</dd></div>}
    </dl>
  );
}

export default function ActionPanel({ action, schema = FORM_SCHEMAS[action?.schemaId ?? action?.id], capability, onExecute, onSwitchNetwork, context = [], dangerous = false, targetAddress, preview }) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState('');
  const [outcome, setOutcome] = useState('');
  const { title, description } = actionCopy(t, action);
  const enabled = capability?.state === CAPABILITY_STATES.AVAILABLE;
  const canonicalTarget = canonicalTargetAddress(targetAddress);
  const suffix = canonicalTarget?.slice(-4) ?? '';
  const confirmed = !dangerous || (Boolean(suffix) && confirmation === suffix);
  const disabled = !enabled || !confirmed;
  const badge = supportBadge(t, action, capability);
  const submitLabel = isBuiltInSignatureAction(action.id) ? t.workspaces.ui.signPayload : t.workspaces.ui.executeAction;
  const execute = async rawInput => {
    if (disabled || typeof onExecute !== 'function') return;
    try {
      setOutcome(t.workspaces.ui.submitting);
      await onExecute(action.id, rawInput);
      setOutcome(isBuiltInSignatureAction(action.id) ? t.workspaces.ui.payloadSigned : t.workspaces.ui.actionSubmitted);
    } catch {
      setOutcome(t.workspaces.ui.actionFailed);
    }
  };
  const confirmationControl = dangerous ? (
    <div className="ws-danger-confirmation">
      <p><strong>{t.workspaces.ui.warning}:</strong> {t.workspaces.ui.dangerConfirmBody}</p>
      {canonicalTarget ? (
        <label>
          {t.workspaces.ui.confirmation}
          <input aria-label={t.workspaces.ui.confirmation} value={confirmation} onChange={event => setConfirmation(event.target.value)} aria-describedby="danger-target" autoComplete="off" />
        </label>
      ) : (
        <p id="danger-target" role="alert">{t.workspaces.ui.noCanonicalTarget}</p>
      )}
      {canonicalTarget && <p id="danger-target">{t.workspaces.ui.targetEnding}: <code>{suffix}</code></p>}
    </div>
  ) : null;

  return (
    <section className="ws-action-panel" aria-labelledby={`action-${action.id}`}>
      <header><div><h2 id={`action-${action.id}`}>{title}</h2><p>{description}</p></div>{badge && <span className="ws-support-badge">{badge}</span>}</header>
      <CapabilityBanner state={capability?.state} label={capability?.detail?.stateEligible ? t.workspaces.badges.stateEligible : undefined} />
      {capability?.detail?.stateEligible && <p className="ws-action-panel__detail">{t.workspaces.ui.stateEligibleDetail}</p>}
      <Detail t={t} capability={capability} onSwitchNetwork={onSwitchNetwork} />
      {context.length > 0 && <dl className="ws-action-context">{context.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
      <Preview t={t} targetAddress={canonicalTarget} preview={preview} />
      <ActionForm fields={schema?.fields ?? []} disabled={disabled} confirmation={confirmationControl} submitLabel={submitLabel} onSubmit={execute} />
      <p className="ws-action-panel__outcome" aria-live="polite">{outcome}</p>
    </section>
  );
}
