import { render } from 'svelte/server';
import { expect, it } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import PiContextUsage from './PiContextUsage.svelte';

it('shows used and remaining percentages and token counts accessibly', () => {
  const { body } = render(PiContextUsage, { props: { usage: { tokens: 135000, capacity: 475000 } } });
  expect(body).toContain('28% used (72% left)');
  expect(body).toContain('135K / 475K tokens used');
});

it('includes streaming output, clamps a full window and announces compaction', () => {
  const { body } = render(PiContextUsage, { props: { usage: { tokens: 98, capacity: 100 }, message: fauxAssistantMessage('A growing response'), compacting: true } });
  expect(body).toContain('100% used (0% left)');
  expect(body).toContain('Compacting conversation');
});

it('does not invent a percentage when capacity or usage is unavailable', () => {
  const unknown = render(PiContextUsage, { props: { usage: { tokens: 135000, capacity: 0 } } }).body;
  expect(unknown).toContain('135K tokens used · capacity unavailable');
  expect(unknown).not.toContain('% used');
  const fresh = render(PiContextUsage).body;
  expect(fresh).toContain('Usage will appear after you send a message');
  expect(fresh).not.toContain('% used');
});
