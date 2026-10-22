import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';

async function markdown() {
  return browser.execute(() => (window as unknown as {
    __GNEAUXGHTS_NATIVE_E2E__: { readEditorState(): { editor: { markdown: string } } }
  }).__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
}

async function startDrag(move = true, pointerType = 'touch') {
  await browser.execute(() => {
    const line = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-line')!;
    const rect = line.getBoundingClientRect();
    line.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: rect.left + 100, clientY: rect.top + 8
    }));
  });
  await $('.notepad-block-handle[data-show="true"]').waitForExist();
  await browser.execute(({ move, pointerType }) => {
    const button = document.querySelector<HTMLElement>('[aria-label="Move block"]')!;
    const rect = button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 7, pointerType,
      button: 0, clientX: rect.left + 10, clientY: rect.top + 10
    }));
    if (move) {
      const third = [...document.querySelectorAll<HTMLElement>('.cm-line')]
        .find(line => line.textContent?.startsWith('Alpha line 3:'))!;
      window.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 7, pointerType, clientX: rect.left + 10,
        clientY: third.getBoundingClientRect().bottom + 4
      }));
    }
  }, { move, pointerType });
}

async function endDrag(event: string, pointerId = 7) {
  await browser.execute(({ event, pointerId }) => {
    const target = event === 'lostpointercapture'
      ? document.querySelector('[aria-label="Move block"]')! : window;
    target.dispatchEvent(new PointerEvent(event, { bubbles: true, pointerId }));
  }, { event, pointerId });
}

async function moveDragToViewport(position: 'top' | 'center' | 'bottom') {
  return browser.execute((position) => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!;
    const port = scroller.getBoundingClientRect();
    const overlay = document.querySelector<HTMLElement>('.notepad-editor-top-overlay');
    const top = Math.max(port.top, overlay?.getBoundingClientRect().bottom ?? 0);
    const bottom = Math.min(innerHeight, port.bottom);
    window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 7, pointerType: 'touch', clientX: port.left + port.width / 2,
      clientY: position === 'top' ? top + 2 : position === 'bottom' ? bottom - 2 : (top + bottom) / 2
    }));
    return scroller.scrollTop;
  }, position);
}

async function scrollTop() {
  return browser.execute(() => document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!.scrollTop);
}

