import { invoke } from '@tauri-apps/api/core';
import { Harness, defineDoc, createRegistry } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNativeSqlite } from './nativeSqlite';

const Probe = defineDoc({ kind: 'gneauxghts.prototype.probe', version: 1, scope: 'session',
  initial: () => ({ runs: 0, submission: 0 }) });
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

// Runs inside the real webview, including its real structuredClone implementation.
export async function nativeProbe() {
  const report: Record<string, unknown> = { pin: '1.3.0', userAgent: navigator.userAgent, checks: [] };
  const checks = report.checks as string[];
  const mark = async (name: string) => { checks.push(name); await invoke('pi_probe_report', { report }); };
  let harness: Harness | undefined;
  try {
    let db = await openNativeSqlite();
    await db.exec('CREATE TABLE IF NOT EXISTS prototype_facade (id INTEGER PRIMARY KEY, value TEXT)');
    await db.run('DELETE FROM prototype_facade');
    const expected = new Error('intentional rollback');
    try {
      await db.transaction(async tx => {
        await tx.run('INSERT INTO prototype_facade VALUES (?, ?)', 1, 'must rollback');
        throw expected;
      });
    } catch (error) { assert(error === expected, 'callback error lost or rollback failed'); }
    assert(!(await db.get('SELECT * FROM prototype_facade')), 'rollback leaked row');
    await mark('native callback rollback');
    let escaped: import('@earendil-works/pi-durable/storage/sqlite').SqliteExecutor | undefined;
    const order: string[] = [];
    const write = db.transaction(async tx => {
      escaped = tx;
      await tx.run('INSERT INTO prototype_facade VALUES (?, ?)', 1, 'committed');
      order.push('transaction');
    });
    const read = db.get<{value: string}>('SELECT value FROM prototype_facade').then(row => {
      assert(row?.value === 'committed', 'competing query saw uncommitted state'); order.push('read');
    });
    await Promise.all([write, read]);
    assert(order.join(',') === 'transaction,read', 'unrelated work did not queue');
    let staleRejected = false;
    try { await escaped!.run('DELETE FROM prototype_facade'); } catch { staleRejected = true; }
    assert(staleRejected, 'closed transaction handle accepted');
    await mark('serialized competing access and stale handle rejection');
    await db.close();

    const models = createModels();
    const faux = fauxProvider(); models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage('Synthetic Pi native reply.')]);
    db = await openNativeSqlite();
    harness = await Harness.open(await SqliteStorage.open(db), { models, registry: createRegistry() }, context);
    const previous = await harness.snapshot(Probe, context);
    if (previous?.submission) {
      const restored = await harness.submission(previous.submission as never, context);
      assert(restored && (await restored.wait(context)).status === 'done', 'process relaunch receipt missing');
      await mark('prior process submission receipt restored');
    }
    const root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
    const submission = await root.submit({ type: 'input', content: 'Synthetic native Pi turn.' }, context);
    const receipt = await submission.wait(context);
    assert(receipt.status === 'done', 'Pi turn did not complete');
    await harness.commit(async tx => {
      const state = await tx.doc(Probe); state.runs++; state.submission = submission.id;
    }, context);
    const entries = (await root.context(context)).entries;
    assert(entries.some(entry => entry.kind === 'pi.assistant'), 'committed assistant entry missing');
    report.entryKinds = entries.map(entry => entry.kind); report.submissionId = submission.id;
    await mark('Pi submission and committed assistant through native SQLite');
    await harness.close(context); harness = undefined;
    harness = await Harness.open(await SqliteStorage.open(await openNativeSqlite()), { models, registry: createRegistry() }, context);
    const restored = await harness.submission(submission.id, context);
    assert(restored && (await restored.wait(context)).status === 'done', 'reopen receipt missing');
    assert((await harness.snapshot(Probe, context))?.submission === submission.id, 'reopen document missing');
    await mark('Pi close/reopen document and receipt');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = String(error); report.stack = error instanceof Error ? error.stack : '';
  } finally {
    if (harness) await harness.close(context).catch(error => { report.closeError = String(error); });
    await invoke('pi_probe_report', { report });
  }
  return report;
}
