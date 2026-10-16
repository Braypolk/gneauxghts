// LAST phase only, in a generated synthetic native root. This probes the actual
// SQLite/lease facade, without replacing Pi storage or injecting runtime hooks.
// It closes every chat owner, so callers must finish all UI journeys first and
// must relaunch the process before any subsequent chat work.
import { invoke } from '@tauri-apps/api/core';
import { closePiChatApis } from './chatApi';
import { openNativeSqlite } from './nativeSqlite';

type SqlRequest = { action: 'open' | 'close' | 'begin' | 'commit' | 'rollback' | 'exec' | 'run' | 'get'; owner?: number; transaction?: number; sql?: string; params?: number[] };
type Receipt = { name: string; status: 'passed'; [key: string]: unknown };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const describeError = (error: unknown): string => error instanceof AggregateError
  ? `${String(error)}: ${error.errors.map(describeError).join('; ')}` : String(error);
async function rejected(operation: () => Promise<unknown>, label: string) {
  try { await operation(); } catch (error) { return describeError(error); }
  throw new Error(`${label} was incorrectly acknowledged`);
}

export async function runNativeStorageFaultProbe(options: { phase: 'last-after-ui'; generatedSyntheticRoot: true }) {
  const config = await invoke<{ fixture: boolean; interactiveGate: boolean }>('pi_probe_config');
  assert(config.fixture && config.interactiveGate && options.phase === 'last-after-ui' && options.generatedSyntheticRoot,
    'Native storage faults require explicit last-phase synthetic fixture activation');
  await closePiChatApis();
  const startedAt = Date.now(), receipts: Receipt[] = [];
  const mark = (name: string, detail: Record<string, unknown>) => receipts.push({ name, status: 'passed', ...detail });
  const sql = <T = unknown>(request: SqlRequest) => invoke<T>('pi_sql', { request });

  // Callback rollback and deferred FK violation exercise two different paths:
  // the latter fails in SQLite COMMIT after the callback successfully returns.
  const db = await openNativeSqlite();
  try {
    await db.exec('CREATE TABLE IF NOT EXISTS pi_fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS pi_fault_child(parent_id INTEGER REFERENCES pi_fault_parent(id) DEFERRABLE INITIALLY DEFERRED); DELETE FROM pi_fault_child; DELETE FROM pi_fault_parent;');
    const intentional = new Error('Synthetic callback rollback');
    let callbackFailure: unknown;
    try { await db.transaction(async tx => { await tx.run('INSERT INTO pi_fault_parent VALUES (1)'); throw intentional; }); }
    catch (error) { callbackFailure = error; }
    assert(callbackFailure === intentional, 'Native callback rollback changed or lost its error');
    assert((await db.get<{ count: number }>('SELECT count(*) AS count FROM pi_fault_parent'))?.count === 0, 'Callback rollback leaked a durable row');
    mark('native callback rollback', { error: String(callbackFailure), durableRows: 0 });

    let callbackReturned = false;
    const commitError = await rejected(() => db.transaction(async tx => {
      await tx.run('INSERT INTO pi_fault_child VALUES (404)'); callbackReturned = true;
    }), 'Deferred foreign-key COMMIT');
    assert(callbackReturned && /foreign key/i.test(commitError), 'Failure did not occur at real deferred-constraint COMMIT');
    assert((await db.get<{ count: number }>('SELECT count(*) AS count FROM pi_fault_child'))?.count === 0, 'Failed COMMIT leaked its uncommitted row');
    await db.transaction(async tx => { await tx.run('INSERT INTO pi_fault_parent VALUES (1)'); await tx.run('INSERT INTO pi_fault_child VALUES (1)'); });
    assert((await db.get<{ count: number }>('SELECT count(*) AS count FROM pi_fault_child'))?.count === 1, 'Facade did not recover after COMMIT rollback');
    mark('native COMMIT failure and rollback', { callbackReturned, error: commitError, rejectedDurableRows: 0, laterCommittedRows: 1 });
    await db.exec('DROP TABLE pi_fault_child; DROP TABLE pi_fault_parent;');
  } finally { await db.close(); }

  // A page quota produces SQLite's real SQLITE_FULL condition in a bounded
  // generated database, without filling the host filesystem or private vault.
  let owner = await sql<number>({ action: 'open' });
  let priorMax: number | undefined;
  try {
    await sql({ action: 'exec', owner, sql: 'CREATE TABLE IF NOT EXISTS pi_fault_full(payload BLOB); DELETE FROM pi_fault_full;' });
    const pageCount = (await sql<{ page_count: number }>({ action: 'get', owner, sql: 'PRAGMA page_count' })).page_count;
    const pageSize = (await sql<{ page_size: number }>({ action: 'get', owner, sql: 'PRAGMA page_size' })).page_size;
    const freePages = (await sql<{ freelist_count: number }>({ action: 'get', owner, sql: 'PRAGMA freelist_count' })).freelist_count;
    priorMax = (await sql<{ max_page_count: number }>({ action: 'get', owner, sql: 'PRAGMA max_page_count' })).max_page_count;
    // A quota still permits reusing free pages left by earlier compaction. The
    // blob must exceed those pages too, while remaining bounded for this gate.
    const attemptedBytes = pageSize * (freePages + 16);
    assert(Number.isSafeInteger(freePages) && freePages >= 0 && Number.isSafeInteger(attemptedBytes) && attemptedBytes > 0 && attemptedBytes <= 16 * 1024 * 1024,
      'Synthetic storage-full proof exceeds the hard 16 MiB bound');
    const quota = pageCount + 2;
    const applied = await sql<{ max_page_count: number }>({ action: 'get', owner, sql: `PRAGMA max_page_count=${quota}` });
    assert(applied.max_page_count === quota && pageSize > 0 && pageSize <= 65536, 'Synthetic SQLite page quota was not applied');
    const transaction = await sql<number>({ action: 'begin', owner });
    const fullError = await rejected(() => sql({ action: 'run', owner, transaction, sql: 'INSERT INTO pi_fault_full VALUES (zeroblob(?))', params: [attemptedBytes] }), 'Native storage-full INSERT');
    assert(/full/i.test(fullError), 'Storage failure was not SQLite FULL');
    // SQLITE_FULL may automatically roll back inside SQLite. Preserve the
    // explicit rollback error instead of claiming a guaranteed same-owner retry.
    let rollbackError: string | null = null;
    try { await sql({ action: 'rollback', owner, transaction }); } catch (error) { rollbackError = describeError(error); }
    const lateCommitError = await rejected(() => sql({ action: 'commit', owner, transaction }), 'Storage-full late COMMIT');
    const failedOwner = owner;
    owner = await sql<number>({ action: 'open' }); // Explicit owner recovery.
    const staleOwnerError = await rejected(() => sql({ action: 'commit', owner: failedOwner, transaction }), 'Storage-full stale owner COMMIT');
    assert(/revoked/i.test(staleOwnerError), 'Failed storage owner was not revoked on explicit reopen');
    await sql({ action: 'get', owner, sql: `PRAGMA max_page_count=${priorMax}` });
    const rows = await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_fault_full' });
    assert(rows.count === 0, 'SQLite FULL was announced or retained as a durable effect');
    await sql({ action: 'run', owner, sql: 'INSERT INTO pi_fault_full VALUES (zeroblob(16))' });
    assert((await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_fault_full' })).count === 1, 'Explicit owner recovery could not commit bounded work');
    mark('native SQLITE_FULL refuses durability; explicit owner recovery', { quotaPages: quota, pageSize, freePages, attemptedBytes, error: fullError, rollbackError, lateCommitError, staleOwnerError, rejectedDurableRows: rows.count, recoveredRows: 1 });
  } finally {
    if (priorMax !== undefined) await sql({ action: 'get', owner, sql: `PRAGMA max_page_count=${priorMax}` });
    await sql({ action: 'exec', owner, sql: 'DROP TABLE IF EXISTS pi_fault_full;' });
    await sql({ action: 'close', owner });
  }

  owner = await sql<number>({ action: 'open' });
  try {
    await sql({ action: 'exec', owner, sql: 'CREATE TABLE IF NOT EXISTS pi_fault_lease(value TEXT); DELETE FROM pi_fault_lease;' });
    const transaction = await sql<number>({ action: 'begin', owner });
    await sql({ action: 'run', owner, transaction, sql: "INSERT INTO pi_fault_lease VALUES ('uncommitted expired lease')" });
    const leaseStartedAt = Date.now();
    // The 10-second lease watchdog polls each second. Give it a full poll plus
    // scheduling margin, and require actual owner revocation rather than an
    // operation opportunistically expiring a still-connected transaction.
    await sleep(12000);
    const leaseError = await rejected(() => sql({ action: 'commit', owner, transaction }), 'Expired native lease COMMIT');
    assert(/revoked/i.test(leaseError), 'Native lease watchdog did not revoke the expired owner');
    const expiredOwner = owner;
    owner = await sql<number>({ action: 'open' });
    const staleLeaseError = await rejected(() => sql({ action: 'commit', owner: expiredOwner, transaction }), 'Expired stale owner COMMIT after reopen');
    assert(/revoked/i.test(staleLeaseError), 'Explicit reopen allowed the expired owner to commit');
    assert((await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_fault_lease' })).count === 0, 'Expired owner retained uncommitted bytes');
    mark('native lease expiry revokes owner; reopen verifies rollback', { leaseStartedAt, rejectedAt: Date.now(), error: leaseError, staleLeaseError, durableRows: 0 });

    const disconnectedTransaction = await sql<number>({ action: 'begin', owner });
    await sql({ action: 'run', owner, transaction: disconnectedTransaction, sql: "INSERT INTO pi_fault_lease VALUES ('uncommitted disconnected owner')" });
    const disconnectedOwner = owner;
    owner = await sql<number>({ action: 'open' });
    const disconnectedError = await rejected(() => sql({ action: 'commit', owner: disconnectedOwner, transaction: disconnectedTransaction }), 'Disconnected stale owner COMMIT');
    assert(/revoked/i.test(disconnectedError), 'New webview owner did not revoke disconnected owner');
    assert((await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_fault_lease' })).count === 0, 'Disconnected owner leaked an uncommitted row');
    await sql({ action: 'run', owner, sql: "INSERT INTO pi_fault_lease VALUES ('fresh owner committed')" });
    assert((await sql<{ count: number }>({ action: 'get', owner, sql: 'SELECT count(*) AS count FROM pi_fault_lease' })).count === 1, 'Fresh owner could not commit after disconnect');
    mark('native disconnect revokes stale owner and rolls back', { error: disconnectedError, rejectedDurableRows: 0, freshOwnerRows: 1 });
    await sql({ action: 'exec', owner, sql: 'DROP TABLE pi_fault_lease;' });
  } finally { await sql({ action: 'close', owner }); }
  return { gate: 'native-real-sqlite-faults', status: 'passed', startedAt, finishedAt: Date.now(), receipts,
    limits: ['Storage facade observations only; no Pi staged-outcome or terminal persistence interruption is claimed.', 'SQLITE_FULL is a bounded SQLite page quota, not host disk exhaustion.', 'All chat owners are closed; subsequent chat work requires process relaunch.'] };
}
