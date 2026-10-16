// Opt-in persistent evaluation entry. Fixture diagnostics always use separate data.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, cpSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';
import { evaluationRoot, dataOperation } from './evaluation-data.mjs';
import { iosBuildFeatures } from './ios-build-features.mjs';

const mode = process.argv[2] ?? 'desktop';
if (process.env.PI_PROTOTYPE_IOS_CRASH_FIXTURES && mode !== 'ios') throw new Error('iOS crash fixture packaging is allowed only in explicit simulator builds');
const modes = ['desktop', 'installed', 'build', 'setup', 'status', 'reset', 'diagnostics', 'ios', 'gate', 'ios-gate', 'ui-gate', 'ios-ui-gate', 'fault-gate', 'interactive-gate', 'ios-interactive-gate', 'ios-live-gate'];
if (!modes.includes(mode)) throw new Error(`Use ${modes.join(', ')}`);
const sourceArgs = process.argv.slice(3);
if (mode === 'setup') {
  const options = {};
  for (let index = 0; index < sourceArgs.length; index++) {
    const option = sourceArgs[index];
    if (option === '--recover-stopped-source') {
      if (options.recoverStoppedSource) throw new Error('Duplicate recovery flag');
      options.recoverStoppedSource = true;
      continue;
    }
    const key = { '--source': 'source', '--observations': 'observations', '--adopt-recovered': 'adoptRecovered' }[option];
    const value = sourceArgs[++index];
    if (!key || options[key] || !value || !isAbsolute(value)) throw new Error('Setup paths must be explicit absolute paths; use --source, optional --recover-stopped-source --observations, or --adopt-recovered');
    options[key] = value;
  }
  if (options.adoptRecovered ? (options.source || options.recoverStoppedSource || options.observations)
      : (!options.source || Boolean(options.recoverStoppedSource) !== Boolean(options.observations))) {
    throw new Error('Use setup --source /vault [--recover-stopped-source --observations /original-observations.json], or setup --adopt-recovered /quarantine');
  }
  dataOperation('setup', evaluationRoot(), options);
  process.exit(0);
}
if (sourceArgs.length) throw new Error('Unexpected arguments; only setup accepts --source');
if (mode === 'installed' && process.env.PI_PROTOTYPE_DATA) {
  throw new Error('The installed app uses its native default root; PI_PROTOTYPE_DATA is supported by desktop and setup, not installed');
}
if (['status', 'reset'].includes(mode)) {
  dataOperation(mode, evaluationRoot());
  process.exit(0);
}
const baseConfig = JSON.parse(readFileSync('scripts/pi-prototype/tauri.prototype.conf.json', 'utf8'));
const diagnostic = mode.endsWith('gate') || mode === 'diagnostics' || (mode === 'ios' && process.env.PI_PROTOTYPE_DIAGNOSTICS === 'true');
const nativeConfig = diagnostic && !['interactive-gate', 'fault-gate'].includes(mode) ? { ...baseConfig, app: { ...baseConfig.app,
  windows: baseConfig.app.windows.map(window => ({ ...window, url: process.env.PI_PROTOTYPE_IOS_LIVE_GATE === 'true' ? '/?piIosLiveTest=1' : process.env.PI_PROTOTYPE_TRANSCRIPT_GATE === 'true' ? '/?piTranscriptTest=1' : process.env.PI_PROTOTYPE_EXPANDED_GATE === 'true' ? '/?piExpandedTest=1' : 'pi-prototype', title: 'Pi fixture diagnostics — disposable synthetic data' })) } } : baseConfig;
