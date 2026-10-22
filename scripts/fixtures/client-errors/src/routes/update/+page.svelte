<script>
  import Fault from '../Fault.svelte';
  let armed = $state(false);
</script>

<button onclick={() => { armed = true; }}>Trigger child render failure</button>
<Fault {armed} />
