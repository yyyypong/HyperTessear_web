import { useParams } from 'react-router-dom';
import { chainName, truncateAddress, useWallet } from '../../wallet';
import { getDeployment } from '../config/deployments';

const workspaceDeployment = getDeployment(97);

function deploymentProfileLabel(profile) {
  if (profile === 'legacy') return 'Legacy Compatible';
  if (profile === 'target') return 'Target';
  return profile ?? 'Unknown';
}

function selectedObject(params) {
  if (params.vault) return `Vault ${truncateAddress(params.vault)}`;
  if (params.adapter) return `Adapter ${truncateAddress(params.adapter)}`;
  if (params.assetId !== undefined) return `Asset #${params.assetId}`;
  return 'No object selected';
}

export default function ContextBar() {
  const { session, switchChain, openModal } = useWallet();
  const params = useParams();
  const connected = Boolean(session?.address);
  const onConfiguredChain = connected && Number(session.chainId) === workspaceDeployment.chainId;
  const walletLabel = session?.info?.name ?? 'Wallet';
  const currentChain = connected && Number(session.chainId) === workspaceDeployment.chainId
    ? workspaceDeployment.chainName
    : connected ? chainName(session.chainId) : 'Not connected';

  return (
    <section className="ws-context" aria-label="Workspace context">
      <div className="ws-context__identity">
        <span className="ws-context__label">Wallet</span>
        <strong>{connected ? truncateAddress(session.address) : 'Not connected'}</strong>
        <span>{connected ? walletLabel : 'Connect a wallet to view account context.'}</span>
      </div>
      <dl className="ws-context__details">
        <div><dt>Network</dt><dd>{currentChain}</dd></div>
        <div><dt>Deployment</dt><dd>{workspaceDeployment.chainName} · {deploymentProfileLabel(workspaceDeployment.profile)}</dd></div>
        <div><dt>Selected object</dt><dd>{selectedObject(params)}</dd></div>
      </dl>
      {connected ? (
        !onConfiguredChain && (
          <button type="button" className="ws-context__action" onClick={() => switchChain(workspaceDeployment.chainId).catch(() => {})}>
            Switch to {workspaceDeployment.chainName}
          </button>
        )
      ) : (
        <button type="button" className="ws-context__action" onClick={openModal}>Connect wallet</button>
      )}
    </section>
  );
}
