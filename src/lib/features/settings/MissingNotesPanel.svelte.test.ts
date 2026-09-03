import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import MissingNotesPanel from './MissingNotesPanel.svelte';

describe('MissingNotesPanel', () => {
  it('exposes the retained timeline and safe recovery lifecycle', () => {
    const body = render(MissingNotesPanel, {
      props: {
        missingNotes: [
          {
            noteId: 'missing-1',
            path: '/vault/Ideas.md',
            title: 'Ideas',
            fileName: 'Ideas.md',
            missingAtMillis: 1_800_000_000_000,
            retentionDays: 7,
            purgeAtMillis: 1_800_604_800_000,
            timeline: {
              nextCursor: null,
              records: [
                {
                  kind: 'lifecycleEvent',
                  recordId: 'missing-event',
                  eventId: 'missing-event',
                  eventKind: 'missing',
                  occurredAtMillis: 1_800_000_000_000,
                  timelineOrdinal: 2,
                  previousPath: null,
                  path: '/vault/Ideas.md'
                },
                {
                  kind: 'revision',
                  recordId: 'revision-1',
                  revisionId: 'revision-1',
                  source: 'editor',
                  occurredAtMillis: 1_799_000_000_000,
                  timelineOrdinal: 1,
                  timeKind: 'committed',
                  modifiedAtMillis: null,
                  editingSessionId: null,
                  revisionLabel: 'Before deletion',
                  lineCount: 12,
                  characterCount: 480
                }
              ]
            }
          }
        ],
        isLoading: false,
        isUpdating: false,
        actionMessage: null,
        actionError: null,
        loadMissingNotes: vi.fn(),
        recoverMissingNote: vi.fn(),
        deleteMissingNote: vi.fn(),
        formatTimestamp: () => 'Sep 3, 2026',
        formatForgottenRetention: () => '7 days'
      }
    }).body;

    expect(body).toContain('Missing Notes');
    expect(body).toContain('Before deletion');
    expect(body).toContain('Editor revision');
    expect(body).toContain('Recover');
    expect(body).toContain('Permanently delete');
    expect(body).toContain('will not overwrite');
  });
});
