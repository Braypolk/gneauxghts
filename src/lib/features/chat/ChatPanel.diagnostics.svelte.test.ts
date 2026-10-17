import { render } from 'svelte/server';
import { expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { PI_CONTEXT } from './pi/runtime';
import { piViewFixture } from './ui/piViewTestSupport';
import { viewLive } from './ui/piConversationView';
import ChatPanel from './ChatPanel.svelte';

const control = (body: string, selector: string) => body.match(new RegExp(`<[^>]*${selector}[^>]*>`, 'u'))?.[0];

it('keeps report-only admission available and disables it after actual runtime failure while retaining history', async () => {
  const fixture = await piViewFixture();
  try {
    await fixture.binding.initialize();
    fixture.faux.setResponses([fauxAssistantMessage('Retained response', { stopReason: 'error', errorMessage: 'Model unavailable' })]);
    await (await fixture.binding.send('Retained question'))!.wait(PI_CONTEXT);
    await vi.waitFor(() => expect(viewLive(fixture.binding.getSnapshot().view).run).toBeUndefined());
    fixture.runtime.diagnostics.report(new Error('SECRET_NOTE_CREDENTIAL_ENDPOINT_PATH'));
    const renderPanel = () => render(ChatPanel, { props: { binding: fixture.binding, autoInitialize: false } }).body;
    const reported = renderPanel();
    for (const selector of ['aria-label="AI model"', 'aria-label="Vault access"', 'aria-label="Conversation title"', 'data-testid="pi-new-attempt"']) {
      expect(control(reported, selector)).toBeDefined(); expect(control(reported, selector)).not.toContain('disabled');
    }
    expect(reported).toContain('data-diagnostic-code="runtime_report"');
    fixture.runtime.diagnostics.end({ reason: 'failed', error: new Error('SECRET_NOTE_CREDENTIAL_ENDPOINT_PATH') });
    const failed = renderPanel();
    for (const selector of ['aria-label="AI model"', 'aria-label="Vault access"', 'aria-label="Conversation title"', 'data-testid="pi-new-attempt"', 'data-testid="pi-send"']) {
      expect(control(failed, selector)).toContain('disabled');
    }
    expect(control(failed, 'aria-label="Message"')).toContain('disabled');
    expect(control(failed, 'aria-label="Conversations"')).not.toContain('disabled');
    expect(failed).toContain('Retained response'); expect(failed).toContain('Retained question');
    expect(failed).toContain('Restart the app to reconnect'); expect(failed).not.toContain('SECRET_NOTE_CREDENTIAL_ENDPOINT_PATH');
    expect(fixture.faux.state.callCount).toBe(1);
  } finally { await fixture.close(); }
});

it('keeps arbitrary task fault details out of the conversation presentation', async () => {
  const fixture = await piViewFixture();
  try {
    await fixture.binding.initialize();
    vi.spyOn(fixture.runtime.models, 'getModel').mockImplementationOnce(() => {
      throw new Error('SECRET_NOTE_CREDENTIAL_ENDPOINT_PATH');
    });
    const submission = (await fixture.binding.send('Keep this question'))!;
    expect((await submission.wait(PI_CONTEXT)).status).toBe('unanswered');
    await vi.waitFor(() => expect(fixture.binding.getSnapshot().latestInput?.status).toBe('unanswered'));
    const body = render(ChatPanel, { props: { binding: fixture.binding, autoInitialize: false } }).body;
    expect(body).not.toContain('SECRET_NOTE_CREDENTIAL_ENDPOINT_PATH');
    expect(body).toContain('The response could not complete');
    expect(body).toContain('data-testid="pi-new-attempt"');
    expect(body).toContain('Keep this question');
  } finally { await fixture.close(); }
});
