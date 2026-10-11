// Opt-in paid native pass. The credential stays in process memory and is never
// sent over WebDriver, printed, or written into the evaluation artifact.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSpecs } from './nativeSuite.mjs';

assert.equal(process.platform, 'darwin', 'This saved-Keychain launcher is macOS only');
assert(process.env.GNEAUX_CONTEXT_SELECTION_NATIVE === '1', 'Explicit opt-in required');
assert(process.env.GNEAUX_LIVE_OUTPUT, 'An explicit artifact path is required');
const credential = spawnSync('security', ['find-generic-password', '-s',
  'com.braypolkinghorne.gneauxghts.credentials', '-a', 'provider.openai.api-key', '-w']);
assert.equal(credential.status, 0, 'Saved OpenAI credential unavailable (value suppressed)');
const key = credential.stdout.toString('utf8').trim();
assert(key, 'Saved OpenAI credential is empty');
process.env.OPENAI_API_KEY = key;
process.env.GNEAUX_LIVE_MODEL = 'gpt-6-luna';
process.env.GNEAUX_LIVE_ENDPOINT = 'https://api.openai.com/v1';
process.env.GNEAUXGHTS_CONTEXT_DIAGNOSTICS = '1';
process.env.GNEAUX_NATIVE_SEMANTIC_ASSETS ??= join(homedir(), 'Library/Application Support/com.braypolkinghorne.gneauxghts/semantic');
try {
  process.exitCode = await runNativeSpecs([resolve('e2e/specs/native/context-selection.spec.ts')]);
} finally {
  delete process.env.OPENAI_API_KEY;
}
