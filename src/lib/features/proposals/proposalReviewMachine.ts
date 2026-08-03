export interface ProposalReviewIdentity {
  reviewId: string;
  proposalId: string;
  notePath: string;
}

export type ProposalReviewRecoveryPhase = 'reviewing' | 'conflicted';

export interface ProposalReviewContext<TReview> {
  identity: ProposalReviewIdentity;
  review: TReview;
  error: string | null;
}

type StableState<TReview> = ProposalReviewContext<TReview> & {
  kind: ProposalReviewRecoveryPhase;
};
type ConfirmingDiscardState<TReview> = ProposalReviewContext<TReview> & {
  kind: 'confirmingDiscard';
  recoverTo: ProposalReviewRecoveryPhase;
};
type ResolvingState<TReview> = ProposalReviewContext<TReview> & {
  kind: 'committing' | 'dismissing';
  recoverTo: ProposalReviewRecoveryPhase;
  reason?: 'proposal' | 'reload';
};

export type ProposalReviewWorkflowState<TReview> =
  | { kind: 'idle'; error: string | null }
  | {
      kind: 'opening';
      identity: ProposalReviewIdentity;
      review: TReview | null;
      error: string | null;
    }
  | StableState<TReview>
  | ConfirmingDiscardState<TReview>
  | ResolvingState<TReview>;

export type ProposalReviewWorkflowEvent<TReview> =
  | { type: 'openRequested'; identity: ProposalReviewIdentity }
  | { type: 'openPrepared'; identity: ProposalReviewIdentity; review: TReview }
  | { type: 'openSucceeded'; identity: ProposalReviewIdentity }
  | { type: 'openFailed'; identity: ProposalReviewIdentity; error: string }
  | { type: 'errorSet'; reviewId: string | null; error: string | null }
  | { type: 'resolutionRequested'; reviewId: string; resolution: 'commit' | 'dismiss' }
  | { type: 'completionConflicted'; reviewId: string; error: string }
  | { type: 'completionFailed'; reviewId: string; error: string }
  | { type: 'completionSucceeded'; reviewId: string }
  | { type: 'externalConflict'; reviewId: string; error: string }
  | { type: 'discardCancelled'; reviewId: string }
  | { type: 'discardRequested'; reviewId: string; confirmationMessage: string };

export function createProposalReviewWorkflowState<TReview>(): ProposalReviewWorkflowState<TReview> {
  return { kind: 'idle', error: null };
}

function sameIdentity(
  left: ProposalReviewIdentity,
  right: ProposalReviewIdentity
) {
  return left.reviewId === right.reviewId &&
    left.proposalId === right.proposalId &&
    left.notePath === right.notePath;
}

function context<TReview>(
  state:
    | StableState<TReview>
    | ConfirmingDiscardState<TReview>
    | ResolvingState<TReview>,
  error: string | null = state.error
): ProposalReviewContext<TReview> {
  return {
    identity: state.identity,
    review: state.review,
    error
  };
}

export function transitionProposalReviewWorkflow<TReview>(
  state: ProposalReviewWorkflowState<TReview>,
  event: ProposalReviewWorkflowEvent<TReview>
): ProposalReviewWorkflowState<TReview> {
  switch (event.type) {
    case 'openRequested':
      return state.kind === 'idle' ||
        state.kind === 'reviewing' ||
        state.kind === 'conflicted' ||
        state.kind === 'confirmingDiscard'
        ? { kind: 'opening', identity: event.identity, review: null, error: null }
        : state;
    case 'openPrepared':
      return state.kind === 'opening' && sameIdentity(state.identity, event.identity)
        ? { ...state, review: event.review }
        : state;
    case 'openSucceeded':
      return state.kind === 'opening' && state.review &&
        sameIdentity(state.identity, event.identity)
        ? {
            kind: 'reviewing',
            identity: state.identity,
            review: state.review,
            error: null
          }
        : state;
    case 'openFailed':
      return state.kind === 'opening' && sameIdentity(state.identity, event.identity)
        ? { kind: 'idle', error: event.error }
        : state;
    case 'errorSet':
      if (state.kind === 'idle') {
        return event.reviewId === null ? { ...state, error: event.error } : state;
      }
      if (
        state.kind === 'confirmingDiscard' &&
        event.reviewId === state.identity.reviewId
      ) {
        return {
          kind: state.recoverTo,
          ...context(state, event.error)
        };
      }
      return event.reviewId === state.identity.reviewId
        ? { ...state, error: event.error }
        : state;
    case 'resolutionRequested':
      if (
        (state.kind !== 'reviewing' &&
          state.kind !== 'conflicted' &&
          state.kind !== 'confirmingDiscard') ||
        event.reviewId !== state.identity.reviewId
      ) return state;
      const recoverTo = state.kind === 'confirmingDiscard'
        ? state.recoverTo
        : state.kind;
      return event.resolution === 'commit'
        ? { kind: 'committing', ...context(state, null), recoverTo }
        : {
            kind: 'dismissing',
            ...context(state, null),
            recoverTo,
            reason: 'proposal'
          };
    case 'completionConflicted':
      return state.kind === 'committing' && event.reviewId === state.identity.reviewId
        ? { kind: 'conflicted', ...context(state, event.error) }
        : state;
    case 'completionFailed':
      if (
        (state.kind !== 'committing' && state.kind !== 'dismissing') ||
        event.reviewId !== state.identity.reviewId
      ) return state;
      return { kind: state.recoverTo, ...context(state, event.error) };
    case 'completionSucceeded':
      return (state.kind === 'committing' || state.kind === 'dismissing') &&
        event.reviewId === state.identity.reviewId
        ? { kind: 'idle', error: null }
        : state;
    case 'externalConflict':
      return (state.kind === 'reviewing' ||
        state.kind === 'conflicted' ||
        state.kind === 'confirmingDiscard') &&
        event.reviewId === state.identity.reviewId
        ? { kind: 'conflicted', ...context(state, event.error) }
        : state;
    case 'discardCancelled':
      return state.kind === 'confirmingDiscard' &&
        event.reviewId === state.identity.reviewId
        ? { kind: state.recoverTo, ...context(state, null) }
        : state;
    case 'discardRequested':
      if (
        state.kind === 'idle' ||
        event.reviewId !== state.identity.reviewId
      ) return state;
      if (state.kind === 'confirmingDiscard') {
        return {
          kind: 'dismissing',
          ...context(state, null),
          recoverTo: state.recoverTo,
          reason: 'reload'
        };
      }
      return state.kind === 'reviewing' || state.kind === 'conflicted'
        ? {
            kind: 'confirmingDiscard',
            ...context(state, event.confirmationMessage),
            recoverTo: state.kind
          }
        : state;
    default:
      return assertNeverProposalReviewEvent(event);
  }
}

function assertNeverProposalReviewEvent(value: never): never {
  throw new Error(`Unhandled proposal-review event: ${String(value)}`);
}
