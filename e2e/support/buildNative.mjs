import { spawnSync } from 'node:child_process';

const e2eTauriConfig = {
  identifier: 'com.braypolkinghorne.gneauxghts-e2e',
  // Match the isolated IPv4 server in wdio.native.conf.ts. `localhost:1420`
  // can resolve to an unrelated development server listening on IPv6.
  build: { devUrl: 'http://127.0.0.1:1430' },
  app: {
    withGlobalTauri: true,
    security: {
      capabilities: [
        {
          identifier: 'e2e-main',
          description: 'Debug-only WebDriver capability for the isolated native E2E binary',
          windows: ['main'],
          permissions: [
            'core:default',
            'core:app:allow-set-app-theme',
            'core:window:allow-start-dragging',
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
  ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'e2e-wdio'],
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
