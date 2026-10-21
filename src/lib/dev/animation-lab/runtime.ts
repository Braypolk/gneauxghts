// Imported only by scripts/animationLab.mjs's dev-server transform.
import { reverseActions, type Action, type Options, type Scenario } from './scenarios';
import { tick } from 'svelte';
import { createRecordingFrames } from './recordingFrames';

// The browser backend owns event callback cleanup; the native JS registry is
// absent without WebDriver/Tauri. Publication itself is not exercised by the lab.
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
Object.assign(window.__GNEAUXGHTS_E2E_COMMANDS__ ??= {}, {
  'plugin:app|set_app_theme': async () => null,
  pi_chat_bind_editor_owner: async () => 'animation-lab-editor-owner',
  pi_chat_close_editor_owner: async () => null,
});

const native = {
  now: performance.now.bind(performance), raf: requestAnimationFrame.bind(window), cancel: cancelAnimationFrame.bind(window),
  timeout: setTimeout.bind(window), clear: clearTimeout.bind(window), media: matchMedia.bind(window),
};
const wait = (ms: number) => new Promise<void>(resolve => native.timeout(resolve, ms));
// Libraries use -1 and 0 as cancellation sentinels. Virtual handles must not
// collide with them or with the browser's live handles in this fixture lifetime.
let capturing = false, time = 0, nextId = 0x40000000, reduced = false;
const recordingFrames = createRecordingFrames(native, () => capturing);
const timers = new Map<number, { at: number; callback: () => void }>();
const mediaQueries = new Set<MediaQueryList>();
const animationOrigins = new WeakMap<Animation, number>();

