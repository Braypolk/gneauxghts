import { browser, $, expect } from '@wdio/globals'

describe('remaining shortcut assignments', () => {
    it('persists assignments and uses them for editing, images, and focused map notes', async () => {
        await browser.setWindowSize(1440,1000);
        await browser.url('/__gneauxghts_e2e_reset');
        await browser.execute(() => { localStorage.clear(); sessionStorage.clear(); });
        await browser.url('/settings');
        await $('button=Keyboard shortcuts').click();
        const assignments = [
         ['editorSplitLine','o','KeyO',{ctrlKey:true,shiftKey:true}],
         ['editorDeleteToLineEnd','k','KeyK',{ctrlKey:true,shiftKey:true}],
         ['editorStructuralIndent','q','KeyQ',{ctrlKey:true}],
         ['editorStructuralOutdent','q','KeyQ',{ctrlKey:true,shiftKey:true}],
         ['imageCopySource','c','KeyC',{ctrlKey:true,shiftKey:true}],
         ['imageCutSource','x','KeyX',{ctrlKey:true,shiftKey:true}],
         ['mapPreview','F9','F9',{}],
         ['mapOpen','F8','F8',{}],
        ];
        for (const [id,key,code,modifiers] of assignments) {
         const row = $(`tr[data-shortcut-id="${id}"]`);
         await expect(row).toExist();
         await (await row.$$('.binding-button'))[0].click();
         await browser.execute((key,code,modifiers) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true,...modifiers})),key,code,modifiers);
         await $('button=Save').click();
         await expect(row).toHaveText(expect.stringContaining('User'));
        }
        await browser.refresh();
        await $('button=Keyboard shortcuts').click();
        await $('input[aria-label="Filter shortcuts"]').setValue('Map:');
        await expect($('tr[data-shortcut-id="mapOpen"] .binding-button')).toHaveText('F8');
        await expect($('tr[data-shortcut-id="mapPreview"] .binding-button')).toHaveText('F9');

        const press = async (selector,key,code,modifiers={}) => browser.execute((selector,key,code,modifiers) => {
         const element=document.querySelector(selector); element.focus();
         element.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true,...modifiers}));
        },selector,key,code,modifiers);
        const body = async () => browser.execute(() => window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
        const insert = async (markdown,position=0) => {
         await browser.execute((markdown,position) => {
          const bridge=window.__GNEAUXGHTS_NATIVE_E2E__;
          const content=document.querySelector('[data-testid="note-editor"] .cm-content'); content.focus();
          bridge.setEditorSelection(0,bridge.readEditorState().editor.markdown.length);
          const clipboardData=new DataTransfer(); clipboardData.setData('text/plain',markdown);
          content.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
          bridge.setEditorSelection(position,position);
         },markdown,position);
         await browser.waitUntil(async () => await body() === markdown);
        };
        const editor='[data-testid="note-editor"] .cm-content';
        await browser.url('/');
        await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
        await insert('one',1);
        await press(editor,'o','KeyO',{ctrlKey:true});
        expect(await body()).toBe('one');
        await press(editor,'O','KeyO',{ctrlKey:true,shiftKey:true});
        await browser.waitUntil(async()=>await body()==='o\nne');
        expect(await browser.execute(()=>window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.selection.head)).toBe(1);
        await insert('one',1);
        await press(editor,'k','KeyK',{ctrlKey:true});
        expect(await body()).toBe('one');
        await press(editor,'K','KeyK',{ctrlKey:true,shiftKey:true});
        await browser.waitUntil(async()=>await body()==='o');
        await insert('- parent\n- child',11);
        await press(editor,'Tab','Tab');
        expect(await body()).toBe('- parent\n- child');
        await press(editor,'q','KeyQ',{ctrlKey:true});
        await browser.waitUntil(async()=>await body()==='- parent\n  - child');
        await press(editor,'Q','KeyQ',{ctrlKey:true,shiftKey:true});
        await browser.waitUntil(async()=>await body()==='- parent\n- child');
        await browser.execute(()=>window.__GNEAUXGHTS_E2E__.seedImageAsset('second.png'));
        const imageMarkdown='Before\n\n![[second.png|200]]\n\nAfter';
        await insert(imageMarkdown);
        await $('.gn-image-embed img').waitForDisplayed();
        await $('.gn-image-embed img').click();
        await expect($('.gn-image-embed[data-selected="true"]')).toExist();
        await browser.execute(()=>{
         window.__shortcutImageCopies=[];
         window.__shortcutClipboardDescriptor=Object.getOwnPropertyDescriptor(navigator.clipboard,'writeText');
         Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__shortcutImageCopies.push(text);}});
        });
        try {
         await press(editor,'C','KeyC',{ctrlKey:true,shiftKey:true});
         await browser.waitUntil(async()=>await browser.execute(()=>window.__shortcutImageCopies.length)===1);
         expect(await browser.execute(()=>window.__shortcutImageCopies[0])).toBe('![[second.png|200]]');
         expect(await body()).toBe(imageMarkdown);
         await press(editor,'X','KeyX',{ctrlKey:true,shiftKey:true});
         await browser.waitUntil(async()=>!(await body()).includes('![[second.png'));
         expect(await browser.execute(()=>window.__shortcutImageCopies)).toEqual(['![[second.png|200]]','![[second.png|200]]']);
         await press(editor,'z','KeyZ',{metaKey:true});
         await browser.waitUntil(async()=>await body()===imageMarkdown);
        } finally {
         await browser.execute(()=>{
          if(window.__shortcutClipboardDescriptor)Object.defineProperty(navigator.clipboard,'writeText',window.__shortcutClipboardDescriptor);
          else delete navigator.clipboard.writeText;
          delete window.__shortcutImageCopies; delete window.__shortcutClipboardDescriptor;
         });
        }
        await browser.url('/map');
        await $('[data-node-id="note-beta"]').waitForDisplayed();
        await press('[data-node-id="note-beta"]','Enter','Enter');
        await expect(browser).toHaveUrl(expect.stringContaining('/map'));
        await expect($('.reader')).not.toExist();
        await press('[data-node-id="note-beta"]',' ','Space');
        await expect($('.reader')).not.toExist();
        await press('[data-node-id="note-beta"]','F9','F9');
        await expect($('.reader h2')).toHaveText('beta');
        await press('[data-node-id="note-beta"]','Enter','Enter');
        await expect(browser).toHaveUrl(expect.stringContaining('/map'));
        await press('[data-node-id="note-beta"]','F8','F8');
        await expect($('[data-testid="note-title"]')).toHaveValue('Beta note');
        await browser.url('/map');
        await $('[data-filename-id="note-alpha"]').waitForExist();
        await press('[data-filename-id="note-alpha"]','F9','F9');
        await expect($('.reader h2')).toHaveText('alpha');
        await press('[data-filename-id="note-alpha"]','Enter','Enter');
        await expect(browser).toHaveUrl(expect.stringContaining('/map'));
        await press('[data-filename-id="note-alpha"]','F8','F8');
        await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    })
})
