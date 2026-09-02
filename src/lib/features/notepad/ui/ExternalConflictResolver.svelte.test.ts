import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ExternalConflictResolver from './ExternalConflictResolver.svelte';

describe('ExternalConflictResolver committed history warning', () => {
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
