import { homedir, platform } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

export function evaluationRoot(env = process.env, system = platform(), home = homedir()) {
  if (env.PI_PROTOTYPE_DATA) {
    if (!isAbsolute(env.PI_PROTOTYPE_DATA)) throw new Error('PI_PROTOTYPE_DATA must be an absolute disposable path');
    return resolve(env.PI_PROTOTYPE_DATA);
  }
  const identity = 'com.braypolkinghorne.gneauxghts.pi-prototype';
  if (system === 'darwin') return join(home, 'Library/Application Support', identity);
  if (system === 'win32') throw new Error('Windows evaluation setup is not verified; use the documented macOS entry');
  return join(env.XDG_DATA_HOME ?? join(home, '.local/share'), identity);
}

export function dataOperation(action, root, options = {}) {
  const args = ['-B', 'scripts/pi-prototype/evaluation_data.py', action, '--root', root];
  if (options.source) args.push('--source', options.source);
  if (options.recoverStoppedSource) args.push('--recover-stopped-source');
  if (options.observations) args.push('--observations', options.observations);
  if (options.adoptRecovered) args.push('--adopt-recovered', options.adoptRecovered);
  if (options.command) args.push('--', ...options.command);
  const result = spawnSync('python3', args, { stdio: 'inherit', env: options.env ?? process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Evaluation ${action} failed (exit ${result.status ?? 'signal'})`);
}