// Own the frame clock as well as native effects: DevTools alone cannot pause
// the dock's requestAnimationFrame geometry. All overrides live in this iframe.
window.requestAnimationFrame = recordingFrames.request;
window.cancelAnimationFrame = recordingFrames.cancel;
Object.defineProperty(performance, 'now', { configurable: true, value: () => capturing ? time : native.now() });
window.setTimeout = ((handler: TimerHandler, delay = 0, ...args: unknown[]) => {
  if (!capturing || typeof handler !== 'function') return native.timeout(handler, delay, ...args);
  const id = nextId++; timers.set(id, { at: time + Math.max(0, delay), callback: () => handler(...args) }); return id;
}) as typeof window.setTimeout;
window.clearTimeout = id => { if (typeof id === 'number') timers.delete(id); native.clear(id); };
window.matchMedia = query => {
  const result = native.media(query);
  if (query === '(prefers-reduced-motion: reduce)') {
    Object.defineProperty(result, 'matches', { get: () => reduced });
    mediaQueries.add(result);
  }
  return result;
};
function setReduced(value: boolean) {
  reduced = value;
  document.getElementById('lab-reduced')?.remove();
  if (value) {
    const style = document.createElement('style'); style.id = 'lab-reduced';
    style.textContent = '*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important}'; document.head.append(style);
  }
  for (const query of mediaQueries) query.dispatchEvent(new MediaQueryListEvent('change', { matches: value, media: query.media }));
}
function find<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`This case is unavailable in the current UI: ${selector}`);
  return element;
}
const search = '[data-testid="note-search-input"]';
const composer = '[data-notepad-command-bar] textarea';
function input(selector: string, value: string) {
  const element = find<HTMLInputElement | HTMLTextAreaElement>(selector);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(selector: string) {
  const element = find(selector);
  // Navigation focus admission listens for the newer pointer intent before click.
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
  element.click();
}
function activate(kind: string, index = 0) {
  const panes = [...document.querySelectorAll<HTMLElement>(`[data-pane-kind="${kind}"]`)];
  const pane = panes[index]; if (!pane) throw new Error(`No ${kind} pane ${index + 1}`);
  const target = pane.querySelector<HTMLElement>('.pane-rail, .pane-header-title-wrap');
  if (!target) throw new Error('Pane activation target is unavailable');
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); target.click();
}
function split(kind: 'chat' | 'note') {
  find('button[aria-label="Open split pane options"]').dispatchEvent(new PointerEvent('pointerenter'));
  // The pointer event reveals the choice in a Svelte microtask.
  return tick().then(() => click(`button[aria-label="Split with ${kind === 'chat' ? 'thought partner' : 'current location'}"]`));
}
async function until(test: () => boolean, label: string, timeout = 20000) {
  const started = native.now();
  while (!test()) { if (native.now() - started > timeout) throw new Error(`Timed out waiting for ${label}`); await wait(30); }
}
async function settle() {
  await tick(); await wait(50);
  await until(() => !document.querySelector('[data-pane-motion],[data-dock-motion]') && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), 'workspace motion');
  await wait(80);
}
async function action(value: Action) {
  switch (value) {
    case 'focus-search': find(search).focus({ preventScroll: true }); break;
    case 'blur': {
      const editor = document.querySelector<HTMLElement>('.cm-content');
      if (editor) editor.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      break;
    }
    case 'clear': click('button[aria-label="Clear search"]'); break;
    case 'related': click('button[aria-label="Related notes"]'); break;
    case 'search': {
      const button = document.querySelector<HTMLElement>('button[aria-label="Search notes"],button[aria-label="Expand search"]');
      if (button) click('button[aria-label="Search notes"],button[aria-label="Expand search"]');
      else find(search).focus({ preventScroll: true }); break;
    }
    case 'escape': (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); break;
    case 'chat': click('button[aria-label="Expand chat input"]'); break;
    case 'replace-chat': click('[data-pane-kind="editor"] button[aria-label="Open thought partner"]'); break;
    case 'previous': click('[data-pane-kind="chat"] button[aria-label="Open previous location"]'); break;
    case 'split-chat': await split('chat'); break;
    case 'split-note': await split('note'); break;
    case 'split-previous':
      find('button[aria-label="Open split pane options"]').dispatchEvent(new PointerEvent('pointerenter'));
      await tick(); click('button[aria-label="Split with previous location"]'); break;
    case 'editor-pane': activate('editor'); break;
    case 'chat-pane': activate('chat'); break;
    case 'close-chat': click('[data-pane-kind="chat"] button[aria-label="Close pane"]'); break;
    case 'close-editor': click('[data-pane-kind="editor"] button[aria-label="Close pane"]'); break;
    case 'other-pane': {
      const bridge = (window as any).__GNEAUXGHTS_NATIVE_E2E__;
      const active = bridge.readEditorState().activePaneId;
      const panes = [...document.querySelectorAll<HTMLElement>('[data-pane-kind]')];
      const pane = panes.find(p => p.dataset.paneId !== active);
      if (!pane) throw new Error('No other pane');
      const target = pane.querySelector<HTMLElement>('.pane-rail, .pane-header-title-wrap')!;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); target.click(); break;
    }
    case 'multiline': input(composer, 'A thought worth keeping.\nA second line, with a little more context.\nOne more connection to explore.\nAnd a question for later.'); break;
    case 'empty-draft': input(composer, ''); break;
    case 'stop': click('button[aria-label="Stop"]'); break;
    case 'refresh': {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Related notes"] button, .related-search-heading button, .search-results-panel button')].find(b => /refresh|retry/i.test(`${b.textContent} ${b.getAttribute('aria-label')}`));
      if (!button) throw new Error('Refresh is not available for this Related status'); button.click(); break;
    }
  }
  await tick();
}

