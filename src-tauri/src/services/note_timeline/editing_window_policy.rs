//! Shared decisions used by production Editing Window storage.
//! Continuous deadlines belong to runtime::windows; publication admission and
//! boundary coordination belong to NoteTimeline, and activity uses retained
//! RevisionTimeEvidence.

pub(super) const WINDOW_MILLIS: u64 = 300_000;
pub(super) const TERMINAL_RETRY_RECEIPTS: usize = 64;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Finalization {
    RemovePendingOnly,
    AppendNetRevision,
}

pub(super) fn finalization(anchor_hash: &str, captured_endpoint_hash: &str) -> Finalization {
    if anchor_hash == captured_endpoint_hash {
        Finalization::RemovePendingOnly
    } else {
        Finalization::AppendNetRevision
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReceiptState {
    Pending,
    Captured,
    Abandoned,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum TokenOutcome {
    RecoverExactIntent,
    ReturnOriginalOutcome,
    RemainAbandoned,
    Stale,
    Unknown,
}

pub(super) fn token_outcome(
    scope_matches: bool,
    sequence: u64,
    retired_through: u64,
    retained: Option<ReceiptState>,
) -> TokenOutcome {
    if !scope_matches {
        return TokenOutcome::Stale;
    }
    // Protected exceptions can survive below the retirement watermark.
    match retained {
        Some(ReceiptState::Pending) => TokenOutcome::RecoverExactIntent,
        Some(ReceiptState::Captured) => TokenOutcome::ReturnOriginalOutcome,
        Some(ReceiptState::Abandoned) => TokenOutcome::RemainAbandoned,
        None if sequence <= retired_through => TokenOutcome::Stale,
        None => TokenOutcome::Unknown,
    }
}
