import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function requireLiveConfiguration(environment = process.env) {
  const endpoint = environment.GNEAUX_LIVE_ENDPOINT;
  const model = environment.GNEAUX_LIVE_MODEL;
  const output = environment.GNEAUX_LIVE_OUTPUT;
  assert(endpoint?.trim() && model?.trim() && output?.trim(),
    'Explicit local endpoint, model, and artifact path are required');
  assert(!environment.GNEAUXGHTS_RELEASE_SCALE_RUN, 'Live evaluation requires a fresh disposable native fixture');
  return { endpoint, model, output };
}

/** @param {Array<{ id?: string, role: string, status: string }>} messages
 * @param {{ messageId?: string, excludeIds?: string[] }} options */
export function selectAssistant(messages, { messageId, excludeIds = [] } = {}) {
  return messages.find(message => message.role === 'assistant'
    && (!messageId || message.id === messageId) && !excludeIds.includes(message.id));
}

// Production persists provider/runtime failures as `error`. Retain the older
// `failed` spelling for historical harness fixtures as well.
export function isTerminalAssistant(answer) {
  return Boolean(answer && ['complete', 'error', 'failed', 'cancelled'].includes(answer.status));
}

// Execution success means the assertions in the native spec passed. It never
// silently promotes retrieved/cited coverage into a semantic answer grade.
export function createEvaluationArtifact(config, { now = () => new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const startedAt = now().toISOString();
  const cases = [];
  const requests = new Map();
  let payload = {};
  function write(data) {
    if (data) payload = data;
    assert(config.output, 'An explicit artifact path is required');
    mkdirSync(dirname(resolve(config.output)), { recursive: true });
    writeFileSync(config.output, JSON.stringify({
      ...payload,
      endpoint: config.endpoint, model: config.model,
      evaluationClock: { startedAt, recordedAt: now().toISOString(), timeZone, mode: 'real-native-clock' },
      structuralExecution: { cases, requests: [...requests.values()] },
      semanticGrading: { status: 'not_run', instruction: 'Grade the recorded answers against each scenario rubric separately; structural execution and citation coverage are not factual correctness scores.' }
    }, null, 2));
  }
  return {
    write,
    observeAnswer(conversationId, answer) {
      requests.set(conversationId, { conversationId, observedAt: now().toISOString(), answer });
    },
    startCase(title) {
      cases.push({ title, status: 'running', startedAt: now().toISOString() });
      write();
    },
    finishCase(title, state, error) {
      const current = [...cases].reverse().find(test => test.title === title && test.status === 'running');
      const result = current ?? { title, startedAt: now().toISOString() };
      Object.assign(result, { status: state === 'passed' ? 'passed' : state === 'pending' ? 'skipped' : 'failed', finishedAt: now().toISOString(), ...(error ? { error: String(error.message ?? error) } : {}) });
      if (!current) cases.push(result);
      write();
    }
  };
}
