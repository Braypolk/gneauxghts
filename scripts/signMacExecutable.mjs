import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const localConfig = new URL('../.gneauxghts-signing.local.json', import.meta.url);

/** Public certificate selector only; private keys stay in the OS store. */
export function developmentSigningIdentity(env = process.env) {
  if (env.APPLE_SIGNING_IDENTITY) return env.APPLE_SIGNING_IDENTITY;
  let config;
  try { config = JSON.parse(readFileSync(localConfig, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (typeof config.identity !== 'string' || !config.identity.trim()) {
    throw new Error('Local macOS signing configuration needs a certificate identity.');
  }
  return config.identity;
}

/** Let Tauri sign local app bundles with the same identity as development.
 * Explicit signing/exported certificates and notarized distribution builds keep
 * their own configuration; the local development certificate is not a release
 * distribution credential.
 */
export function macSigningEnvironment(args, env = process.env, {
  platform = process.platform,
  localIdentity = developmentSigningIdentity
} = {}) {
  if (platform !== 'darwin' || !['dev', 'build', 'bundle'].includes(args[0]) ||
      args.includes('--help') || args.includes('-h') || args.includes('--no-sign') ||
      env.APPLE_SIGNING_IDENTITY || env.APPLE_CERTIFICATE ||
      (args[0] !== 'dev' && env.GNEAUXGHTS_REQUIRE_NOTARIZATION === '1')) return env;
  const identity = localIdentity(env);
  return identity ? { ...env, APPLE_SIGNING_IDENTITY: identity } : env;
}

/** Cargo owns the dev process; the shell runner execs the signed app so Tauri's
 * rebuild/stop behavior remains intact. TOML arrays preserve paths with spaces.
 */
export function withMacDevelopmentSigning(args, identity, platform = process.platform) {
  if (platform !== 'darwin' || !identity || args[0] !== 'dev' || args.includes('--help') || args.includes('-h')) return args;
  if (args.includes('--runner') || args.includes('-r') || args.some(arg => arg.startsWith('--runner='))) {
    throw new Error('Certificate signing for tauri dev requires its default Cargo runner.');
  }
  const runner = ['/bin/sh', fileURLToPath(new URL('./runMacDevelopment.sh', import.meta.url)), process.execPath];
  const config = `target.'cfg(target_os = "macos")'.runner=${JSON.stringify(runner)}`;
  const separator = args.indexOf('--');
  if (separator < 0) return [...args, '--', '--config', config];
  return [...args.slice(0, separator + 1), '--config', config, ...args.slice(separator + 1)];
}

/** Sign before launching development builds or pinning an E2E artifact so they retain the same trusted
 * developer identity. Never weaken Keychain ACLs or substitute an ad-hoc signer.
 * Release app bundles continue to use Tauri's normal signing/notarization path.
 */
export function signMacExecutable(binary, {
  identity = developmentSigningIdentity(),
  identifier = 'com.braypolkinghorne.gneauxghts-e2e',
  platform = process.platform,
  run = spawnSync
} = {}) {
  if (platform !== 'darwin') return false;
  if (!identity) return false;
  if (identity.trim() === '-' || !identity.trim()) {
    throw new Error('APPLE_SIGNING_IDENTITY must name a certificate identity; ad-hoc signing cannot preserve Keychain trust across rebuilds.');
  }
  for (const args of [
    ['--force', '--sign', identity, '--identifier', identifier, binary],
    ['--verify', '--strict', binary]
  ]) {
    const result = run('codesign', args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Unable to sign the native executable with APPLE_SIGNING_IDENTITY.');
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [binary, identifier] = process.argv.slice(2);
  if (!binary || !identifier || !signMacExecutable(binary, { identifier })) {
    throw new Error('The macOS development runner needs a certificate identity and executable.');
  }
}
