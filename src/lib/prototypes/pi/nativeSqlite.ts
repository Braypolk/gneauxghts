// Experimental native facade for upstream Pi's schema; no lifecycle state here.
import { invoke } from '@tauri-apps/api/core';
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@earendil-works/pi-durable/storage/sqlite';

function encode(value: SqliteValue) {
  if (typeof value === 'bigint') return { integer: String(value) };
  if (value instanceof Uint8Array) return { blob: [...value] };
  return value;
}
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    if ('integer' in value) return BigInt(String(value.integer));
    if ('blob' in value) return Uint8Array.from(value.blob as number[]);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}

export async function openNativeSqlite(): Promise<SqliteDatabase> {
  const owner = await invoke<number>('pi_sql', { request: { action: 'open' } });
  let tail = Promise.resolve();
  let closed = false;
  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(() => {
      if (closed) throw new Error('SQLite facade closed');
      return operation();
    });
    tail = result.then(() => {}, () => {});
    return result;
  };
  const send = async (action: string, transaction?: number, sql?: string, params: SqliteValue[] = []) =>
    decode(await invoke('pi_sql', { request: { action, owner, transaction, sql, params: params.map(encode) } }));
  const executor = (transaction?: number, isValid = () => true): SqliteExecutor => {
    const run = <T>(action: string, sql: string, params: SqliteValue[]) => {
      const operation = async () => {
        if (!isValid()) throw new Error('SQLite transaction handle closed');
        return await send(action, transaction, sql, params) as T;
      };
      return transaction === undefined ? queue(operation) : operation();
    };
    return {
      exec: sql => run<void>('exec', sql, []),
      run: (sql, ...params) => run<void>('run', sql, params),
      get: async <T extends object>(sql: string, ...params: SqliteValue[]) =>
        (await run<T | null>('get', sql, params)) ?? undefined,
      all: <T extends object>(sql: string, ...params: SqliteValue[]) => run<T[]>('all', sql, params)
    };
  };
  return {
    ...executor(),
    transaction: callback => queue(async () => {
      const transaction = await send('begin') as number;
      let valid = true;
      try {
        const result = await callback(executor(transaction, () => valid));
        valid = false;
        await send('commit', transaction);
        return result;
      } catch (error) {
        valid = false;
        try { await send('rollback', transaction); }
        catch (rollback) { throw new AggregateError([error, rollback], 'SQLite rollback not guaranteed'); }
        throw error;
      }
    }),
    close: () => queue(async () => { await send('close'); closed = true; })
  };
}
