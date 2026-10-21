import { scenarios, defaults, type Options } from './scenarios';
import type { Frame } from './runtime';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const live = $<HTMLIFrameElement>('live'), recording = $<HTMLIFrameElement>('recording');
type Recording = { frames: Frame[]; head: string; rootClass: string; rootStyle: string; width: number; height: number; label: string };
let current: Recording | null = null, pinned: Recording | null = null, showingA = false, position = 0;
let playing = false, raf = 0, busy = false, saving = false, runId = 0;
const state = await fetch('/__animation-lab/state').then(r => r.json());
let settings = structuredClone(state.settings);
const query = new URLSearchParams(location.search);
let selected = scenarios.find(s => s.id === query.get('case')) ?? scenarios[0];
const labels: Record<string, string> = { duration: 'Dock · ms', curve: 'Dock easing', searchDuration: 'Search · ms', searchCurve: 'Search easing', fadeOut: 'Fade out · ms', fadeIn: 'Fade in · ms', reveal: 'Reveal threshold · 0–1', popupIn: 'Popup in · ms', popupOut: 'Popup out · ms' };
let appliedSettings = structuredClone(state.appliedSettings ?? state.original);
function updateSettingsState() {
  const draft = readSettings();
  const pending = JSON.stringify(draft) !== JSON.stringify(settings);
  const unsaved = JSON.stringify(settings) !== JSON.stringify(appliedSettings);
  $<HTMLButtonElement>('preview-settings').disabled = busy || saving || !pending;
  $<HTMLButtonElement>('apply').disabled = busy || saving || pending || !unsaved;
  $<HTMLButtonElement>('reset-settings').disabled = busy || saving || JSON.stringify(draft) === JSON.stringify(state.original);
  $('preview-settings').textContent = pending ? 'Preview changes' : 'Preview';
}
function renderSettings() {
  $('settings').replaceChildren();
  for (const [key, value] of Object.entries(settings)) {
    const label = document.createElement('label'); label.textContent = labels[key];
    const input = document.createElement('input'); input.id = `setting-${key}`;
    input.value = Array.isArray(value) ? value.join(', ') : String(value);
    input.type = Array.isArray(value) ? 'text' : 'number'; input.step = key === 'reveal' ? '0.01' : '1';
    if (Array.isArray(value)) input.className = 'curve';
    label.append(input); $('settings').append(label);
  }
}
function readSettings() {
  return Object.fromEntries(Object.keys(settings).map(key => { const value = $<HTMLInputElement>(`setting-${key}`).value; return [key, key.toLowerCase().includes('curve') ? value.split(',').map(Number) : Number(value)]; }));
}
function options(): Options {
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof value === 'number' ? Number($<HTMLInputElement>(key).value) : $<HTMLSelectElement>(key).value])) as unknown as Options;
}
function dimensions() {
  const width = Math.max(320, Math.min(2400, Number($<HTMLInputElement>('width').value) || 1440));
  const height = Math.max(320, Math.min(1600, Number($<HTMLInputElement>('height').value) || 900));
  return { width, height };
}
function size() {
  const value = showingA ? pinned : current;
  const { width, height } = recording.style.display === 'block' && value ? value.frames[position] : dimensions();
  const stage = $('stage');
  const scale = $<HTMLInputElement>('actual-size').checked ? 1 : Math.min(1, (stage.clientWidth - 28) / width, (stage.clientHeight - 28) / height);
  for (const frame of [live, recording]) { frame.style.width = `${width}px`; frame.style.height = `${height}px`; frame.style.transform = `scale(${scale})`; }
  $('frame-wrap').style.width = `${width * scale}px`; $('frame-wrap').style.height = `${height * scale}px`;
  $('scale').textContent = `${Math.round(scale * 100)}%`;
}
function renderCases() {
  const picker = $<HTMLSelectElement>('cases'); picker.replaceChildren(); let group: HTMLOptGroupElement | null = null;
  for (const scenario of scenarios) {
    if (group?.label !== scenario.group) { group = document.createElement('optgroup'); group.label = scenario.group; picker.append(group); }
    const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.label; group!.append(option);
  }
  picker.value = selected.id;
}
function selectCase(id: string) {
  if (busy) return;
  selected = scenarios.find(s => s.id === id) ?? selected;
  if (selected.id === 'composer-stop') $<HTMLSelectElement>('composer').value = 'running';
  if (selected.id === 'search-clear' || selected.id === 'search-refocus') $<HTMLSelectElement>('search').value = 'unfocused';
  if (selected.id === 'related-refresh') $<HTMLSelectElement>('related').value = 'unavailable';
  history.replaceState(null, '', `?case=${selected.id}`); $('cases').title = selected.label;
  $<HTMLSelectElement>('cases').value = selected.id; void run();
}
function setPanel(open: boolean) {
  document.body.classList.toggle('settings-open', open);
  $('inspector').hidden = !open;
  $('focus-preview').setAttribute('aria-expanded', String(open));
  size();
}
function selectTab(tab: 'motion' | 'scene') {
  for (const name of ['motion', 'scene']) {
    $(`${name}-tab`).setAttribute('aria-selected', String(tab === name));
    $(`${name}-tab`).tabIndex = tab === name ? 0 : -1;
    $(`${name}-panel`).hidden = tab !== name;
  }
}
function pause() { playing = false; cancelAnimationFrame(raf); $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play recording'); }
function display(): Recording | null { return showingA ? pinned : current; }
function installRecording(value: Recording) {
  const doc = recording.contentDocument!;
  doc.open(); doc.write(`<!doctype html><html><head><base href="${location.origin}/">${value.head}<style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}body{margin:0;pointer-events:none}</style></head><body></body></html>`); doc.close();
  doc.documentElement.className = value.rootClass; doc.documentElement.style.cssText = value.rootStyle;
  $<HTMLInputElement>('timeline').max = String(value.frames.length - 1);
  position = 0; show(0);
}
function show(index: number) {
  const value = display(); if (!value) return;
  position = Math.max(0, Math.min(value.frames.length - 1, Math.round(index)));
  const frame = value.frames[position], doc = recording.contentDocument!;
  doc.body.innerHTML = frame.html;
  const elements = [doc.body.firstElementChild!, ...doc.body.firstElementChild!.querySelectorAll('*')];
  for (const [i, top, left] of frame.scroll) { elements[i].scrollTop = top; elements[i].scrollLeft = left; }
  recording.style.display = 'block'; live.style.visibility = 'hidden';
  $<HTMLInputElement>('timeline').value = String(position); $('time').textContent = `${frame.time} ms`;
  $('geometry').textContent = frame.geometry ? `${frame.dock} · x ${frame.geometry.x.toFixed(1)} · ${frame.geometry.width.toFixed(1)} × ${frame.geometry.height.toFixed(1)}` : 'Pane transition';
  size();
  $('status').textContent = `${showingA ? 'A · ' : ''}${value.label} · frame ${position + 1}/${value.frames.length}`;
}
function play() {
  const value = display(); if (!value) return;
  if (playing) { pause(); return; }
  playing = true; $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause recording');
  if (position === value.frames.length - 1) position = 0;
  let started = performance.now(), offset = value.frames[position].time;
  function advance(now: number) {
    if (!playing) return;
    const target = offset + (now - started) * Number($<HTMLSelectElement>('speed').value);
    let index = value!.frames.findIndex(frame => frame.time >= target);
    if (index < 0) {
      if (!$<HTMLInputElement>('loop').checked) { show(value!.frames.length - 1); pause(); return; }
      started = now; offset = 0; index = 0;
    }
    show(index); raf = requestAnimationFrame(advance);
  }
  raf = requestAnimationFrame(advance);
}
async function fresh() {
  const id = ++runId;
  // A full document navigation disposes the old workspace before fixture reset.
  await new Promise<void>(resolve => { live.onload = () => resolve(); live.src = `/?animationLab=${id}`; });
  const started = performance.now();
  while (!(live.contentWindow as any).__ANIMATION_LAB__?.ready()) {
    if (id !== runId) throw new Error('Preview superseded');
    if (performance.now() - started > 30000) throw new Error('Workspace did not load; inspect the dev-server output.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return (live.contentWindow as any).__ANIMATION_LAB__;
}
async function run(record = true, trigger = false) {
  if (busy) return;
  busy = true; updateSettingsState();
  for (const id of ['cases', 'previous-case', 'next-case', 'viewport', 'replay-live', 'live-mode', 'pin', 'compare']) $<HTMLButtonElement>(id).disabled = true;
  for (const id of ['play', 'previous', 'next', 'timeline']) $<HTMLButtonElement>(id).disabled = true;
  pause(); showingA = false; $('compare').textContent = 'Show A'; $('run').setAttribute('disabled', '');
  $('case-status').textContent = ''; $('status').textContent = 'Loading…';
  recording.style.display = 'none'; live.style.visibility = 'visible'; size();
  try {
    const opts = options();
    if (!Number.isFinite(opts.duration) || opts.duration < 100 || opts.duration > 4000) throw new Error('Capture length must be 100–4000ms.');
    const api = await fresh(); await api.prepare(selected, opts);
    if (!record) { $('status').textContent = 'Live · interactive'; $('case-status').textContent = ''; $<HTMLInputElement>('timeline').disabled = true; if (trigger) await api.play(selected, opts); return; }
    $('status').textContent = 'Recording…';
    const result = await api.capture(selected, opts);
    current = { ...result, ...dimensions(), label: selected.label };
    installRecording(current!); $<HTMLInputElement>('timeline').disabled = false; $('case-status').textContent = `${result.frames.length} frames`;
    play();
  } catch (error) {
    $('case-status').textContent = String((error as Error).message); $('status').textContent = 'Unavailable';
  } finally {
    busy = false; $('run').removeAttribute('disabled'); updateSettingsState();
    for (const id of ['cases', 'previous-case', 'next-case', 'viewport', 'replay-live', 'live-mode']) $<HTMLButtonElement>(id).disabled = false;
    $<HTMLButtonElement>('pin').disabled = !current || recording.style.display !== 'block';
    $<HTMLButtonElement>('compare').disabled = !pinned || !current;
    for (const id of ['play', 'previous', 'next', 'timeline']) $<HTMLButtonElement>(id).disabled = recording.style.display !== 'block';
  }
}
async function save(apply: boolean) {
  if (busy || saving) return;
  saving = true; updateSettingsState();
  $('save-status').textContent = apply ? 'Applying values…' : 'Updating preview…';
  try {
    const response = await fetch(`/__animation-lab/${apply ? 'apply' : 'settings'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Animation-Lab-Token': state.token }, body: JSON.stringify(readSettings()) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error);
    settings = value.settings;
    if (apply) appliedSettings = structuredClone(settings);
    $('save-status').textContent = apply ? 'Saved to source.' : 'Preview updated.';
    updateSettingsState();
    await run();
  } catch (error) { $('save-status').textContent = String((error as Error).message); }
  finally { saving = false; updateSettingsState(); }
}
$('replay-live').onclick = () => void run(false, true);
$('run').onclick = () => void run(); $('live-mode').onclick = () => void run(false);
$('play').onclick = play; $('previous').onclick = () => { pause(); show(position - 1); }; $('next').onclick = () => { pause(); show(position + 1); };
$<HTMLInputElement>('timeline').oninput = event => { pause(); show(Number((event.target as HTMLInputElement).value)); };
$('cases').onchange = () => selectCase($<HTMLSelectElement>('cases').value);
for (const [id, delta] of [['previous-case', -1], ['next-case', 1]] as const) $(id).onclick = () => {
  selectCase(scenarios[(scenarios.indexOf(selected) + delta + scenarios.length) % scenarios.length].id);
};
$('settings').oninput = () => { $('save-status').textContent = ''; updateSettingsState(); };
$('settings').onsubmit = event => { event.preventDefault(); void save(false); };
$('scene-panel').onchange = () => {
  $('interrupt-field').hidden = !['reverse', 'retarget', 'resize', 'reduce-during'].includes($<HTMLSelectElement>('condition').value);
  $('case-status').textContent = 'Scene changed · Record to update';
};
$('motion-tab').onclick = () => selectTab('motion'); $('scene-tab').onclick = () => selectTab('scene');
for (const id of ['motion-tab', 'scene-tab']) $(id).onkeydown = event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const tab = id === 'motion-tab' ? 'scene' : 'motion'; selectTab(tab); $(`${tab}-tab`).focus(); }
};
$('viewport').onchange = () => { const [w, h] = $<HTMLSelectElement>('viewport').value.split(','); $<HTMLInputElement>('width').value = w; $<HTMLInputElement>('height').value = h; size(); void run(); };
for (const id of ['width', 'height']) $(id).onchange = () => { $<HTMLSelectElement>('viewport').value = 'custom'; size(); void run(); };
$('actual-size').onchange = size; new ResizeObserver(size).observe($('stage'));
$('preview-settings').onclick = () => void save(false); $('apply').onclick = () => void save(true);
$('reset-settings').onclick = () => { settings = structuredClone(state.original); renderSettings(); void save(false); };
$('copy').onclick = async () => { await navigator.clipboard.writeText(JSON.stringify({ case: selected.id, viewport: dimensions(), options: options(), motion: readSettings() }, null, 2)); $('case-status').textContent = 'Configuration copied'; };
$('pin').onclick = () => { if (current) { pinned = structuredClone(current); $('compare').removeAttribute('disabled'); $('case-status').textContent = 'Baseline pinned'; $('pin').textContent = 'Replace A'; } };
$('compare').onclick = () => {
  if (!pinned || !current || busy) return;
  const wasPlaying = playing, time = display()!.frames[position].time;
  pause(); showingA = !showingA; $('compare').textContent = showingA ? 'Show B' : 'Show A';
  const value = display()!; installRecording(value);
  const index = value.frames.findIndex(frame => frame.time >= time);
  show(index < 0 ? value.frames.length - 1 : index);
  for (const id of ['play', 'previous', 'next', 'timeline', 'pin']) $<HTMLButtonElement>(id).disabled = false;
  if (wasPlaying) play();
};
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.source === live.contentWindow && event.data?.type === 'animation-lab-resize') {
    $<HTMLInputElement>('width').value = Number($<HTMLInputElement>('width').value) > 700 ? '390' : '1440'; size();
  }
});
$('focus-preview').onclick = () => setPanel($('inspector').hidden);
$('inventory-text').textContent = state.inventory;
$('inventory').onclick = () => $<HTMLDialogElement>('inventory-dialog').showModal(); $('close-inventory').onclick = () => $<HTMLDialogElement>('inventory-dialog').close();
if (selected.id === 'composer-stop') $<HTMLSelectElement>('composer').value = 'running';
if (selected.id === 'search-clear' || selected.id === 'search-refocus') $<HTMLSelectElement>('search').value = 'unfocused';
if (selected.id === 'related-refresh') $<HTMLSelectElement>('related').value = 'unavailable';
renderSettings(); renderCases(); $('cases').title = selected.label; selectTab('motion'); updateSettingsState(); setPanel(window.innerWidth >= 1200); size(); void run();
