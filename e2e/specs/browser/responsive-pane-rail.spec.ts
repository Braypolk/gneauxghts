import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, openHistoryShortcut } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { dockMorphDuration } from '../../../src/lib/features/notepad/ui/workspaceDockMachine';

const editor = '[data-pane-kind="editor"] .cm-content';
const composer = '[data-notepad-command-bar] textarea';
async function viewport(width: number, height = 844) {
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  await waitForWorkspaceAnimationSettled();
}
async function openChat() {
  await browser.execute(() => {
    window.__GNEAUXGHTS_E2E__!.seedChatControls();
    document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
      .dispatchEvent(new PointerEvent('pointerenter'));
  });
  await $('button[aria-label="Split with thought partner"]').click();
  await $(composer).waitForEnabled();
  await waitForWorkspaceAnimationSettled();
}
async function expandRail() {
  await $('.pane-rail').click();
  await waitForWorkspaceAnimationSettled();
  await browser.waitUntil(async () => browser.execute(() => {
    const active = document.querySelector('[data-testid="workspace-pane"]:not([data-pane-collapsed])');
    return active?.getAttribute('data-pane-kind') === 'chat'
      ? document.activeElement?.matches('[data-notepad-command-bar] textarea')
      : !!document.activeElement?.closest('[data-pane-kind="editor"] .cm-editor');
  }), { timeoutMsg: 'Expanded pane did not receive focus' });
}
async function assertGeometry() {
  expect(await browser.execute(() => {
    const panes = [...document.querySelectorAll<HTMLElement>('[data-testid="workspace-pane"]')];
    const rail = document.querySelector<HTMLElement>('[data-pane-collapsed]')!;
    const expanded = panes.find(pane => pane !== rail)!;
    const a = rail.getBoundingClientRect(), b = expanded.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('[data-notepad-command-bar]')!.getBoundingClientRect();
    return { count: panes.length, rail: a.width, separate: a.right <= b.left + 1 || b.right <= a.left + 1,
      fits: Math.min(a.left, b.left) >= 0 && Math.max(a.right, b.right) <= innerWidth + 1,
      dockFits: dock.left >= 0 && dock.right <= innerWidth + 1,
      inert: rail.querySelector<HTMLElement>('[data-pane-frame]')!.inert };
  })).toEqual({ count: 2, rail: 48, separate: true, fits: true, dockFits: true, inert: true });
}

