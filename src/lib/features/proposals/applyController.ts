import type { ApplyNoteChangesResult } from '$lib/types/proposals';
import { applyNoteChangeProposal } from './api';
import type { ProposalReviewSession } from './reviewSession.svelte';
import type { PendingProposalChange } from './types';

export interface ProposalApplyHooks {
  /**
   * Called before Keep when the open note may be dirty vs proposal base.
   * Return an error message to block, or null to proceed.
   */
  assertCanKeep?: (change: PendingProposalChange) => string | null;
  /** After a successful keep — reload note / clear review buffer. */
  onKept?: (
    change: PendingProposalChange,
    result: ApplyNoteChangesResult
  ) => void | Promise<void>;
  /** After undo — restore editor if that note was showing the review. */
  onUndone?: (change: PendingProposalChange) => void | Promise<void>;
  /** After undo-all. */
  onUndoneAll?: () => void | Promise<void>;
}

export function createProposalApplyController(
  session: ProposalReviewSession,
  hooks: ProposalApplyHooks = {}
) {
  async function keep(changeId: string): Promise<boolean> {
    const change = session.getChange(changeId);
    if (!change || change.status !== 'pending' || session.snapshot.isApplying) {
      return false;
    }

    const blocked = hooks.assertCanKeep?.(change) ?? null;
    if (blocked) {
      session.setChangeError(changeId, blocked);
      return false;
    }

    session.setApplying(true);
    session.setError(null);
    try {
      const result = await applyNoteChangeProposal([change.change]);
      session.markKept(changeId);
      await hooks.onKept?.(change, result);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to apply this change.';
      session.setChangeError(changeId, message);
      return false;
    } finally {
      session.setApplying(false);
    }
  }

  async function keepAll(): Promise<boolean> {
    const pending = session.pendingChanges();
    if (pending.length === 0 || session.snapshot.isApplying) return false;

    for (const change of pending) {
      const blocked = hooks.assertCanKeep?.(change) ?? null;
      if (blocked) {
        session.setChangeError(change.id, blocked);
        return false;
      }
    }

    session.setApplying(true);
    session.setError(null);
    try {
      const result = await applyNoteChangeProposal(pending.map((item) => item.change));
      for (const change of pending) {
        session.markKept(change.id);
      }
      const last = pending[pending.length - 1];
      if (last) await hooks.onKept?.(last, result);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to apply proposed changes.';
      session.setError(message);
      return false;
    } finally {
      session.setApplying(false);
    }
  }

  async function undo(changeId: string): Promise<void> {
    const change = session.getChange(changeId);
    if (!change || change.status !== 'pending') return;
    session.markUndone(changeId);
    await hooks.onUndone?.(change);
  }

  async function undoAll(): Promise<void> {
    session.markAllUndone();
    await hooks.onUndoneAll?.();
  }

  return { keep, keepAll, undo, undoAll };
}

export type ProposalApplyController = ReturnType<typeof createProposalApplyController>;
