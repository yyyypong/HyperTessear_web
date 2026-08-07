import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, getBytes, id as roleHash } from 'ethers';
import { useI18n } from '../../i18n';
import { useWallet } from '../../wallet';
import { Badge, CallTag, StatCards } from '../../components/blueprint/chrome';
import { useReadSdk, useVaultDirectory, equalAddress } from '../../workspaces/core/onchainLists';
import { buildInstruction, loadSettlementWorkspace } from '../../workspaces/core/settlementData';
import { getWriteSigner } from '../../workspaces/core/walletRunner';
import { demoSettlementWorkspace } from '../../workspaces/core/settlementDemo';

/** USDT-denominated amounts across Settlement / UnifiedPool are 6-decimal. */
const USD_DECIMALS = 6;
/** Signed instructions expire so a stale batch can never be replayed. */
const VALIDITY_WINDOW_SECONDS = 3600;

function usd(amount) {
  if (amount == null) return '—';
  return Number(formatUnits(amount, USD_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 14)}…` : '—';
}

function shortAddr(address) {
  if (!address || typeof address !== 'string') return '—';
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function stamp(seconds) {
  return seconds ? new Date(Number(seconds) * 1000).toLocaleString() : '—';
}

function QueueTable({ title, rows, emptyLabel, t }) {
  return (
    <div className="bp-queue-panel">
      <div className="bp-small bp-strong" style={{ marginBottom: 6 }}>{title}</div>
      <div className="bp-table-wrap">
        <table className="bp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t.bp.settlement.colRequestId}</th>
              <th>{t.bp.settlement.colUser}</th>
              <th>{t.bp.settlement.colAmount}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4}><p className="bp-muted bp-small" style={{ padding: 18 }}>{emptyLabel}</p></td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={String(row.requestId)}>
                <td className="bp-mono bp-small">{i + 1}</td>
                <td className="bp-mono bp-small">#{String(row.requestId)}</td>
                <td className="bp-small bp-mono" title={row.owner}>{shortAddr(row.owner)}</td>
                <td className="bp-mono bp-small">{usd(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SettlementOperatorWorkspace({ vault }) {
  const { t } = useI18n();
  const { address, session } = useWallet();
  const { sdk, demo } = useReadSdk();
  const { vaults } = useVaultDirectory();
  const vaultRow = vaults.find(v => equalAddress(v.vault, vault)) ?? null;

  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration(g => g + 1), []);

  // Collected operator signatures are session-local: the contract only sees
  // them when submitBatch is called with the full array.
  const [signatures, setSignatures] = useState([]);
  const [instructionHash, setInstructionHash] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const [isGovernor, setIsGovernor] = useState(false);
  useEffect(() => {
    if (demo || !sdk || !address) { setIsGovernor(false); return undefined; }
    let cancelled = false;
    sdk.hasRole(roleHash('GOVERNOR_ROLE'), address)
      .then(value => { if (!cancelled) setIsGovernor(value === true); })
      .catch(() => { if (!cancelled) setIsGovernor(false); });
    return () => { cancelled = true; };
  }, [sdk, demo, address]);

  useEffect(() => {
    if (!vault || !address) { setStatus('idle'); setData(null); return undefined; }
    let cancelled = false;
    setStatus('loading');
    const loader = demo
      ? Promise.resolve(demoSettlementWorkspace(vault, address))
      : (sdk ? loadSettlementWorkspace({ sdk, vault, account: address }) : Promise.resolve(null));
    loader
      .then(result => { if (!cancelled) { setData(result); setStatus(result ? 'success' : 'idle'); } })
      .catch(() => { if (!cancelled) { setData(null); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [sdk, demo, vault, address, generation]);

  const shape = data?.operatorSet?.shape ?? null;

  const instruction = useMemo(() => {
    if (!data) return null;
    return buildInstruction({
      vault,
      state: data.state,
      deposits: data.deposits,
      redeems: data.redeems,
      distribution: data.distribution ?? 0n,
      validUntil: BigInt(Math.floor(Date.now() / 1000) + VALIDITY_WINDOW_SECONDS),
      perVault: shape?.perVault === true,
    });
  }, [data, vault, shape]);

  const operators = data?.operatorSet?.operators ?? [];
  const threshold = data?.operatorSet?.threshold ?? 0;
  const isOperator = data?.operatorSet?.mine === true;
  // The deployed contract gates operator config on Governor, not vault owner.
  const canConfigure = demo
    ? equalAddress(vaultRow?.deployer, address)
    : (shape?.perVault ? equalAddress(vaultRow?.deployer, address) : isGovernor);
  const enough = threshold > 0 && signatures.length >= threshold;

  const run = useCallback(async (key, fn) => {
    setBusy(key);
    setNotice(null);
    try {
      const message = await fn();
      setNotice({ tone: 'success', text: message });
    } catch (error) {
      setNotice({ tone: 'danger', text: error?.shortMessage || error?.message || t.bp.settlement.failed });
    } finally {
      setBusy(null);
    }
  }, [t]);

  const onSign = () => run('sign', async () => {
    if (demo) {
      const hash = `0x${'ab'.repeat(32)}`;
      const signature = `0x${'cd'.repeat(65)}`;
      setInstructionHash(hash);
      setSignatures(prev => (prev.includes(signature) ? prev : [...prev, signature]));
      return t.bp.settlement.demoSigned;
    }
    const signer = await getWriteSigner(session?.provider);
    const hash = await sdk.hashInstruction(instruction);
    const signature = await signer.signMessage(getBytes(hash));
    setInstructionHash(hash);
    setSignatures(prev => (prev.includes(signature) ? prev : [...prev, signature]));
    return t.bp.settlement.signed;
  });

  const onSubmit = () => run('submit', async () => {
    if (demo) {
      reload();
      return t.bp.settlement.demoSubmitted;
    }
    const signer = await getWriteSigner(session?.provider);
    const tx = await sdk.submitBatch(instruction, signatures, signer);
    reload();
    return `${t.bp.settlement.submitted} ${tx?.hash ?? ''}`.trim();
  });

  const onConfirmFinal = () => run('final', async () => {
    if (!shape?.canConfirmFinalSettlement) throw new Error(t.bp.settlement.finalUnsupported);
    if (demo) {
      reload();
      return t.bp.settlement.demoSubmitted;
    }
    const signer = await getWriteSigner(session?.provider);
    const settlement = sdk.getContract('Settlement', sdk.addresses?.settlement, signer);
    const tx = await settlement.confirmFinalSettlement(vault, signatures);
    reload();
    return `${t.bp.settlement.submitted} ${tx?.hash ?? ''}`.trim();
  });

  const onSaveOperators = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const operator = String(form.get('opAddr') || '').trim();
    const approved = form.get('approved') === 'on';
    const nextThreshold = Number(form.get('threshold'));
    run('config', async () => {
      if (demo) {
        reload();
        return t.bp.settlement.demoConfigSaved;
      }
      const signer = await getWriteSigner(session?.provider);
      const settlement = sdk.getContract('Settlement', sdk.addresses?.settlement, signer);
      if (operator) {
        const tx = shape?.perVault
          ? await settlement.setOperator(vault, operator, approved)
          : await (approved ? settlement.addOperator(operator) : settlement.removeOperator(operator));
        await tx.wait();
      }
      if (Number.isFinite(nextThreshold) && nextThreshold > 0 && nextThreshold !== threshold) {
        const tx = shape?.perVault
          ? await settlement.setThreshold(vault, nextThreshold)
          : await settlement.setThreshold(nextThreshold);
        await tx.wait();
      }
      reload();
      return t.bp.settlement.configSaved;
    });
  };

  if (status === 'loading') {
    return <div className="bp-card bp-card-pad"><p className="bp-muted">{t.common.loading}</p></div>;
  }
  if (!data) {
    return (
      <div className="bp-card bp-card-pad">
        <div className="bp-empty">
          <h3>{t.bp.settlement.unavailable}</h3>
          <p>{t.bp.settlement.unavailableBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bp-stack">
      <div className="bp-page-head">
        <div>
          <div className="bp-eyebrow">{vaultRow?.symbol ?? 'Vault'} · Settlement Operator workspace</div>
          <h1 title={vault}>{vaultRow?.name ?? shortAddr(vault)}</h1>
          <p>{t.bp.settlement.lede}</p>
        </div>
        <div className="bp-row">
          <Badge tone={isOperator ? 'success' : 'neutral'}>
            {isOperator ? t.bp.settlement.iAmOperator : t.bp.settlement.notOperator}
          </Badge>
          <Badge>{threshold}-of-{operators.length} {t.bp.settlement.multisig}</Badge>
        </div>
      </div>

      {shape?.perVault === false && (
        <div className="bp-alert">{t.bp.settlement.globalScopeNote}</div>
      )}
      {!isOperator && (
        <div className="bp-alert">{t.bp.settlement.readOnlyNote}</div>
      )}
      {notice && (
        <div className={`bp-alert${notice.tone === 'danger' ? ' bp-alert--danger' : ''}`}>{notice.text}</div>
      )}

      <StatCards items={[
        { label: t.bp.settlement.statCycle, value: `#${data.state?.cycleNumber ?? 0}`, foot: `${t.bp.settlement.phase} ${data.state?.product ?? '—'} / ${data.state?.cycle ?? '—'}` },
        { label: t.bp.settlement.statDeposits, value: data.deposits.length, foot: `${t.bp.settlement.total} ${usd(data.depositTotal)} USDT`, dot: 'warning' },
        { label: t.bp.settlement.statRedeems, value: data.redeems.length, foot: `${t.bp.settlement.total} ${usd(data.redeemTotal)} USDT` },
        { label: t.bp.settlement.statPool, value: usd(data.available), foot: `${t.bp.settlement.totalPending} ${usd(data.totalPending)} · NAV ${data.nav ?? '—'}`, dot: 'success', smallValue: true },
      ]} />

      <article className="bp-card bp-card-pad">
        <div className="bp-section-title">
          <h3>{t.bp.settlement.step1}</h3>
          <Badge>{t.bp.settlement.step1Source}</Badge>
        </div>
        <p className="bp-small bp-muted" style={{ marginBottom: 12 }}>{t.bp.settlement.step1Note}</p>
        <div className="bp-form-grid">
          <QueueTable title={t.bp.settlement.depositQueue} rows={data.deposits} emptyLabel={t.bp.settlement.queueEmpty} t={t} />
          <QueueTable title={t.bp.settlement.redeemQueue} rows={data.redeems} emptyLabel={t.bp.settlement.queueEmpty} t={t} />
        </div>
      </article>

      <article className="bp-card bp-card-pad">
        <div className="bp-section-title">
          <h3>{t.bp.settlement.step2}</h3>
          <CallTag>SettlementInstruction</CallTag>
        </div>
        <StatCards items={[
          { label: t.bp.settlement.depositTotal, value: usd(data.depositTotal), foot: 'USDT', smallValue: true },
          { label: t.bp.settlement.redeemTotal, value: usd(data.redeemTotal), foot: 'USDT', smallValue: true },
          { label: t.bp.settlement.netAmount, value: usd(data.net), foot: t.bp.settlement.netFoot, smallValue: true },
          { label: t.bp.settlement.distribution, value: usd(data.distribution), foot: t.bp.settlement.distributionFoot, smallValue: true },
        ]} />
        <p className="bp-small bp-quiet" style={{ marginTop: 12 }}>{t.bp.settlement.step2Note}</p>
      </article>

      <article className="bp-card bp-card-pad">
        <div className="bp-section-title">
          <h3>{t.bp.settlement.step3} ({threshold}-of-{operators.length}, eth_sign)</h3>
          <Badge tone={enough ? 'success' : 'warning'}>{signatures.length}/{threshold || '?'} {t.bp.settlement.signedCount}</Badge>
        </div>
        <p className="bp-small bp-muted" style={{ marginBottom: 10 }}>
          {t.bp.settlement.instructionHash} <span className="bp-mono bp-small">{instructionHash ?? t.bp.settlement.hashPending}</span>
        </p>
        <div className="bp-req-list" style={{ marginBottom: 12 }}>
          {operators.length === 0 && <div className="bp-small bp-muted">{t.bp.settlement.noOperators}</div>}
          {operators.map(operator => (
            <div className="bp-req-item" key={operator}>
              <div>
                <h4 className="bp-mono" title={operator}>{shortAddr(operator)}</h4>
                <p>{equalAddress(operator, address) ? t.bp.settlement.you : t.bp.settlement.operator}</p>
              </div>
              <Badge tone={equalAddress(operator, address) && signatures.length > 0 ? 'success' : 'neutral'}>
                {equalAddress(operator, address) && signatures.length > 0 ? t.bp.settlement.hasSigned : t.bp.settlement.awaitingSignature}
              </Badge>
            </div>
          ))}
        </div>
        {isOperator ? (
          <div className="bp-row">
            <button className="btn" type="button" disabled={busy === 'sign' || !instruction} onClick={onSign}>
              {t.bp.settlement.signBtn}
            </button>
            <button className="btn btn--ghost" type="button" disabled={!enough || busy === 'submit'} onClick={onSubmit}>
              {t.bp.settlement.submitBtn}
            </button>
            <button
              className="btn btn--ghost"
              type="button"
              disabled={signatures.length === 0 || busy === 'final' || shape?.canConfirmFinalSettlement === false}
              title={shape?.canConfirmFinalSettlement === false ? t.bp.settlement.finalUnsupported : undefined}
              onClick={onConfirmFinal}
            >
              {t.bp.settlement.confirmFinalBtn}
            </button>
          </div>
        ) : (
          <Badge>{t.bp.settlement.readOnlyBadge}</Badge>
        )}
        <p className="bp-small bp-quiet" style={{ marginTop: 10 }}>{t.bp.settlement.step3Note}</p>
      </article>

      <article className="bp-card bp-card-pad">
        <div className="bp-section-title">
          <h3>{t.bp.settlement.step4}</h3>
          <Badge>{data.history.length}</Badge>
        </div>
        <div className="bp-table-wrap">
          <table className="bp-table">
            <thead>
              <tr>
                <th>{t.bp.settlement.colTime}</th>
                <th>{t.bp.settlement.colCycle}</th>
                <th>{t.bp.settlement.colBatchHash}</th>
                <th>{t.bp.settlement.colTx}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.length === 0 && (
                <tr><td colSpan={4}><p className="bp-muted bp-small" style={{ padding: 22 }}>{t.bp.settlement.historyEmpty}</p></td></tr>
              )}
              {data.history.map(row => (
                <tr key={row.txHash}>
                  <td className="bp-mono bp-small">{stamp(row.timestamp)}</td>
                  <td className="bp-mono bp-small">#{row.cycleNumber}</td>
                  <td className="bp-mono bp-small">{shortHash(row.batchHash)}</td>
                  <td className="bp-mono bp-small">{shortHash(row.txHash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {canConfigure && (
        <article className="bp-card bp-card-pad">
          <div className="bp-section-title">
            <h3>{t.bp.settlement.ownerTitle}</h3>
            <CallTag>{shape?.perVault ? 'setOperator / setThreshold' : 'addOperator / removeOperator / setThreshold'}</CallTag>
          </div>
          <p className="bp-small bp-muted" style={{ marginBottom: 12 }}>
            {shape?.perVault === false ? t.bp.settlement.ownerNoteGlobal : t.bp.settlement.ownerNote}
          </p>
          <form className="bp-form-grid" onSubmit={onSaveOperators}>
            <div className="bp-field">
              <label htmlFor="settle-op-addr">{t.bp.settlement.operatorAddress}</label>
              <input id="settle-op-addr" className="bp-input bp-mono" name="opAddr" placeholder="0x…" />
            </div>
            <div className="bp-field">
              <label htmlFor="settle-threshold">{t.bp.settlement.thresholdLabel}</label>
              <input id="settle-threshold" className="bp-input" name="threshold" type="number" min="1" defaultValue={threshold || 1} />
            </div>
            <label className="bp-small" style={{ gridColumn: '1/-1' }}>
              <input type="checkbox" name="approved" defaultChecked /> {t.bp.settlement.approveOperator}
            </label>
            <button className="btn" type="submit" disabled={busy === 'config'} style={{ gridColumn: '1/-1', justifySelf: 'start' }}>
              {t.bp.settlement.saveConfig}
            </button>
          </form>
        </article>
      )}
    </div>
  );
}
