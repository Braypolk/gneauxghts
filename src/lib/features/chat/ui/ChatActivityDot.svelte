<script lang="ts">
  import { activityDescription, type ChatActivityStatus } from '../pi/activity';
  let { status, inline = false }: { status: ChatActivityStatus; inline?: boolean } = $props();
</script>

{#if status}
  <span class="chat-activity-dot" class:chat-activity-dot--inline={inline} data-chat-activity={status}
    role="img" aria-label={activityDescription(status)} title={activityDescription(status)}></span>
{/if}

<style>
  .chat-activity-dot { position: absolute; top: 2px; right: 2px; width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 2px var(--card); pointer-events: none; }
  .chat-activity-dot[data-chat-activity="running"] { background: var(--muted-foreground); animation: chat-activity-pulse 3s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
  .chat-activity-dot--inline { position: relative; top: auto; right: auto; flex-shrink: 0; margin-inline: .4rem; box-shadow: none; }
  @keyframes chat-activity-pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .chat-activity-dot[data-chat-activity="running"] { animation: none; } }
</style>
