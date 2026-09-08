import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ExternalConflictResolver from './ExternalConflictResolver.svelte';

describe('ExternalConflictResolver committed history warning', () => {
  it('surfaces a canonical collision without offering a destructive winner action', () => {
    const body = render(ExternalConflictResolver, {
      props: {
        status: {
          kind: 'canonicalCollision',
          label: 'Saved note is open in another draft',
          path: '/vault/Saved.md'
        },
        onKeepMyEdits: vi.fn(),
        onLoadDiskVersion: vi.fn(),
        onCopyMyEdits: vi.fn()
      }
    }).body;

    expect(body).toContain('Open document collision');
    expect(body).toContain('Both drafts were kept');
    expect(body).toContain('match its saved version');
    expect(body).toContain('close that pane');
    expect(body).not.toContain('Keep my edits');
    expect(body).not.toContain('Load disk version');
  });

  it('shows that Markdown was saved and points to the explicit retry path', () => {
    const body = render(ExternalConflictResolver, {
      props: {
        status: {
          kind: 'warning',
          label: 'History finalization is pending.',
          hasUnsavedChanges: false,
          repairAction: 'historySettings'
        },
        onKeepMyEdits: vi.fn(),
        onLoadDiskVersion: vi.fn(),
        onCopyMyEdits: vi.fn()
      }
    }).body;

    expect(body).toContain('Saved to Markdown');
    expect(body).toContain('History finalization is pending.');
    expect(body).toContain('Retry history from Settings.');
  });

  it('does not send unrelated projection failures to history recovery', () => {
    const body = render(ExternalConflictResolver, {
      props: {
        status: {
          kind: 'warning',
          label: 'Task projection is pending.',
          hasUnsavedChanges: false,
          repairAction: 'automatic'
        },
        onKeepMyEdits: vi.fn(),
        onLoadDiskVersion: vi.fn(),
        onCopyMyEdits: vi.fn()
      }
    }).body;

    expect(body).toContain('The app will keep retrying');
    expect(body).not.toContain('Retry history from Settings.');
  });
});

it('shows pending unsaved work without disabling editor interaction or claiming Saved', () => {
  const body = render(ExternalConflictResolver, { props: {
    status: { kind: 'busy', historyWaiting: true, label: 'Unsaved changes — checking this note’s history before saving…' },
    onKeepMyEdits: vi.fn(), onLoadDiskVersion: vi.fn(), onCopyMyEdits: vi.fn()
  } }).body;
  expect(body).toContain('Unsaved changes');
  expect(body).toContain('role="status"');
  expect(body).toContain('pointer-events-none');
  expect(body).not.toContain('Saved');
  expect(body).not.toContain('disabled');
});
