import { act, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { createTransactionStore, TransactionProvider, useTransactions } from './transactionStore';

function StatusProbe() {
  const { entries } = useTransactions();
  return <output>{entries.at(-1)?.status ?? 'empty'}</output>;
}

describe('transaction store', () => {
  test('publishes a new snapshot identity for every transition so React subscribers rerender', () => {
    let tick = 1;
    const store = createTransactionStore({ storage: null, now: () => tick++ });
    render(<TransactionProvider store={store}><StatusProbe /></TransactionProvider>);
    expect(screen.getByText('empty')).toBeInTheDocument();
    let id;
    act(() => { id = store.prepare('nav.sign', { vault: 'safe' }); });
    expect(screen.getByText('prepared')).toBeInTheDocument();
    const preparedSnapshot = store.get();
    act(() => { store.awaitingWallet(id); });
    expect(screen.getByText('awaitingWallet')).toBeInTheDocument();
    expect(store.get()).not.toBe(preparedSnapshot);
  });

  test('sanitizes hostile persisted entries on load and bounds their summaries', () => {
    const hostile = [{
      id: 'x'.repeat(500), actionId: 'nav.sign', status: 'prepared', signature: '0xsecret',
      input: { vault: 'safe', sig: '0xsecret', instruction: { calldata: '0xsecret' }, note: 'n'.repeat(500) },
      provider: { secret: true }, receipt: { logs: ['secret'] },
    }];
    const storage = { getItem: () => JSON.stringify(hostile), setItem: () => {} };
    const store = createTransactionStore({ storage });
    const serialized = JSON.stringify(store.get());
    expect(serialized).not.toMatch(/"(?:signature|sig|instruction|calldata|provider|signer|receipt|logs)"\s*:/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(store.get()[0].id.length).toBeLessThanOrEqual(160);
    expect(store.get()[0].input).toEqual({ vault: 'safe' });
  });

  test('returns a stable deeply immutable snapshot between legal updates', () => {
    const store = createTransactionStore({ storage: null, now: () => 1 });
    store.prepare('nav.sign', { vault: 'safe', note: 'not persisted' });
    const snapshot = store.get();
    expect(store.get()).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(Object.isFrozen(snapshot[0].input)).toBe(true);
    expect(() => snapshot.push({})).toThrow(TypeError);
    expect(() => { snapshot[0].status = 'confirmed'; }).toThrow(TypeError);
    expect(() => { snapshot[0].input.vault = 'mutated'; }).toThrow(TypeError);
    expect(store.get()[0]).toMatchObject({ status: 'prepared', input: { vault: 'safe' } });
  });
});
