import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBackgroundPersistence, registerBackgroundSave } from './backgroundPersistence';

const mocks = vi.hoisted(() => ({ listen: vi.fn(), native: vi.fn(), log: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('$lib/tauriRuntime', () => ({ isTauriRuntime: mocks.native }));
vi.mock('$lib/logDevError', () => ({ logDevError: mocks.log }));

describe('background persistence signals', () => {
  let doc: EventTarget & { visibilityState: string };
  let win: EventTarget;
  const cleanups: Array<() => void> = [];
  beforeEach(() => {
    vi.clearAllMocks();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    win = new EventTarget();
    vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
    mocks.native.mockReturnValue(false);
    mocks.listen.mockResolvedValue(vi.fn());
  });
  afterEach(() => {
    cleanups.splice(0).reverse().forEach(cleanup => cleanup());
    vi.unstubAllGlobals();
  });

  it('requests all feature owners when hidden or departing, without waiting on another owner', async () => {
    const failed = vi.fn(async () => { throw new Error('disk unavailable'); });
    const healthy = vi.fn(async () => undefined);
    cleanups.push(registerBackgroundSave(failed), registerBackgroundSave(healthy), installBackgroundPersistence());
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(healthy).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(failed).toHaveBeenCalledOnce(); expect(healthy).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(mocks.log).toHaveBeenCalled();
    win.dispatchEvent(new Event('pagehide'));
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('removes retired owners and both DOM listeners', () => {
    const save = vi.fn(async () => undefined);
    const unregister = registerBackgroundSave(save);
    const dispose = installBackgroundPersistence();
    cleanups.push(unregister, dispose);
    unregister();
    win.dispatchEvent(new Event('pagehide'));
    expect(save).not.toHaveBeenCalled();
    const other = vi.fn(async () => undefined);
    cleanups.push(registerBackgroundSave(other));
    dispose();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('pagehide'));
    expect(other).not.toHaveBeenCalled();
  });

  it('uses native suspension and releases a listener acquired after disposal', async () => {
    mocks.native.mockReturnValue(true);
    let resolve!: (cleanup: () => void) => void;
    mocks.listen.mockReturnValue(new Promise<() => void>(done => { resolve = done; }));
    const save = vi.fn(async () => undefined);
    const dispose = installBackgroundPersistence();
    cleanups.push(registerBackgroundSave(save), dispose);
    expect(mocks.listen).toHaveBeenCalledWith('app://backgrounding', expect.any(Function));
    const callback = mocks.listen.mock.calls[0][1];
    callback(); expect(save).toHaveBeenCalledOnce();
    dispose();
    callback(); expect(save).toHaveBeenCalledOnce();
    const unlisten = vi.fn(); resolve(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });

  it('keeps DOM background saves available when native listener setup fails', async () => {
    mocks.native.mockReturnValue(true);
    mocks.listen.mockRejectedValue(new Error('native listener unavailable'));
    const save = vi.fn(async () => undefined);
    cleanups.push(registerBackgroundSave(save), installBackgroundPersistence());
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalled());
    win.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenCalledOnce();
  });
});
