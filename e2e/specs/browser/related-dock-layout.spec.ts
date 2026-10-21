import { browser, expect, $, $$ } from '@wdio/globals';
import { resetBrowserWorkspace, waitForNote } from '../../support/browserWorkspace';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { clockProgress as dockClockProgress, containerMorphDuration as dockMorphDuration } from '../../../src/lib/ui/morphing-containers/motion';

const toggle = 'button[aria-label="Related notes"]';
const popup = '[role="dialog"][aria-label="Related notes"]';
const requestCount = () => browser.execute(() => window.__GNEAUXGHTS_E2E__!.invocations.filter(x => x.command === 'get_related_notes').length);
const bounds = () => browser.execute(() => {
  const frame = document.querySelector('[data-testid="workspace-card"]')!.getBoundingClientRect();
  const line = document.querySelector('.cm-line')!.getBoundingClientRect();
  return [frame.left, frame.width, line.left, line.width];
});
function expectSharedClock(frames: number[][]) {
  const origin = frames[0], destination = frames.at(-1)!;
  const moving = frames.slice(1).filter(frame => frame[5] !== -1);
  expect(moving.length).toBeGreaterThan(4);
  expect(moving.every(frame => frame[8] === 1)).toBe(true);
  // Bar dimensions and both icons leave the painted origin and reach the clamped
  // endpoint together, including the first frame and the CSS settling tail.
  for (const column of [1, 2, 3, 4]) {
    const errors = moving.map(frame => {
      const progress = dockClockProgress((frame[0] - frame[5]) / frame[6], 'editor');
      return Math.abs(frame[column] - (origin[column] + (destination[column] - origin[column]) * progress));
    });
    expect(Math.max(...errors)).toBeLessThanOrEqual(1);
    const settled = frames.slice(1).filter(frame => frame[5] === -1);
    expect(settled.length).toBeGreaterThan(0);
    expect(Math.max(...settled.map(frame => Math.abs(frame[column] - destination[column])))).toBeLessThanOrEqual(1);
  }
}
describe('Related discovery without moving note content', () => {
  beforeEach(resetBrowserWorkspace);
  afterEach(async () => {
    await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
    await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  });
  for (const width of [1440, 390]) it(`keeps the Related glyph visible and reveals results during expansion at ${width}px`, async () => {
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await waitForWorkspaceAnimationSettled();
    const frames = await browser.execute(() => new Promise<number[][]>((done) => {
      const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
      const frames: number[][] = [], started = performance.now();
      const read = () => {
        const control = dock.querySelector<HTMLElement>('.dock-related-toggle')!;
        const glyphOpacity = Math.max(...Array.from(control.querySelectorAll('svg')).map(icon => Number(getComputedStyle(icon).opacity))) * Number(getComputedStyle(control).opacity);
        const panel = dock.querySelector<HTMLElement>('.search-results-panel');
        const inset = panel ? parseFloat(getComputedStyle(panel).clipPath.match(/[\d.]+/)?.[0] ?? '0') : 100;
        const scopes = Array.from(dock.querySelectorAll('.shared-search-mode-button')).map(button => button.getBoundingClientRect().left - dock.querySelector('.dock-body')!.getBoundingClientRect().right);
        frames.push([dock.hasAttribute('data-dock-motion') ? 1 : 0, glyphOpacity, inset, ...scopes, panel?.getBoundingClientRect().width ?? 0]);
      };
      read();
      const sample = () => setTimeout(() => {
        read();
        if (performance.now() - started < 850)
          requestAnimationFrame(sample);
        else
          done(frames);
      }, 0);
      dock.querySelector<HTMLElement>('button[aria-label="Related notes"]')!.click();
      requestAnimationFrame(sample);
    }));
    const moving = frames.filter(frame => frame[0] === 1);
    expect(Math.min(...frames.map(frame => frame[1]))).toBeGreaterThanOrEqual(0.99);
    expect(moving.some(frame => frame[2] < 90)).toBe(true);
    expect(Math.max(...moving.map(frame => frame[5])) - Math.min(...moving.map(frame => frame[5]))).toBeLessThanOrEqual(1);
    // Expanding scope labels may travel on Search's curve, but must not snap
    // to their expanded width on the first visible frame of Related entry.
    for (const column of [3, 4]) expect(Math.abs(moving[0][column] - frames[0][column])).toBeLessThan(20);
    await expect($(popup).$('.search-results-heading')).toHaveText(expect.stringContaining('RELATED'));
    await expect($(popup)).not.toHaveText(expect.stringContaining('Connections across your notes'));
  });
  it('swaps the heading and note detail inside the same open popup', async () => {
    await $('[data-testid="note-search-input"]').click();
    await $('button[aria-label^="Open recent note:"]').waitForDisplayed();
    await waitForWorkspaceAnimationSettled();
    const searchPanel = await $('.search-results-panel');
    const panelId = searchPanel.elementId;
    const width = await searchPanel.getSize('width');
    const recentHeight = await $('button[aria-label^="Open recent note:"]').getSize('height');
    await $(toggle).click();
    const note = await $('button[aria-label="Open related note: Beta note"]');
    await note.waitForDisplayed();
    expect((await $('.search-results-panel')).elementId).toBe(panelId);
    expect(await $('.search-results-panel').getSize('width')).toBe(width);
    await expect(note).toHaveElementClass('search-result-item');
    expect(await note.getSize('height')).toBeGreaterThan(recentHeight);
    await $('button[aria-label="Search notes"]').click();
    await $('button[aria-label^="Open recent note:"]').waitForDisplayed();
    expect((await $('.search-results-panel')).elementId).toBe(panelId);
    await expect($('.search-results-heading')).toHaveText('RECENT');
  });
  it('holds the open popup base steady while two-row containers pinch', async () => {
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await $('[data-testid="note-search-input"]').click();
    await waitForWorkspaceAnimationSettled();
    const frames = await browser.execute(() => new Promise<number[][]>((done) => {
      const dock = document.querySelector('.workspace-input-dock')!;
      const panel = dock.querySelector('.search-results-panel')!;
      const frames: number[][] = [], started = performance.now();
      const read = () => {
        const rect = panel.getBoundingClientRect(), body = dock.querySelector(':scope > .dock-body')!.getBoundingClientRect();
        frames.push([rect.bottom, rect.width, body.height, panel.isConnected ? 1 : 0]);
      };
      read();
      dock.querySelector<HTMLElement>('[data-container-toggle="related"]')!.click();
      const sample = () => setTimeout(() => {
        read();
        if (performance.now() - started < 800)
          requestAnimationFrame(sample);
        else
          done(frames);
      }, 0);
      requestAnimationFrame(sample);
    }));
    expect(frames.every(frame => frame[3] === 1)).toBe(true);
    expect(Math.max(...frames.map(frame => frame[0])) - Math.min(...frames.map(frame => frame[0]))).toBeLessThanOrEqual(1);
    expect(Math.max(...frames.map(frame => frame[1])) - Math.min(...frames.map(frame => frame[1]))).toBeLessThanOrEqual(1);
    expect(Math.max(...frames.map(frame => frame[2])) - Math.min(...frames.map(frame => frame[2]))).toBeGreaterThan(30);
  });
  for (const width of [1440, 390]) it(`animates idle Related opening and dismissal on one clock at ${width}px`, async () => {
    await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await waitForWorkspaceAnimationSettled();
    const searchDuration = dockMorphDuration;
    for (const selector of [toggle, '.cm-content']) {
      const frames = await browser.execute((selector: string) => new Promise<number[][]>((done) => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        const frames: number[][] = [];
        const started = performance.now();
        const read = (now: number) => {
          const body = dock.querySelector('.dock-body')!.getBoundingClientRect();
          const search = dock.querySelector('.dock-search-toggle')!.getBoundingClientRect();
          const related = dock.querySelector('.dock-related-toggle')!.getBoundingClientRect();
          frames.push([now, body.left, body.width, search.left, related.left,
            Number(dock.dataset.dockStartedAt ?? -1), Number(dock.dataset.dockDuration ?? 0), body.height,
            dock.dataset.dockEasing === 'editor' ? 1 : 0]);
        };
        read(started);
        const control = document.querySelector<HTMLElement>(selector)!;
        if (selector === '.cm-content')
          control.focus();
        else
          control.click();
        const sample = (now: number) => setTimeout(() => {
          read(now);
          if (performance.now() - started < 850)
            requestAnimationFrame(sample);
          else
            done(frames);
        }, 0);
        requestAnimationFrame(sample);
      }), selector);
      expect(frames.find(frame => frame[5] !== -1)![6]).toBe(searchDuration);
      expectSharedClock(frames);
      await waitForWorkspaceAnimationSettled();
    }
  });
  it('reverses an unfinished Related exchange from the painted size', async () => {
    await waitForWorkspaceAnimationSettled();
    const frames = await browser.execute(() => new Promise<number[][]>((done) => {
      const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
      const frames: number[][] = [];
      const started = performance.now();
      let reversing = false;
      const read = (now: number) => {
        const body = dock.querySelector('.dock-body')!.getBoundingClientRect();
        frames.push([now, body.left, body.width,
          dock.querySelector('.dock-search-toggle')!.getBoundingClientRect().left,
          dock.querySelector('.dock-related-toggle')!.getBoundingClientRect().left,
          Number(dock.dataset.dockStartedAt ?? -1), Number(dock.dataset.dockDuration ?? 0), body.height,
          dock.dataset.dockEasing === 'editor' ? 1 : 0]);
      };
      dock.querySelector<HTMLElement>('button[aria-label="Related notes"]')!.click();
      const sample = (now: number) => setTimeout(() => {
        if (reversing)
          read(now);
        else if (performance.now() - started >= 130) {
          read(now);
          reversing = true;
          dock.querySelector<HTMLElement>('button[aria-label="Search notes"]')!.click();
        }
        if (performance.now() - started < 850)
          requestAnimationFrame(sample);
        else
          done(frames);
      }, 0);
      requestAnimationFrame(sample);
    }));
    expectSharedClock(frames);
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($(popup)).not.toExist();
  });
  it('fades both mounted presentations through Search/Related exchanges', async () => {
    await $('[data-testid="note-search-input"]').click();
    await waitForWorkspaceAnimationSettled();
    for (const [selector, incoming] of [[toggle, 2], ['button[aria-label="Search notes"]', 1]] as const) {
      const frames = await browser.execute((selector: string) => new Promise<number[][]>((done) => {
        const dock = document.querySelector<HTMLElement>('.workspace-input-dock')!;
        const search = dock.querySelector<HTMLElement>('[data-container-surface="search"]')!;
        const related = dock.querySelector<HTMLElement>('[data-container-surface="related"]')!;
        const frames: number[][] = [], started = performance.now();
        dock.querySelector<HTMLElement>(selector)!.click();
        const sample = () => setTimeout(() => {
          const opacity = (element: HTMLElement) => getComputedStyle(element).visibility === 'hidden' ? 0 : Number(getComputedStyle(element).opacity);
          frames.push([dock.hasAttribute('data-dock-motion') ? 1 : 0, opacity(search), opacity(related),
            search.isConnected && related.isConnected ? 1 : 0]);
          if (performance.now() - started < 850)
            requestAnimationFrame(sample);
          else
            done(frames);
        }, 0);
        requestAnimationFrame(sample);
      }), selector);
      const moving = frames.filter(frame => frame[0] === 1), settled = frames.filter(frame => frame[0] === 0);
      const outgoing = incoming === 1 ? 2 : 1;
      expect(moving.some(frame => frame[outgoing] > 0 && frame[outgoing] < 1)).toBe(true);
      expect(moving.some(frame => frame[1] === 0 && frame[2] === 0)).toBe(true);
      expect(frames.every(frame => Math.min(frame[1], frame[2]) === 0 && frame[3] === 1)).toBe(true);
      expect(settled.some(frame => frame[incoming] > 0 && frame[incoming] < 1)).toBe(true);
      expect(settled.at(-1)![incoming]).toBe(1);
      expect(settled.every(frame => frame[outgoing] === 0)).toBe(true);
      await waitForWorkspaceAnimationSettled();
    }
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
  });
  for (const hasChat of [false, true]) for (const width of [390, 640, 900, 1440]) {
    it(`exchanges floating icons at ${width}px with chat ${hasChat ? 'available' : 'closed'} and keeps the search bar dimensions`, async () => {
      if (hasChat) {
        await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1440, height: 844, deviceScaleFactor: 1, mobile: false });
        await waitForWorkspaceAnimationSettled();
        await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!.dispatchEvent(new PointerEvent('pointerenter')));
        await $('button[aria-label="Split with thought partner"]').click();
        await waitForWorkspaceAnimationSettled();
      }
      await browser.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      if (hasChat) {
        if (width === 390) await browser.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await waitForWorkspaceAnimationSettled();
        if (await $('.pane-rail').isDisplayed()) await $('.pane-rail').click();
        else await $('[data-pane-kind="editor"] .cm-content').click();
        await waitForWorkspaceAnimationSettled();
      }
      const expectAdjacentRelated = async () => {
        const position = await browser.execute((hasChat: boolean) => {
          const related = document.querySelector('button[aria-label="Related notes"]')!.getBoundingClientRect();
          const neighbor = document.querySelector('.workspace-input-dock .dock-body')!.getBoundingClientRect();
          return { gap: related.left - neighbor.right, bottom: related.bottom - neighbor.bottom };
        }, hasChat);
        expect(position.gap).toBeGreaterThanOrEqual(6);
        expect(position.gap).toBeLessThanOrEqual(12.5);
        expect(Math.abs(position.bottom)).toBeLessThanOrEqual(1);
      };
      // Idle Search is narrower than its flex frame: this is the placement
      // shown in the user's screenshot, before focusing/expanding Search.
      await waitForWorkspaceAnimationSettled();
      await expectAdjacentRelated();
      if (!hasChat && width === 1440) await browser.saveScreenshot('/tmp/related-adjacent-idle-1440.png');
      await $('[data-testid="note-search-input"]').click();
      await waitForWorkspaceAnimationSettled();
      await expectAdjacentRelated();
      const read = () => browser.execute(() => {
        const bar = document.querySelector('.workspace-input-dock .dock-body')!.getBoundingClientRect();
        const shell = document.querySelector('.shared-search-bar-shell')!.getBoundingClientRect();
        return { left: bar.left, width: bar.width, height: bar.height, shellHeight: shell.height };
      });
      const search = await read();
      await $(toggle).click();
      await waitForWorkspaceAnimationSettled();
      const related = await read();
      expect(related.width).toBeCloseTo(search.width, 0);
      expect(related.height).toBeCloseTo(search.height, 0);
      expect(related.shellHeight).toBeCloseTo(search.shellHeight, 0);
      await expect($(toggle)).toHaveAttribute('aria-hidden', 'true');
      if (hasChat) await expect($('button[aria-label="Expand chat input"]')).toBeDisplayed();
      const circle = await browser.execute(() => {
        const { x, width, height } = document.querySelector('button[aria-label="Search notes"]')!.getBoundingClientRect();
        return { x, width, height };
      });
      expect(circle.x + circle.width).toBeLessThan(related.left);
      expect(circle.width).toBe(circle.height);
      expect(circle.width).toBeGreaterThanOrEqual(40);
      const glyph = await browser.execute(() => {
        const icon = document.querySelector('.dock-related-toggle .dock-related-icon')!;
        const style = getComputedStyle(icon);
        const button = getComputedStyle(icon.parentElement!);
        return { opacity: Number(style.opacity) * Number(button.opacity), color: style.color, background: button.backgroundColor };
      });
      expect(glyph.opacity).toBeGreaterThanOrEqual(0.99);
      expect(glyph.color).not.toBe(glyph.background);
      if (!hasChat && (width === 1440 || width === 390)) await browser.saveScreenshot(`/tmp/related-swap-${width}.png`);
      await $('button[aria-label="Search notes"]').click();
      await waitForWorkspaceAnimationSettled();
      expect(await read()).toEqual(search);
      await expect($('[data-testid="note-search-input"]')).toBeFocused();
    });
  }
  for (const width of [1440, 390]) {
    it(`opens and dismisses the shared popup without resizing the editor at ${width}px`, async () => {
      await browser.setWindowSize(width, 844);
      await waitForWorkspaceAnimationSettled();
      expect(await requestCount()).toBe(0);
      const before = await bounds();
      await $(toggle).click();
      await $(popup).waitForDisplayed();
      await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
      expect(await requestCount()).toBe(1);
      expect(await bounds()).toEqual(before);
      if (width === 1440) await browser.saveScreenshot('/tmp/gneauxghts-related-popup.png');
      await expect($('.related-drawer')).not.toExist();
      await expect($('.related-bottom-sheet')).not.toExist();
      await expect($('.related-note-footer')).not.toExist();
      await expect($('section[aria-label="Related notes at end of note"]')).not.toExist();
      await browser.keys('Escape');
      await expect($(toggle)).toHaveAttribute('aria-expanded', 'false');
      expect(await bounds()).toEqual(before);
    });
  }
  it('opens a related note through keyboard navigation and preserves ordinary search', async () => {
    await $(toggle).click();
    await $('button[aria-label="Open related note: Beta note"]').waitForDisplayed();
    await browser.keys('Enter');
    await waitForNote('Beta note');
    await $(toggle).click();
    await $('button[aria-label="Search notes"]').click();
    await $('[data-testid="note-search-input"]').setValue('Alpha');
    await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
    await expect($(popup)).not.toExist();
    await $(toggle).click();
    await $(popup).waitForDisplayed();
    await $('button[aria-label="Search notes"]').click();
    await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
    await $(toggle).click();
    await $(popup).waitForDisplayed();
    await browser.keys(['Shift', 'Tab']);
    await expect($('button[aria-label="Search notes"]')).toBeFocused();
    await expect($(popup)).toBeDisplayed();
    await browser.keys('Enter');
    await expect($('[data-testid="note-search-input"]')).toBeFocused();
    await expect($('[data-testid="note-search-input"]')).toHaveValue('Alpha');
  });
  it('shows loading and Retry without changing search mode or showing Recent notes', async () => {
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.setRelatedResponse({ status: 'unavailable', scope: 'note', reason: 'Index warming up.', items: [] }, 300));
    await $(toggle).click();
    await expect($(popup)).toHaveText(expect.stringContaining('Finding related notes'));
    await $(popup).$('button=Retry').waitForDisplayed();
    await browser.execute(() => window.__GNEAUXGHTS_E2E__!.setRelatedResponse(null));
    await $(popup).$('button=Retry').click();
    await expect($('button[aria-label="Open related note: Beta note"]')).toBeDisplayed();
  });
  it('closes the popup when entering chat and returns to notes with it closed', async () => {
    await $(toggle).click();
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
    await waitForWorkspaceAnimationSettled();
    await expect($(toggle)).not.toExist();
    await expect($(popup)).not.toExist();
    await browser.execute(() => document.querySelector<HTMLElement>('[data-pane-kind="chat"] button[aria-label="Open previous location"]')!.click());
    await waitForWorkspaceAnimationSettled();
    await expect($(toggle)).toHaveAttribute('aria-expanded', 'false');
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
  it('returns directly from Related to a retained chat', async () => {
    await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open split pane options"]')!
      .dispatchEvent(new PointerEvent('pointerenter')));
    await $('button[aria-label="Split with thought partner"]').click();
    await waitForWorkspaceAnimationSettled();
    await $('[data-pane-kind="editor"] .cm-content').click();
    await waitForWorkspaceAnimationSettled();
    await $(toggle).click();
    await waitForWorkspaceAnimationSettled();
    await $('button[aria-label="Expand chat input"]').click();
    await waitForWorkspaceAnimationSettled();
    await expect($('[data-notepad-command-bar] textarea')).toBeFocused();
    await expect($(popup)).not.toExist();
  });
});
