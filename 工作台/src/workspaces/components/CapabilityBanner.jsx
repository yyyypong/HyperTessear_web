import { useI18n } from '../../i18n';
import { CAPABILITY_STATES } from '../core/capabilityStates';

export default function CapabilityBanner({ state = CAPABILITY_STATES.TARGET_ONLY, label: suppliedLabel }) {
  const { t } = useI18n();
  const label = suppliedLabel ?? t.workspaces.capabilities[state] ?? t.workspaces.capabilities.unsupportedDeployment;

  return <p className={`ws-capability ws-capability--${state}`} role="status">{label}</p>;
}
