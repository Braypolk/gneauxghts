import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armSuspensionLease, finishSuspensionLease, assertSuspensionSnapshot, suspensionControlOrigin,
  runSupplementalSuspensionProbe, verifySupplementalSuspensionRelaunch, type SuspensionSnapshot, type SuspensionSql, type SuspensionSqlRequest } from './supplementalSuspensionProbe';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

const snapshot = (): SuspensionSnapshot => ({ ordinary: { noteId: 'ordinary-1', path: '/synthetic/ordinary.md', title: 'Ordinary', markdown: 'Exact authored ordinary bytes.\n', connected: true },
  review: { proposalId: 'pi-review-1', reviewId: 'review-native-1', connected: true, markdown: 'Reviewed human bytes.', title: 'Reviewed', hunks: [],
    draft: { version: 9, markdown: 'Reviewed human bytes.', title: 'Reviewed', path: '/synthetic/Chats/Pi/Reviewed.md', decisions: [] } },
  partial: { conversationId: 'pi-1', messageId: 'pi-assistant-3', content: 'Acknowledged partial fixture text.', status: 'streaming', renderedPartial: true, normalControl: 'Stop response' } });

describe('native target admission for the supplemental iOS suspension lane', () => {
  const gates = { fixture: true, interactiveGate: true, expandedGate: true, fixtureBaseUrl: 'http://127.0.0.1:1443' };
  const input = (localBaseUrl: string | undefined = 'http://127.0.0.1:1443/local/v1') => ({
    api: { getSettings: vi.fn(async (): Promise<{ localBaseUrl: string | undefined }> => ({ localBaseUrl })), prototypeState: vi.fn(async () => undefined), prototypeCheckpoint: vi.fn(async () => {}) },
    launchId: 'owned-launch', capture: vi.fn(async () => snapshot()), emit: vi.fn(async () => {}),
  });
  const fetchControl = vi.fn();
  beforeEach(() => { mocks.invoke.mockReset(); fetchControl.mockReset(); vi.stubGlobal('fetch', fetchControl); });
  afterEach(() => vi.unstubAllGlobals());

  it('skips an explicitly native desktop target before reading its journey-modified endpoint or contacting iOS control', async () => {
    mocks.invoke.mockResolvedValue({ ...gates, iosTarget: false });
    const probe = input('https://journey-modified.invalid/v1');
    await expect(runSupplementalSuspensionProbe(probe)).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledWith('pi_probe_config');
    expect(probe.api.getSettings).not.toHaveBeenCalled(); expect(fetchControl).not.toHaveBeenCalled();
    expect(probe.capture).not.toHaveBeenCalled(); expect(probe.api.prototypeCheckpoint).not.toHaveBeenCalled(); expect(probe.emit).not.toHaveBeenCalled();
  });
  it('fails closed when native target identity is absent', async () => {
    mocks.invoke.mockResolvedValue(gates);
    const probe = input();
    await expect(runSupplementalSuspensionProbe(probe)).rejects.toThrow(/native target/);
    expect(probe.api.getSettings).not.toHaveBeenCalled(); expect(fetchControl).not.toHaveBeenCalled();
  });
  it.each([undefined, 'https://127.0.0.1:1443', 'http://127.0.0.1:8080'])('rejects an iOS target with unavailable or invalid endpoint %s', async endpoint => {
    mocks.invoke.mockResolvedValue({ ...gates, iosTarget: true, fixtureBaseUrl: endpoint });
    const probe = input();
    await expect(runSupplementalSuspensionProbe(probe)).rejects.toThrow(/fixture/);
    expect(fetchControl).not.toHaveBeenCalled(); expect(probe.capture).not.toHaveBeenCalled(); expect(probe.emit).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'rejected', 'foreign'] as const)('fails closed when iOS control is %s', async mode => {
    mocks.invoke.mockResolvedValue({ ...gates, iosTarget: true });
    if (mode === 'unavailable') fetchControl.mockRejectedValue(new Error('Owned control unavailable'));
    else fetchControl.mockResolvedValue({ ok: mode !== 'rejected', json: async () => ({ gate: 'foreign-control', launchId: 'owned-launch' }) });
    const probe = input('http://localhost:1234/v1');
    await expect(runSupplementalSuspensionProbe(probe)).rejects.toThrow(mode === 'unavailable' ? /unavailable/ : mode === 'rejected' ? /rejected request/ : /Unrecognized/);
    expect(fetchControl).toHaveBeenCalledWith('http://127.0.0.1:1444/pi-suspension/discover?launchId=owned-launch', expect.anything());
    expect(probe.api.getSettings).not.toHaveBeenCalled();
    expect(probe.capture).not.toHaveBeenCalled(); expect(probe.api.prototypeCheckpoint).not.toHaveBeenCalled(); expect(probe.emit).not.toHaveBeenCalled();
  });
});

