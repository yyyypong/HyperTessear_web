import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import { useNetwork } from '../../contexts/NetworkContext';
import { roleLabel } from '../../components/access/RoleGate';

/**
 * Shared shell for every role workspace.
 * Internal business modules are out of scope — identity + context only.
 */
export default function WorkspaceShell({
  role,
  objectLabel,
  objectMeta,
  backTo,
  backLabel,
  children,
}) {
  const { t } = useI18n();
  const { shortAddress, isDemo } = useWallet();
  const { selectedNetwork } = useNetwork();

  return (
    <div className="wrap accesspage">
      <div className="wshead">
        {backTo && (
          <Link to={backTo} className="wshead__back">← {backLabel || t.workspace.back}</Link>
        )}
        <div className="section__eyebrow">{t.workspace.eyebrow}</div>
        <h1 className="phead__title">{roleLabel(t, role)}</h1>
        <p className="section__lede">{t.workspace.shellLede}</p>
      </div>

      <div className="shellcard">
        <dl className="shellcard__meta">
          <div><dt>{t.access.role}</dt><dd>{roleLabel(t, role)}</dd></div>
          <div><dt>{t.access.network}</dt><dd>{selectedNetwork?.name}</dd></div>
          <div><dt>{t.access.wallet}</dt><dd>{isDemo ? `${t.access.demo} · ` : ''}{shortAddress}</dd></div>
          {objectLabel && (
            <div><dt>{t.access.object}</dt><dd>{objectLabel}</dd></div>
          )}
          {objectMeta && (
            <div><dt>{t.access.objectId}</dt><dd className="mono">{objectMeta}</dd></div>
          )}
        </dl>
        <p className="shellcard__note">{t.workspace.phaseNote}</p>
        {children}
      </div>
    </div>
  );
}
