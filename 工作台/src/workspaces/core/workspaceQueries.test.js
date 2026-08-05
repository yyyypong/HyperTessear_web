import { describe, expect, it, vi } from 'vitest';
import { loadPoolOverview, loadRoleOverview, loadSettlementOverview, loadVaultOverview } from './workspaceQueries';

const vault = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';

describe('workspaceQueries', () => {
  it('loads the vault chain facts concurrently into a deterministic result', async () => {
    const sdk = {
      isVaultRegistered: vi.fn().mockResolvedValue(true),
      isVaultActive: vi.fn().mockResolvedValue(false),
      getStateContext: vi.fn().mockResolvedValue({ product: 3, cycle: 0, pause: 1, cycleNumber: 7n }),
      getNAV: vi.fn().mockResolvedValue({ nav: 1_025_000n, dataTimestamp: 10n, updatedAt: 11n }),
      isNAVFresh: vi.fn().mockResolvedValue(true),
    };

    await expect(loadVaultOverview({ sdk, vault, now: () => 1234 })).resolves.toEqual({
      status: 'success',
      data: {
        registered: true,
        active: false,
        state: { product: 3, cycle: 0, pause: 1, cycleNumber: 7n },
        nav: { nav: 1_025_000n, dataTimestamp: 10n, updatedAt: 11n },
        navFresh: true,
      },
      error: null,
      refreshedAt: 1234,
    });
  });

  it('loads settlement, supplied global roles and pool facts', async () => {
    const sdk = {
      isOperator: vi.fn().mockResolvedValue(true), threshold: vi.fn().mockResolvedValue(2n),
      hasRole: vi.fn(async role => role === 'governor'),
      getContract: vi.fn(name => name === 'StateManager'
        ? { modulePaused: vi.fn(async id => id === 1) }
        : { globalPaused: vi.fn().mockResolvedValue(false) }),
      pending: vi.fn().mockResolvedValue(4n), availableToDistribute: vi.fn().mockResolvedValue(5n), totalPending: vi.fn().mockResolvedValue(6n),
    };
    const roleIds = { governor: 'governor', keeper: 'keeper' };

    await expect(loadSettlementOverview({ sdk, account, now: () => 1 })).resolves.toMatchObject({ status: 'success', data: { operator: true, threshold: 2n } });
    await expect(loadRoleOverview({ sdk, account, roleIds, moduleIds: [0, 1], now: () => 2 })).resolves.toEqual({
      status: 'success',
      data: { roles: { governor: true, keeper: false }, modulesPaused: { 0: false, 1: true }, psmPaused: false },
      error: null,
      refreshedAt: 2,
    });
    await expect(loadPoolOverview({ sdk, vault, now: () => 3 })).resolves.toMatchObject({ status: 'success', data: { pending: 4n, available: 5n, totalPending: 6n } });
  });

  it('maps RPC failures to a stable safe error without exposing provider text', async () => {
    const result = await loadSettlementOverview({
      sdk: { isOperator: vi.fn().mockRejectedValue(new Error('secret rpc endpoint and revert data')), threshold: vi.fn().mockResolvedValue(2n) },
      account,
      now: () => 99,
    });

    expect(result).toEqual({ status: 'error', data: null, error: { code: 'settlementOverviewUnavailable', messageKey: 'workspaces.errors.settlementOverviewUnavailable' }, refreshedAt: 99 });
    expect(JSON.stringify(result)).not.toContain('secret rpc');
  });

  it('propagates AbortError before and after RPC completion', async () => {
    const before = new AbortController();
    before.abort();
    await expect(loadPoolOverview({ sdk: {}, vault, signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' });

    const after = new AbortController();
    const sdk = {
      pending: vi.fn(async () => { after.abort(); return 1n; }),
      availableToDistribute: vi.fn().mockResolvedValue(2n),
      totalPending: vi.fn().mockResolvedValue(3n),
    };
    await expect(loadPoolOverview({ sdk, vault, signal: after.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
