import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ForgottenNotesPanel from './ForgottenNotesPanel.svelte';

describe('ForgottenNotesPanel', () => {
  it('makes permanent note purge and complete timeline deletion explicit', () => {
    const body = render(ForgottenNotesPanel, {
      props: {
        forgottenNotes: [
          {
            kind: 'note',
            title: 'Old draft',
            fileName: 'Old draft.md',
            originalPath: '/vault/Old draft.md',
            forgottenPath: '/vault/.forgotten/old-draft',
            forgottenAtMillis: 1_800_000_000_000,
            purgeAfterDays: 30,
            purgeAtMillis: 1_802_592_000_000
          }
        ],
        allForgottenSelected: false,
        selectedForgottenPaths: [],
        isLoadingForgottenNotes: false,
        isUpdatingForgottenNotes: false,
        loadForgottenNotes: vi.fn(),
        runForgottenAction: vi.fn(),
        toggleForgottenSelection: vi.fn(),
        toggleAllForgottenSelections: vi.fn(),
        formatTimestamp: () => 'Sep 2, 2026',
        formatForgottenRetention: () => '30 days'
      }
    }).body;

    expect(body).toContain('Permanently delete');
    expect(body).toContain('complete Note Timeline');
    expect(body).toContain('cannot be undone');
    expect(body).not.toContain('>Delete selected<');
    expect(body).not.toContain('>Delete<');
  });
});
