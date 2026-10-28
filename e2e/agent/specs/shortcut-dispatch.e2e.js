import { browser, $, $$, expect } from '@wdio/globals';

// Recorded in a WDIO session, reduced to independent cases for fresh replay.
describe('shortcut dispatch honors assignments', () => {
  it('prioritizes editor and search assignments and honors image-viewer remaps', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(()=>{
     localStorage.clear(); sessionStorage.clear();
     localStorage.setItem('gneauxghts.keyboard-shortcuts',JSON.stringify({
      editorCopyLineDown:['Enter'],editorBold:['Ctrl+b'],editorHardBreak:['Ctrl+Shift+Enter'],
      searchCurrent:['Ctrl+Enter'],searchOpenInSplit:['Shift+Escape'],
      imageViewerClose:['F9'],imageViewerNext:['F10'],imageViewerPrevious:['F11'],
      imageViewerZoomIn:['F6'],imageViewerZoomOut:['F7'],imageViewerReset:['F8']
     }));
    });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    const editor='[data-testid="note-editor"] .cm-content';
    const body=async()=>browser.execute(()=>window.__GNEAUXGHTS_NATIVE_E2E__.readEditorState().editor.markdown);
    const press=async(selector,key,code,modifiers={})=>browser.execute((selector,key,code,modifiers)=>{
     const element=document.querySelector(selector);element.focus();
     element.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true,cancelable:true,...modifiers}));
    },selector,key,code,modifiers);
    const insert=async(markdown,anchor=0,head=anchor)=>{
     await browser.execute((markdown,anchor,head)=>{
      const content=document.querySelector('[data-testid="note-editor"] .cm-content');content.focus();
      const bridge=window.__GNEAUXGHTS_NATIVE_E2E__;bridge.setEditorSelection(0,bridge.readEditorState().editor.markdown.length);
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain',markdown);
      content.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
      bridge.setEditorSelection(anchor,head);
     },markdown,anchor,head);
     await browser.waitUntil(async()=>await body()===markdown);
    };
    await insert('one',1);
    await press(editor,'Enter','Enter');
    await browser.waitUntil(async()=>await body()==='one\none');
    await insert('hello',0,5);
    await press(editor,'b','KeyB',{ctrlKey:true});
    await browser.waitUntil(async()=>await body()==='**hello**');
    await insert('/text',5);
    await $('.slash-panel').waitForDisplayed();
    await press(editor,'Enter','Enter',{ctrlKey:true,shiftKey:true});
    await browser.waitUntil(async()=>await body()==='/text\n');
    await browser.execute(()=>{window.__GNEAUXGHTS_E2E__.seedImageAsset('second.png');window.__GNEAUXGHTS_E2E__.seedImageAsset('a b.png');});
    await insert('Before\n\n![[second.png|200]]\n\n![[a b.png|200]]\n\nAfter');
    await (await $$('button[aria-label="Zoom image"]'))[0].click();
    await $('dialog.gn-image-viewer').waitForDisplayed();
    await expect($('.gn-image-viewer .counter')).toHaveText('1 / 2');
    await browser.keys('Escape');
    await expect($('dialog.gn-image-viewer')).toBeDisplayed();
    await browser.keys('ArrowRight');
    await expect($('.gn-image-viewer .counter')).toHaveText('1 / 2');
    await browser.keys('F10');
    await expect($('.gn-image-viewer .counter')).toHaveText('2 / 2');
    await browser.keys('F11');
    await expect($('.gn-image-viewer .counter')).toHaveText('1 / 2');
    await $('.gn-image-viewer .stage img').waitForDisplayed();
    const viewerStyle=await $('.gn-image-viewer .stage img').getAttribute('style');
    await browser.keys('F6');
    await browser.waitUntil(async()=>await $('.gn-image-viewer .stage img').getAttribute('style')!==viewerStyle);
    await browser.keys('F7');
    await expect($('.gn-image-viewer .stage img')).toHaveAttribute('style',viewerStyle);
    await browser.keys('F6');
    await browser.keys('F8');
    await expect($('.gn-image-viewer .stage img')).toHaveAttribute('style',viewerStyle);
    await browser.keys('F9');
    await expect($('dialog.gn-image-viewer')).not.toExist();
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await $('button[aria-label="Open search result: beta.md"]').waitForDisplayed();
    await press('[data-testid="note-search-input"]','Enter','Enter',{ctrlKey:true});
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(1);
    await expect($('[data-testid="note-search-input"]')).toHaveAttribute('aria-label',expect.stringContaining('this note'));
    await press('[data-testid="note-search-input"]','f','KeyF',{metaKey:true,shiftKey:true});
    await $('[data-testid="note-search-input"]').setValue('Beta');
    await $('button[aria-label="Open search result: beta.md"]').waitForDisplayed();
    await expect($('[data-search-retained]')).toHaveAttribute('data-search-retained','false');
    await press('[data-testid="note-search-input"]','Escape','Escape',{shiftKey:true});
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
  });
  it('splits from Related using an assigned modified arrow', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(()=>{ localStorage.clear();sessionStorage.clear();localStorage.setItem('gneauxghts.keyboard-shortcuts',JSON.stringify({searchOpenInSplit:['Ctrl+ArrowDown']})); });
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await $('button[aria-label="Related notes"]').click();
    await $('button[aria-label="Related to Alpha note"]').waitForDisplayed();
    await $('button[aria-label="Open related note: Beta note"]').waitForDisplayed();
    await browser.execute(()=>{
     const header=document.querySelector('button[aria-label="Related to Alpha note"]');header.focus();
     header.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',ctrlKey:true,bubbles:true,cancelable:true}));
    });
    await expect($$('[data-testid="workspace-pane"]')).toBeElementsArrayOfSize(2);
    await expect($('[data-testid="workspace-pane"]:last-child [data-testid="note-title"]')).toHaveValue('Beta note');
  });
  it('honors history remaps during renaming and disables image-viewer close keys', async () => {
    await browser.url('/__gneauxghts_e2e_reset');
    await browser.execute(()=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('gneauxghts.keyboard-shortcuts',JSON.stringify({historyExit:['Shift+Escape'],historyRename:['F9'],imageViewerClose:[]}));});
    await browser.url('/');
    await expect($('[data-testid="note-title"]')).toHaveValue('Alpha note');
    await browser.execute(()=>document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'H',code:'KeyH',metaKey:true,shiftKey:true,bubbles:true,cancelable:true})));
    await $('[data-testid="history-mode"]').waitForDisplayed();
    await $('[data-revision-id="note-alpha-revision-35"]').waitForExist();
    await browser.execute(()=>{const revision=document.querySelector('[data-revision-id="note-alpha-revision-35"]');revision.focus();revision.dispatchEvent(new KeyboardEvent('keydown',{key:'F9',code:'F9',bubbles:true,cancelable:true}));});
    await $('input[aria-label="Revision name"]').waitForDisplayed();
    await browser.keys(['Shift','Escape','\uE000']);
    await expect($('[data-testid="history-mode"]')).not.toExist();
    await browser.execute(()=>document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'H',code:'KeyH',metaKey:true,shiftKey:true,bubbles:true,cancelable:true})));
    await $('[data-testid="history-mode"]').waitForDisplayed();
    await browser.keys('Escape');
    await expect($('[data-testid="history-mode"]')).toBeDisplayed();
    await browser.keys(['Shift','Escape','\uE000']);
    await expect($('[data-testid="history-mode"]')).not.toExist();
    await browser.execute(()=>{
     window.__GNEAUXGHTS_E2E__.seedImageAsset('second.png');
     const content=document.querySelector('.cm-content');content.focus();const bridge=window.__GNEAUXGHTS_NATIVE_E2E__;
     bridge.setEditorSelection(0,bridge.readEditorState().editor.markdown.length);
     const clipboardData=new DataTransfer();clipboardData.setData('text/plain','![[second.png|200]]');
     content.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    });
    await $('button[aria-label="Zoom image"]').click();
    await $('dialog.gn-image-viewer').waitForDisplayed();
    await browser.keys('Escape');
    await expect($('dialog.gn-image-viewer')).toBeDisplayed();
    await browser.keys('F9');
    await expect($('dialog.gn-image-viewer')).toBeDisplayed();
    await $('button[aria-label="Close image viewer"]').click();
    await expect($('dialog.gn-image-viewer')).not.toExist();
  });
});
