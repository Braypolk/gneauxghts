import { describe, expect, it } from 'vitest';
import {
  availableExclusionCandidates,
  sortedExcludedPolicies
} from './excludedNotes';

describe('excluded note settings', () => {
  const policies = [
    {
      noteId: 'note-b',
      notePath: 'Private/Beta.md',
      title: 'Beta',
      disposition: 'excluded' as const,
      updatedAtMillis: 2
    },
    {
      noteId: 'note-approved',
      notePath: 'Shared.md',
      title: 'Shared',
      disposition: 'approved' as const,
      updatedAtMillis: 3
    },
    {
      noteId: 'note-a',
      notePath: 'Private/Alpha.md',
      title: 'Alpha',
      disposition: 'excluded' as const,
      updatedAtMillis: 1
    }
  ];

  it('shows only exclusions and sorts them by title', () => {
    expect(sortedExcludedPolicies(policies).map((policy) => policy.noteId)).toEqual([
      'note-a',
      'note-b'
    ]);
  });

  it('removes already excluded notes from add-search results', () => {
    const candidates = [
      { noteId: 'note-a', notePath: 'Private/Alpha.md', title: 'Alpha' },
      { noteId: 'note-c', notePath: 'Projects/Charlie.md', title: 'Charlie' }
    ];

    expect(availableExclusionCandidates(candidates, policies)).toEqual([
      candidates[1]
    ]);
  });
});