async function prepare(scenario: Scenario, options: Options) {
  document.documentElement.style.fontSize = `${options.fontSize}px`;
  document.documentElement.style.setProperty('--app-safe-area-bottom', `${options.safeArea}px`);
  const shell = find('.app-shell');
  if (options.keyboardInset) {
    shell.style.setProperty('--app-shell-height', `${Math.max(240, innerHeight - options.keyboardInset)}px`);
    shell.dataset.keyboardOpen = 'true';
  }
  await until(() => !!document.querySelector('.cm-content') && !!window.__GNEAUXGHTS_E2E__, 'initial editor');
  await settle();
  if (options.related !== 'ready') {
    window.__GNEAUXGHTS_E2E__!.setRelatedResponse({ status: options.related === 'insufficient' ? 'insufficientContent' : options.related === 'unavailable' ? 'unavailable' : 'ready', scope: 'note', reason: options.related === 'unavailable' ? 'Animation lab: retrieval unavailable' : null, items: [] } as any, options.related === 'loading' ? 6000 : 0);
  }
  if (scenario.layout === 'mixed' || scenario.layout === 'chats') {
    await split('chat'); await until(() => !!document.querySelector(composer) && !find<HTMLTextAreaElement>(composer).disabled, 'chat composer'); await settle();
    if (scenario.layout === 'chats') {
      input(composer, 'Retained draft from Chat A.\nThis belongs to the other conversation.');
      activate('editor'); await tick(); await action('replace-chat');
      await until(() => !!document.querySelector(composer) && !find<HTMLTextAreaElement>(composer).disabled, 'second chat composer'); await settle();
    }
  } else if (scenario.layout === 'chat') {
    await action('replace-chat'); await until(() => !!document.querySelector(composer) && !find<HTMLTextAreaElement>(composer).disabled, 'chat composer'); await settle();
  } else if (scenario.layout === 'editors') {
    await split('note'); await settle();
    await action('focus-search'); click('button[aria-label="Search all notes"]'); await tick(); input(search, 'Beta');
    await until(() => !!document.querySelector('button[aria-label="Open search result: Beta note.md"]'), 'second note');
    click('button[aria-label="Open search result: Beta note.md"]'); await settle();
    input(search, ''); await action('blur'); await settle();
  }
  if (scenario.layout !== 'editor' && scenario.layout !== 'editors') {
    if (options.composer === 'multiline') await action('multiline');
    if (options.composer === 'text' || options.composer === 'running') input(composer, 'Explore this connection');
    if (options.composer === 'running') {
      await window.__GNEAUXGHTS_E2E__!.holdNextPiResponse(); click('button[aria-label="Send message"]');
      await until(() => !!document.querySelector('button[aria-label="Stop"]'), 'running fixture');
    }
    await settle();
  }
  if (scenario.layout === 'mixed' && scenario.start !== 'chat') { activate('editor'); await settle(); }
  if (options.search !== 'idle') {
    await action('focus-search');
    if (options.search === 'populated' || options.search === 'unfocused') input(search, 'Alpha');
    if (options.search === 'image') {
      click('button[aria-label="Search all notes"]'); await tick();
      const data = new DataTransfer();
      // A tiny valid PNG exercises the real paste/image-query path.
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      data.items.add(new File([bytes], 'lab-query.png', { type: 'image/png' }));
      find(search).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }
    if (options.search === 'unfocused') await action('blur');
    await settle();
  }
  if (scenario.start === 'chat' && document.querySelector('[data-input-dock-mode]')?.getAttribute('data-input-dock-mode') !== 'chat') { await action('chat'); await settle(); }
  if (scenario.start === 'search') { await action('search'); await settle(); }
  if (scenario.start === 'related') { await action('related'); await settle(); }
  for (const step of scenario.prepare ?? []) { await action(step); await settle(); }
  if (options.condition === 'reduced') { setReduced(true); await settle(); }
}

