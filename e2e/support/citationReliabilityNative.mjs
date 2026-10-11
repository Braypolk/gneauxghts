// Paid native reproduction in an owned disposable vault. Keychain secret stays
// in process memory/child environment, never WebDriver arguments or artifacts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { runNativeSpecs } from './nativeSuite.mjs';

const { values } = parseArgs({ options: { run: { type: 'boolean' }, settings: { type: 'string' }, output: { type: 'string' }, case: { type: 'string', multiple: true } } });
assert(values.run && values.settings && values.output, 'Explicit --run, --settings and fresh --output are required');
assert.equal(process.platform, 'darwin', 'Saved-Keychain native launcher requires macOS');
assert(!existsSync(values.output), 'Never overwrite a paid run');
const settings = JSON.parse(readFileSync(values.settings, 'utf8'));
assert.equal(settings.provider, 'openai');
assert(settings.model && ['low', 'medium', 'high'].includes(settings.reasoning_effort));
assert(['standard', 'flex'].includes(settings.service_tier));
const known = ['deadline-1', 'partial-selected', 'partial-unrestricted', 'deadline-2'];
const cases = values.case ?? known;
assert(cases.length && new Set(cases).size === cases.length && cases.every(id => known.includes(id)), 'Select only known, unique cases');
const credential = spawnSync('security', ['find-generic-password', '-s', 'com.braypolkinghorne.gneauxghts.credentials', '-a', 'provider.openai.api-key', '-w']);
assert(credential.status === 0 && credential.stdout.toString('utf8').trim(), 'Saved OpenAI credential unavailable (value and diagnostics suppressed)');
const environment = { ...process.env, OPENAI_API_KEY: credential.stdout.toString('utf8').trim(),
  GNEAUX_CITATION_NATIVE: '1', GNEAUX_CITATION_NATIVE_SETTINGS: JSON.stringify(settings),
  GNEAUX_CITATION_NATIVE_CASES: JSON.stringify(cases), GNEAUX_LIVE_OUTPUT: resolve(values.output),
  GNEAUX_LIVE_MODEL: settings.model, GNEAUX_LIVE_ENDPOINT: 'https://api.openai.com/v1',
  GNEAUXGHTS_CONTEXT_DIAGNOSTICS: '1' };
try { process.exitCode = await runNativeSpecs([resolve('e2e/specs/native/citation-reliability.spec.ts')], { env: environment }); }
finally { delete environment.OPENAI_API_KEY; }