async function settleFrames() {
  await browser.execute(() => new Promise<void>((resolve) => {
    let frames = 6;
    const tick = () => { if (--frames === 0) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
}

describe('block drag lifecycle', () => {
  beforeEach(resetBrowserWorkspace);

  it('preserves exact Markdown after touch cancellation and ignores a later pointerup', async () => {
    const original = await markdown();
    await startDrag();
    await endDrag('pointercancel');
    await endDrag('pointerup');
    expect(await markdown()).toBe(original);
    expect(await $('.notepad-block-drop-indicator').getAttribute('data-show')).toBe('false');
    expect(await $('.notepad-block-handle').getAttribute('data-dragging')).toBe('false');
  });

  it('cancels a tap without opening the formatting menu', async () => {
    const original = await markdown();
    await startDrag(false);
    await endDrag('pointercancel');
    await endDrag('pointerup');
    expect(await markdown()).toBe(original);
    expect(await $('.slash-root').isExisting()).toBe(false);
  });

  for (const move of [false, true]) {
    it(`cancels ${move ? 'an active drag' : 'a pending handle tap'} with Escape and ignores a later pointerup`, async () => {
      const original = await markdown();
      await startDrag(move);
      await browser.keys('Escape');
      await endDrag('pointerup');
      expect(await markdown()).toBe(original);
      expect(await $('.slash-root').isExisting()).toBe(false);
      expect(await $('.notepad-block-drop-indicator').getAttribute('data-show')).toBe('false');
      expect(await $('.notepad-block-handle').getAttribute('data-dragging')).toBe('false');
    });
  }

  it('continues scrolling under a stationary pointer and drops among newly revealed blocks', async () => {
    const original = await markdown();
    const initialLastVisible = await browser.execute(() => {
      const port = document.querySelector('[data-testid="note-editor"] .cm-scroller')!.getBoundingClientRect();
      return Math.max(...[...document.querySelectorAll<HTMLElement>('[data-testid="note-editor"] .cm-line')]
        .filter(line => line.getBoundingClientRect().top < port.bottom)
        .map(line => Number(line.textContent?.match(/^Alpha line (\d+):/)?.[1] ?? 0)));
    });
    expect(initialLastVisible).toBeGreaterThan(3);
    await startDrag();
    await moveDragToViewport('bottom');
    const viewportHeight = await browser.execute(() => document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-scroller')!.clientHeight);
    await browser.waitUntil(async () => await scrollTop() > viewportHeight, {
      timeout: 6000, timeoutMsg: 'Stationary drag pointer did not scroll past the original viewport'
    });
    await endDrag('pointerup');
    const moved = await markdown();
    expect(moved.indexOf('Alpha line 1:')).toBeGreaterThan(moved.indexOf(`Alpha line ${initialLastVisible}:`));
    await settleFrames();
    const stopped = await scrollTop();
    await settleFrames();
    expect(await scrollTop()).toBe(stopped);
    await browser.keys(['Meta', 'z', '\uE000']);
    expect(await markdown()).toBe(original);
  });

  it('scrolls upward, stops in the center, and stops immediately when Escape cancels', async () => {
    const original = await markdown();
    await startDrag();
    await moveDragToViewport('bottom');
    await browser.waitUntil(async () => await scrollTop() > 650, { timeout: 5000 });
    const beforeUp = await moveDragToViewport('top');
    await browser.waitUntil(async () => await scrollTop() < beforeUp - 200, { timeout: 5000 });
    await moveDragToViewport('center');
    await settleFrames();
    const center = await scrollTop();
    await settleFrames();
    expect(await scrollTop()).toBe(center);
    await moveDragToViewport('bottom');
    await browser.waitUntil(async () => await scrollTop() > center + 100, { timeout: 5000 });
    await browser.keys('Escape');
    const cancelled = await scrollTop();
    await settleFrames();
    expect(await scrollTop()).toBe(cancelled);
    await endDrag('pointerup');
    expect(await markdown()).toBe(original);
    expect(await $('.notepad-block-drop-indicator').getAttribute('data-show')).toBe('false');
  });

  for (const interruption of ['lostpointercapture', 'blur', 'hidden']) {
    it(`abandons a drag on ${interruption}`, async () => {
      const original = await markdown();
      await startDrag();
      if (interruption === 'lostpointercapture') await endDrag(interruption);
      else await browser.execute((interruption) => {
        if (interruption === 'blur') window.dispatchEvent(new Event('blur'));
        else {
          const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
          try {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
          } finally {
            if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
            else delete (document as unknown as { visibilityState?: string }).visibilityState;
          }
        }
      }, interruption);
      await endDrag('pointerup');
      expect(await markdown()).toBe(original);
      expect(await $('.slash-root').isExisting()).toBe(false);
      expect(await $('.notepad-block-drop-indicator').getAttribute('data-show')).toBe('false');
    });
  }

  for (const pointerType of ['touch', 'mouse']) {
    it(`commits a ${pointerType} drop only for its pointer and supports Undo`, async () => {
      const original = await markdown();
      await startDrag(true, pointerType);
      await endDrag('pointercancel', 8);
      await endDrag('pointerup', 8);
      expect(await markdown()).toBe(original);
      await endDrag('pointerup');
      expect(await markdown()).not.toBe(original);
      expect((await markdown()).trimStart().startsWith('Alpha line 2:')).toBe(true);
      await browser.keys(['Meta', 'z', '\uE000']);
      expect(await markdown()).toBe(original);
    });
  }

  it('abandons stale block positions when the document changes during a drag', async () => {
    await startDrag();
    const edited = 'Edited during drag\n\nSecond paragraph';
    await browser.execute((edited) => {
      const content = document.querySelector<HTMLElement>('[data-testid="note-editor"] .cm-content')!;
      content.focus();
      document.execCommand('selectAll');
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', edited);
      content.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, edited);
    await endDrag('pointerup');
    expect(await markdown()).toBe(edited);
    expect(await $('.notepad-block-drop-indicator').getAttribute('data-show')).toBe('false');
  });

  it('keeps a completed handle tap available for formatting', async () => {
    const original = await markdown();
    await startDrag(false);
    await endDrag('pointerup');
    await $('.slash-root').waitForDisplayed();
    expect(await markdown()).toBe(original);
    expect(await $('[aria-label="Move block"]').getCSSProperty('touch-action')).toMatchObject({ value: 'none' });
  });
});
