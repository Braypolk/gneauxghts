import type { LiveState } from '@earendil-works/pi-durable';

/** Describe only progress Pi has actually observed; waiting is not evidence of tokens. */
export function generationProgress(live: LiveState): string | undefined {
  const generation = live.generation;
  if (!generation) return;
  if (generation.retry) return 'Waiting to retry model request';
  if (generation.deferred) return 'Waiting for model response';
  const last = generation.message?.content.findLast(block => block.type === 'toolCall'
    || block.type === 'thinking' && Boolean(block.thinking)
    || block.type === 'text' && Boolean(block.text));
  if (last?.type === 'thinking') return 'Thinking';
  if (last?.type === 'text') return 'Writing response';
  if (last?.type === 'toolCall') return 'Preparing tool calls';
  return 'Waiting for model';
}

/** Only show a separate status when no tool, reasoning, or answer conveys progress. */
export function fallbackProgress(live: LiveState, stopping: boolean): string | undefined {
  if (!live.run && !live.compactions?.length) return;
  if (stopping) return 'Stopping';
  if ([...(live.tools ?? []), ...(live.nestedTools ?? [])].some(tool => tool.status !== 'done')) return;
  const generation = generationProgress(live);
  if (generation?.startsWith('Waiting')) return generation;
  if (generation || live.compactions?.length) return;
  return 'Working';
}
