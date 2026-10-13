import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { expectDockMotion } from '../../support/paneMotion';

describe('Related and retained dock layout', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.seedChatControls());
  });

  for (const width of [1440, 1624]) {
    for (const query of ['', 'Alpha']) {
      it(`moves ${query ? 'expanded' : 'idle'} search continuously when opening and closing Related at ${width}px`, async () => {
        await browser.setWindowSize(width, 1000);
        if (query) {
          await $('[data-testid="note-search-input"]').setValue(query);
          await browser.execute(() => (document.activeElement as HTMLElement)?.blur());
        }
        await waitForWorkspaceAnimationSettled();
        for (const label of ['Expand related notes', 'Collapse related notes']) {
          const frames = await browser.executeAsync((label: string, done: (frames: number[][]) => void) => {
            const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
            const row = dock.parentElement!;
            const read = () => {
              const body = dock.querySelector<HTMLElement>(':scope > .dock-body')!.getBoundingClientRect();
              const material = dock.querySelector<SVGElement>('.dock-material-body')!.getBoundingClientRect();
              return [body.left, body.right, material.left, material.right,
                row.firstElementChild!.getBoundingClientRect().width,
                row.lastElementChild!.getBoundingClientRect().width, performance.now()];
            };
            const frames = [read()], started = performance.now();
            document.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click();
            const sample = () => setTimeout(() => {
              frames.push(read());
              if (performance.now() - started < 950) requestAnimationFrame(sample);
              else done(frames);
            }, 0);
            requestAnimationFrame(sample);
          }, label);
          expectDockMotion(frames.map(([left, right, materialLeft, materialRight]) => ({
            left, right, materialLeft, materialRight,
          })), `Related ${label}`);
          await waitForWorkspaceAnimationSettled();
        }
      });
    }
  }

  it('keeps the chat dock evenly spaced between its actions with Related open', async () => {
    await $('button[aria-label="Expand related notes"]').click();
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
    await $('[data-notepad-command-bar] textarea').waitForEnabled();
    await waitForWorkspaceAnimationSettled();
    for (const mode of ['chat', 'search']) {
      if (mode === 'search') {
        await $('button[aria-label="Expand search"]').click();
        await waitForWorkspaceAnimationSettled();
      }
      const gaps = await browser.execute(() => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
        const chat = dock.dataset.inputDockMode === 'chat';
        const left = chat ? dock.querySelector('.dock-search-toggle')!.getBoundingClientRect().left : body.left;
        const right = chat ? body.right : dock.querySelector('.dock-chat-toggle')!.getBoundingClientRect().right;
        return { left: left - dock.previousElementSibling!.getBoundingClientRect().right,
          right: dock.nextElementSibling!.getBoundingClientRect().left - right };
      });
      expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(1);
    }
  });

  it('shows search when the active one of two chat panes becomes an editor', async () => {
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
    await $('[data-notepad-command-bar] textarea').waitForEnabled();
    await waitForWorkspaceAnimationSettled();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
      .dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with current location"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($$('[data-pane-kind="chat"]')).toBeElementsArrayOfSize(2);
    const active = $('[data-pane-kind="chat"]:last-child');
    const paneId = await active.getAttribute('data-pane-id');
    if (!paneId) throw new Error('Active chat has no pane ID');
    await active.$('button[aria-label="Open previous location"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($$('[data-pane-kind="chat"]')).toBeElementsArrayOfSize(1);
    await expect($('[data-pane-kind="editor"]')).toHaveAttribute('data-pane-id', paneId);
    await expect($('.workspace-input-dock')).toHaveAttribute('data-input-dock-mode', 'search');
    await expect($('button[aria-label="Expand chat input"]')).toBeDisplayed();
    await $('button[aria-label="Expand chat input"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($('[data-notepad-command-bar] textarea')).toBeFocused();
  });
});
