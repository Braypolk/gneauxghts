<script lang="ts">
  let { class: className = '' }: { class?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
>
  <!-- Mailbox body -->
  <path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H18c2.2 0 4 1.8 4 4v8Z" fill="currentColor" fill-opacity="0.15" />
  <path d="M6.5 5C9 5 11 7 11 9.5V17a2 2 0 0 1-2 2" />
  
  <!-- Mail slot with letter inside -->
  <line x1="6" x2="7" y1="10" y2="10" />
  <rect x="2" y="10" width="4" height="2" fill="currentColor" rx="0.5" />
  
  <!-- Flag up -->
  <path d="M16 10v-6" stroke="#ef4444" />
  <path d="M16 4h3v3h-3z" fill="#ef4444" stroke="#ef4444" />
</svg>
