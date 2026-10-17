import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateToPendingTaskTarget, openRecentTask, openSearchResult, openResolvedNoteLink, openNoteCitation, type NavigationContext, type OpenContext } from './openFlow';
import { revealEditorTextTarget, revealEditorCitationTarget, focusEditorAtDocumentLine, waitForEditorPaint } from './navigation';
import { Text } from '@codemirror/state';
import type { SearchItem } from '$lib/types/semantic';
vi.mock('./navigation', () => ({ revealEditorTextTarget: vi.fn(() => true), revealEditorCitationTarget: vi.fn(() => true), focusEditorAtDocumentLine: vi.fn(() => true), waitForEditorPaint: vi.fn(async () => {}) }));
function fixture() {
  let id = 'a';
  const root = {} as HTMLDivElement;
  const getContext = (): NavigationContext => {
    const captured = id;
    return { editorRoot: root, titleShell: null, currentNoteId: id, currentNotePath: `/vault/${id}.md`, focusTitleAtEnd: vi.fn(), isCurrent: () => id === captured };
  };
  const openContext: OpenContext = { currentNoteId: id, currentNotePath: '/vault/a.md', stopPendingAutosave: vi.fn(), clearSearch: vi.fn(), openNotePath: vi.fn(async (next) => { id = next!; }) };
  const task = { noteId: 'b', notePath: '/vault/b.md', text: 'target task', lineNumber: 5, completed: false, noteTitle: 'B', taskKey: 'task-b', updatedAtMillis: 1 };
  return { root, getContext, openContext, task, change: (next: string) => { id = next; } };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(waitForEditorPaint).mockResolvedValue(undefined); vi.mocked(revealEditorTextTarget).mockReturnValue(true); });
afterEach(() => vi.unstubAllGlobals());

