// Single opt-in entry point. Never launches against the ordinary app/vault.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const mode = process.argv[2] ?? 'desktop';
if (!['desktop', 'build', 'ios', 'gate', 'ios-gate','ui-gate','ios-ui-gate','fault-gate'].includes(mode)) throw new Error('Use desktop, build, gate, ios, ios-gate, ui-gate ios-ui-gate or fault-gate');
if (mode.endsWith('gate')) {
  if(!mode.startsWith('ios')){
    const built=spawnSync('cargo',['build','--manifest-path','src-tauri/Cargo.toml','--features','pi-prototype,e2e-wdio'],{stdio:'inherit',env:{...process.env,TAURI_CONFIG:readFileSync('scripts/pi-prototype/tauri.prototype.conf.json','utf8')}});
    if(built.status!==0)process.exit(built.status ?? 1);
  }
  const result = spawnSync(process.execPath, [`scripts/pi-prototype/${mode.startsWith('ios') ? 'ios' : mode==='fault-gate' ? 'fault' : 'desktop'}-gate.mjs`], { stdio: 'inherit',
    env: {...process.env,...(mode.includes('ui')?{PI_PROTOTYPE_UI_GATE:'true'}:{})} });
  process.exit(result.status ?? 1);
}
const root = process.env.PI_PROTOTYPE_DATA ?? mkdtempSync(join(tmpdir(), 'gneauxghts-pi-native-'));
mkdirSync(root, { recursive: true });
const config = resolve('scripts/pi-prototype/tauri.prototype.conf.json');
const env = { ...process.env, VITE_PI_PROTOTYPE: 'true' };
console.log(`Disposable prototype data: ${root}`);
writeFileSync(join(root, 'run.json'), JSON.stringify({ root, mode, date: new Date().toISOString() }));
if (mode === 'ios') {
  // cargo-mobile2 requires a runtime >= the newest SDK. Xcode itself supports
  // the installed older simulator. Keep its normal compiler/linker/signing,
  // replacing only the generated project's redundant Rust script with a build
  // performed here using the exact same feature and embedded Tauri config.
  const run = (command, args, extra = {}) => {
    const result = spawnSync(command, args, { env: { ...env, ...extra }, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
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
  run('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--target', 'aarch64-apple-ios-sim', '--lib', '--features', 'pi-prototype,tauri/custom-protocol'],
    { TAURI_CONFIG: readFileSync(config, 'utf8') });
  mkdirSync(join(apple, 'Externals/arm64/debug'), { recursive: true });
  copyFileSync('src-tauri/target/aarch64-apple-ios-sim/debug/libgneauxghts_lib.a', join(apple, 'Externals/arm64/debug/libapp.a'));
  run('xcodebuild', ['-project', generated, '-scheme', 'gneauxghts_iOS', '-configuration', 'debug',
    '-sdk', 'iphonesimulator', '-destination', `id=${env.PI_PROTOTYPE_SIMULATOR ?? 'FBAC4D90-9149-4B49-B40D-EA5B90B7069C'}`,
    '-derivedDataPath', join(root, 'xcode'), 'PRODUCT_BUNDLE_IDENTIFIER=com.braypolkinghorne.gneauxghts.pi-prototype',
    'PRODUCT_NAME=Gneauxghts Pi Prototype', 'build']);
  console.log(`Simulator app: ${join(root, 'xcode/Build/Products/debug-iphonesimulator/Gneauxghts Pi Prototype.app')}`);
  process.exit(0);
}
const args = mode === 'ios'
  ? ['tauri', 'ios', 'build', '--debug', '--target', 'aarch64-sim', '--ci', '--features', 'pi-prototype', '--config', config]
  : ['tauri', mode === 'build' ? 'build' : 'dev', ...(mode === 'build' ? ['--debug', '--no-bundle'] : []),
    '--features', 'pi-prototype,e2e-wdio', '--config', config,
    ...(mode === 'desktop' ? ['--', '--', '--e2e-app-data-root', root, '--e2e-documents-root', root] : [])];
const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
