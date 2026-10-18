import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Harness, createRegistry, defineDoc, defineExtension, defineTool,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, Type } from '@earendil-works/pi-ai';
import {
  fauxProvider, fauxAssistantMessage, fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import {
  BACKGROUND_CONTEXT as context, awaitWithContext,
} from '@earendil-works/chord/context';

const directory = await mkdtemp(join(tmpdir(), 'gneauxghts-pi-approval-'));
const databasePath = join(directory, 'approval.sqlite');
const Review = defineDoc({
  kind: 'research.review', version: 1, scope: 'task',
  initial: () => ({ status: 'pending', body: 'original proposed text' }),
});
const firstPending = Promise.withResolvers();
let pendingTask;
let executions = 0;
let acceptedBody;
let harness;

const tool = defineTool({
  name: 'review_note', description: 'Review note',
  parameters: Type.Object({}), replay: 'safe',
  execute: async (_arguments, api, callContext) => {
    pendingTask = api.taskId;
    await api.commit(async transaction => {
      await transaction.doc(Review, api.taskId);
    }, callContext);
    const watch = await api.watchDoc(Review, api.taskId, callContext);
    const gate = Promise.withResolvers();
    const choose = value => {
      if (value?.status === 'approved') gate.resolve(value);
      if (value?.status === 'rejected') gate.reject(new Error('Rejected'));
    };
    watch.start(async value => choose(value));
    choose(watch.value);
    firstPending.resolve();
    let decision;
    try {
      decision = await awaitWithContext(gate.promise, callContext);
    } finally {
      await watch.stop();
    }
    // This counter stands in for a native effect. It is not crash-safe idempotency.
    executions++;
    acceptedBody = decision.body;
    return { output: [{ type: 'text', text: 'Saved approved note' }] };
  },
});
const registry = createRegistry();
registry.install(defineExtension({ name: 'review', tools: [tool] }));
function setup() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}
try {
  let provider = setup();
  provider.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('review_note', {}), { stopReason: 'toolUse' }),
  ]);
  harness = await Harness.open(await openNodeSqliteStorage(databasePath), {
    models: provider.models, registry,
  }, context);
  const root = await harness.root(context, {
    agent: { model: { provider: 'faux', modelId: 'faux-1' } },
  });
  const submission = await root.submit({
    type: 'input', content: 'Please edit this note',
  }, context);
  await firstPending.promise;
  const submissionId = submission.id;
  console.log('before-close', await harness.snapshot(Review, pendingTask, context), { executions });
  assert.equal(executions, 0);
  await harness.close(context);

  provider = setup();
  provider.faux.setResponses([fauxAssistantMessage('Saved.')]);
  harness = await Harness.open(await openNodeSqliteStorage(databasePath), {
    models: provider.models, registry,
  }, context);
  const restored = await harness.snapshot(Review, pendingTask, context);
  console.log('after-reopen', restored, { executions });
  assert.equal(restored.status, 'pending');
  assert.equal(restored.body, 'original proposed text');
  await harness.commit(async transaction => {
    const review = await transaction.doc(Review, pendingTask);
    review.body = 'edited by human';
    review.status = 'approved';
  }, context);
  const result = await (await harness.submission(submissionId, context)).wait(context);
  assert.equal(result.status, 'done');
  assert.equal(executions, 1);
  assert.equal(acceptedBody, 'edited by human');
  console.log('settled', result, { executions, acceptedBody });
} finally {
  if (harness) await harness.close(context);
  await rm(directory, { recursive: true, force: true });
}