if (mode.endsWith('gate')) {
  if (mode === 'interactive-gate' && process.env.PI_PROTOTYPE_DATA) throw new Error('Interactive gate always allocates a fresh generated root; unset PI_PROTOTYPE_DATA');
  // A gate may not seed/kill/reset a private evaluation root. Explicit test roots
  // must be empty; otherwise the gate scripts allocate their own temporary root.
  if (process.env.PI_PROTOTYPE_DATA && existsSync(process.env.PI_PROTOTYPE_DATA)
      && readdirSync(process.env.PI_PROTOTYPE_DATA).length) throw new Error('Fixture gates require an empty disposable root');
  if (!mode.startsWith('ios')) {
    const built = spawnSync('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'pi-prototype,e2e-wdio'],
      { stdio: 'inherit', env: { ...process.env, TAURI_CONFIG: JSON.stringify(nativeConfig) } });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
  const gateEnv = { ...process.env };
  delete gateEnv.GNEAUXGHTS_E2E_FOREGROUND;
  const gateName = mode === 'ios-live-gate' ? 'ios-live' : mode === 'ios-interactive-gate' ? 'ios-interactive' : mode.startsWith('ios') ? 'ios' : mode === 'fault-gate' ? 'fault' : mode === 'interactive-gate' ? 'desktop-interactive' : 'desktop';
  const result = spawnSync(process.execPath, [`scripts/pi-prototype/${gateName}-gate.mjs`], {
    stdio: 'inherit', env: { ...gateEnv, PI_PROTOTYPE_DIAGNOSTICS: 'true', ...(mode.includes('ui') ? { PI_PROTOTYPE_UI_GATE: 'true' } : {}) }
  });
  process.exit(result.status ?? 1);
}
if (!diagnostic && (process.env.PI_PROTOTYPE_HTTP_FIXTURE || process.env.PI_PROTOTYPE_UI_GATE || process.env.PI_PROTOTYPE_INTERACTIVE_GATE || process.env.PI_PROTOTYPE_EXPANDED_GATE || process.env.PI_PROTOTYPE_FOLLOWONS_GATE || process.env.PI_PROTOTYPE_TRANSCRIPT_GATE || process.env.PI_PROTOTYPE_IOS_LIVE_GATE || process.env.PI_PROTOTYPE_FAULT || process.env.PI_PROTOTYPE_DIAGNOSTICS)) {
  throw new Error('Fixture/fault environment is forbidden for manual evaluation; use a separate gate');
}
const root = mode === 'ios' || mode === 'diagnostics'
  ? (mode === 'ios' && process.env.PI_PROTOTYPE_DATA ? resolve(process.env.PI_PROTOTYPE_DATA) : realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-pi-native-'))))
  : evaluationRoot();
const configDirectory = mkdtempSync(join(tmpdir(), 'gneauxghts-pi-config-'));
const config = join(configDirectory, 'tauri.prototype.conf.json');
writeFileSync(config, JSON.stringify(nativeConfig));
process.on('exit', () => rmSync(configDirectory, { recursive: true, force: true }));
const env = { ...process.env, VITE_PI_PROTOTYPE: 'true',
  ...(mode === 'desktop' ? { GNEAUXGHTS_E2E_FOREGROUND: '1' } : {}) };
// Automation stays background even when the parent shell selected foreground.
if (diagnostic) delete env.GNEAUXGHTS_E2E_FOREGROUND;
console.log(`Pi evaluation data root: ${root}`);
if (['desktop', 'installed', 'diagnostics'].includes(mode)) {
  if (!existsSync(root) || readdirSync(root).length === 0) dataOperation('init', root);
  else dataOperation('status', root);
}
if (mode === 'installed') {
  const executable = resolve('src-tauri/target/debug/bundle/macos/Gneauxghts Pi Evaluation.app/Contents/MacOS/gneauxghts');
  if (!existsSync(executable)) throw new Error('Build the isolated .app first: pnpm pi:prototype build');
  dataOperation('launch', root, { command: [executable], env });
  process.exit(0);
}
if (mode === 'ios') {
  // cargo-mobile2 requires a runtime >= the newest SDK. Xcode itself supports
  // the installed older simulator. Keep its normal compiler/linker/signing,
  // replacing only the generated project's redundant Rust script with a build
  // performed here using the exact same feature and embedded Tauri config.
  const run = (command, args, extra = {}) => {
    const result = spawnSync(command, args, { env: { ...env, ...extra }, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  mkdirSync(root, { recursive: true });
  run('python3', ['-B', 'scripts/ios_litert_runtime.py',
    ...(env.GNEAUXGHTS_IOS_LITERT_ARCHIVE ? ['--archive', env.GNEAUXGHTS_IOS_LITERT_ARCHIVE] : [])]);
  run('pnpm', ['build']);
  const apple = resolve('src-tauri/gen/apple');
  const generated = join(apple, 'pi-prototype.xcodeproj');
  rmSync(generated, { recursive: true, force: true });
  cpSync(join(apple, 'gneauxghts.xcodeproj'), generated, { recursive: true });
  const project = join(generated, 'project.pbxproj');
  const scheme = join(generated, 'xcshareddata/xcschemes/gneauxghts_iOS.xcscheme');
  writeFileSync(scheme, readFileSync(scheme, 'utf8').replaceAll('container:gneauxghts.xcodeproj', 'container:pi-prototype.xcodeproj'));
  writeFileSync(project, readFileSync(project, 'utf8').replace(/shellScript = "pnpm tauri ios xcode-script[^\n]+;/,
    'shellScript = "echo Pi Rust library built by scripts/pi-prototype/run.mjs";'));
  run('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--target', 'aarch64-apple-ios-sim', '--lib', '--features', iosBuildFeatures(env)],
    { TAURI_CONFIG: readFileSync(config, 'utf8') });
  mkdirSync(join(apple, 'Externals/arm64/debug'), { recursive: true });
  copyFileSync('src-tauri/target/aarch64-apple-ios-sim/debug/libgneauxghts_lib.a', join(apple, 'Externals/arm64/debug/libapp.a'));
  run('xcodebuild', ['-project', generated, '-scheme', 'gneauxghts_iOS', '-configuration', 'debug',
    '-sdk', 'iphonesimulator', '-destination', `id=${env.PI_PROTOTYPE_SIMULATOR ?? 'FBAC4D90-9149-4B49-B40D-EA5B90B7069C'}`,
    '-derivedDataPath', join(root, 'xcode'), 'PRODUCT_BUNDLE_IDENTIFIER=com.braypolkinghorne.gneauxghts.pi-prototype',
    `PRODUCT_NAME=${diagnostic ? 'Gneauxghts Pi Prototype' : 'Gneauxghts Pi Evaluation'}`, 'build']);
  console.log(`Simulator app: ${join(root, `xcode/Build/Products/debug-iphonesimulator/${diagnostic ? 'Gneauxghts Pi Prototype' : 'Gneauxghts Pi Evaluation'}.app`)}`);
  process.exit(0);
}
const args = ['tauri', mode === 'build' ? 'build' : 'dev',
  ...(mode === 'build' ? ['--debug', '--bundles', 'app'] : []),
  '--features', mode === 'build' ? 'pi-prototype' : 'pi-prototype,e2e-wdio', '--config', config,
  ...(mode === 'desktop' || mode === 'diagnostics' ? ['--', '--', '--e2e-app-data-root', root, '--e2e-documents-root', root] : [])];
if (mode === 'desktop' || mode === 'diagnostics') {
  dataOperation('launch', root, { command: ['pnpm', ...args], env });
} else {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
