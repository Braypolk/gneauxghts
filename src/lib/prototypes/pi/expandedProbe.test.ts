import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: vi.fn(), shared: vi.fn(), followons: vi.fn(), storage: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { prototypeState: mocks.state } }));
vi.mock('./interactiveProbe', () => ({ runInteractiveProbe: mocks.shared }));
vi.mock('./expandedFollowonsProbe', () => ({ runExpandedFollowonsProbe: mocks.followons }));
vi.mock('./nativeStorageFaultProbe', () => ({ runNativeStorageFaultProbe: mocks.storage }));
import { runExpandedProbe } from './expandedProbe';

describe('explicit native expanded journey wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const location = { href: 'http://tauri.localhost/?piExpandedTest=1' };
    vi.stubGlobal('location', location);
    vi.stubGlobal('history', { state: null, replaceState: (_state: unknown, _title: string, url: string | URL) => { location.href = String(url); } });
    mocks.invoke.mockImplementation(async command => command === 'pi_probe_config' ? { fixture: true, interactiveGate: true, expandedGate: true } : undefined);
    mocks.state.mockResolvedValue({});
    mocks.storage.mockResolvedValue({ status: 'passed' });
    mocks.followons.mockResolvedValue({ gate: 'expanded-native-followons-fixture', status: 'passed', checks: [] });
    mocks.shared.mockImplementation(async () => ({ gate: 'first-usable-desktop-fixture',
      phase: new URL(location.href).searchParams.get('piInteractiveTest'), status: 'passed', checks: ['observed'], receipts: { timings: [{ at: 1 }] } }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it('requires every native fixture grant and the explicit query before starting work', async () => {
    mocks.invoke.mockResolvedValue({ fixture: true, interactiveGate: true, expandedGate: false });
    expect(await runExpandedProbe()).toBeUndefined();
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.shared).not.toHaveBeenCalled();
  });
  it('propagates failed UI admission and restores the original URL without advancing phases', async () => {
    mocks.shared.mockResolvedValue({ gate: 'first-usable-desktop-fixture', phase: 'seed', status: 'failed', error: 'storage unavailable', checks: ['visible checkpoint observed'], receipts: { partialId: 'acknowledged-partial' } });
    const result = await runExpandedProbe();
    expect(result).toMatchObject({ status: 'failed', error: 'Error: storage unavailable' });
    expect(result?.shared).toMatchObject([{ status: 'failed', checks: ['visible checkpoint observed'], receipts: { partialId: 'acknowledged-partial' } }]);
    expect(mocks.shared).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('http://tauri.localhost/?piExpandedTest=1');
    expect(mocks.invoke).toHaveBeenLastCalledWith('pi_ui_report', { report: result });
  });
  it('runs the shared fresh phases and retains their observations with explicit incomplete limits', async () => {
    mocks.state.mockResolvedValue(undefined);
    const result = await runExpandedProbe();
    expect(result).toMatchObject({ status: 'passed', phase: 'first' });
    expect(result?.shared.map(value => value.phase)).toEqual(['seed', 'first']);
    expect(result?.shared[0].receipts).toEqual({ timingEventCount: 1 });
    expect(result?.unobserved.length).toBeGreaterThan(0);
    expect(location.href).toBe('http://tauri.localhost/?piExpandedTest=1');
    expect(mocks.followons).not.toHaveBeenCalled();
  });
  const relaunchState = { interactiveStateJson: JSON.stringify({ a: 'a', b: 'b', source: { noteId: 'n' }, interruptedId: 'i', keepId: 'k', discardId: 'd' }) };
  it('runs opted-in follow-ons after shared UI and before storage closes owners', async () => {
    mocks.state.mockResolvedValue(relaunchState);
    mocks.invoke.mockImplementation(async command => command === 'pi_probe_config' ? { fixture: true, interactiveGate: true, expandedGate: true, followonsGate: true } : undefined);
    const result = await runExpandedProbe();
    expect(result?.shared.map(value => value.phase)).toEqual(['relaunch', 'failures']);
    expect(result).toMatchObject({ status: 'passed', followons: { status: 'passed' }, storageFaults: { status: 'passed' } });
    expect(mocks.shared.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.followons.mock.invocationCallOrder[0]);
    expect(mocks.followons.mock.invocationCallOrder[0]).toBeLessThan(mocks.storage.mock.invocationCallOrder[0]);
    expect(mocks.storage).toHaveBeenCalledWith({ phase: 'last-after-ui', generatedSyntheticRoot: true });
  });
  it.each([undefined, { status: 'failed', error: 'native follow-on admission failed' }])('never closes owners after an enabled absent or failed follow-on report', async followons => {
    mocks.state.mockResolvedValue(relaunchState);
    mocks.invoke.mockImplementation(async command => command === 'pi_probe_config' ? { fixture: true, interactiveGate: true, expandedGate: true, followonsGate: true } : undefined);
    mocks.followons.mockResolvedValue(followons);
    expect(await runExpandedProbe()).toMatchObject({ status: 'failed' });
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('preserves the default expanded route without opting into follow-ons', async () => {
    mocks.state.mockResolvedValue(relaunchState);
    expect(await runExpandedProbe()).toMatchObject({ status: 'passed', storageFaults: { status: 'passed' } });
    expect(mocks.followons).not.toHaveBeenCalled();
  });
});
