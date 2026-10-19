import { build } from 'esbuild';
import { copyFileSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Node distributions place their notices beside the executable, at the prefix
// root, or under share/doc. Custom installations can name their matching file.
export function nodeRuntimeLicense(runtime = process.execPath, configured = process.env.GNEAUXGHTS_NODE_LICENSE) {
  const bin = dirname(runtime), prefix = dirname(bin);
  const candidates = configured ? [resolve(configured)] : [
    join(bin, 'LICENSE'), join(bin, 'LICENSE.txt'), join(prefix, 'LICENSE'),
    join(prefix, 'share/doc/node/LICENSE'), join(prefix, 'share/doc/nodejs/LICENSE'),
    join(prefix, 'share/doc/nodejs/copyright')
  ];
  const license = candidates.find(candidate => statSync(candidate, { throwIfNoEntry: false })?.isFile());
  if (!license) throw new Error('The bundled Node runtime requires its license notices. Set GNEAUXGHTS_NODE_LICENSE to the matching Node distribution license file.');
  return license;
}

// Pi's public bundled OAuth registration also works in Node. Ship that runtime
// with the desktop app so installed users never need Node, Bun, or node_modules.
export async function buildChatgptAuth() {
  const license = nodeRuntimeLicense();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const destination = join(root, 'src-tauri/resources/chatgpt-auth');
  mkdirSync(destination, { recursive: true });
  await build({ entryPoints: [join(root, 'scripts/chatgptAuth.mjs')], outfile: join(destination, 'auth.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning',
    banner: { js: "import { createRequire as authCreateRequire } from 'node:module'; const require = authCreateRequire(import.meta.url);" } });
  const runtime = join(destination, process.platform === 'win32' ? 'node.exe' : 'node');
  copyFileSync(process.execPath, runtime);
  chmodSync(runtime, 0o755);
  copyFileSync(license, join(destination, 'NODE-LICENSE'));
  if (process.platform === 'darwin') {
    const signed = spawnSync('codesign', ['-s', '-', '-f', '--timestamp=none', runtime], { stdio: 'inherit' });
    if (signed.status !== 0) throw new Error('Unable to sign the bundled authentication runtime');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildChatgptAuth();
