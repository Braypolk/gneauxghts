import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const relaunchMock = vi.fn();
const pendingSaveMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }));
vi.mock('$lib/features/notepad/navigation/pendingNoteSave', () => ({
  awaitPendingNoteSave: pendingSaveMock
}));

describe('RestartLifecycle', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    relaunchMock.mockReset();
    pendingSaveMock.mockReset();
    pendingSaveMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({
      status: 'ready',
      ready: true,
      timelinePortable: true,
      canResume: false
    });
    relaunchMock.mockResolvedValue(undefined);
  });

  it('joins duplicate restart requests behind the existing persistence barrier', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    let releaseSave!: () => void;
    pendingSaveMock.mockImplementation(
      () => new Promise<void>((resolve) => (releaseSave = resolve))
    );
    const lifecycle = new RestartLifecycle();

    const first = lifecycle.restart();
    const duplicate = lifecycle.restart();

    expect(duplicate).toBe(first);
    expect(lifecycle.workspaceMutationsBlocked).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
    releaseSave();
    await first;

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('prepare_restart');
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(lifecycle.phase).toBe('readyToRestart');
  });

  it('does not prepare or relaunch when restore/save departure fails', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    pendingSaveMock.mockRejectedValue(new Error('external conflict'));
    const lifecycle = new RestartLifecycle();

    await lifecycle.restart();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(lifecycle.phase).toBe('failure');
    expect(lifecycle.workspaceMutationsBlocked).toBe(false);
  });

  it('restores mutation admission only when every backend owner remains usable', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    const lifecycle = new RestartLifecycle();
    invokeMock.mockResolvedValue({
      status: 'failed',
      ready: false,
      timelinePortable: false,
      canResume: false,
      error: 'watcher stopped before close failed'
    });

    await lifecycle.restart();

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(lifecycle.phase).toBe('failure');
    expect(lifecycle.workspaceMutationsBlocked).toBe(true);
  });

  it('restores mutation admission after an explicitly reversible backend failure', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    const lifecycle = new RestartLifecycle();
    invokeMock.mockResolvedValue({
      status: 'failed',
      ready: false,
      timelinePortable: false,
      canResume: true,
      error: 'provider refused reversible quiescence'
    });

    await lifecycle.restart();

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(lifecycle.workspaceMutationsBlocked).toBe(false);
  });

  it('keeps mutation admission closed when backend dispatch has no receipt', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    const lifecycle = new RestartLifecycle();
    invokeMock.mockRejectedValueOnce(new Error('response channel closed')).mockResolvedValueOnce({
      status: 'ready',
      ready: true,
      timelinePortable: true,
      canResume: false
    });

    await lifecycle.restart();
    expect(lifecycle.workspaceMutationsBlocked).toBe(true);
    expect(relaunchMock).not.toHaveBeenCalled();

    await lifecycle.restart();
    expect(pendingSaveMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(relaunchMock).toHaveBeenCalledOnce();
  });

  it('keeps the closed state and retries only relaunch after relaunch rejection', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    const lifecycle = new RestartLifecycle();
    relaunchMock.mockRejectedValueOnce(new Error('plugin failed')).mockResolvedValueOnce(undefined);

    await lifecycle.restart();
    expect(lifecycle.phase).toBe('readyToRestart');
    expect(lifecycle.workspaceMutationsBlocked).toBe(true);
    expect(lifecycle.error).toContain('plugin failed');

    await lifecycle.restart();
    expect(pendingSaveMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(relaunchMock).toHaveBeenCalledTimes(2);
  });

  it('applies ordinary-exit backend status to the same mutation gate', async () => {
    const { RestartLifecycle } = await import('./restartLifecycle.svelte');
    const lifecycle = new RestartLifecycle();

    lifecycle.observeBackendPreparing();
    expect(lifecycle.phase).toBe('preparing');
    expect(lifecycle.workspaceMutationsBlocked).toBe(true);

    lifecycle.observeBackendReceipt({
      status: 'failed',
      ready: false,
      timelinePortable: false,
      canResume: true,
      error: 'reversible failure'
    });
    expect(lifecycle.phase).toBe('failure');
    expect(lifecycle.workspaceMutationsBlocked).toBe(false);
  });
});
