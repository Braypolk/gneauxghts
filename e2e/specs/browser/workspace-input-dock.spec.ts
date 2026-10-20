import { readPiFixture } from '../../support/browserPi';
import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { containerMorphDuration as dockMorphDuration } from '../../../src/lib/ui/morphing-containers/motion';

const composerSelector = '[data-notepad-command-bar] textarea';
const motionCaptureDuration = Math.max(800, dockMorphDuration + 200);

async function openChat() {
  await browser.execute(() => {
    document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
      .dispatchEvent(new PointerEvent('pointerenter'));
  });
  await $('button[aria-label="Split with thought partner"]').click();
  await $(composerSelector).waitForEnabled();
  await waitForWorkspaceAnimationSettled();
}

async function expectMode(mode: 'chat' | 'search') {
  await expect($('[data-input-dock-mode]')).toHaveAttribute('data-input-dock-mode', mode);
  await (mode === 'chat' ? $(composerSelector) : $('[data-testid="note-search-input"]')).waitForDisplayed();
  await waitForWorkspaceAnimationSettled();
}

describe('shared workspace input dock', () => {
  beforeEach(async () => {
    await resetBrowserWorkspace();
  });

  for (const split of [false, true]) it(`keeps the bottom blur fitted to the animated input height during ${split ? 'compact pane exchanges' : 'note/chat replacement'}`, async () => {
    if (split) {
      await openChat();
      await browser.setWindowSize(390, 950);
      await waitForWorkspaceAnimationSettled();
    }
    for (const mode of (split ? ['search', 'chat'] : ['chat', 'search']) as Array<'search' | 'chat'>) {
      const selector = split ? '.pane-rail' : mode === 'chat'
        ? '[data-pane-kind="editor"] button[aria-label="Open thought partner"]'
        : '[data-pane-kind="chat"] button[aria-label="Open previous location"]';
      const frames = await browser.executeAsync((selector: string, duration: number, done: (frames: number[][]) => void) => {
        const bar = document.querySelector<HTMLElement>('[data-notepad-command-bar]')!;
        const backdrop = bar.firstElementChild!;
        const dock = bar.querySelector<HTMLElement>('.workspace-input-dock')!;
        const row = dock.closest<HTMLElement>('.search-dock-row')!;
        const frames: number[][] = [];
        const read = () => {
          const style = getComputedStyle(row);
          // Pane motion positions the dock absolutely inside its discovery
          // group. Include its painted height even when that group has no
          // intrinsic height in the row during the handoff.
          const contentHeight = Math.max(dock.getBoundingClientRect().height,
            ...[...row.children].map(child => child.getBoundingClientRect().height));
          const actionHeight = parseFloat(style.getPropertyValue('--workspace-dock-action-height')) *
            parseFloat(getComputedStyle(document.documentElement).fontSize);
          const expectedHeight = Math.max(actionHeight, contentHeight) +
            parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
          const rect = backdrop.getBoundingClientRect();
          frames.push([rect.height, expectedHeight, rect.bottom]);
        };
        read();
        const started = performance.now();
        document.querySelector<HTMLButtonElement>(selector)!.click();
        const sample = () => setTimeout(() => {
          read();
          if (performance.now() - started < duration) requestAnimationFrame(sample);
          else done(frames);
        }, 0);
        requestAnimationFrame(sample);
      }, selector, motionCaptureDuration);
      const heights = frames.map(frame => frame[0]);
      expect(Math.max(...frames.map(frame => Math.abs(frame[0] - frame[1])))).toBeLessThanOrEqual(1);
      expect(heights.some(height => height > Math.min(...heights) + 2 && height < Math.max(...heights) - 2)).toBe(true);
      expect(Math.max(...frames.map(frame => frame[2])) - Math.min(...frames.map(frame => frame[2]))).toBeLessThanOrEqual(1);
      await expectMode(mode);
    }
  });

  it('keeps settled shells separate and send controls circular at desktop and narrow widths', async () => {
    await openChat();
    for (const width of [638, 1440, 390]) {
      await browser.setWindowSize(width, 950);
      await waitForWorkspaceAnimationSettled();
      const geometry = await browser.execute(() => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
        const search = dock.querySelector('.dock-search-toggle')!.getBoundingClientRect();
        const controls = ['.chat-send-button', '.dock-chat-toggle'].map(selector => {
          const rect = dock.querySelector(selector)!.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        return { controls, gap: body.left - search.right,
          blur: dock.querySelector<SVGFEGaussianBlurElement>('feGaussianBlur')!.stdDeviationX.baseVal };
      });
      for (const control of geometry.controls) {
        expect(Math.abs(control.width - control.height)).toBeLessThanOrEqual(1);
      }
      expect(geometry.gap).toBeGreaterThanOrEqual(6);
      expect(geometry.blur).toBe(0);
    }
  });

  it('follows pointer and keyboard pane switches in wide splits while retaining both input drafts', async () => {
    const search = $('[data-testid="note-search-input"]');
    await search.setValue('Alpha');
    await openChat();
    const composer = $(composerSelector);
    await composer.setValue('Keep my unsent thought');

    await $('[data-pane-kind="editor"] .pane-header-title-wrap').click();
    await expectMode('search');
    await expect(search).toHaveValue('Alpha');
    await $('[data-pane-kind="editor"] .pane-header-title-wrap').click();
    await expectMode('search');

    await $('[data-pane-kind="chat"] .pane-header-title-wrap').click();
    await expectMode('chat');
    await expect(composer).toHaveValue('Keep my unsent thought');
    // Repeated activation within a pane must preserve an explicit mode choice.
    await $('button[aria-label="Expand search"]').click();
    await expectMode('search');
    await $('[data-pane-kind="chat"] .pane-header-title-wrap').click();
    await expectMode('search');
    for (const mode of ['search', 'chat'] as const) {
      await browser.execute(() => window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true
      })));
      await expectMode(mode);
    }
    await expect(composer).toHaveValue('Keep my unsent thought');
    await expect(search).toHaveValue('Alpha');
    expect(await readPiFixture()).toHaveLength(0);
  });

  for (const width of [1440, 390]) for (const query of ['', 'Alpha']) {
    it(`retains the chat button without flashing ${query ? 'populated' : 'idle'} search controls when switching to an editor at ${width}px`, async () => {
      if (query) await $('[data-testid="note-search-input"]').setValue(query);
      await openChat();
      await browser.setWindowSize(width, 1000);
      await waitForWorkspaceAnimationSettled();
      await $(composerSelector).setValue('Retain my draft');
      type Frame = { state: string; placeholder: string; active: string; matchOpacity: number;
        left: number; width: number; time: number };
      const capture = await browser.executeAsync((done: (capture: { before: number[]; frames: Frame[] }) => void) => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        const shell = dock.querySelector<HTMLElement>('.shared-search-bar-shell')!;
        const input = shell.querySelector<HTMLInputElement>('input')!;
        const match = shell.querySelector<HTMLElement>('.shared-search-match-options')!;
        const body = dock.querySelector<HTMLElement>(':scope > .dock-body')!;
        const origin = body.getBoundingClientRect();
        const before = [origin.left, origin.width, performance.now()];
        const frames: Frame[] = [];
        const started = performance.now();
        const editor = document.querySelector<HTMLElement>('[data-pane-kind="editor"] .cm-content')!;
        const rail = document.querySelector<HTMLElement>('[data-pane-kind="editor"] .pane-rail');
        if (rail) rail.click();
        else {
          editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          editor.focus({ preventScroll: true });
        }
        const sample = () => setTimeout(() => {
          let opacity = 1;
          for (let element: HTMLElement | null = match; element; element = element.parentElement) {
            opacity *= Number(getComputedStyle(element).opacity);
          }
          const rect = body.getBoundingClientRect();
          frames.push({ state: dock.dataset.dockState!, placeholder: input.placeholder,
            active: shell.dataset.searchActive!, matchOpacity: opacity,
            left: rect.left, width: rect.width, time: performance.now() });
          if (performance.now() - started < 850) requestAnimationFrame(sample);
          else done({ before, frames });
        }, 0);
        requestAnimationFrame(sample);
      });
      const { before, frames } = capture;
      expect(frames.length).toBeGreaterThan(10);
      expect([...new Set(frames.map(frame => frame.state))]).toEqual(['chat-search']);
      expect(frames.every(frame => frame.placeholder === '' && frame.active === 'false')).toBe(true);
      expect(Math.max(...frames.map(frame => frame.matchOpacity))).toBe(0);
      for (const [index, field] of ['left', 'width'].entries()) {
        const samples = [[before[index], before[2]], ...frames.map(frame => [frame[field as 'left' | 'width'], frame.time])];
        const travel = Math.abs(samples.at(-1)![0] - samples[0][0]);
        for (let i = 1; i < samples.length; i++) {
          expect(Math.abs(samples[i][0] - samples[i - 1][0]))
            .toBeLessThanOrEqual(1 + travel * 3 * (samples[i][1] - samples[i - 1][1]) / dockMorphDuration);
        }
      }
      await expect($('[data-testid="note-search-input"]')).toHaveValue(query);
      await $('button[aria-label="Expand chat input"]').click();
      await expectMode('chat');
      await expect($(composerSelector)).toBeFocused();
      await expect($('[data-pane-kind="chat"]')).not.toHaveAttribute('data-pane-collapsed');
      await expect($(composerSelector)).toHaveValue('Retain my draft');
    });
  }

  it('expands hidden search with its shortcut and restores focus to the chat composer on dismissal', async () => {
    await openChat();
    await $(composerSelector).setValue('Return here');
    await $(composerSelector).click();
    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f', code: 'KeyF', metaKey: true, shiftKey: true, bubbles: true, cancelable: true
      }));
    });
    await expectMode('search');
    await expect($('button[aria-label="Search all notes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await browser.keys('Escape');
    await expectMode('chat');
    await expect($(composerSelector)).toBeFocused();
    await expect($(composerSelector)).toHaveValue('Return here');
  });

  it('grows upward, keeps the last response clear, and fits narrow viewports', async () => {
    await openChat();
    await $(composerSelector).setValue('Explain this note');
    await $('button[aria-label="Send message"]').click();
    await $('[data-testid="pi-assistant-message"][data-streaming="false"]').waitForDisplayed();
    const geometry = () => browser.execute(() => {
      const dock = document.querySelector('[data-notepad-command-bar]')!.getBoundingClientRect();
      const logElement = document.querySelector('[role="log"]')!;
      const log = logElement.getBoundingClientRect();
      const surface = document.querySelector('.workspace-chat-slot .chat-composer-surface')!.getBoundingClientRect();
      return { top: dock.top, bottom: dock.bottom, height: dock.height,
        readingBottom: log.bottom - parseFloat(getComputedStyle(logElement).paddingBottom),
        left: surface.left, right: surface.right,
        shellBottoms: [surface.bottom,
          document.querySelector('button[aria-label="Expand search"]')!.getBoundingClientRect().bottom],
        centers: [
          document.querySelector<HTMLElement>('.notepad-command-bar-content > :last-child .notepad-command-action')!,
          document.querySelector<HTMLElement>('button[aria-label="Expand search"]')!,
          document.querySelector<HTMLElement>('.workspace-chat-slot .chat-send-button')!
        ].map(element => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; }),
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    const before = await geometry();
    await browser.execute(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-notepad-command-bar] textarea')!;
      textarea.value = Array.from({ length: 8 }, (_, i) => `Draft line ${i + 1}`).join('\n');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await geometry()).height > before.height + 60);
    await browser.waitUntil(async () => {
      const layout = await geometry();
      return layout.readingBottom <= layout.top;
    }, { timeoutMsg: 'Chat reading space should follow the expanded draft height' });
    const after = await geometry();
    expect(Math.abs(after.bottom - before.bottom)).toBeLessThanOrEqual(1);
    expect(after.readingBottom).toBeLessThanOrEqual(after.top);
    expect(Math.max(...after.centers) - Math.min(...after.centers)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.shellBottoms[0] - after.shellBottoms[1])).toBeLessThanOrEqual(1);
    try {
      for (const width of [900, 390]) {
        await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
        // Device emulation dispatches resize asynchronously; let its layout
        // and ResizeObservers commit before waiting for finite motion.
        await browser.executeAsync((done: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        await waitForWorkspaceAnimationSettled();
        await browser.waitUntil(async () => {
          const layout = await geometry();
          return layout.readingBottom <= layout.top;
        });
        const layout = await geometry();
        expect(layout.left).toBeGreaterThanOrEqual(0);
        expect(layout.right).toBeLessThanOrEqual(width);
        expect(layout.overflow).toBeLessThanOrEqual(1);
        expect(Math.max(...layout.centers) - Math.min(...layout.centers)).toBeLessThanOrEqual(1);
        expect(Math.abs(layout.shellBottoms[0] - layout.shellBottoms[1])).toBeLessThanOrEqual(1);
        expect(layout.readingBottom).toBeLessThanOrEqual(layout.top);
        await $('button[aria-label="Expand search"]').click();
        await expectMode('search');
        await expect($('[data-testid="note-search-input"]')).toBeDisplayed();
        await $('button[aria-label="Expand chat input"]').click();
        await expectMode('chat');
        await expect($(composerSelector)).toHaveValue(expect.stringContaining('Draft line 8'));
      }
    } finally {
      await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    }
  });

  it('returns to ordinary search when the last chat closes', async () => {
    await openChat();
    await $('[data-pane-kind="chat"] button[aria-label="Close pane"]').click();
    await waitForWorkspaceAnimationSettled();
    await expectMode('search');
    await expect($$(composerSelector)).toBeElementsArrayOfSize(0);
    await expect($('button[aria-label="Expand chat input"]')).not.toBeDisplayed();
    await expect($('[data-testid="note-search-input"]')).toBeDisplayed();
  });

  for (const mode of ['chat', 'search'] as const) {
    it(`morphs an expanded editor search into chat and absorbs ${mode} when the last chat closes`, async () => {
      await $('[data-testid="note-search-input"]').setValue('Alpha');
      await waitForWorkspaceAnimationSettled();
      await browser.execute(() => {
        document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
          .dispatchEvent(new PointerEvent('pointerenter'));
      });
      const opening = await browser.executeAsync((captureDuration: number, done: (result: { before: number[]; frames: number[][] }) => void) => {
        const dock = document.querySelector('[data-input-dock-mode]')!;
        const read = () => {
          const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
          const icon = dock.querySelector('.dock-search-toggle')!.getBoundingClientRect();
          return [body.left, body.width, body.bottom, icon.left, performance.now()];
        };
        const before = read(), frames: number[][] = [];
        const started = performance.now();
        document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click();
        const sample = () => setTimeout(() => {
          frames.push(read());
          if (performance.now() - started < captureDuration) requestAnimationFrame(sample);
          else done({ before, frames });
        }, 0);
        requestAnimationFrame(sample);
      }, motionCaptureDuration);
      // A populated editor search must start from its expanded width.
      expect(opening.before[1]).toBeGreaterThan(500);
      expect(Math.abs(opening.frames[0][1] - opening.before[1])).toBeLessThan(3);
      expect(Math.abs(opening.frames[0][0] - opening.before[0])).toBeLessThan(3);
      const openingTravel = Math.abs(opening.frames.at(-1)![0] - opening.before[0]);
      const openingFrames = [opening.before, ...opening.frames];
      for (let i = 1; i < openingFrames.length; i++) {
        const elapsed = openingFrames[i][4] - openingFrames[i - 1][4];
        expect(Math.abs(openingFrames[i][0] - openingFrames[i - 1][0]))
          .toBeLessThanOrEqual(1 + openingTravel * 3 * elapsed / dockMorphDuration);
      }
      expect(Math.max(...opening.frames.map(frame => Math.abs(frame[2] - opening.before[2])))).toBeLessThanOrEqual(1);
      expect(opening.frames.at(-1)![3]).toBeLessThan(opening.before[3] - 30);
      await expectMode('chat');
      await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
      // Selecting the neighboring note shows search; selecting chat restores its input.
      await $('[data-pane-kind="editor"] .pane-header-title-wrap').click();
      await expectMode('search');
      await $('[data-pane-kind="chat"] .pane-header-title-wrap').click();
      await expectMode('chat');
      if (mode === 'search') {
        await $('button[aria-label="Expand search"]').click();
        await expectMode('search');
      } else await $(composerSelector).setValue('Keep this thought');
      const closing = await browser.executeAsync((captureDuration: number, done: (result: { frames: number[][]; states: string[] }) => void) => {
        const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
        const frames: number[][] = [], states: string[] = [];
        const started = performance.now();
        document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Close pane"]')!.click();
        const sample = () => setTimeout(() => {
          const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
          const icon = dock.querySelector('.dock-chat-toggle, .dock-related-toggle')!.getBoundingClientRect();
          const search = dock.querySelector('.dock-search-toggle')!.getBoundingClientRect();
          const discovery = dock.closest('.notepad-discovery-dock')!;
          const leftAction = discovery.previousElementSibling!.getBoundingClientRect();
          const rightAction = discovery.nextElementSibling!.getBoundingClientRect();
          const card = dock.closest('.notepad-workspace-card')!.getBoundingClientRect();
          const iconVisible = Number(getComputedStyle(dock.querySelector('.dock-chat-toggle, .dock-related-toggle')!).opacity) > 0.05;
          frames.push([body.left, body.width, body.bottom, icon.left + icon.width / 2 - body.right,
            Math.min(body.left, search.left) - leftAction.right,
            rightAction.left - Math.max(body.right, iconVisible ? icon.right : body.right),
            Number(getComputedStyle(dock.querySelector('.dock-related-icon, .dock-chat-icon')!).opacity),
            leftAction.left - card.left, card.right - rightAction.right]);
          states.push(dock.dataset.dockPhase!);
          if (performance.now() - started < captureDuration) requestAnimationFrame(sample);
          else done({ frames, states });
        }, 0);
        requestAnimationFrame(sample);
      }, motionCaptureDuration);
      expect(closing.states).toContain('exchange');
      expect(closing.states.at(-1)).toBe('settled');
      expect(Math.max(...closing.frames.map(frame => Math.abs(frame[2] - closing.frames[0][2])))).toBeLessThanOrEqual(1);
      // Closing chat now returns to the Search/Related pair: the incoming
      // Related circle stays beside Search instead of being absorbed.
      expect(closing.frames.at(-1)![3]).toBeGreaterThan(20);
      expect(Math.min(...closing.frames.map(frame => frame[4]))).toBeGreaterThanOrEqual(4);
      expect(Math.min(...closing.frames.map(frame => frame[5]))).toBeGreaterThanOrEqual(4);
      expect(Math.min(...closing.frames.map(frame => frame[7]))).toBeGreaterThanOrEqual(1);
      expect(Math.min(...closing.frames.map(frame => frame[8]))).toBeGreaterThanOrEqual(1);
      expect(closing.frames.at(-1)![6]).toBe(1);
      if (mode === 'search') expect(closing.frames[0][3]).toBeGreaterThan(0);
      await expectMode('search');
      await expect($('[data-input-dock-mode]')).toHaveAttribute('data-dock-state', 'related-search');
      await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
      await expect($$(composerSelector)).toBeElementsArrayOfSize(0);
    });
  }

  it('slots each chat pane into the same dock without mixing their drafts', async () => {
    await openChat();
    await $(composerSelector).setValue('Right pane thought');
    await $('[data-pane-kind="editor"] button[aria-label="Open thought partner"]').click();
    await browser.waitUntil(async () => (await $$('[data-pane-kind="chat"]').length) === 2);
    await $(composerSelector).waitForEnabled();
    await expect($(composerSelector)).toHaveValue('');
    await $(composerSelector).setValue('Left pane thought');
    const panes = await $$('[data-pane-kind="chat"]');
    await panes[1].$('.pane-header-title-wrap').click();
    await expect($(composerSelector)).toHaveValue('Right pane thought');
    await panes[0].$('.pane-header-title-wrap').click();
    await expect($(composerSelector)).toHaveValue('Left pane thought');
    await expect($$(composerSelector)).toBeElementsArrayOfSize(1);
    expect(await readPiFixture()).toHaveLength(0);
  });

  it('exchanges one constant-width bar and settles rapid reversals without replacing either input', async () => {
    await openChat();
    await browser.execute(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-notepad-command-bar] textarea')!;
      textarea.value = 'Keep this draft\nAnd its second line';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await $('button[aria-label="Expand search"]').click();
    await expectMode('search');
    const motion = await browser.executeAsync((captureDuration: number, done: (result: {
      before: number[]; frames: number[][]; after: number[]; sameComposer: boolean; focused: boolean;
    }) => void) => {
      const dock = document.querySelector('[data-input-dock-mode]')!;
      const composer = document.querySelector('[data-notepad-command-bar] textarea');
      const body = dock.querySelector<HTMLElement>(':scope > .dock-body')!;
      const read = () => {
        const rect = body.getBoundingClientRect();
        const material = dock.querySelector('.dock-material .dock-body')!.getBoundingClientRect();
        const text = dock.querySelector('textarea')!.getBoundingClientRect();
        return [rect.left, rect.width, rect.height, rect.bottom, material.left, material.width, material.height, text.top];
      };
      const before = read(), frames: number[][] = [];
      const started = performance.now();
      dock.querySelector<HTMLElement>('button[aria-label="Expand chat input"]')!.click();
      const sample = () => {
        frames.push(read());
        if (performance.now() - started < captureDuration) requestAnimationFrame(sample);
        else done({ before, frames, after: read(), sameComposer: composer === document.querySelector('[data-notepad-command-bar] textarea'),
          focused: document.activeElement === composer });
      };
      requestAnimationFrame(sample);
    }, motionCaptureDuration);
    expect(motion.frames.filter(frame => frame[0] > motion.before[0] + 3 && frame[0] < motion.after[0] - 3).length).toBeGreaterThan(4);
    expect(Math.max(...motion.frames.map(frame => Math.abs(frame[1] - motion.before[1])))).toBeLessThanOrEqual(1);
    expect(Math.max(...motion.frames.map(frame => Math.abs(frame[3] - motion.before[3])))).toBeLessThanOrEqual(1);
    expect(Math.max(...motion.frames.flatMap(frame => [Math.abs(frame[0] - frame[4]), Math.abs(frame[1] - frame[5]), Math.abs(frame[2] - frame[6])]))).toBeLessThanOrEqual(1);
    expect(motion.after[2]).toBeGreaterThan(motion.before[2] + 30);
    expect(motion.after[7]).toBeLessThan(motion.before[7] - 30);
    expect(motion.sameComposer).toBe(true);
    expect(motion.focused).toBe(true);
    await browser.executeAsync((done: () => void) => {
      const toggle = (label: string) => document.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click();
      toggle('Expand search');
      setTimeout(() => toggle('Expand chat input'), 80);
      setTimeout(() => toggle('Expand search'), 160);
      setTimeout(done, 900);
    });
    await expectMode('search');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await $('button[aria-label="Expand chat input"]').click();
    await expectMode('chat');
    await expect($(composerSelector)).toHaveValue('Keep this draft\nAnd its second line');
  });

  it('moves the bar and glyphs continuously with fixed opaque shells, including a wide chat-to-editor return', async () => {
    await openChat();
    await browser.setWindowSize(2400, 1000);
    await waitForWorkspaceAnimationSettled();
    for (const selector of ['button[aria-label="Expand search"]', 'button[aria-label="Expand chat input"]',
      '[data-pane-kind="chat"] button[aria-label="Close pane"]']) {
      const capture = await browser.executeAsync((button: string, duration: number, done: (frames: number[][]) => void) => {
        const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
        const read = () => {
          const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
          const left = dock.querySelector('[data-container-shell="search"]')!, right = dock.querySelector('[data-container-shell="chat"], [data-container-shell="related"]')!;
          const leftRect = left.getBoundingClientRect(), rightRect = right.getBoundingClientRect();
          const glyph = dock.querySelector('.dock-chat-toggle, .dock-related-toggle')!.getBoundingClientRect();
          return [body.left, body.width, leftRect.left, rightRect.right, glyph.left + glyph.width / 2,
            leftRect.height, rightRect.height, Number(getComputedStyle(left).opacity), Number(getComputedStyle(right).opacity), performance.now()];
        };
        const frames = [read()], started = performance.now();
        document.querySelector<HTMLElement>(button)!.click();
        // Sample the committed frame after both pane WAAPI and dock rAF updates.
        // A callback registered before Svelte starts the dock reads a mixture
        // of this frame's pane bounds and the previous frame's dock offsets.
        const sample = () => setTimeout(() => {
          frames.push(read());
          if (performance.now() - started < duration) requestAnimationFrame(sample);
          else done(frames);
        }, 0);
        requestAnimationFrame(sample);
      }, selector, motionCaptureDuration);
      for (const column of [0, 1, 2, 3, 4]) {
        const values = capture.map(frame => frame[column]);
        const direction = Math.sign(values.at(-1)! - values[0]);
        const steps = values.slice(1).map((value, i) => value - values[i]);
        if (Math.min(...steps.map(step => step * direction)) < -0.1) {
          throw new Error(`Reversing dock path ${selector}, column ${column}: ${JSON.stringify({
            start: values[0], end: values.at(-1), reversals: steps.flatMap((step, i) => step * direction < -0.1
              ? [{ frame: i, from: values[i], to: values[i + 1] }] : [])
          })}`);
        }
        const travel = Math.abs(values.at(-1)! - values[0]);
        // Bound jumps by elapsed frame time and the easing's maximum speed,
        // rather than a pixel cap that only makes sense in slow playback.
        steps.forEach((step, i) => {
          const elapsed = capture[i + 1][9] - capture[i][9];
          const maximumSpeed = selector.includes('Close pane') ? 3 : 2;
          const limit = 1 + travel * maximumSpeed * elapsed / dockMorphDuration;
          expect(Math.abs(step)).toBeLessThanOrEqual(limit);
        });
        // Smoothstep starts quadratically. A first-paint width/position flash
        // remains a failure even when the normal-speed first frame moves.
        const firstElapsed = capture[1][9] - capture[0][9];
        expect(Math.abs(steps[0])).toBeLessThanOrEqual(1 + travel * 3 * (firstElapsed / 300) ** 2);
      }
      expect(capture.every(frame => Math.abs(frame[5] - 40) < 0.01 && Math.abs(frame[6] - 40) < 0.01 && frame[7] === 1 && frame[8] === 1)).toBe(true);
      if (!selector.includes('Close pane')) {
        for (const column of [1, 2, 3]) {
          expect(Math.max(...capture.map(frame => frame[column])) - Math.min(...capture.map(frame => frame[column]))).toBeLessThanOrEqual(1);
        }
      }
      await waitForWorkspaceAnimationSettled();
    }
    await expect($('[data-input-dock-mode]')).toHaveAttribute('data-dock-state', 'related-search');
  });

  it('keeps the dock and window anchored when opening chat and focusing either input', async () => {
    await browser.execute(() => {
      document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
        .dispatchEvent(new PointerEvent('pointerenter'));
    });
    const opening = await browser.executeAsync((captureDuration: number, done: (result: { bottom: number[]; scroll: number[]; heights: number[] }) => void) => {
      const bar = document.querySelector<HTMLElement>('[data-notepad-command-bar]')!;
      const ancestors: HTMLElement[] = [];
      for (let node = bar.parentElement; node; node = node.parentElement) ancestors.push(node);
      const bottom: number[] = [], scroll: number[] = [], heights: number[] = [];
      const started = performance.now();
      document.querySelector<HTMLElement>('button[aria-label="Split with thought partner"]')!.click();
      const sample = () => {
        bottom.push(bar.getBoundingClientRect().bottom);
        scroll.push(window.scrollY, ...ancestors.map(node => node.scrollTop));
        const composer = bar.querySelector<HTMLElement>('.chat-composer-surface');
        if (composer) heights.push(bar.querySelector('[data-input-dock-mode] > .dock-body')!.getBoundingClientRect().height);
        if (performance.now() - started < captureDuration) requestAnimationFrame(sample);
        else done({ bottom, scroll, heights });
      };
      requestAnimationFrame(sample);
    }, motionCaptureDuration);
    expect(Math.max(...opening.bottom) - Math.min(...opening.bottom)).toBeLessThanOrEqual(1);
    expect(Math.max(...opening.scroll.map(Math.abs))).toBe(0);
    expect(Math.max(...opening.heights) - Math.min(...opening.heights)).toBeGreaterThan(20);
    const scrollOffsets = () => browser.execute(() => {
      const offsets = [window.scrollY];
      for (let node = document.querySelector<HTMLElement>('[data-notepad-command-bar]')!.parentElement; node; node = node.parentElement) offsets.push(node.scrollTop);
      return offsets;
    });
    await $('button[aria-label="Expand search"]').click();
    await expectMode('search');
    expect((await scrollOffsets()).every(value => value === 0)).toBe(true);
    await $('button[aria-label="Expand chat input"]').click();
    await expectMode('chat');
    expect((await scrollOffsets()).every(value => value === 0)).toBe(true);
  });

  it('joins the moving material while leaving text and controls unfiltered', async () => {
    await openChat();
    const result = await browser.executeAsync((delay: number, done: (result: { filter: string; textFilters: string[]; neckHeight: number; offsets: number[] }) => void) => {
      const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
      dock.querySelector<HTMLElement>('button[aria-label="Expand search"]')!.click();
      setTimeout(() => {
        const material = dock.querySelector<HTMLElement>('.dock-material')!;
        // The right material stays full size while its send glyph shrinks.
        // Only the body and search shell should match their foreground bounds.
        const shapes = [material.querySelector('.dock-body')!, material.querySelector('[data-container-shell="search"]')!];
        const surfaces = [dock.querySelector(':scope > .dock-body')!, dock.querySelector('.dock-search-toggle')!];
        const textFilters: string[] = [];
        for (let node = dock.querySelector<HTMLTextAreaElement>('textarea') as HTMLElement | null; node && node !== dock.parentElement; node = node.parentElement) textFilters.push(getComputedStyle(node).filter);
        const offsets = surfaces.flatMap((surface, i) => {
          const shell = surface.getBoundingClientRect(), shape = shapes[i].getBoundingClientRect();
          return [shell.left - shape.left, shell.width - shape.width, shell.height - shape.height, shell.bottom - shape.bottom];
        });
        done({ filter: getComputedStyle(material.querySelector('[data-dock-joined-shapes]')!).filter, textFilters,
          neckHeight: material.querySelector('[data-container-neck="search"]')!.getBoundingClientRect().height, offsets });
      }, delay);
    }, dockMorphDuration / 2);
    expect(result.filter).toContain('url(');
    expect(result.neckHeight).toBeGreaterThan(5);
    expect(result.textFilters.every(value => value === 'none')).toBe(true);
    expect(Math.max(...result.offsets.map(Math.abs))).toBeLessThanOrEqual(1);
    await expectMode('search');
  });

  it('keeps the search outline absorbed and Related adjacent throughout ordinary search expansion', async () => {
    for (const expand of [true, false]) {
      const offsets = await browser.executeAsync((expand: boolean, duration: number, done: (errors: number[]) => void) => {
        const dock = document.querySelector('.workspace-input-dock')!, input = dock.querySelector<HTMLInputElement>('input')!;
        const errors: number[] = [], started = performance.now();
        if (expand) input.focus({ preventScroll: true });
        else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const sample = () => setTimeout(() => {
          const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
          const material = dock.querySelector('.dock-material-body')!.getBoundingClientRect();
          const left = dock.querySelector('[data-container-shell="search"]')!.getBoundingClientRect();
          const right = dock.querySelector('[data-container-shell="chat"], [data-container-shell="related"]')!.getBoundingClientRect();
          const glyph = dock.querySelector('.dock-search-toggle > svg')!.getBoundingClientRect();
          const inputGlyph = dock.querySelector('.shared-search-input-layer > svg')!.getBoundingClientRect();
          errors.push(Math.abs(body.left - material.left), Math.abs(body.width - material.width),
            Math.max(0, body.left - left.left), Math.abs(right.left - body.right - parseFloat(getComputedStyle(dock).getPropertyValue('--dock-gap'))),
            Math.abs(glyph.left + glyph.width / 2 - inputGlyph.left - inputGlyph.width / 2));
          if (performance.now() - started < duration) requestAnimationFrame(sample);
          else done(errors);
        }, 0);
        requestAnimationFrame(sample);
      }, expand, motionCaptureDuration);
      expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
      await waitForWorkspaceAnimationSettled();
    }
  });

  it('fades contents out, leaves the exchange clear, and finishes a longer reveal after settling', async () => {
    await openChat();
    await $(composerSelector).setValue('Keep this thought');
    await $('button[aria-label="Expand search"]').click();
    await expectMode('search');
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    for (const [label, visible] of [['Expand chat input', 2], ['Expand search', 1]] as const) {
      const frames = await browser.executeAsync((label: string, duration: number, done: (frames: number[][]) => void) => {
        const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
        const frames: number[][] = [], started = performance.now();
        dock.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click();
        const sample = () => setTimeout(() => {
          const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
          const selected = dock.querySelector(label === 'Expand search' ? '[data-container-surface="search"]' : '.dock-chat-layer')!;
          frames.push([dock.hasAttribute('data-dock-motion') ? 1 : 0,
            Number(getComputedStyle(dock.querySelector('[data-container-surface="search"]')!).opacity),
            Number(getComputedStyle(dock.querySelector('.dock-chat-layer')!).opacity),
            body.left, body.top, body.width, body.height,
            dock.hasAttribute('data-dock-text-reveal') ? 1 : 0,
            selected.getAnimations().some(animation => animation.effect?.getTiming().duration === 280
              && (animation.pending || animation.playState === 'running')) ? 1 : 0]);
          if (performance.now() - started < duration) requestAnimationFrame(sample);
          else done(frames);
        }, 0);
        requestAnimationFrame(sample);
      }, label, motionCaptureDuration);
      const moving = frames.filter(frame => frame[0] === 1), settled = frames.filter(frame => frame[0] === 0);
      expect(moving.length).toBeGreaterThan(4);
      const outgoing = visible === 1 ? 2 : 1;
      expect(moving.some(frame => frame[outgoing] > 0 && frame[outgoing] < 1)).toBe(true);
      expect(moving.some(frame => frame[1] === 0 && frame[2] === 0)).toBe(true);
      // At low frame rates CSS can still be pending when geometry settles.
      // Verify that the longer reveal is admitted during motion, then painted.
      expect(moving.some(frame => frame[7] === 1 && frame[8] === 1)).toBe(true);
      expect(moving.every(frame => frame[7] === 1 || frame[visible] === 0)).toBe(true);
      expect(frames.every(frame => Math.min(frame[1], frame[2]) === 0)).toBe(true);
      expect(settled.some(frame => frame[visible] > 0 && frame[visible] < 1)).toBe(true);
      expect(settled.at(-1)![visible]).toBe(1);
      expect(settled.every(frame => frame[visible === 1 ? 2 : 1] === 0)).toBe(true);
      // The reveal continues while the completed bar holds its final geometry.
      for (const column of [3, 4, 5, 6]) {
        expect(Math.max(...settled.map(frame => frame[column])) - Math.min(...settled.map(frame => frame[column]))).toBeLessThanOrEqual(1);
      }
      await waitForWorkspaceAnimationSettled();
    }
    await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
    await $('button[aria-label="Expand chat input"]').click();
    await expectMode('chat');
    await expect($(composerSelector)).toHaveValue('Keep this thought');
  });

  it('hands glyphs off in sequence without activating idle search during the text fade', async () => {
    await openChat();
    await $('button[aria-label="Expand search"]').click();
    await expectMode('search');
    await browser.execute(() => document.querySelector<HTMLInputElement>('[data-testid="note-search-input"]')!.blur());
    await expect($('[data-testid="note-search-input"]')).toHaveAttribute('placeholder', '');
    const result = await browser.executeAsync((duration: number, done: (frames: number[][]) => void) => {
      const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
      const frames: number[][] = [];
      const started = performance.now();
      dock.querySelector<HTMLElement>('button[aria-label="Expand chat input"]')!.click();
      const sample = () => {
        const style = getComputedStyle(dock);
        const alpha = (name: string) => Number(style.getPropertyValue(name));
        const search = dock.querySelector<HTMLElement>('.shared-search-bar-shell')!;
        frames.push([alpha('--dock-search-text'), alpha('--dock-chat-text'),
          alpha('--dock-chat-glyph'), alpha('--dock-send-glyph'),
          search.dataset.searchActive === 'true' ? 1 : 0,
          search.querySelector<HTMLInputElement>('input')!.placeholder.length,
          search.querySelector('[title="Match case"]') ? 1 : 0,
          dock.hasAttribute('data-dock-motion') ? 1 : 0]);
        if (performance.now() - started < duration) requestAnimationFrame(sample);
        else done(frames);
      };
      requestAnimationFrame(sample);
    }, motionCaptureDuration);
    for (const frame of result) {
      expect(Math.min(frame[0], frame[1])).toBe(0);
      expect(Math.min(frame[2], frame[3])).toBe(0);
      expect(frame[4]).toBe(0);
      expect(frame[5]).toBe(0);
    }
  });

  it('returns from disabled Send to enabled Related while keeping reading clearance steady', async () => {
    await openChat();
    const result = await browser.executeAsync((duration: number, done: (result: { opacity: number[]; clearance: number[]; glyph: number[] }) => void) => {
      const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
      const workspace = dock.closest<HTMLElement>('.notepad-shell')!;
      const opacity: number[] = [Number(getComputedStyle(dock).getPropertyValue('--dock-send-opacity'))], clearance: number[] = [], glyph: number[] = [];
      const started = performance.now();
      document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Close pane"]')!.click();
      const sample = () => {
        const style = getComputedStyle(dock);
        opacity.push(Number(style.getPropertyValue('--dock-send-opacity')));
        glyph.push(Number(style.getPropertyValue('--dock-chat-glyph')));
        if (dock.dataset.dockMotion) clearance.push(parseFloat(getComputedStyle(workspace).getPropertyValue('--workspace-dock-height')));
        if (performance.now() - started < duration) requestAnimationFrame(sample);
        else done({ opacity, clearance, glyph });
      };
      requestAnimationFrame(sample);
    }, motionCaptureDuration);
    expect(result.opacity[0]).toBe(0.4);
    expect(result.opacity.at(-1)).toBe(1);
    expect(result.opacity.every(value => value >= 0.4 && value <= 1)).toBe(true);
    expect(result.glyph.at(-1)).toBe(1);
    expect(Math.max(...result.clearance) - Math.min(...result.clearance)).toBeLessThanOrEqual(1);
  });

  it('paints only the projected send button during exchanges with empty and sendable drafts', async () => {
    await openChat();
    for (const draft of ['', 'Ready to send']) {
      await $(composerSelector).setValue(draft);
      const send = $('button[aria-label="Send message"]');
      if (draft) await expect(send).toBeEnabled();
      else await expect(send).toBeDisabled();
      for (const label of ['Expand search', 'Expand chat input']) {
        const opacity = await browser.executeAsync((label: string, duration: number, done: (opacity: number[]) => void) => {
          const send = document.querySelector('.workspace-input-dock .chat-send-button')!;
          const opacity = [Number(getComputedStyle(send).opacity)], started = performance.now();
          document.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click();
          const sample = () => setTimeout(() => {
            opacity.push(Number(getComputedStyle(send).opacity));
            if (performance.now() - started < duration) requestAnimationFrame(sample);
            else done(opacity);
          }, 0);
          requestAnimationFrame(sample);
        }, label, motionCaptureDuration);
        expect(Math.max(...opacity)).toBe(0);
        await waitForWorkspaceAnimationSettled();
      }
    }
    // The invisible native control still owns submission and keyboard focus.
    await $('button[aria-label="Send message"]').click();
    await $('[data-testid="pi-assistant-message"][data-streaming="false"]').waitForDisplayed();
  });

  it('coordinates editor/chat replacement in one pane and releases temporary layout projections', async () => {
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    await waitForWorkspaceAnimationSettled();
    const capture = (selector: string) => browser.executeAsync((button: string, duration: number, done: (frames: number[][]) => void) => {
      const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
      const frames: number[][] = [];
      const started = performance.now();
      document.querySelector<HTMLElement>(button)!.click();
      const sample = () => {
        const card = dock.closest('.notepad-workspace-card')!.getBoundingClientRect();
        const discovery = dock.closest('.notepad-discovery-dock')!;
        const left = discovery.previousElementSibling!.getBoundingClientRect();
        const right = discovery.nextElementSibling!.getBoundingClientRect();
        const body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
        const label = discovery.nextElementSibling!.querySelector('.remember-action-label')!;
        const words = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        let newOpacity = 0;
        while (words.nextNode()) {
          if (!words.currentNode.textContent?.trim().startsWith('New')) continue;
          let opacity = 1;
          for (let element = words.currentNode.parentElement; element; element = element.parentElement) {
            opacity *= Number(getComputedStyle(element).opacity);
          }
          newOpacity += opacity;
        }
        frames.push([left.left - card.left, card.right - right.right,
          body.left - left.right, right.left - body.right,
          Number(getComputedStyle(dock).getPropertyValue('--dock-chat-glyph')), Math.min(1, newOpacity)]);
        if (performance.now() - started < duration) requestAnimationFrame(sample);
        else done(frames);
      };
      requestAnimationFrame(sample);
    }, selector, motionCaptureDuration);
    for (const selector of ['[data-pane-kind="editor"] button[aria-label="Open thought partner"]',
      '[data-pane-kind="chat"] button[aria-label="Open previous location"]']) {
      const frames = await capture(selector);
      expect(Math.min(...frames.flatMap(frame => frame.slice(0, 4)))).toBeGreaterThanOrEqual(1);
      // The secondary glyph belongs to Related in notes and to Send in chat.
      expect(frames.at(-1)![4]).toBe(selector.includes('Open previous') ? 1 : 0);
      expect(frames.every(frame => frame[5] === 1)).toBe(true);
      await waitForWorkspaceAnimationSettled();
      expect(await browser.execute(() => {
        const row = document.querySelector<HTMLElement>('.notepad-command-bar-content')!;
        return [row.style.getPropertyValue('--dock-layout-reserved'), row.style.getPropertyValue('--dock-layout-balance')];
      })).toEqual(['', '']);
    }
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
    await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
  });

  it('changes dock mode immediately with reduced motion', async () => {
    await openChat();
    try {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const result = await browser.executeAsync((done: (result: { mode: string | undefined; running: number; widths: number[] }) => void) => {
        const dock = document.querySelector<HTMLElement>('[data-input-dock-mode]')!;
        dock.querySelector<HTMLElement>('button[aria-label="Expand search"]')!.click();
        requestAnimationFrame(() => requestAnimationFrame(() => done({
          mode: dock.dataset.inputDockMode,
          running: dock.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
          widths: [dock.querySelector(':scope > .dock-body')!, dock.querySelector('.dock-chat-toggle')!].map(surface => surface.getBoundingClientRect().width)
        })));
      });
      expect(result.mode).toBe('search');
      expect(result.running).toBe(0);
      expect(result.widths[0]).toBeGreaterThan(result.widths[1] * 3);
      await expect($('[data-testid="note-search-input"]')).toBeFocused();
    } finally {
      await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('settles the selected input when resizing during a morph', async () => {
    await openChat();
    await $(composerSelector).setValue('Keep this on resize');
    await browser.executeAsync((done: () => void) => {
      document.querySelector<HTMLElement>('button[aria-label="Expand search"]')!.click();
      setTimeout(() => { window.dispatchEvent(new Event('resize')); done(); }, 120);
    });
    await expectMode('search');
    await expect($('[data-input-dock-mode]')).toHaveAttribute('data-dock-phase', 'settled');
    await $('button[aria-label="Expand chat input"]').click();
    await expectMode('chat');
    await expect($(composerSelector)).toHaveValue('Keep this on resize');
  });
});