describe('post-open navigation admission', () => {
  it('opens a cited note normally and selects only its exact passage', async () => {
    const f = fixture();
    expect(await openNoteCitation(f.openContext, f.getContext, { noteId: 'b', path: '/vault/b.md', location: { quote: 'exact quote' } })).toBe(true);
    expect(f.openContext.openNotePath).toHaveBeenCalledWith('b', '/vault/b.md', { focusEditorAfterOpen: true });
    expect(revealEditorCitationTarget).toHaveBeenCalledWith(f.root, 'exact quote');
    expect(revealEditorTextTarget).not.toHaveBeenCalled();
  });
  it('keeps normal note positioning for whole-note citations', async () => {
    const f = fixture();
    expect(await openNoteCitation(f.openContext, f.getContext, { noteId: 'b', path: '/vault/b.md' })).toBe(true);
    expect(revealEditorCitationTarget).not.toHaveBeenCalled();
  });
  it('does not select a cited passage when navigation is superseded during paint', async () => {
    const f = fixture();
    vi.mocked(waitForEditorPaint).mockImplementation(async () => { f.change('c'); });
    expect(await openNoteCitation(f.openContext, f.getContext, { noteId: 'b', path: '/vault/b.md', location: { quote: 'exact quote' } })).toBe(false);
    expect(revealEditorCitationTarget).not.toHaveBeenCalled();
  });
  it('focuses a Recent Task using note B after opening from note A', async () => {
    const f = fixture(); await openRecentTask(f.openContext, f.getContext, f.task);
    expect(f.openContext.openNotePath).toHaveBeenCalledWith('b', '/vault/b.md', { focusEditorAfterOpen: true });
    expect(revealEditorTextTarget).toHaveBeenCalledWith(f.root, 'target task', { preferredLine: undefined });
  });
  it('focuses a task in the current note without opening it again', async () => {
    const f = fixture(); await openRecentTask(f.openContext, f.getContext, { ...f.task, noteId: 'a', notePath: '/vault/a.md' });
    expect(f.openContext.openNotePath).not.toHaveBeenCalled(); expect(revealEditorTextTarget).toHaveBeenCalledOnce();
  });
  it('does not target after save/open fails', async () => {
    const f = fixture(); vi.mocked(f.openContext.openNotePath).mockRejectedValue(new Error('save failed'));
    await expect(openRecentTask(f.openContext, f.getContext, f.task)).rejects.toThrow('save failed');
    expect(revealEditorTextTarget).not.toHaveBeenCalled();
  });
  it('ignores a target superseded by note C while paint is pending', async () => {
    const f = fixture(); let painted!: () => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(waitForEditorPaint).mockImplementation(() => { entered(); return new Promise<void>(resolve => { painted = resolve; }); });
    const opening = openRecentTask(f.openContext, f.getContext, f.task); await ready;
    f.change('c'); painted(); await opening;
    expect(revealEditorTextTarget).not.toHaveBeenCalled();
  });
  it.each(['open', 'paint'] as const)('does not refocus a search result after newer input during %s', async stage => {
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const f = fixture();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    if (stage === 'open') {
      vi.mocked(f.openContext.openNotePath).mockImplementation(async next => {
        entered(); await pending; f.change(next!);
      });
    } else {
      vi.mocked(waitForEditorPaint).mockImplementation(async () => { entered(); await pending; });
    }
    const opening = openSearchResult(f.openContext, f.getContext, {
      noteId: 'b', notePath: '/vault/b.md', sectionLabel: 'Paragraph 1',
      matchText: 'target', reasonLabels: ['lexical'], lexicalScore: 1
    } as SearchItem);
    await ready;
    events.dispatchEvent(new Event('keydown'));
    release();
    await opening;
    expect(f.getContext().currentNoteId).toBe('b');
    expect(revealEditorTextTarget).not.toHaveBeenCalled();
    if (stage === 'open') expect(f.openContext.clearSearch).not.toHaveBeenCalled();
  });
  it('releases pending interaction listeners when the workspace is disposed', async () => {
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const added = vi.spyOn(events, 'addEventListener');
    const removed = vi.spyOn(events, 'removeEventListener');
    const lifetime = new AbortController();
    const f = fixture();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(f.openContext.openNotePath).mockImplementation(async next => {
      entered(); await new Promise<void>(resolve => { release = resolve; }); f.change(next!);
    });
    const opening = openRecentTask(f.openContext,
      () => ({ ...f.getContext(), signal: lifetime.signal }), f.task);
    await ready;
    expect(added.mock.calls.length).toBeGreaterThan(0);
    lifetime.abort();
    // Cleanup must precede IPC settlement; the backend may never answer.
    expect(removed.mock.calls).toEqual(added.mock.calls);
    release();
    await opening;
    expect(revealEditorTextTarget).not.toHaveBeenCalled();
  });
  it('checks the loaded identity when an open resolves without adopting its target', async () => {
    const f = fixture(); vi.mocked(f.openContext.openNotePath).mockResolvedValue(undefined);
    await openRecentTask(f.openContext, f.getContext, f.task);
    expect(revealEditorTextTarget).not.toHaveBeenCalled();
  });
  it('uses the post-open context for a resolved link', async () => {
    const f = fixture(); await openResolvedNoteLink(f.openContext, f.getContext, { noteId: 'b', notePath: '/vault/b.md', sectionLabel: 'Paragraph 1', matchText: 'target' });
    expect(revealEditorTextTarget).toHaveBeenCalledWith(f.root, 'target', { focus: true });
  });
  it('preserves title-only cursor positions and semantic-only nonfocus', async () => {
    const f = fixture(); const result = { noteId: 'b', notePath: '/vault/b.md', sectionLabel: 'Title', matchText: 'B', reasonLabels: ['semantic'], lexicalScore: null, semanticScore: 1 } as SearchItem;
    await openSearchResult(f.openContext, f.getContext, result); expect(revealEditorTextTarget).not.toHaveBeenCalled();
    await openSearchResult(f.openContext, f.getContext, { ...result, sectionLabel: 'Paragraph 2', matchText: 'target' });
    expect(revealEditorTextTarget).toHaveBeenCalledWith(f.root, 'target', { focus: false });
  });
});


it.each([
  { hint: 1, text: 'target task', expectedLine: 3 },
  { hint: 900, text: 'target task', expectedLine: 3 },
  { hint: 1, text: 'deleted task', expectedLine: null }
])('verifies pending task text when the saved editor hint is $hint ($text)', async ({ hint, text, expectedLine }) => {
  const { resolveEditorTextTarget } = await vi.importActual<typeof import('./navigation')>('./navigation');
  const doc = Text.of(['unrelated content', '', '- [ ] target task']);
  let focused: number | null = null;
  vi.mocked(revealEditorTextTarget).mockImplementation((_root, query, options) => {
    focused = resolveEditorTextTarget(doc, query, options?.preferredLine);
    return focused !== null;
  });
  const f = fixture();
  await navigateToPendingTaskTarget(f.getContext(), {
    noteId: 'a', notePath: '/vault/a.md', text, lineNumber: hint,
    editorLineNumber: hint, sectionLabel: 'Old section'
  });
  expect(focused).toBe(expectedLine === null ? null : doc.line(expectedLine).from);
  expect(focusEditorAtDocumentLine).not.toHaveBeenCalled();
});
