import type { PaneKind } from './paneTypes';

export const PANE_CAPABILITIES = [
  'edit-document',
  'edit-title',
  'host-editor-transient-ui',
  'host-chat'
] as const;

export type PaneCapability =
  (typeof PANE_CAPABILITIES)[number];

export type PaneCapabilityPolicy =
  | Readonly<{
      kind: 'editor';
      documentMode: 'editable';
      titleMode: 'document';
      capabilities: Readonly<Record<PaneCapability, boolean>>;
    }>
  | Readonly<{
      kind: 'chat';
      documentMode: 'retained-context';
      titleMode: 'fixed';
      capabilities: Readonly<Record<PaneCapability, boolean>>;
    }>;

const POLICY_BY_KIND: Readonly<
  Record<PaneKind, PaneCapabilityPolicy>
> = {
  editor: {
    kind: 'editor',
    documentMode: 'editable',
    titleMode: 'document',
    capabilities: {
      'edit-document': true,
      'edit-title': true,
      'host-editor-transient-ui': true,
      'host-chat': false
    }
  },
  chat: {
    kind: 'chat',
    documentMode: 'retained-context',
    titleMode: 'fixed',
    capabilities: {
      'edit-document': false,
      'edit-title': false,
      'host-editor-transient-ui': false,
      'host-chat': true
    }
  }
};

/**
 * Canonical policy for behavior that varies by pane kind.
 *
 * Consumers should ask this policy about behavior instead of growing new
 * `kind === "editor"` or `kind === "chat"` capability predicates.
 */
export function getPaneCapabilityPolicy(
  kind: PaneKind
): PaneCapabilityPolicy {
  return POLICY_BY_KIND[kind];
}

export function paneHasCapability(
  kind: PaneKind,
  capability: PaneCapability
): boolean {
  return getPaneCapabilityPolicy(kind).capabilities[
    capability
  ];
}

export interface PaneCapabilityWorkspace<
  TPaneId extends string
> {
  paneOrder: readonly TPaneId[];
  getPaneKind: (paneId: TPaneId) => PaneKind;
}

export function getPaneIdsWithCapability<
  TPaneId extends string
>(
  paneOrder: readonly TPaneId[],
  getPaneKind: (paneId: TPaneId) => PaneKind,
  capability: PaneCapability
): TPaneId[] {
  return paneOrder.filter((paneId) =>
    paneHasCapability(getPaneKind(paneId), capability)
  );
}

/**
 * Selects by visual pane-order distance. Equal-distance ties retain pane order.
 */
export function getNearestPaneIdWithCapability<
  TPaneId extends string
>(
  paneOrder: readonly TPaneId[],
  getPaneKind: (paneId: TPaneId) => PaneKind,
  fromPaneId: TPaneId,
  capability: PaneCapability
): TPaneId | null {
  const fromIndex = paneOrder.indexOf(fromPaneId);
  const candidates = getPaneIdsWithCapability(
    paneOrder,
    getPaneKind,
    capability
  );
  if (fromIndex === -1) return candidates[0] ?? null;

  let nearest: TPaneId | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(
      paneOrder.indexOf(candidate) - fromIndex
    );
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * A kind transition is allowed only when it preserves a pane capable of
 * editing documents. Same-kind transitions are harmless and remain allowed.
 */
export function canSetPaneKind<TPaneId extends string>(
  workspace: PaneCapabilityWorkspace<TPaneId>,
  paneId: TPaneId,
  nextKind: PaneKind
): boolean {
  if (!workspace.paneOrder.includes(paneId)) return false;
  return workspace.paneOrder.some((candidate) => {
    const candidateKind =
      candidate === paneId
        ? nextKind
        : workspace.getPaneKind(candidate);
    return paneHasCapability(
      candidateKind,
      'edit-document'
    );
  });
}

/**
 * A pane may be removed only when another pane remains and the resulting
 * workspace still has a document-editing pane.
 */
export function canRemovePane<TPaneId extends string>(
  workspace: PaneCapabilityWorkspace<TPaneId>,
  paneId: TPaneId
): boolean {
  if (
    workspace.paneOrder.length <= 1 ||
    !workspace.paneOrder.includes(paneId)
  ) {
    return false;
  }
  return workspace.paneOrder.some(
    (candidate) =>
      candidate !== paneId &&
      paneHasCapability(
        workspace.getPaneKind(candidate),
        'edit-document'
      )
  );
}
