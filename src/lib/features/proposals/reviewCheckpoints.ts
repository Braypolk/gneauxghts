import type { ProposalReviewRuntime, ProposalWorkingState } from './types';

interface CheckpointQueue {
  pending: ProposalWorkingState | null;
  completion: Promise<void>;
}

// The retained review can outlive a route coordinator. Share serialization for
// that lifetime, and retain only the newest waiting snapshot during slow I/O.
const queues = new WeakMap<ProposalReviewRuntime, CheckpointQueue>();

export function checkpointProposalReview(
  review: ProposalReviewRuntime,
  working: ProposalWorkingState
): Promise<void> {
  const existing = queues.get(review);
  if (existing) {
    existing.pending = { ...working,
      requestedPath: working.requestedPath ?? existing.pending?.requestedPath };

    return existing.completion;
  }

  const queue: CheckpointQueue = {
    pending: working,
    completion: Promise.resolve()
  };
  queues.set(review, queue);
  queue.completion = Promise.resolve().then(async () => {
    let failed = false;
    let failure: unknown;
    let locationFailed = false;
    let locationFailure: unknown;
    try {
      while (queue.pending) {
        const snapshot = queue.pending;
        queue.pending = null;
        try {
          await review.request.checkpoint?.(snapshot);
          failed = false;
          if (snapshot.requestedPath !== undefined) locationFailed = false;
        } catch (error) {
          failed = true;
          failure = error;
          if (snapshot.requestedPath !== undefined) {
            locationFailed = true;
            locationFailure = error;
          }
        }
      }
      // A successful body write cannot acknowledge a location it never saved.
      if (locationFailed) throw locationFailure;
      if (failed) throw failure;
    } finally {
      queues.delete(review);
    }
  });
  return queue.completion;
}

export function awaitProposalCheckpoints(review: ProposalReviewRuntime): Promise<void> {
  return queues.get(review)?.completion ?? Promise.resolve();
}
