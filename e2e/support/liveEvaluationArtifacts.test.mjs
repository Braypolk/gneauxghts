import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEvaluationArtifact, requireLiveConfiguration, selectAssistant } from './liveEvaluationArtifacts.mjs';

test('live configuration has no model/endpoint/artifact fallback and rejects scale fixtures', () => {
  const config = { GNEAUX_LIVE_ENDPOINT: 'http://localhost:8080/v1', GNEAUX_LIVE_MODEL: 'fixture-model', GNEAUX_LIVE_OUTPUT: '/tmp/result.json' };
  for (const key of Object.keys(config)) assert.throws(() => requireLiveConfiguration({ ...config, [key]: '' }), /Explicit/);
  assert.throws(() => requireLiveConfiguration({ ...config, GNEAUXGHTS_RELEASE_SCALE_RUN: '1' }), /fresh disposable/);
  assert.equal(requireLiveConfiguration(config).model, 'fixture-model');
});

test('late old answers cannot satisfy a new request and receipt IDs select exact messages', () => {
  const messages = [{ id: 'user', role: 'user', status: 'complete' }, { id: 'old', role: 'assistant', status: 'complete' }, { id: 'new', role: 'assistant', status: 'streaming' }];
  assert.equal(selectAssistant(messages, { excludeIds: ['old'] }).id, 'new');
  assert.equal(selectAssistant(messages, { messageId: 'new' }).status, 'streaming');
  assert.equal(selectAssistant(messages, { messageId: 'missing' }), undefined);
});

test('artifacts preserve scenario evidence through failure and distinguish ungraded semantic results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-evaluation-artifact-'));
  try {
    const output = join(directory, 'nested', 'result.json');
    const artifact = createEvaluationArtifact({ output, endpoint: 'local', model: 'fixture' }, { now: () => new Date('2026-10-03T12:00:00Z'), timeZone: 'America/Denver' });
    artifact.write({ results: [{ question: 'fixture', answer: 'partial response', rubric: 'requires evidence' }] });
    artifact.startCase('timeout case');
    artifact.observeAnswer('conversation-a', { role: 'assistant', status: 'streaming', content: 'partial streamed result' });
    artifact.finishCase('timeout case', 'failed', new Error('Native agent timed out'));
    artifact.startCase('structural success');
    artifact.finishCase('structural success', 'passed');
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.results[0].answer, 'partial response');
    assert.equal(report.structuralExecution.requests[0].answer.content, 'partial streamed result');
    assert.deepEqual(report.structuralExecution.cases.map(row => row.status), ['failed', 'passed']);
    assert.match(report.structuralExecution.cases[0].error, /timed out/);
    assert.equal(report.semanticGrading.status, 'not_run');
    assert.equal(report.evaluationClock.startedAt, '2026-10-03T12:00:00.000Z');
    assert.equal(report.evaluationClock.timeZone, 'America/Denver');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
