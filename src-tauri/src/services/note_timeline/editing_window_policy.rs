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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finalization_uses_retained_anchor_including_return_to_anchor() {
        assert_eq!(finalization("A", "D"), Finalization::AppendNetRevision);
        // Intermediate B or C is intentionally irrelevant to this decision.
        assert_eq!(finalization("A", "A"), Finalization::RemovePendingOnly);
    }

    #[test]
    fn stale_tokens_never_become_success_and_protected_exceptions_remain_retryable() {
        assert_eq!(token_outcome(true, 2, 3, None), TokenOutcome::Stale);
        assert_eq!(token_outcome(true, 3, 3, None), TokenOutcome::Stale);
        assert_eq!(token_outcome(true, 4, 3, None), TokenOutcome::Unknown);
        assert_eq!(
            token_outcome(true, 2, 3, Some(ReceiptState::Pending)),
            TokenOutcome::RecoverExactIntent
        );
        assert_eq!(
            token_outcome(true, 2, 3, Some(ReceiptState::Captured)),
            TokenOutcome::ReturnOriginalOutcome
        );
        assert_eq!(
            token_outcome(true, 2, 3, Some(ReceiptState::Abandoned)),
            TokenOutcome::RemainAbandoned
        );
        assert_eq!(
            token_outcome(false, 4, 3, Some(ReceiptState::Captured)),
            TokenOutcome::Stale
        );
    }
}
