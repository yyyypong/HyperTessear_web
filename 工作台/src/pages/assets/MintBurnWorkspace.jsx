import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { id, isAddress, parseUnits } from 'ethers';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import ManagementEntry from '../../components/access/ManagementEntry';
import { CallTag, ContextBar, PageHead, SidePanel, StatusBadge, WorkLayout } from '../../components/blueprint/chrome';
import { useReadSdk, useAssetDirectory, useMintBurnQueues, equalAddress } from '../../workspaces/core/onchainLists';
import { createAmountDecimalsResolver, createWriteSdk } from '../../workspaces/core/createSdk';
import { getWriteSigner } from '../../workspaces/core/walletRunner';

const EMPTY_SIG = '0x';

function formatAmount(value, decimals = 18) {
  const factor = 10 ** Number(decimals);
  const whole = Number(value) / factor;
  return whole > 1000000 ? whole.toExponential(3) : whole.toFixed(4);
}

function MintBurnInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { assetId } = useParams();
  const { assets } = useAssetDirectory();
  const { sdk, deployment, demo } = useReadSdk();
  const { session, address } = useWallet();
  const { mints, burns } = useMintBurnQueues(assetId);
  const asset = assets.find(a => a.id === Number(assetId));

  const [mintAmount, setMintAmount] = useState('');
  const [mintTo, setMintTo] = useState('');
  const [burnAmount, setBurnAmount] = useState('');
  const [burnFrom, setBurnFrom] = useState('');
  const [submitting, setSubmitting] = useState(null); // 'mint' | 'burn'
  const [approving, setApproving] = useState(null); // { kind, nonce }
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [isTokenAgent, setIsTokenAgent] = useState(false);

  const tokenAgentCheck = async () => {
    if (!sdk || !address) return false;
    try {
      const role = id('TOKEN_AGENT_ROLE');
      return await sdk.getContract('HyperAccessControl', sdk.addresses?.hyperAccessControl).hasRole(role, address) === true;
    } catch { return false; }
  };

  useEffect(() => {
    let cancelled = false;
    const check = demo ? Promise.resolve(true) : tokenAgentCheck();
    check.then(ok => { if (!cancelled) setIsTokenAgent(ok); });
    return () => { cancelled = true; };
  }, [sdk, address, demo]);

  async function initiate(kind) {
    setError(null);
    setResult(null);
    const amount = kind === 'mint' ? mintAmount : burnAmount;
    const party = kind === 'mint' ? mintTo : burnFrom;
    const toAddress = party.trim() || address;
    if (!assetId || !/^\d+$/.test(String(assetId))) { setError(t.bp.mintBurn.invalidAsset); return; }
    if (!amount.trim() || Number.isNaN(Number(amount)) || Number(amount) <= 0) { setError(t.bp.mintBurn.amountRequired); return; }
    if (!isAddress(toAddress)) { setError(t.bp.mintBurn.invalidParty); return; }
    setSubmitting(kind);
    try {
      const sdkWrite = await createWriteSdk(deployment, session.provider);
      const resolveDecimals = createAmountDecimalsResolver(sdkWrite);
      const resolved = await resolveDecimals({ actionId: kind === 'mint' ? 'mint.initiate' : 'burn.initiate', rawInput: { assetId: BigInt(assetId) } });
      const amountWei = parseUnits(amount.trim(), Number(resolved));
      const signer = await getWriteSigner(session.provider);
      const id = BigInt(assetId);
      const receipt = kind === 'mint'
        ? await sdkWrite.initiateMint(id, amountWei, toAddress, EMPTY_SIG, signer)
        : await sdkWrite.initiateBurn(id, amountWei, toAddress, EMPTY_SIG, signer);
      setResult({ txHash: receipt.txHash, nonce: receipt.nonce, kind });
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setSubmitting(null);
    }
  }

  async function approve(kind, nonce) {
    setError(null);
    setResult(null);
    setApproving({ kind, nonce });
    try {
      const sdkWrite = await createWriteSdk(deployment, session.provider);
      const signer = await getWriteSigner(session.provider);
      const receipt = kind === 'mint'
        ? await sdkWrite.approveMint(BigInt(nonce), EMPTY_SIG, signer)
        : await sdkWrite.approveBurn(BigInt(nonce), EMPTY_SIG, signer);
      setResult({ txHash: receipt.hash, kind: 'approve', nonce });
    } catch (e) {
      setError(e?.shortMessage || e?.message || String(e));
    } finally {
      setApproving(null);
    }
  }

  function reqRow(kind, req) {
    const canApprove = isTokenAgent && !req.approved && !req.executed;
    return (
      <div className="bp-req-item" key={req.nonce}>
        <div>
          <h4>
            {kind === 'mint' ? 'Mint' : 'Burn'} #{req.nonce}
            <CallTag>{kind === 'mint' ? 'initiateMint' : 'initiateBurn'}</CallTag>
          </h4>
          <p>amount {formatAmount(req.amount, asset?.decimals)} → {req.party}</p>
        </div>
        <div className="bp-row">
          <StatusBadge status={req.approved ? 'approved' : req.executed ? 'executed' : 'pending'} />
          {canApprove && (
            <button className="btn btn--gold" onClick={() => approve(kind, req.nonce)} disabled={approving?.nonce === req.nonce}>
              {t.bp.mintBurn.approve}
            </button>
          )}
        </div>
      </div>
    );
  }

  const partyLabel = { mint: 'to', burn: 'from' };
  const queueCard = (kind, reqs) => (
    <section className="bp-card bp-card-pad">
      <div className="bp-section-title">
        <h3>{kind === 'mint' ? t.bp.mintBurn.mintQueue : t.bp.mintBurn.burnQueue}</h3>
        <span className="bp-badge">{reqs.length}</span>
      </div>
      <div className="bp-req-list">
        {reqs.length === 0 && <p className="bp-muted bp-small">{t.bp.mintBurn.queueEmpty}</p>}
        {reqs.map(req => reqRow(kind, req))}
      </div>
    </section>
  );

  return (
    <div className="bp-page">
      <PageHead
        eyebrow="Dual signature"
        title={<>{t.bp.mintBurn.title} <span className="bp-mono bp-quiet" style={{ fontSize: 18 }}>{asset?.symbol ?? ''}</span></>}
        lede={t.bp.mintBurn.lede}
      >
        <button className="btn btn--ghost" onClick={() => navigate(`/assets/workspace/${assetId}`)}>{t.bp.mintBurn.back}</button>
      </PageHead>
      <ContextBar extra={[
        { label: t.bp.context.object, value: asset?.symbol ?? assetId },
        { label: t.bp.mintBurn.issuer, value: t.bp.mintBurn.issuerValue },
        { label: t.bp.mintBurn.tokenAgent, value: isTokenAgent ? t.bp.mintBurn.agentHeld : t.bp.mintBurn.agentNotHeld },
      ]} />
      <WorkLayout
        main={(
          <div className="bp-stack">
            <section className="bp-card bp-card-pad">
              <div className="bp-section-title">
                <h3>{t.bp.mintBurn.initiate}</h3>
                <CallTag>MintBurnController.initiateMint / initiateBurn</CallTag>
              </div>
              <div className="bp-form-grid">
                <div className="bp-field">
                  <label>{t.bp.mintBurn.initiateMint}</label>
                  <input className="bp-input bp-mono" value={mintAmount} inputMode="decimal" placeholder={t.bp.mintBurn.amountPlaceholder} onChange={e => setMintAmount(e.target.value)} />
                  <input className="bp-input bp-mono" value={mintTo} placeholder={t.bp.mintBurn.toPlaceholder} onChange={e => setMintTo(e.target.value)} />
                  <button className="btn btn--gold" onClick={() => initiate('mint')} disabled={submitting === 'mint'} style={{ justifySelf: 'start' }}>
                    {submitting === 'mint' ? t.common.loading : t.bp.mintBurn.initiateMintBtn}
                  </button>
                </div>
                <div className="bp-field">
                  <label>{t.bp.mintBurn.initiateBurn}</label>
                  <input className="bp-input bp-mono" value={burnAmount} inputMode="decimal" placeholder={t.bp.mintBurn.amountPlaceholder} onChange={e => setBurnAmount(e.target.value)} />
                  <input className="bp-input bp-mono" value={burnFrom} placeholder={t.bp.mintBurn.fromPlaceholder} onChange={e => setBurnFrom(e.target.value)} />
                  <button className="btn btn--ghost" onClick={() => initiate('burn')} disabled={submitting === 'burn'} style={{ justifySelf: 'start' }}>
                    {submitting === 'burn' ? t.common.loading : t.bp.mintBurn.initiateBurnBtn}
                  </button>
                </div>
              </div>
              <p className="bp-small bp-quiet" style={{ marginTop: 12 }}>{t.bp.mintBurn.signatureNote}</p>
            </section>
            {queueCard('mint', mints)}
            {queueCard('burn', burns)}
          </div>
        )}
        aside={(
          <SidePanel
            contract="MintBurnController"
            permission={t.bp.mintBurn.perm}
            permissionNote={t.bp.mintBurn.permNote}
            pre={t.bp.mintBurn.pre}
            events="MintInitiated(nonce) → MintApproved(nonce)；BurnInitiated(nonce) → BurnApproved(nonce)"
            next={t.bp.mintBurn.next}
            note={t.bp.mintBurn.note}
          />
        )}
      />
      {error && <p className="actionform__error">{error}</p>}
      {result && (
        <div className="bp-card bp-card-pad">
          <div className="chainresult">
            <div className="chainresult__row">
              <span>{t.bp.mintBurn.txSent}</span>
              <a className="chainresult__mono" href={`${deployment.explorerUrl}/tx/${result.txHash}`} target="_blank" rel="noreferrer">{result.txHash}</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MintBurnWorkspace() {
  return (
    <ManagementEntry>
      <MintBurnInner />
    </ManagementEntry>
  );
}
