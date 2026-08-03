export type PaneNavigationTransitionKind =
  | 'split-pane'
  | 'close-pane'
  | 'switch-pane'
  | 'change-pane-kind'
  | 'open-note'
  | 'new-note'
  | 'restore-location'
  | 'pane-command';

export type PaneNavigationTransitionPhase =
  | 'resolved'
  | 'guarded'
  | 'document-departed'
  | 'history-captured'
  | 'prepared'
  | 'workspace-mutated'
  | 'editors-ensured'
  | 'completed'
  | 'focused';

export type PaneNavigationTransitionStatus =
  | 'applied'
  | 'noop'
  | 'blocked'
  | 'missing-target'
  | 'stale'
  | 'failed';

export interface PaneNavigationTransitionOutcome<
  TPaneId extends string
> {
  operationId: number;
  kind: PaneNavigationTransitionKind;
  paneId: TPaneId | null;
  status: PaneNavigationTransitionStatus;
  reason?: string;
  error?: unknown;
  phases: PaneNavigationTransitionPhase[];
}

export type PaneNavigationGuard =
  | { status: 'allow' }
  | { status: 'noop'; reason?: string }
  | { status: 'blocked'; reason: string };

export interface PaneNavigationTransitionRequest<
  TPaneId extends string
> {
  kind: PaneNavigationTransitionKind;
  resolvePane: () => TPaneId | null;
  onResolved?: (
    paneId: TPaneId,
    operationId: number
  ) => void | Promise<void>;
  guard?: (paneId: TPaneId, operationId: number) =>
    | PaneNavigationGuard
    | Promise<PaneNavigationGuard>;
  /**
   * Establishes the document's authoritative persisted identity and saves its
   * cursor before history observes the location being left.
   */
  departDocument?: (paneId: TPaneId) => void | Promise<void>;
  captureHistory?: (paneId: TPaneId) => void | Promise<void>;
  prepare?: (paneId: TPaneId) => void | Promise<void>;
  isCurrent?: (paneId: TPaneId) => boolean;
  mutateWorkspace?: (paneId: TPaneId) => void | Promise<void>;
  ensureEditors?: boolean;
  complete?: (paneId: TPaneId) => void | Promise<void>;
  focus?: (paneId: TPaneId) => void | Promise<void>;
  onStale?: (paneId: TPaneId) => void | Promise<void>;
  onFailed?: (
    paneId: TPaneId,
    error: unknown
  ) => void | Promise<void>;
  /**
   * Composite transitions such as history restoration delegate to an
   * `open-note` transition. They participate in the phase pipeline without
   * superseding that nested pane operation.
   */
  trackLatestForPane?: boolean;
}

export interface PaneNavigationTransitionPipelineDeps {
  assertWorkspaceInvariants: () => void;
  ensurePaneEditors: () => Promise<void>;
}

/**
 * Runs every pane/navigation mutation through one observable phase order.
 * Policy stays in the callers, while ordering, stale-result rejection and
 * deterministic outcomes live here.
 */
export function createPaneNavigationTransitionPipeline<
  TPaneId extends string
>(deps: PaneNavigationTransitionPipelineDeps) {
  let nextOperationId = 0;
  const latestOperationByPane = new Map<TPaneId, number>();

  function outcome(
    operationId: number,
    request: PaneNavigationTransitionRequest<TPaneId>,
    paneId: TPaneId | null,
    status: PaneNavigationTransitionStatus,
    phases: PaneNavigationTransitionPhase[],
    details: { reason?: string; error?: unknown } = {}
  ): PaneNavigationTransitionOutcome<TPaneId> {
    return {
      operationId,
      kind: request.kind,
      paneId,
      status,
      phases,
      ...details
    };
  }

  async function execute(
    request: PaneNavigationTransitionRequest<TPaneId>
  ): Promise<PaneNavigationTransitionOutcome<TPaneId>> {
    const operationId = ++nextOperationId;
    const phases: PaneNavigationTransitionPhase[] = [];
    const paneId = request.resolvePane();
    if (!paneId) {
      return outcome(
        operationId,
        request,
        null,
        'missing-target',
        phases,
        { reason: 'No target pane could be resolved.' }
      );
    }
    phases.push('resolved');

    const trackLatest = request.trackLatestForPane ?? true;
    if (trackLatest) {
      latestOperationByPane.set(paneId, operationId);
    }
    const isCurrent = () =>
      (!trackLatest ||
        latestOperationByPane.get(paneId) === operationId) &&
      (request.isCurrent?.(paneId) ?? true);

    try {
      await request.onResolved?.(paneId, operationId);
      const guard =
        (await request.guard?.(paneId, operationId)) ??
        ({ status: 'allow' } as const);
      if (guard.status !== 'allow') {
        return outcome(
          operationId,
          request,
          paneId,
          guard.status,
          phases,
          { reason: guard.reason }
        );
      }
      phases.push('guarded');

      await request.departDocument?.(paneId);
      if (request.departDocument) {
        phases.push('document-departed');
      }
      if (!isCurrent()) {
        await request.onStale?.(paneId);
        return outcome(
          operationId,
          request,
          paneId,
          'stale',
          phases,
          { reason: 'A newer pane transition superseded this result.' }
        );
      }

      await request.captureHistory?.(paneId);
      if (request.captureHistory) {
        phases.push('history-captured');
      }

      await request.prepare?.(paneId);
      if (request.prepare) {
        phases.push('prepared');
      }
      if (!isCurrent()) {
        await request.onStale?.(paneId);
        return outcome(
          operationId,
          request,
          paneId,
          'stale',
          phases,
          { reason: 'A newer pane transition superseded this result.' }
        );
      }

      await request.mutateWorkspace?.(paneId);
      if (request.mutateWorkspace) {
        deps.assertWorkspaceInvariants();
        phases.push('workspace-mutated');
      }

      if (request.ensureEditors) {
        await deps.ensurePaneEditors();
        phases.push('editors-ensured');
      }
      if (!isCurrent()) {
        await request.onStale?.(paneId);
        return outcome(
          operationId,
          request,
          paneId,
          'stale',
          phases,
          { reason: 'A newer pane transition superseded this result.' }
        );
      }

      await request.complete?.(paneId);
      if (request.complete) {
        phases.push('completed');
      }
      if (!isCurrent()) {
        await request.onStale?.(paneId);
        return outcome(
          operationId,
          request,
          paneId,
          'stale',
          phases,
          { reason: 'A newer pane transition superseded this result.' }
        );
      }

      await request.focus?.(paneId);
      if (request.focus) {
        phases.push('focused');
      }
      return outcome(
        operationId,
        request,
        paneId,
        'applied',
        phases
      );
    } catch (error) {
      await request.onFailed?.(paneId, error);
      return outcome(
        operationId,
        request,
        paneId,
        'failed',
        phases,
        { error }
      );
    }
  }

  return {
    execute,
    getLatestOperationId: (paneId: TPaneId) =>
      latestOperationByPane.get(paneId) ?? null
  };
}

export type PaneNavigationTransitionPipeline<
  TPaneId extends string
> = ReturnType<
  typeof createPaneNavigationTransitionPipeline<TPaneId>
>;