describe('fresh iOS foreground retention contract', () => {
  it('requires a guarded owned loopback fixture port for the control channel', () => {
    expect(suspensionControlOrigin('http://127.0.0.1:1443/local/v1')).toBe('http://127.0.0.1:1444');
    expect(suspensionControlOrigin('http://127.0.0.1:1446')).toBe('http://127.0.0.1:1447');
    for (const value of [undefined, 'https://127.0.0.1:1443', 'http://localhost:1443', 'http://user@127.0.0.1:1443', 'http://127.0.0.1:1443?secret=value', 'http://127.0.0.1:8080'])
      expect(() => suspensionControlOrigin(value)).toThrow();
  });
  it('compares exact ordinary editor bytes and complete pending review fields, not merely visible text', () => {
    const baseline = snapshot(); expect(() => assertSuspensionSnapshot(baseline, snapshot(), 'foreground')).not.toThrow();
    const changes: Array<(value: SuspensionSnapshot) => void> = [
      value => { value.ordinary.noteId = 'other'; }, value => { value.ordinary.path = '/other.md'; }, value => { value.ordinary.title = 'Other'; },
      value => { value.ordinary.markdown += ' '; }, value => { value.ordinary.connected = false; },
      value => { value.review.proposalId = 'pi-review-2'; }, value => { value.review.reviewId = 'superseded'; },
      value => { value.review.draft.version++; }, value => { value.review.draft.path = '/other.md'; },
      value => { value.review.markdown += ' '; value.review.draft.markdown += ' '; },
      value => { value.review.draft.title = 'Other'; }, value => { value.review.connected = false; },
      value => { value.review.draft.decisions = [{ id: 'hunk', baseFrom: 0, baseTo: 0, proposedFrom: 0, proposedTo: 1, oldText: '', newText: 'x', from: 0, to: 1, status: 'modified' }]; },
      value => { value.partial.messageId = 'another'; }, value => { value.partial.content += ' '; },
      value => { value.partial.renderedPartial = false; }, value => { value.partial.normalControl = 'Retry'; }, value => { value.partial.status = 'completed'; },
    ];
    for (const change of changes) { const actual = snapshot(); change(actual); expect(() => assertSuspensionSnapshot(baseline, actual, 'foreground')).toThrow(); }
  });
  it('requires exact retained state with interrupted status and normal Retry before consuming the relaunch review', async () => {
    const baseline = snapshot(), restored = snapshot(); restored.partial.status = 'error'; restored.partial.normalControl = 'Retry';
    const api = { prototypeState: async () => ({ supplementalSuspensionStateJson: JSON.stringify({ launchId: 'old-launch', baseline }) }),
      prototypeCheckpoint: async () => {}, getSettings: async () => ({}) };
    expect((await verifySupplementalSuspensionRelaunch({ api, capture: async () => restored }))?.priorLaunchId).toBe('old-launch');
    restored.review.draft.version++;
    await expect(verifySupplementalSuspensionRelaunch({ api, capture: async () => restored })).rejects.toThrow(/exact pending review/);
    expect(await verifySupplementalSuspensionRelaunch({ api: { ...api, prototypeState: async () => undefined }, capture: async () => { throw new Error('Must not read unrelated UI'); } })).toBeUndefined();
  });
});

function leaseFixture(mode: 'expired' | 'accepts' | 'leaks' | 'stale-accepts' | 'fresh-fails' = 'expired') {
  const requests: SuspensionSqlRequest[] = []; let owner = 0, transaction = 0, rows = 0, uncommitted = false;
  const sql: SuspensionSql = async <T>(request: SuspensionSqlRequest): Promise<T> => {
    requests.push({ ...request });
    if (request.action === 'open') { owner++; if (uncommitted) { rows = mode === 'leaks' ? 1 : 0; uncommitted = false; } return owner as T; }
    if (request.action === 'begin') { transaction++; uncommitted = true; return transaction as T; }
    if (request.action === 'commit') {
      if (mode === 'accepts' || (mode === 'stale-accepts' && request.owner !== owner)) return undefined as T;
      throw new Error('Revoked SQLite owner');
    }
    if (request.action === 'get') return { count: rows } as T;
    if (request.action === 'run' && request.transaction === undefined) { if (mode !== 'fresh-fails') rows++; }
    if (request.action === 'exec' && request.sql?.startsWith('DROP')) rows = 0;
    return undefined as T;
  };
  return { requests, sql, time: () => 20000 };
}

describe('actual native transaction spanning owned suspension orchestration', () => {
  it('arms BEGIN and an uncommitted row, then rejects COMMIT and stale owner, verifies zero rows and successful fresh work', async () => {
    const fixture = leaseFixture(), armed = await armSuspensionLease(fixture.sql, () => 100);
    expect(armed).toEqual({ owner: 1, transaction: 1, armedAt: 100, uncommittedRows: 1 });
    const receipt = await finishSuspensionLease(fixture.sql, armed, fixture.time);
    expect(receipt.rejectedDurableRows).toBe(0); expect(receipt.freshOwnerRows).toBe(1);
    const commits = fixture.requests.filter(value => value.action === 'commit');
    expect(commits).toEqual([{ action: 'commit', owner: 1, transaction: 1 }, { action: 'commit', owner: 1, transaction: 1 }]);
    expect(fixture.requests.at(-1)).toEqual({ action: 'close', owner: 3 });
  });
  it.each(['accepts', 'leaks', 'stale-accepts', 'fresh-fails'] as const)('fails closed and cleans its native table when %s', async mode => {
    const fixture = leaseFixture(mode), armed = await armSuspensionLease(fixture.sql, () => 100);
    await expect(finishSuspensionLease(fixture.sql, armed, fixture.time)).rejects.toThrow();
    expect(fixture.requests.at(-2)?.sql).toBe('DROP TABLE IF EXISTS pi_suspension_lease;');
    expect(fixture.requests.at(-1)?.action).toBe('close');
  });
  it('never calls a late COMMIT before the lease exceeds the actual bound', async () => {
    const fixture = leaseFixture(), armed = await armSuspensionLease(fixture.sql, () => 100);
    await expect(finishSuspensionLease(fixture.sql, armed, () => 12100)).rejects.toThrow(/ten-second/);
    expect(fixture.requests.some(value => value.action === 'commit')).toBe(false);
  });
});
