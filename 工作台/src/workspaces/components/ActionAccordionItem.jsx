import { useI18n } from '../../i18n';
import ActionPanel from './ActionPanel';

function actionCopy(t, action) {
  const configured = t.workspaces.actions?.[action.id.replaceAll('.', '-')];
  return {
    title: action.title ?? configured?.title ?? action.id,
    description: action.description ?? configured?.description ?? '',
  };
}

export default function ActionAccordionItem({
  action,
  capability,
  open,
  onToggle,
  dangerous = false,
  ...panelProps
}) {
  const { t } = useI18n();
  const { title } = actionCopy(t, action);
  const stateLabel = t.workspaces.capabilities[capability?.state] ?? t.workspaces.capabilities.unsupportedDeployment;
  const panelId = `ws-action-panel-${action.id}`;

  return (
    <div
      className={`ws-accordion-item${open ? ' is-open' : ''}${dangerous ? ' is-dangerous' : ''}`}
      data-testid="workspace-action"
      data-action-id={action.id}
    >
      <button
        type="button"
        className="ws-accordion-item__summary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle?.(action.id)}
      >
        <span className="ws-accordion-item__title">{title}</span>
        <span className="ws-accordion-item__badges">
          {dangerous && <span className="ws-accordion-item__risk">{t.workspaces.badges.highRisk}</span>}
          <span className={`ws-capability ws-capability--${capability?.state ?? 'unsupportedDeployment'}`}>{stateLabel}</span>
        </span>
        <span className="ws-accordion-item__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      <div id={panelId} data-testid={`workspace-action-${action.id}`}>
        {open ? <ActionPanel action={action} capability={capability} dangerous={dangerous} {...panelProps} /> : null}
      </div>
    </div>
  );
}
