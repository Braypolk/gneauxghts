import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqliteExecutor } from '@earendil-works/pi-durable/storage/sqlite';
import { openNativeSqlite } from './nativeSqlite';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
beforeEach(() => {
  native.invoke.mockReset().mockImplementation(async (_command, { request }) => {
    if (request.action === 'open') return 19;
    if (request.action === 'begin') return 5;
  });
});
const actions = () => native.invoke.mock.calls.map(([, { request }]) => request.action);

describe('native Pi SQLite lifetime', () => {
  it('returns a transaction result only after commit and revokes retained callback handles', async () => {
    const db = await openNativeSqlite();
    let retained!: SqliteExecutor;
    const result = await db.transaction(async tx => {
      retained = tx;
      await tx.run('INSERT INTO effects VALUES (?)', 1n);
      expect(actions()).toEqual(['open', 'begin', 'run']);
      return 'durable';
    });
    expect(result).toBe('durable');
    expect(actions()).toEqual(['open', 'begin', 'run', 'commit']);
    expect(native.invoke.mock.calls[2][1].request).toMatchObject({ owner: 19, transaction: 5, params: [{ integer: '1' }] });
    await expect(retained.run('INSERT INTO effects VALUES (2)')).rejects.toThrow('handle closed');
    expect(actions()).toEqual(['open', 'begin', 'run', 'commit']);
  });

  it('rolls back a failed commit instead of exposing callback success', async () => {
    const failure = new Error('durable commit failed');
    native.invoke.mockImplementation(async (_command, { request }) => {
      if (request.action === 'open') return 19;
      if (request.action === 'begin') return 5;
      if (request.action === 'commit') throw failure;
    });
    const db = await openNativeSqlite();
    await expect(db.transaction(async tx => { await tx.run('INSERT INTO effects VALUES (1)'); return 'success'; })).rejects.toBe(failure);
    expect(actions()).toEqual(['open', 'begin', 'run', 'commit', 'rollback']);
  });

  it('preserves both causes if rollback cannot be guaranteed and keeps later work ordered', async () => {
    const failure = new Error('effect failed'), rollback = new Error('rollback failed');
    native.invoke.mockImplementation(async (_command, { request }) => {
      if (request.action === 'open') return 19;
      if (request.action === 'begin') return 5;
      if (request.action === 'rollback') throw rollback;
    });
    const db = await openNativeSqlite();
    const result = db.transaction(async () => { throw failure; });
    const close = db.close();
    const error = await result.catch(value => value);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([failure, rollback]);
    await close;
    expect(actions()).toEqual(['open', 'begin', 'rollback', 'close']);
    await expect(db.run('INSERT INTO effects VALUES (2)')).rejects.toThrow('facade closed');
  });
});
