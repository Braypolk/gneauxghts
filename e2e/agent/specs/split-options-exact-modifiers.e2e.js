import { browser, $, expect } from '@wdio/globals';

// Recorded through the WDIO session loop and reduced to the independent workflow.
describe('exact held split modifiers', () => {
  it('rejects extra modifiers in either press order and restores matching previews on release', async () => {
    await browser.setWindowSize(1440, 1000);
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('.cm-content').click();
    const send = async (type, key, modifiers = {}) => browser.execute((type, key, modifiers) => {
      const code = { Alt: 'AltLeft', Meta: 'MetaLeft', Control: 'ControlLeft', Shift: 'ShiftLeft' }[key];
      document.activeElement.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ...modifiers }));
    }, type, key, modifiers);
    const shown = () => expect($('.split-pane-control')).toHaveAttribute('class', expect.stringContaining('split-pane-control--split'));
    const hidden = () => expect($('.split-pane-control')).not.toHaveAttribute('class', expect.stringContaining('split-pane-control--split'));
    await hidden();
    for (const [otherKey, otherFlag] of [['Meta', 'metaKey'], ['Control', 'ctrlKey'], ['Shift', 'shiftKey']]) {
      await send('keydown', 'Alt', { altKey: true });
      await shown();
      await send('keydown', otherKey, { altKey: true, [otherFlag]: true });
      await hidden();
      await send('keyup', otherKey, { altKey: true });
      await shown();
      await send('keyup', 'Alt');
      await hidden();
      await send('keydown', otherKey, { [otherFlag]: true });
      await hidden();
      await send('keydown', 'Alt', { altKey: true, [otherFlag]: true });
      await hidden();
      await send('keyup', 'Alt', { [otherFlag]: true });
      await hidden();
      await send('keyup', otherKey);
      await hidden();
    }
    for (const order of [['Meta', 'Shift'], ['Shift', 'Meta']]) {
      const firstFlag = order[0] === 'Meta' ? 'metaKey' : 'shiftKey';
      const secondFlag = order[1] === 'Meta' ? 'metaKey' : 'shiftKey';
      await send('keydown', order[0], { [firstFlag]: true });
      await hidden();
      await send('keydown', order[1], { metaKey: true, shiftKey: true });
      await shown();
      for (const [extraKey, extraFlag] of [['Alt', 'altKey'], ['Control', 'ctrlKey']]) {
        await send('keydown', extraKey, { metaKey: true, shiftKey: true, [extraFlag]: true });
        await hidden();
        await send('keyup', extraKey, { metaKey: true, shiftKey: true });
        await shown();
      }
      await send('keyup', order[0], { [secondFlag]: true });
      await hidden();
      await send('keyup', order[1]);
      await hidden();
    }
  });
});