describe('persistent collapsed pane rail', () => {
  beforeEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await resetBrowserWorkspace();
  });
  afterEach(async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__?.releaseSave());
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
  });

  it('preserves editor, failed edits, undo and unsent chat while switching at phone and medium widths', async () => {
    await openChat();
    await $(composer).setValue('Keep this unsent thought');
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-pane-kind="editor"] .cm-editor')!.dataset.retained = 'original';
      document.querySelector<HTMLElement>('[data-notepad-command-bar] textarea')!.dataset.retained = 'original';
    });
    for (const width of [640, 390, 320]) {
      await viewport(width); await assertGeometry();
      await expect($('.pane-rail')).toHaveAttribute('aria-label', 'Expand Alpha note');
      await expandRail(); await assertGeometry();
      await expect($(editor)).toBeFocused();
      await expect($('.pane-rail')).toHaveAttribute('aria-label', 'Expand Thought partner');
      await expandRail(); await assertGeometry();
      await expect($(composer)).toBeFocused();
      await expect($(composer)).toHaveValue('Keep this unsent thought');
    }
    await expandRail();
    await expect($(editor)).toBeFocused();
    const original = await browser.execute(() => window.__GNEAUXGHTS_E2E__!.snapshot().notes.find(note => note.noteId === 'note-alpha')!.markdown);
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.holdSave(true));
    await $(editor).click();
    await browser.keys(['Meta', 'a', '\uE000']);
    await browser.keys('Retain this failed edit');
    await browser.waitUntil(async () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.some(entry => entry.command === 'save_note')));
    await expandRail();
    expect(await $('.pane-rail').getAttribute('aria-label')).toMatch(/Unsaved changes|Saving/);
    await expandRail();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.releaseSave());
    await $('[data-pane-kind="editor"] [role="alert"]').waitForDisplayed();
    await expandRail();
    expect(await $('.pane-rail').getAttribute('aria-label')).toContain('History is unavailable');
    await expandRail();
    await expect($(editor)).toHaveText('Retain this failed edit');
    await browser.keys(['Meta', 'z', '\uE000']);
    await browser.waitUntil(async () => browser.execute(expected =>
      (window as typeof window & { __GNEAUXGHTS_NATIVE_E2E__: {
        readEditorState(): { editor: { markdown: string } | null };
      } }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor?.markdown === expected, original));
    expect(await browser.execute(() => [
      document.querySelector<HTMLElement>('[data-pane-kind="editor"] .cm-editor')!.dataset.retained,
      document.querySelector<HTMLElement>('[data-notepad-command-bar] textarea')!.dataset.retained
    ])).toEqual(['original', 'original']);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(entry =>
      ['chat_create_conversation', 'chat_send_message', 'forget_note'].includes(entry.command)))).toHaveLength(0);
  });

  it('dismisses an inline date picker when keyboard switching with reduced motion', async () => {
    const date = await browser.execute(() => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).format(new Date(2026, 8, 24)));
    await $(editor).click();
    await browser.execute((element: HTMLElement, value: string) => {
      element.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, value);
    }, await $(editor), `Meeting ${date}\nTail`);
    await openChat(); await viewport(390); await expandRail();
    await $('button[aria-label^="Edit date:"]').click();
    await $('dialog.date-time-picker').waitForDisplayed();
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await browser.execute(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })));
    await waitForWorkspaceAnimationSettled();
    await $('dialog.date-time-picker').waitForExist({ reverse: true });
    await expect($(composer)).toBeFocused(); await assertGeometry();
  });

  it('uses the ordinary editor/chat dock edge and fades retained surfaces on its clock', async () => {
    await openChat(); await viewport(640);
    await $(composer).setValue('Retain through the editor transition');
    type MotionSample = { state: string; easing?: string; paneMoving: boolean;
      opacity: number; railOpacity: number; left: number; width: number; frameLefts: number[] };
    const sampleSwitch = async (): Promise<MotionSample[]> => {
      await browser.execute(() => {
        const shell = document.querySelector<HTMLElement>('.notepad-shell')!;
        delete shell.dataset.motionCapture;
        document.querySelector('.pane-rail')!.addEventListener('click', () => {
          const samples: unknown[] = [], until = performance.now() + 500;
          const sample = () => setTimeout(() => {
            const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
            const expanded = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed])')!;
            const bar = dock.querySelector<HTMLElement>(':scope > .dock-body')!.getBoundingClientRect();
            samples.push({ state: dock.dataset.dockState, easing: dock.dataset.dockEasing,
              paneMoving: !!document.querySelector('[data-pane-motion]'),
              opacity: Number(getComputedStyle(expanded.querySelector<HTMLElement>('[data-pane-content]')!).opacity),
              railOpacity: Number(getComputedStyle(document.querySelector('.pane-rail')!).opacity),
              left: bar.left, width: bar.width,
              frameLefts: [...document.querySelectorAll<HTMLElement>('[data-pane-frame]')].map(frame => frame.getBoundingClientRect().left) });
            if (performance.now() < until) requestAnimationFrame(sample);
            else shell.dataset.motionCapture = JSON.stringify(samples);
          }, 0);
          requestAnimationFrame(sample);
        }, { once: true });
      });
      await $('.pane-rail').click();
      await browser.waitUntil(async () => browser.execute(() => !!document.querySelector<HTMLElement>('.notepad-shell')?.dataset.motionCapture));
      return browser.execute(() => JSON.parse(document.querySelector<HTMLElement>('.notepad-shell')!.dataset.motionCapture!));
    };
    const expectRevealMotion = (samples: Array<{ left: number; width: number; frameLefts: number[] }>) => {
      for (const index of [0, 1]) {
        const lefts = samples.map(sample => sample.frameLefts[index]);
        expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(0.75);
      }
      for (const field of ['left', 'width'] as const) {
        const direction = Math.sign(samples.at(-1)![field] - samples[0][field]);
        for (let i = 1; i < samples.length; i++) {
          expect((samples[i][field] - samples[i - 1][field]) * direction).toBeGreaterThanOrEqual(-0.75);
        }
      }
    };
    const toEditor = await sampleSwitch();
    expectRevealMotion(toEditor);
    expect(toEditor.every(sample => sample.state === 'editor-search')).toBe(true);
    expect(toEditor.some(sample => sample.paneMoving && sample.easing === 'editor' &&
      sample.opacity > 0.05 && sample.opacity < 0.95 && sample.railOpacity === 1)).toBe(true);
    await waitForWorkspaceAnimationSettled();
    await expect($(editor)).toBeFocused();
    expect(await browser.execute(() => ({
      borders: document.querySelectorAll('[data-pane-border]').length,
      divider: getComputedStyle(document.querySelector('.pane-rail')!).borderLeftWidth,
      fade: getComputedStyle(document.querySelector('.pane-rail')!, '::before').maskImage
    }))).toEqual({ borders: 0, divider: '0px', fade: expect.stringContaining('linear-gradient') });
    const toChat = await sampleSwitch();
    expectRevealMotion(toChat);
    expect(toChat.every(sample => sample.state === 'chat-input')).toBe(true);
    expect(toChat.some(sample => sample.paneMoving && sample.easing === 'editor' && sample.opacity > 0.05 && sample.opacity < 0.95)).toBe(true);
    await waitForWorkspaceAnimationSettled();
    await expect($(composer)).toBeFocused();
    await expect($(composer)).toHaveValue('Retain through the editor transition');
    await browser.execute(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })));
    await waitForWorkspaceAnimationSettled();
    await expect($(editor)).toBeFocused();
  });

  it('continues a reply while collapsed and settles rapid rail reversals', async () => {
    await openChat(); await viewport(390);
    await browser.execute(() => {
      window.__GNEAUXGHTS_E2E_COMMANDS__!.chat_send_message = () => {
        const identity = { requestId: 'rail-request', conversationId: 'controls-chat', messageId: 'rail-answer' };
        window.__GNEAUXGHTS_E2E__!.emit('chat://started', identity);
        window.__GNEAUXGHTS_E2E__!.emit('chat://text-delta', { ...identity, delta: 'Still working' });
        return { requestId: identity.requestId, conversationId: identity.conversationId, userMessageId: 'rail-question', assistantMessageId: identity.messageId };
      };
    });
    await $(composer).setValue('Keep working across panes');
    await $('button[aria-label="Send message"]').click();
    await $('[data-chat-message-id="rail-answer"]').waitForDisplayed();
    await expandRail();
    expect(await $('.pane-rail').getAttribute('aria-label')).toContain('Reply in progress');
    await viewport(320);
    await browser.execute(() => {
      const identity = { requestId: 'rail-request', conversationId: 'controls-chat', messageId: 'rail-answer' };
      window.__GNEAUXGHTS_E2E__!.emit('chat://text-delta', { ...identity, delta: ' while collapsed' });
      window.__GNEAUXGHTS_E2E__!.emit('chat://completed', { ...identity, content: 'Finished while collapsed' });
    });
    await browser.waitUntil(async () => !(await $('.pane-rail').getAttribute('aria-label'))!.includes('Reply in progress'));
    await expandRail();
    await expect($('[data-chat-message-id="rail-answer"]')).toHaveText(expect.stringContaining('Finished while collapsed'));
    await browser.execute(async () => {
      for (let i = 0; i < 3; i++) {
        document.querySelector<HTMLButtonElement>('.pane-rail')!.click();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    });
    await waitForWorkspaceAnimationSettled(); await assertGeometry();
    expect(await browser.execute(() => document.querySelectorAll('[data-rail-label-snapshot]').length)).toBe(0);
    await expect($(editor)).toBeFocused();
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(entry => entry.command === 'chat_send_message'))).toHaveLength(1);
    expect(await browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(entry => entry.command === 'chat_cancel_request'))).toHaveLength(0);
  });

  it('settles the dock when resizing across the compact breakpoint with an editor active', async () => {
    await openChat();
    await $('[data-testid="note-title"]').click();
    for (const width of [640, 1024, 390]) {
      await browser.execute(() => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        dock.dataset.resizeSamples = '[]';
        const observer = new MutationObserver(() => {
          const samples = JSON.parse(dock.dataset.resizeSamples!);
          samples.push({ state: dock.dataset.dockState, moving: dock.hasAttribute('data-dock-motion') });
          dock.dataset.resizeSamples = JSON.stringify(samples);
        });
        observer.observe(dock, { attributes: true, attributeFilter: ['data-dock-state', 'data-dock-motion'] });
        setTimeout(() => observer.disconnect(), 1000);
      });
      await viewport(width);
      const samples = await browser.execute(() => JSON.parse(document.querySelector<HTMLElement>('.workspace-input-dock')!.dataset.resizeSamples!) as Array<{ state: string; moving: boolean }>);
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.every(sample => !sample.moving)).toBe(true);
      await expect($('.workspace-input-dock')).toHaveAttribute('data-dock-state', width < 720 ? 'editor-search' : 'chat-search');
    }
  });

  it('retains scroll, supports keyboard activation and returns from History to the expanded pane', async () => {
    await openChat(); await viewport(390); await expandRail();
    const scroller = await $('[data-pane-kind="editor"] .cm-scroller');
    await browser.execute((element: HTMLElement) => { element.scrollTop = 240; }, scroller);
    const scrollBefore = await browser.execute((element: HTMLElement) => element.scrollTop, scroller);
    await expandRail();
    await browser.execute(() => document.querySelector<HTMLButtonElement>('.pane-rail')!.focus());
    // Merely focusing the rail must not expand it.
    await expect($('.pane-rail')).toBeFocused();
    await expect($('[data-pane-kind="editor"]')).toHaveAttribute('data-pane-collapsed', 'true');
    await browser.keys('Enter'); await waitForWorkspaceAnimationSettled();
    await expect($(editor)).toBeFocused();
    expect(Math.abs(await browser.execute((element: HTMLElement) => element.scrollTop, scroller) - scrollBefore)).toBeLessThanOrEqual(2);
    await openHistoryShortcut(); await $('[data-testid="history-mode"]').waitForDisplayed();
    await $('button[aria-label="Back to workspace"]').click();
    await expect($(editor)).toBeFocused();
    await assertGeometry();
    await browser.execute(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })));
    await waitForWorkspaceAnimationSettled();
    await expect($(composer)).toBeFocused();
    await viewport(1024, 768);
    await expect($('.pane-rail')).not.toExist();
    await expect($(editor)).toBeDisplayed();
    await viewport(320); await viewport(1024, 768); await viewport(390);
    await assertGeometry();
  });

  it('keeps both rail sides reachable while Related is expanded', async () => {
    await openChat(); await viewport(390);
    await $('button[aria-label="Expand related notes"]').click();
    await $('#related-drawer-panel').waitForDisplayed();
    const sheetClearsRail = () => browser.execute(() => {
      const rail = document.querySelector('.pane-rail')!.getBoundingClientRect();
      const sheet = document.querySelector('#related-drawer-panel')!.getBoundingClientRect();
      return rail.right <= sheet.left + 1 || sheet.right <= rail.left + 1;
    });
    expect(await sheetClearsRail()).toBe(true);
    await expandRail();
    expect(await sheetClearsRail()).toBe(true);
    await expandRail();
    await assertGeometry();
  });

  it('retains each editor selection while the shared dock stays fixed between two note panes', async () => {
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with current location"]').click();
    await waitForWorkspaceAnimationSettled(); await viewport(390);
    type ProbeWindow = typeof window & { __GNEAUXGHTS_NATIVE_E2E__: {
      setEditorSelection(anchor: number, head: number): boolean;
      readEditorState(): { editor: { selection: { anchor: number; head: number } } | null };
    } };
    expect(await browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(2, 7))).toBe(true);
    const dockRect = () => browser.execute(() => {
      const r = document.querySelector('[data-notepad-command-bar]')!.getBoundingClientRect();
      return [r.left, r.width];
    });
    const before = await dockRect();
    await expandRail();
    await browser.waitUntil(async () => browser.execute(() => !!document.activeElement?.closest('[data-pane-kind="editor"]')));
    expect(await browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__.setEditorSelection(12, 16))).toBe(true);
    await expandRail();
    await browser.waitUntil(async () => browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor?.selection.anchor === 2));
    expect(await browser.execute(() => (window as ProbeWindow).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor?.selection)).toEqual({ anchor: 2, head: 7 });
    expect(await dockRect()).toEqual(before);
    await viewport(640, 390); await assertGeometry();
  });

  it('reveals stationary note text using the search/chat dock timing in both directions', async () => {
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with current location"]').click();
    await waitForWorkspaceAnimationSettled();
    for (const width of [390, 640]) {
      await viewport(width);
      for (let direction = 0; direction < 2; direction++) {
        const samples = await browser.execute(async () => {
          const read = () => [...document.querySelectorAll<HTMLElement>('[data-pane-frame]')].map(frame => ({
            left: frame.getBoundingClientRect().left,
            textLeft: frame.querySelector('.cm-line')!.getBoundingClientRect().left,
            width: frame.getBoundingClientRect().width,
            opacity: Number(getComputedStyle(frame.querySelector('[data-pane-content]')!).opacity),
            duration: frame.closest('.notepad-pane')!.getAnimations()[0]?.effect?.getTiming().duration
          }));
          const frames = [read()];
          const rail = document.querySelector<HTMLButtonElement>('.pane-rail')!;
          rail.focus(); rail.click();
          const until = performance.now() + 500;
          while (performance.now() < until) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            frames.push(read());
          }
          return frames;
        });
        for (const index of [0, 1]) {
          for (const field of ['left', 'textLeft', 'width'] as const) {
            const values = samples.map(sample => sample[index][field]);
            expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(0.75);
          }
        }
        expect(samples.some(sample => sample.some(pane => pane.duration === dockMorphDuration))).toBe(true);
        expect(samples.flat().filter(pane => typeof pane.duration === 'number').every(pane => pane.opacity >= 0.849 && pane.opacity <= 1)).toBe(true);
        await waitForWorkspaceAnimationSettled();
        await expect($('[data-pane-compact]:not([data-pane-collapsed]) .cm-content')).toBeFocused();
      }
    }
  });

  it('follows the actual search/chat curve when switching between two retained chats', async () => {
    await openChat();
    await $('[data-pane-kind="editor"] button[aria-label="Open thought partner"]').click();
    await waitForWorkspaceAnimationSettled(); await viewport(640);
    await $('button[aria-label="Expand search"]').click();
    await waitForWorkspaceAnimationSettled();
    const samples = await browser.executeAsync((done: (samples: number[][]) => void) => {
      const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
      const rowWidth = document.querySelector<HTMLElement>('[data-compact-panes]')!.clientWidth;
      const rail = document.querySelector<HTMLButtonElement>('.pane-rail')!;
      const railWidth = rail.getBoundingClientRect().width;
      const circle = dock.querySelector('.dock-search-toggle')!.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(dock).getPropertyValue('--dock-gap')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const samples: number[][] = [];
      rail.focus(); rail.click();
      const until = performance.now() + 500;
      const sample = () => setTimeout(() => {
        const expanded = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed])')!;
        const paneProgress = (expanded.getBoundingClientRect().width - railWidth) / (rowWidth - railWidth * 2);
        const dockProgress = (dock.querySelector(':scope > .dock-body')!.getBoundingClientRect().left - dock.getBoundingClientRect().left) / (circle + gap);
        samples.push([paneProgress, dockProgress]);
        if (performance.now() < until) requestAnimationFrame(sample);
        else done(samples);
      }, 0);
      requestAnimationFrame(sample);
    });
    expect(samples.some(([pane]) => pane > 0.2 && pane < 0.8)).toBe(true);
    expect(Math.max(...samples.map(([pane, dock]) => Math.abs(pane - dock)))).toBeLessThanOrEqual(0.04);
    await waitForWorkspaceAnimationSettled();
    await expect($(composer)).toBeFocused();
  });

  it('moves one opaque rail and Related continuously while preserving the header blur', async () => {
    await openChat();
    for (const width of [390, 640]) {
      await viewport(width);
      for (let direction = 0; direction < 2; direction++) {
        const samples = await browser.executeAsync((done: (samples: Array<{ rails: number; opacity: number; left: number; related: number; frameOpacity: number; blur: string; hit: boolean; frameOpacityEffects: number }>) => void) => {
          const samples: Array<{ rails: number; opacity: number; left: number; related: number; frameOpacity: number; blur: string; hit: boolean; frameOpacityEffects: number }> = [];
          const rail = document.querySelector<HTMLButtonElement>('.pane-rail')!;
          const read = () => {
            const visible = [...document.querySelectorAll<HTMLElement>('.pane-rail-surface')].filter(node => Number(getComputedStyle(node).opacity) > 0.01);
            const frame = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed]) [data-pane-frame]')!;
            return { rails: visible.length, opacity: Number(getComputedStyle(visible[0]).opacity), left: visible[0].getBoundingClientRect().left,
              related: document.querySelector('.related-bottom-sheet button')!.getBoundingClientRect().right,
              hit: !!document.elementFromPoint(visible[0].getBoundingClientRect().left + 24, visible[0].getBoundingClientRect().top + 200)?.closest('.pane-rail-surface'),
              frameOpacityEffects: [frame, frame.closest('.notepad-pane')!].flatMap(node => node.getAnimations()).filter(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(keyframe => 'opacity' in keyframe)).length,
              frameOpacity: Number(getComputedStyle(frame).opacity), blur: getComputedStyle(frame.querySelector('.pane-header')!, '::before').backdropFilter };
          };
          samples.push(read());
          rail.focus(); rail.click();
          const until = performance.now() + 500;
          const sample = () => setTimeout(() => {
            samples.push(read());
            if (performance.now() < until) requestAnimationFrame(sample);
            else done(samples);
          }, 0);
          requestAnimationFrame(sample);
        });
        expect(samples.every(sample => sample.rails === 1 && sample.opacity === 1 && sample.hit)).toBe(true);
        expect(samples.every(sample => sample.frameOpacity === 1 && sample.frameOpacityEffects === 0 && sample.blur.includes('blur('))).toBe(true);
        const from = samples[0], to = samples.at(-1)!;
        expect(Math.abs(to.left - from.left)).toBeGreaterThan(width - 150);
        expect(Math.max(...samples.map(sample => Math.abs(
          (sample.left - from.left) / (to.left - from.left) -
          (sample.related - from.related) / (to.related - from.related)
        )))).toBeLessThanOrEqual(0.04);
        expect(samples.some(sample => Math.abs(sample.related - from.related) > 5 && Math.abs(sample.related - to.related) > 5)).toBe(true);
        for (const field of ['left', 'related'] as const) {
          const direction = Math.sign(to[field] - from[field]);
          for (let index = 1; index < samples.length; index++) {
            expect((samples[index][field] - samples[index - 1][field]) * direction).toBeGreaterThanOrEqual(-0.75);
          }
        }
        await waitForWorkspaceAnimationSettled();
      }
    }
  });

  it('hands off rail titles smoothly and clips both notes at the moving rail', async () => {
    await openChat();
    for (const width of [390, 640]) {
      await viewport(width);
      for (let direction = 0; direction < 2; direction++) {
        const samples = await browser.executeAsync((done: (samples: Array<{ spill: number; titles: Array<{ text: string; opacity: number }> }>) => void) => {
          const samples: Array<{ spill: number; titles: Array<{ text: string; opacity: number }> }> = [];
          const rail = document.querySelector<HTMLButtonElement>('.pane-rail')!;
          rail.focus(); rail.click();
          const until = performance.now() + 500;
          const sample = () => setTimeout(() => {
            const movingRail = document.querySelector<HTMLElement>('.pane-rail')!;
            const rect = movingRail.getBoundingClientRect();
            const clips = [...document.querySelectorAll('.pane-viewport')].map(node => node.getBoundingClientRect());
            samples.push({ spill: Math.max(clips[0].right - rect.left, rect.right - clips[1].left),
              titles: [...movingRail.querySelectorAll<HTMLElement>('.pane-rail-label')].map(label => ({
                text: label.querySelector('.pane-rail-title')!.textContent!, opacity: Number(getComputedStyle(label).opacity)
              })) });
            if (performance.now() < until) requestAnimationFrame(sample);
            else done(samples);
          }, 0);
          requestAnimationFrame(sample);
        });
        expect(Math.max(...samples.map(sample => sample.spill))).toBeLessThanOrEqual(0.75);
        expect(samples.some(sample => sample.titles.length === 2 && sample.titles.every(title => title.opacity > 0.05 && title.opacity < 0.95))).toBe(true);
        expect(samples.at(-1)!.titles).toEqual([{ text: direction === 0 ? 'Thought partner' : 'Alpha note', opacity: 1 }]);
        await waitForWorkspaceAnimationSettled();
      }
    }
  });

  it('removes title snapshots when resizing or enabling reduced motion during a handoff', async () => {
    await openChat();
    for (const interruption of ['resize', 'reduced-motion']) {
      await viewport(390);
      await browser.executeAsync((done: () => void) => {
        document.querySelector<HTMLButtonElement>('.pane-rail')!.click();
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      });
      expect(await browser.execute(() => document.querySelectorAll('[data-rail-label-snapshot]').length)).toBeGreaterThan(0);
      if (interruption === 'resize') await viewport(1024);
      else await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await waitForWorkspaceAnimationSettled();
      expect(await browser.execute(() => document.querySelectorAll('[data-rail-label-snapshot]').length)).toBe(0);
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('slides the initial rail in from the edge and reveals stationary content on the shared clock', async () => {
    for (const width of [640, 700]) {
      for (const choice of ['blank', 'current', 'chat']) {
        await resetBrowserWorkspace();
        await viewport(width);
        await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
        const samples = await browser.executeAsync((choice: string, done: (samples: Array<{ rail: number; width: number; opacity: number; spill: number; frameLeft: number; frameWidth: number; oldWidth: number; duration?: number }>) => void) => {
          const shell = document.querySelector('.notepad-shell')!;
          const row = document.querySelector('[data-compact-panes]') ?? document.querySelector('.notepad-pane')!.parentElement!;
          const edge = row.getBoundingClientRect().right;
          const old = document.querySelector<HTMLElement>('[data-pane-frame]')!;
          const oldWidth = old.getBoundingClientRect().width;
          const samples: Array<{ rail: number; width: number; opacity: number; spill: number; frameLeft: number; frameWidth: number; oldWidth: number; duration?: number }> = [];
          // A mutation observer samples before the first paint of the new rail.
          const read = () => {
            const rail = document.querySelector<HTMLElement>('.pane-rail');
            const frames = [...document.querySelectorAll<HTMLElement>('[data-pane-frame]')];
            if (!rail || frames.length !== 2) return;
            const rect = rail.getBoundingClientRect(), frame = frames[1].getBoundingClientRect();
            samples.push({ rail: rect.left - edge, width: rect.width, opacity: Number(getComputedStyle(rail).opacity),
              spill: old.parentElement!.getBoundingClientRect().right - rect.left,
              frameLeft: frame.left, frameWidth: frame.width,
              oldWidth: old.getBoundingClientRect().width - oldWidth,
              duration: rail.getAnimations()[0]?.effect?.getTiming().duration as number | undefined });
          };
          const observer = new MutationObserver(read);
          observer.observe(shell, { childList: true, subtree: true });
          if (choice !== 'blank') {
            if (choice === 'chat') window.__GNEAUXGHTS_E2E__!.seedChatControls();
            document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
            document.querySelector<HTMLButtonElement>(`button[aria-label="${choice === 'chat' ? 'Split with thought partner' : 'Split with current location'}"]`)!.click();
          } else document.querySelector<HTMLButtonElement>('button[aria-label="Open split pane options"]')!.click();
          const until = performance.now() + 550;
          const sample = () => setTimeout(() => {
            read();
            if (performance.now() < until) requestAnimationFrame(sample);
            else { observer.disconnect(); done(samples); }
          }, 0);
          requestAnimationFrame(sample);
        }, choice);
        const moving = samples.filter(sample => typeof sample.duration === 'number');
        expect(moving.length).toBeGreaterThan(3);
        expect(moving[0].rail).toBeGreaterThanOrEqual(-1);
        expect(moving.some(sample => sample.rail < -60 && sample.rail > samples.at(-1)!.rail + 60)).toBe(true);
        expect(moving.every(sample => sample.opacity === 1 && Math.abs(sample.width - 48) < 0.1 && sample.spill <= 0.75)).toBe(true);
        expect(moving.every(sample => Math.abs(sample.oldWidth) <= 0.75)).toBe(true);
        for (const field of ['frameLeft', 'frameWidth'] as const) {
          const values = moving.map(sample => sample[field]);
          expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(0.75);
        }
        expect(moving.every(sample => sample.duration! <= dockMorphDuration && sample.duration! > 250)).toBe(true);
        for (let index = 1; index < moving.length; index++) expect(moving[index].rail - moving[index - 1].rail).toBeLessThanOrEqual(0.75);
        await waitForWorkspaceAnimationSettled();
        await assertGeometry();
        await expect($(choice === 'chat' ? composer : '[data-pane-compact]:not([data-pane-collapsed]) .cm-content')).toBeFocused();
      }
    }
  });

  it('cleans up an initial reveal when reversed, resized, reduced or closed', async () => {
    for (const interruption of ['reverse', 'resize', 'reduce', 'close']) {
      await resetBrowserWorkspace(); await viewport(640);
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
      await browser.executeAsync((done: () => void) => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Open split pane options"]')!.click();
        const observe = () => {
          if (!document.querySelector('.pane-rail')?.getAnimations().length) requestAnimationFrame(observe);
          else requestAnimationFrame(() => done());
        };
        requestAnimationFrame(observe);
      });
      if (interruption === 'resize') await viewport(390);
      else if (interruption === 'reduce') await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      else await browser.execute((interruption: string) => {
        document.querySelector<HTMLButtonElement>(interruption === 'reverse' ? '.pane-rail' : '[data-pane-compact]:not([data-pane-collapsed]) button[aria-label="Close pane"]')!.click();
      }, interruption);
      await waitForWorkspaceAnimationSettled();
      expect(await browser.execute(() => document.querySelectorAll('[data-rail-label-snapshot]').length)).toBe(0);
      const geometry = await browser.execute(() => [...document.querySelectorAll<HTMLElement>('[data-pane-frame]')].map(frame => ({
        effects: frame.getAnimations().length,
        width: frame.getBoundingClientRect().width,
        expected: parseFloat(getComputedStyle(frame).getPropertyValue('--compact-pane-content-width'))
      })));
      expect(geometry).toHaveLength(interruption === 'close' ? 1 : 2);
      expect(geometry.every(frame => frame.effects === 0 && Math.abs(frame.width - frame.expected) <= 1)).toBe(true);
      if (interruption !== 'close') await assertGeometry();
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('keeps the rail below both measured headers with matching top and bottom fades', async () => {
    await openChat();
    for (const width of [390, 640]) {
      await viewport(width);
      for (let direction = 0; direction < 2; direction++) {
        const samples = await browser.executeAsync((done: (samples: Array<{ gap: number; mask: string; padding: boolean }>) => void) => {
          const samples: Array<{ gap: number; mask: string; padding: boolean }> = [];
          const read = () => {
            const rail = document.querySelector<HTMLElement>('.pane-rail')!;
            const headers = [...document.querySelectorAll('.pane-header')].map(header => header.getBoundingClientRect().bottom);
            const style = getComputedStyle(rail);
            samples.push({ gap: rail.getBoundingClientRect().top - Math.max(...headers),
              mask: getComputedStyle(rail, '::before').maskImage, padding: style.paddingTop === style.paddingBottom });
          };
          read(); document.querySelector<HTMLButtonElement>('.pane-rail')!.click();
          const until = performance.now() + 500;
          const sample = () => setTimeout(() => {
            read();
            if (performance.now() < until) requestAnimationFrame(sample);
            else done(samples);
          }, 0);
          requestAnimationFrame(sample);
        });
        expect(samples.every(sample => Math.abs(sample.gap) <= 1 && sample.padding)).toBe(true);
        expect(samples.every(sample => (sample.mask.match(/rgba\(0, 0, 0, 0\)/g) ?? []).length === 2)).toBe(true);
        await waitForWorkspaceAnimationSettled();
      }
    }
  });

  it('closes either expanded rail pane on the same clock as opening', async () => {
    for (const width of [390, 640]) {
      for (const side of ['left', 'right']) {
        await resetBrowserWorkspace(); await viewport(640);
        await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
        await browser.execute(() => {
          document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
            .dispatchEvent(new PointerEvent('pointerenter'));
          document.querySelector<HTMLButtonElement>('button[aria-label="Split with current location"]')!.click();
        });
        await waitForWorkspaceAnimationSettled();
        await viewport(width);
        if (side === 'left') await expandRail();
        const samples = await browser.executeAsync((done: (samples: Array<{ width: number; duration: number }>) => void) => {
          const pane = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed])')!;
          const samples: Array<{ width: number; duration: number }> = [];
          pane.querySelector<HTMLButtonElement>('button[aria-label="Close pane"]')!.click();
          const until = performance.now() + 550;
          const sample = () => setTimeout(() => {
            const effect = pane.getAnimations()[0]?.effect;
            if (effect) samples.push({ width: pane.getBoundingClientRect().width,
              duration: Number(effect.getTiming().duration) });
            if (performance.now() < until) requestAnimationFrame(sample);
            else done(samples);
          }, 0);
          requestAnimationFrame(sample);
        });
        expect(samples.length).toBeGreaterThan(3);
        expect([...new Set(samples.map(sample => sample.duration))]).toEqual([dockMorphDuration]);
        for (let index = 1; index < samples.length; index++) {
          expect(samples[index].width - samples[index - 1].width).toBeLessThanOrEqual(0.75);
        }
        await waitForWorkspaceAnimationSettled();
        await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
        expect(await browser.execute(() => document.querySelector('[data-testid="workspace-pane"]')!.contains(document.activeElement))).toBe(true);
        expect(await browser.execute(() => document.querySelectorAll('[data-rail-label-snapshot], [data-pane-motion]').length)).toBe(0);
      }
    }
  });

  it('hides stationary outgoing text behind one opaque rail when either expanded pane closes', async () => {
    for (const width of [390, 640]) {
      for (const kind of ['note', 'chat']) {
        for (const side of ['left', 'right']) {
          await resetBrowserWorkspace(); await viewport(640);
          await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
          if (kind === 'chat') await openChat();
          else {
            await browser.execute(() => {
              document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter'));
              document.querySelector<HTMLButtonElement>('button[aria-label="Split with current location"]')!.click();
            });
            await waitForWorkspaceAnimationSettled();
          }
          await viewport(width);
          if (side === 'left') await expandRail();
          const result = await browser.executeAsync((side: string, done: (result: { before: number[]; edge: number; samples: Array<{ pose: number[]; rails: number; opacity: number; rail: number; spill: number }> }) => void) => {
            const pane = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed])')!;
            const frame = pane.querySelector<HTMLElement>('[data-pane-frame]')!;
            const text = frame.querySelector<HTMLElement>('.cm-line, [role="log"] p')!;
            const range = document.createRange(); range.selectNodeContents(text);
            const readPose = () => {
              const rect = frame.getBoundingClientRect(), textRect = range.getBoundingClientRect();
              return [rect.left, rect.width, textRect.left, textRect.top, textRect.width, textRect.height];
            };
            const before = readPose();
            const row = pane.parentElement!.getBoundingClientRect();
            const edge = side === 'left' ? row.left - 48 : row.right;
            const samples: Array<{ pose: number[]; rails: number; opacity: number; rail: number; spill: number }> = [];
            pane.querySelector<HTMLButtonElement>('button[aria-label="Close pane"]')!.click();
            const until = performance.now() + 600;
            const sample = () => setTimeout(() => {
              if (pane.isConnected && document.querySelector('[data-pane-motion]')) {
                const rails = [...document.querySelectorAll<HTMLElement>('.pane-rail-surface')].filter(node => Number(getComputedStyle(node).opacity) > 0.01);
                const rail = rails[0]?.getBoundingClientRect();
                const viewport = pane.querySelector<HTMLElement>('.pane-viewport')!;
                const clip = viewport.getBoundingClientRect();
                samples.push({ pose: readPose(), rails: rails.length,
                  opacity: rails[0] ? Number(getComputedStyle(rails[0]).opacity) : 0,
                  rail: rail?.left ?? 0,
                  spill: !rail ? Infinity : clip.width < 0.1 ? 0 : side === 'left' ? clip.right - rail.left : rail.right - clip.left });
              }
              if (performance.now() < until) requestAnimationFrame(sample);
              else done({ before, edge, samples });
            }, 0);
            requestAnimationFrame(sample);
          }, side);
          expect(result.samples.length).toBeGreaterThan(3);
          expect(result.samples.every(sample => sample.rails === 1 && sample.opacity === 1)).toBe(true);
          expect(Math.max(...result.samples.flatMap(sample => sample.pose.map((value, index) => Math.abs(value - result.before[index]))))).toBeLessThanOrEqual(0.75);
          expect(Math.max(...result.samples.map(sample => sample.spill))).toBeLessThanOrEqual(0.75);
          // The last RAF precedes completion/removal; allow one final paint's travel.
          expect(Math.abs(result.samples.at(-1)!.rail - result.edge)).toBeLessThanOrEqual(8);
          const direction = side === 'left' ? -1 : 1;
          for (let index = 1; index < result.samples.length; index++) expect((result.samples[index].rail - result.samples[index - 1].rail) * direction).toBeGreaterThanOrEqual(-0.75);
          await waitForWorkspaceAnimationSettled();
          await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
          expect(await browser.execute(() => document.querySelectorAll('[data-pane-compact], .pane-rail-surface, [data-rail-label-snapshot], [data-pane-motion]').length)).toBe(0);
        }
      }
    }
  });

  it('settles a rail hide cleanly when resized or reduced mid-close', async () => {
    for (const side of ['left', 'right']) for (const interruption of ['resize', 'reduce']) {
      await resetBrowserWorkspace(); await viewport(640);
      await browser.waitUntil(async () => browser.execute(() => !document.querySelector('[data-window-resizing]')));
      await browser.execute(() => document.querySelector<HTMLButtonElement>('button[aria-label="Open split pane options"]')!.click());
      await waitForWorkspaceAnimationSettled();
      if (side === 'left') await expandRail();
      await browser.executeAsync((done: () => void) => {
        const pane = document.querySelector<HTMLElement>('[data-pane-compact]:not([data-pane-collapsed])')!;
        pane.querySelector<HTMLButtonElement>('button[aria-label="Close pane"]')!.click();
        const sample = () => {
          if (!pane.getAnimations().length) requestAnimationFrame(sample);
          else requestAnimationFrame(() => done());
        };
        requestAnimationFrame(sample);
      });
      if (interruption === 'resize') await viewport(1024);
      else await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await waitForWorkspaceAnimationSettled();
      await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
      expect(await browser.execute(() => {
        const pane = document.querySelector<HTMLElement>('[data-testid="workspace-pane"]')!;
        const frame = pane.querySelector<HTMLElement>('[data-pane-frame]')!;
        return { artifacts: document.querySelectorAll('[data-pane-compact], .pane-rail-surface, [data-rail-label-snapshot], [data-pane-motion]').length,
          effects: frame.getAnimations().length, inert: frame.inert,
          widthError: Math.abs(frame.getBoundingClientRect().width - pane.getBoundingClientRect().width) };
      })).toEqual({ artifacts: 0, effects: 0, inert: false, widthError: 0 });
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });

});
