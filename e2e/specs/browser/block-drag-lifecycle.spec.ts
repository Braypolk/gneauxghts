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
