<script lang="ts">
  import { onMount } from 'svelte';
  let report = $state<unknown>('Native storage gate running…');
  onMount(() => {
    if (import.meta.env.VITE_PI_PROTOTYPE !== 'true') { report = 'Prototype disabled'; return; }
    void import('$lib/prototypes/pi/probe').then(async ({ nativeProbe }) => { report = await nativeProbe(); })
      .catch(error => { report = String(error); });
  });
</script>

<h1>Pi Durable native prototype — disposable data</h1>
<a href="/">Open the existing app and chat UI</a>
<pre>{typeof report === 'string' ? report : JSON.stringify(report, null, 2)}</pre>
