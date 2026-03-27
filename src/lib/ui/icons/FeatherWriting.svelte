<script lang="ts">
  import { Feather } from 'lucide-svelte';
  let { class: className = '' }: { class?: string } = $props();
</script>

<Feather class="writing-pen {className}" />

<style>
  @keyframes writing {
    0% { transform: translate(0, 0) rotate(0deg); }
    15% { transform: translate(1px, -1px) rotate(4deg); }
    30% { transform: translate(2px, 0px) rotate(-2deg); }
    45% { transform: translate(3px, -1px) rotate(3deg); }
    60% { transform: translate(2px, 1px) rotate(-1deg); }
    75% { transform: translate(1px, -1px) rotate(2deg); }
    100% { transform: translate(0, 0) rotate(0deg); }
  }

  :global(.writing-pen) {
    /* Runs for 1.5s per cycle, 2 times total = 3 seconds of animation */
    animation: writing 1.5s ease-in-out 2 forwards;
    transform-origin: 5px 19px; /* roughly the tip of the feather */
  }
</style>
