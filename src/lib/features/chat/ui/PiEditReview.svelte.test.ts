import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editDiffLayout } from '#lib/editDiffLayout.svelte.js';
import PiEditReview from './PiEditReview.svelte';
import { editReviewChanges } from './editReviewChanges';
import { stageNoteEdit } from '../pi/editStaging';
import { PI_CONTEXT } from '../pi/runtime';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';

const patch = `--- /note.md
+++ /note.md
@@ -5,7 +5,7 @@
   updated_at: 2026-10-17T20:04:25Z
   trashed_at: null
 ---
${' '}
-Walk for 20 minutes.
+Walk for 30 minutes.
 Buy milk.
 Call Sam on Friday.
\\ No newline at end of file
`;
const text = (parts: Array<{ text: string }>) => parts.map(part => part.text).join('');
const show = (value = patch, disabled = false) => render(PiEditReview, { props: {
  review: { taskId: 1, title: 'Edit check', kind: 'edit', patch: value, decision: 'pending' }, disabled, onDecision: vi.fn()
} }).body;

describe('readable edit reviews', () => {
  afterEach(() => editDiffLayout.setPreference('inline'));

  it('reviews a new note with its destination and complete escaped content', () => {
    const body = render(PiEditReview, { props: {
      review: { taskId: 1, title: 'Project plan', kind: 'create', decision: 'pending', destination: 'Projects/Project plan.md', markdown: '# Plan\n\n<script>untrusted</script>\n' }, onDecision: vi.fn()
    } }).body;
    expect(body).toContain('Create Project plan');
    expect(body).toContain('Projects/Project plan.md');
    expect(body).toContain('# Plan'); expect(body).toContain('&lt;script>'); expect(body).not.toContain('<script>');
    expect(body).toContain('Create note'); expect(body).toContain('Discard creation');
    expect(body).not.toContain('saved note');
    expect(body).not.toContain('Show technical diff');
  });

  it.each(['inline', 'side-by-side'] as const)('makes internal spaces, tabs and indentation visible in %s review', async layout => {
    editDiffLayout.setPreference(layout);
    for (const [before, after, marker] of [['Buy milk', 'Buy  milk', '··'], ['Buy milk', 'Buy\tmilk', '⇥'], ['  - Task', '    - Task', '····'], ['Buy milk', 'Buy\u00a0milk', '⍽']]) {
      const staged = await stageNoteEdit(`${before}\n`, [{ oldText: before, newText: after }], { taskId: 1 } as ToolExecutionApi, PI_CONTEXT);
      const change = editReviewChanges(staged.patch)![0];
      expect(change.spacingChanged).toBe(true);
      const main = show(staged.patch).split('<details')[0].replace(/<!--[\s\S]*?-->/g, '');
      expect(main).toContain('Spacing or line breaks changed.');
      const added = layout === 'inline' ? new RegExp(`<ins[^>]*>${marker}</ins>`) : new RegExp(`<mark[^>]*>${marker}</mark>`);
      expect(main).toMatch(added);
      expect(text(change.before)).toBe(`${before}\n`);
      expect(text(change.after)).toBe(`${after}\n`);
    }
  });

  it.each(['inline', 'side-by-side'] as const)('shows identifying section context in %s without changing the reviewed text', async layout => {
    editDiffLayout.setPreference(layout);
    const staged = await stageNoteEdit('# First project\n\nStatus: Open\n\n# Second project\n\nStatus: Open\n', [{ oldText: '# Second project\n\nStatus: Open', newText: '# Second project\n\nStatus: Closed' }], { taskId: 1 } as ToolExecutionApi, PI_CONTEXT);
    const change = editReviewChanges(staged.patch)![0];
    const main = show(staged.patch).split('<details')[0];
    expect(main).toContain('Second project');
    expect(main).not.toContain('First project');
    expect(text(change.before)).toBe('Status: Open\n');
    expect(text(change.after)).toBe('Status: Closed\n');
  });

  it('defaults to inline with unchanged text shown once and both edits visible', () => {
    const main = show().split('<details')[0].replace(/<!--[\s\S]*?-->/g, '');
    expect(main).toContain('data-layout="inline"');
    expect(main).toMatch(/<del[^>]*>20<\/del>/);
    expect(main).toMatch(/<ins[^>]*>30<\/ins>/);
    expect(main.match(/Walk for/g)).toHaveLength(1);
    expect(main.match(/minutes\./g)).toHaveLength(1);
    expect(main).not.toContain('pi-edit-before');
    const change = editReviewChanges(patch)![0];
    expect(text(change.inline.filter(part => part.kind !== 'added'))).toBe(text(change.before));
    expect(text(change.inline.filter(part => part.kind !== 'removed'))).toBe(text(change.after));
  });
  it.each([
    ['inline', ''], ['inline', '\n'], ['side-by-side', ''], ['side-by-side', '\n']
  ] as const)('highlights separate replacements without joining the old and new lines in %s (final newline %j)', async (layout, ending) => {
    editDiffLayout.setPreference(layout);
    const before = `chuck went to bed\nhe woke up at 6am${ending}`;
    const after = `Tim went to bed\nhe woke up at 8am${ending}`;
    const staged = await stageNoteEdit(before, [
      { oldText: 'chuck', newText: 'Tim' },
      { oldText: '6am', newText: '8am' }
    ], { taskId: 1 } as ToolExecutionApi, PI_CONTEXT);
    const change = editReviewChanges(staged.patch)![0];
    expect(staged.markdown).toBe(after);
    expect(change.before.filter(part => part.changed).map(part => part.text)).toEqual(['chuck', '6am']);
    expect(change.after.filter(part => part.changed).map(part => part.text)).toEqual(['Tim', '8am']);
    expect(text(change.inline.filter(part => part.kind !== 'added'))).toBe(before);
    expect(text(change.inline.filter(part => part.kind !== 'removed'))).toBe(after);
    const main = show(staged.patch).split('<details')[0].replace(/<!--[\s\S]*?-->/g, '');
    if (layout === 'inline') {
      expect(main).toMatch(/<del[^>]*>chuck<\/del><ins[^>]*>Tim<\/ins> went to bed\nhe woke up at <del[^>]*>6am<\/del><ins[^>]*>8am<\/ins>/);
    } else {
      expect(main).toMatch(/<mark[^>]*>chuck<\/mark> went to bed\nhe woke up at <mark[^>]*>6am<\/mark>/);
      expect(main).toMatch(/<mark[^>]*>Tim<\/mark> went to bed\nhe woke up at <mark[^>]*>8am<\/mark>/);
    }
  });
  it('shows the exact changed sentence with just the changed words highlighted', () => {
    editDiffLayout.setPreference('side-by-side');
    const changes = editReviewChanges(patch)!;
    expect(changes).toHaveLength(1);
    expect(text(changes[0].before)).toBe('Walk for 20 minutes.\n');
    expect(text(changes[0].after)).toBe('Walk for 30 minutes.\n');
    expect(changes[0].before.filter(part => part.changed).map(part => part.text)).toEqual(['20']);
    expect(changes[0].after.filter(part => part.changed).map(part => part.text)).toEqual(['30']);
    const body = show(), main = body.split('<details')[0];
    expect(main).toContain('data-layout="side-by-side"');
    expect(main).toContain('Before'); expect(main).toContain('After');
    expect(main).toContain('20</mark>'); expect(main).toContain('30</mark>');
    for (const noise of ['updated_at', 'trashed_at', '/note.md', '@@', 'No newline', 'Buy milk']) expect(main).not.toContain(noise);
    expect(body).toContain('Show technical diff'); expect(body).toContain('updated_at');
    expect(body).not.toMatch(/<details[^>]*\sopen(?:\s|>)/);
  });
  it('preserves added and deleted paragraphs, blank lines, and separated hunks', () => {
    const changes = editReviewChanges('--- /note.md\n+++ /note.md\n@@ -1,2 +1,3 @@\n-Old paragraph\n+New paragraph\n+Extra line\n context\n@@ -20,2 +21,0 @@\n-Removed paragraph\n-\n@@ -25,0 +25,1 @@\n+\n')!;
    expect(changes).toHaveLength(3);
    expect(text(changes[0].after)).toBe('New paragraph\nExtra line\n');
    expect(text(changes[1].before)).toBe('Removed paragraph\n\n'); expect(changes[1].after).toEqual([]);
    expect(changes[2].before).toEqual([]); expect(text(changes[2].after)).toBe('\n');
    for (const change of changes) {
      expect(text(change.inline.filter(part => part.kind !== 'added'))).toBe(text(change.before));
      expect(text(change.inline.filter(part => part.kind !== 'removed'))).toBe(text(change.after));
    }
    expect(show('--- a\n+++ b\n@@ -0,0 +1,2 @@\n+\n+\n')).toContain('2 blank lines');
  });
  it('retains changed Markdown, property lines and patch-like text as escaped plain text', () => {
    const value = '--- a\n+++ b\n@@ -1,3 +1,3 @@\n-project: old\n---- heading\n-<script>alert(1)</script>\n+project: new\n++++ heading\n+<img src=x onerror=alert(1)>\n';
    const changes = editReviewChanges(value)!;
    expect(text(changes[0].before)).toContain('--- heading'); expect(text(changes[0].after)).toContain('+++ heading');
    const body = show(value);
    expect(body).not.toContain('<script>'); expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img'); expect(body).toContain('project:');
  });
  it.each(['bad patch', '--- a\n+++ b\n@@ -1,2 +1,1 @@\n-old\n+new\n', '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\nunexpected'])('shows the original patch if it cannot be fully presented: %j', value => {
    expect(editReviewChanges(value)).toBeNull();
    const body = show(value); expect(body).toContain('Review the detailed changes below.'); expect(body).not.toContain('Show technical diff');
  });
  it('keeps both decision controls disabled when publication is unavailable', () => {
    expect(show(patch, true).match(/disabled/g)).toHaveLength(2);
  });
  it('falls back to the complete technical patch when word comparison exceeds its work limit', () => {
    const value = `--- a\n+++ b\n@@ -1 +1 @@\n-old\n+${'new '.repeat(600)}\n`;
    expect(editReviewChanges(value)).toBeNull();
    const body = show(value);
    expect(body).toContain('Review the detailed changes below.');
    expect(body).toContain('new '.repeat(600));
  });
  it('makes an otherwise invisible final line break change explicit', () => {
    const value = '--- a\n+++ b\n@@ -1 +1 @@\n-Same text\n\\ No newline at end of file\n+Same text\n';
    const changes = editReviewChanges(value)!;
    expect(text(changes[0].before)).toBe('Same text'); expect(text(changes[0].after)).toBe('Same text\n');
    expect(show(value).split('<details')[0]).toContain('Spacing or line breaks changed.');
  });
});
