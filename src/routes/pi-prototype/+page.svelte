<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  let report = $state<unknown>('Native storage gate running…');
  onMount(() => {
    if (import.meta.env.VITE_PI_PROTOTYPE !== 'true') { report = 'Prototype disabled'; return; }
    void invoke<{ fixture: boolean }>('pi_probe_config').then(async config => {
      if (!config.fixture) {
        report = 'Fixture diagnostics are unavailable in the evaluation app. Run pnpm pi:prototype gate with separate disposable data.';
        return;
      }
      const { nativeProbe } = await import('$lib/prototypes/pi/probe');
      report = await nativeProbe();
    }).catch(error => { report = String(error); });
  });
</script>

<h1>Pi Durable native prototype — disposable data</h1>
<a href="/">Open the existing app and chat UI</a>
<pre>{typeof report === 'string' ? report : JSON.stringify(report, null, 2)}</pre>
