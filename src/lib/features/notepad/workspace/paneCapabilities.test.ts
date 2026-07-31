import { describe, expect, it } from 'vitest';
import {
  PANE_CAPABILITIES,
  canRemovePane,
  canSetPaneKind,
  getNearestPaneIdWithCapability,
  getPaneCapabilityPolicy,
  getPaneIdsWithCapability,
  paneHasCapability,
  type PaneCapability
} from './paneCapabilities';
import type { PaneKind } from './paneTypes';

const expectedCapabilities: Record<
  PaneKind,
  Record<PaneCapability, boolean>
> = {
  editor: {
    'edit-document': true,
    'edit-title': true,
    'host-editor-transient-ui': true,
    'host-chat': false
  },
  chat: {
    'edit-document': false,
    'edit-title': false,
    'host-editor-transient-ui': false,
    'host-chat': true
  }
};

describe('pane capability policy', () => {
  it.each(['editor', 'chat'] satisfies PaneKind[])(
    'defines every capability for %s panes',
    (kind) => {
      const policy = getPaneCapabilityPolicy(kind);

      expect(Object.keys(policy.capabilities).sort()).toEqual(
        [...PANE_CAPABILITIES].sort()
      );
      for (const capability of PANE_CAPABILITIES) {
        expect(paneHasCapability(kind, capability)).toBe(
          expectedCapabilities[kind][capability]
        );
      }
    }
  );

  it.each(PANE_CAPABILITIES)(
    'selects every pane with %s through the policy table',
    (capability) => {
      const order = ['left', 'middle', 'right'] as const;
      const kindsById = {
        left: 'editor',
        middle: 'chat',
        right: 'editor'
      } satisfies Record<
        (typeof order)[number],
        PaneKind
      >;
      const expected = expectedCapabilities.editor[
        capability
      ]
        ? ['left', 'right']
        : ['middle'];

      expect(
        getPaneIdsWithCapability(
          order,
          (paneId) => kindsById[paneId],
          capability
        )
      ).toEqual(expected);
    }
  );

  it('selects the nearest capable pane with stable pane-order ties', () => {
    const order = ['left', 'middle', 'right'] as const;
    const kindsById = {
      left: 'editor',
      middle: 'chat',
      right: 'editor'
    } satisfies Record<
      (typeof order)[number],
      PaneKind
    >;

    expect(
      getNearestPaneIdWithCapability(
        order,
        (paneId) => kindsById[paneId],
        'middle',
        'edit-document'
      )
    ).toBe('left');
  });

  it.each([
    {
      name: 'single editor can become chat',
      kinds: ['editor'] as PaneKind[],
      paneId: 'p1',
      nextKind: 'chat' as PaneKind,
      expected: true
    },
    {
      name: 'editor can become chat when another editor remains',
      kinds: ['editor', 'editor'] as PaneKind[],
      paneId: 'p1',
      nextKind: 'chat' as PaneKind,
      expected: true
    },
    {
      name: 'chat can become editor',
      kinds: ['editor', 'chat'] as PaneKind[],
      paneId: 'p2',
      nextKind: 'editor' as PaneKind,
      expected: true
    },
    {
      name: 'same-kind transition is allowed',
      kinds: ['editor'] as PaneKind[],
      paneId: 'p1',
      nextKind: 'editor' as PaneKind,
      expected: true
    },
    {
      name: 'unknown pane cannot transition',
      kinds: ['editor'] as PaneKind[],
      paneId: 'missing',
      nextKind: 'chat' as PaneKind,
      expected: false
    }
  ])('$name', ({ kinds, paneId, nextKind, expected }) => {
    const paneOrder = kinds.map((_, index) => `p${index + 1}`);
    const getPaneKind = (candidate: string) =>
      kinds[paneOrder.indexOf(candidate)] ?? 'chat';

    expect(
      canSetPaneKind(
        {
          paneOrder,
          getPaneKind
        },
        paneId,
        nextKind
      )
    ).toBe(expected);
  });

  it.each([
    {
      name: 'sole editor cannot be removed',
      kinds: ['editor'] as PaneKind[],
      paneId: 'p1',
      expected: false
    },
    {
      name: 'editor can be removed when another editor remains',
      kinds: ['editor', 'editor'] as PaneKind[],
      paneId: 'p1',
      expected: true
    },
    {
      name: 'chat can be removed while an editor remains',
      kinds: ['editor', 'chat'] as PaneKind[],
      paneId: 'p2',
      expected: true
    },
    {
      name: 'last editor can be removed when a chat remains',
      kinds: ['editor', 'chat'] as PaneKind[],
      paneId: 'p1',
      expected: true
    },
    {
      name: 'unknown pane cannot be removed',
      kinds: ['editor', 'chat'] as PaneKind[],
      paneId: 'missing',
      expected: false
    }
  ])('$name', ({ kinds, paneId, expected }) => {
    const paneOrder = kinds.map((_, index) => `p${index + 1}`);
    const getPaneKind = (candidate: string) =>
      kinds[paneOrder.indexOf(candidate)] ?? 'chat';

    expect(
      canRemovePane(
        {
          paneOrder,
          getPaneKind
        },
        paneId
      )
    ).toBe(expected);
  });
});
