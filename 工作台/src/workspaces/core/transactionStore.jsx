import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'hypertessera.workspace.transactions';
const SENSITIVE_KEY = /signature|sig|issuersig|tokenagentsig|instruction|calldata|secret|signer|provider|receipt|logs|json/i;
const SUMMARY_INPUT_KEYS = Object.freeze(['vault', 'assetId', 'adapter', 'wrapper']);
const TRANSITIONS = Object.freeze({
  prepared: new Set(['awaitingWallet', 'signed', 'failed']),
  awaitingWallet: new Set(['submitted', 'signed', 'rejected', 'failed']),
  submitted: new Set(['confirmed', 'failed']),
});

function safeValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key) || depth > 3) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 160);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(item => safeValue(item, '', depth + 1)).filter(item => item !== undefined).slice(0, 20);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([name, item]) => [name.slice(0, 80), safeValue(item, name, depth + 1)]).filter(([, item]) => item !== undefined));
  return undefined;
}

const VALID_STATUSES = new Set(['prepared', 'awaitingWallet', 'submitted', 'confirmed', 'signed', 'rejected', 'failed']);
function summarizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(SUMMARY_INPUT_KEYS.map(key => [key, safeValue(input[key], key)]).filter(([, value]) => value !== undefined));
}

function sanitizeError(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined;
  const code = typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(error.code) ? error.code : undefined;
  const messageKey = typeof error.messageKey === 'string' && /^workspaces\.errors\.[A-Za-z0-9._-]{1,80}$/.test(error.messageKey) ? error.messageKey : undefined;
  return code && messageKey ? { code, messageKey } : undefined;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const freezeEntries = entries => deepFreeze([...entries]);

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = safeValue(raw.id);
  const actionId = safeValue(raw.actionId);
  const status = safeValue(raw.status);
  if (typeof id !== 'string' || typeof actionId !== 'string' || !VALID_STATUSES.has(status)) return null;
  return Object.fromEntries(Object.entries({
    id,
    actionId,
    status,
    createdAt: safeValue(raw.createdAt),
    updatedAt: safeValue(raw.updatedAt),
    input: summarizeInput(raw.input),
    txHash: safeValue(raw.txHash),
    digest: safeValue(raw.digest),
    error: sanitizeError(raw.error),
  }).filter(([, value]) => value !== undefined));
}

function load(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(key) ?? '[]');
    return Array.isArray(parsed) ? freezeEntries(parsed.slice(-50).map(sanitizeEntry).filter(Boolean)) : freezeEntries([]);
  } catch { return freezeEntries([]); }
}

export function createTransactionStore({ storage = typeof sessionStorage === 'undefined' ? null : sessionStorage, key = STORAGE_KEY, now = () => Date.now() } = {}) {
  let entries = load(storage, key);
  const listeners = new Set();
  const persist = () => { try { storage?.setItem?.(key, JSON.stringify(entries.map(entry => safeValue(entry)))); } catch { /* session storage is optional */ } };
  const emit = () => { persist(); listeners.forEach(listener => listener()); };
  const update = (id, next, extra = {}) => {
    const index = entries.findIndex(item => item.id === id);
    const entry = entries[index];
    if (!entry || !TRANSITIONS[entry.status]?.has(next)) throw new Error(`Illegal transaction transition: ${entry?.status ?? 'missing'} -> ${next}`);
    const updated = sanitizeEntry({ ...entry, ...safeValue({ status: next, updatedAt: now(), ...extra }) });
    entries = freezeEntries(entries.map((item, itemIndex) => itemIndex === index ? updated : item));
    emit();
    return updated;
  };
  return {
    get: () => entries,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    prepare(actionId, input) { const entry = sanitizeEntry({ id: `${now()}-${Math.random().toString(36).slice(2, 10)}`, actionId, status: 'prepared', createdAt: now(), input }); entries = freezeEntries([...entries.slice(-49), entry]); emit(); return entry.id; },
    awaitingWallet: id => update(id, 'awaitingWallet'),
    submitted: (id, txHash) => update(id, 'submitted', { txHash: typeof txHash === 'string' ? txHash.slice(0, 160) : null }),
    confirmed: (id, receipt) => {
      const existing = entries.find(item => item.id === id);
      return update(id, 'confirmed', { txHash: existing?.txHash ?? (typeof receipt?.hash === 'string' ? receipt.hash.slice(0, 160) : undefined) });
    },
    signed: (id, result) => update(id, 'signed', { digest: typeof result?.digest === 'string' ? result.digest.slice(0, 160) : undefined }),
    rejected: (id, error) => update(id, 'rejected', { error }),
    failed: (id, error) => update(id, 'failed', { error }),
  };
}

const TransactionContext = createContext(null);
export function TransactionProvider({ children, store }) {
  const value = useMemo(() => store ?? createTransactionStore(), [store]);
  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
}
export function useTransactions() {
  const store = useContext(TransactionContext);
  if (!store) throw new Error('useTransactions must be used within TransactionProvider');
  const entries = useSyncExternalStore(store.subscribe, store.get, store.get);
  return useMemo(() => ({ entries, ...store }), [entries, store]);
}