export interface Frame { time: number; html: string; width: number; height: number; scroll: Array<[number, number, number]>; dock: string; geometry: { x: number; width: number; height: number } | null }
function snapshot(elapsed: number): Frame {
  const live = document.querySelector('.app-shell')!;
  const copy = live.cloneNode(true) as HTMLElement;
  const originals = [live, ...live.querySelectorAll('*')];
  const clones = [copy, ...copy.querySelectorAll('*')];
  const index = new Map(originals.map((element, i) => [element, i]));
  const scroll: Frame['scroll'] = [];
  for (let i = 0; i < originals.length; i++) {
    const element = originals[i], clone = clones[i];
    if (element instanceof HTMLInputElement && clone instanceof HTMLInputElement) { clone.value = element.value; clone.setAttribute('value', element.value); }
    if (element instanceof HTMLTextAreaElement) clone.textContent = element.value;
    if (element.scrollTop || element.scrollLeft) scroll.push([i, element.scrollTop, element.scrollLeft]);
  }
  // Inline only properties actually animated by CSS/WAAPI. RAF-written styles,
  // SVG material geometry, content changes and attributes are already cloned.
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!target || !index.has(target)) continue;
    const clone = clones[index.get(target)!] as HTMLElement | SVGElement;
    const style = getComputedStyle(target);
    for (const key of new Set(effect!.getKeyframes().flatMap(frame => Object.keys(frame)))) {
      if (['offset', 'computedOffset', 'easing', 'composite'].includes(key)) continue;
      const property = key.startsWith('--') ? key : key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
      clone.style.setProperty(property, style.getPropertyValue(property), 'important');
    }
  }
  const body = document.querySelector('.workspace-input-dock > .dock-body')?.getBoundingClientRect();
  return { time: elapsed, html: copy.outerHTML, width: innerWidth, height: innerHeight, scroll, dock: document.querySelector<HTMLElement>('[data-dock-state]')?.dataset.dockState ?? '', geometry: body ? { x: body.x, width: body.width, height: body.height } : null };
}
async function advance(elapsed: number, origin: number) {
  time = origin + elapsed;
  for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
  recordingFrames.flush(time);
  await tick();
  // Let layout/ResizeObserver and native effects be created before freezing them.
  await new Promise<void>(resolve => native.raf(() => resolve()));
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getTiming().iterations === Infinity) continue;
    if (!animationOrigins.has(animation)) {
      animationOrigins.set(animation, time - Number(animation.currentTime ?? 0)); animation.pause();
    }
    const duration = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
    const current = Math.max(0, time - animationOrigins.get(animation)!);
    animation.currentTime = Math.min(current, duration);
    if (current >= duration && animation.playState !== 'finished') animation.finish();
  }
  await tick();
}
function interruption(scenario: Scenario, options: Options): (() => Promise<void>) | null {
  if (options.condition === 'reverse') {
    const reverse = reverseActions[scenario.id];
    if (!reverse) throw new Error(`Reverse is unavailable for ${scenario.label}. Choose another interruption.`);
    return () => action(reverse);
  }
  if (options.condition === 'retarget') return () => action(scenario.layout === 'mixed' ? 'chat' : 'related');
  if (options.condition === 'reduce-during') return async () => setReduced(true);
  if (options.condition === 'resize') return async () => window.parent.postMessage({ type: 'animation-lab-resize' }, location.origin);
  return null;
}
const api = {
  ready: () => !!document.querySelector('[data-testid="note-editor"][aria-busy="false"]'),
  prepare,
  async play(scenario: Scenario, options: Options) {
    const interrupt = interruption(scenario, options);
    await Promise.all([
      action(scenario.action),
      interrupt ? wait(options.interruptAt).then(interrupt) : Promise.resolve(),
    ]);
  },
  async capture(scenario: Scenario, options: Options) {
    const interrupt = interruption(scenario, options);
    time = native.now(); const origin = time; capturing = true;
    const frames: Frame[] = [snapshot(0)];
    let interrupted = false;
    try {
      await action(scenario.action);
      for (let elapsed = 0; elapsed <= options.duration; elapsed += 1000 / 60) {
        if (interrupt && !interrupted && elapsed >= options.interruptAt) {
          interrupted = true;
          await interrupt();
        }
        await advance(elapsed, origin); frames.push(snapshot(Math.round(elapsed)));
      }
      return {
        frames,
        head: [...document.head.querySelectorAll('style,link[rel="stylesheet"]')].map(node => node.outerHTML).join(''),
        rootClass: document.documentElement.className,
        rootStyle: document.documentElement.style.cssText,
      };
    } finally {
      // This iframe stays frozen until the next fresh load. Never resume old
      // virtual timestamps against the wall clock or replay old pending work.
      capturing = true;
    }
  },
};
(window as any).__ANIMATION_LAB__ = api;
if (window.parent !== window && new URLSearchParams(location.search).has('animationLab')) {
  // This origin belongs exclusively to the fixture server. Reset before owners mount.
  localStorage.clear(); sessionStorage.clear();
}
