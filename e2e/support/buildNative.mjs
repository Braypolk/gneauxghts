import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const optimized = process.argv.includes('--release');
if (optimized) {
  const frontend = spawnSync('pnpm', ['build'], {
    env: { ...process.env, VITE_E2E_NATIVE: 'true' }, stdio: 'inherit'
  });
  if (frontend.status !== 0) process.exit(frontend.status ?? 1);
}

const e2eTauriConfig = {
  identifier: 'com.braypolkinghorne.gneauxghts-e2e',
  // Match the isolated IPv4 server in wdio.native.conf.ts. `localhost:1420`
  // can resolve to an unrelated development server listening on IPv6.
  build: { devUrl: 'http://127.0.0.1:1430' },
  app: {
    ...(optimized ? { windows: JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.windows.map(window => ({
      ...window, backgroundThrottling: 'disabled'
    })) } : {}),
    withGlobalTauri: true,
    security: {
      capabilities: [
        {
          identifier: 'e2e-main',
          description: 'Test-only WebDriver capability for the isolated native E2E binary',
          windows: ['main'],
          permissions: [
            'core:default',
            'core:app:allow-set-app-theme',
            'core:window:allow-start-dragging',
            'core:window:allow-show',
            'core:window:allow-set-focus',
            'dialog:default',
            'opener:default',
            'process:default',
            'wdio:default',
            'wdio-webdriver:default'
          ]
        }
      ]
    }
  }
};

const result = spawnSync(
  'cargo',
  ['build', ...(optimized ? ['--release'] : []), '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'e2e-wdio'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TAURI_CONFIG: JSON.stringify(e2eTauriConfig)
    },
    stdio: 'inherit'
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
