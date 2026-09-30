//! Application-owned failures and recovery. Raw dependency diagnostics are never
//! model feedback; callers explicitly select a safe contract at the error origin.
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FailureCode {
    InvalidRequest,
    Unavailable,
    StaleEvidence,
    EvidenceBudget,
    ReadCapacity,
    WorkBudget,
    ProvenanceUnavailable,
    ResearchSelection,
    Cancelled,
    Busy,
    InternalError,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Recovery {
    CorrectRequest,
    SearchAgain,
    ReadNarrower,
    FinishWithAvailableEvidence,
    UseDirectEvidence,
    RetryLater,
    Stop,
}
#[derive(Clone, Debug, thiserror::Error)]
#[error("{message}")]
pub(crate) struct ToolError {
    pub(crate) code: FailureCode,
    pub(crate) recovery: Recovery,
    message: String,
    safe: bool,
}
impl ToolError {
    fn known(code: FailureCode, recovery: Recovery, message: &'static str) -> Self {
        Self {
            code,
            recovery,
            message: message.into(),
            safe: true,
        }
    }
    pub(crate) fn invalid(message: &'static str) -> Self {
        Self::known(
            FailureCode::InvalidRequest,
            Recovery::CorrectRequest,
            message,
        )
    }
    pub(crate) fn unavailable(message: &'static str) -> Self {
        Self::known(FailureCode::Unavailable, Recovery::SearchAgain, message)
    }
    pub(crate) fn stale(message: &'static str) -> Self {
        Self::known(FailureCode::StaleEvidence, Recovery::SearchAgain, message)
    }
    pub(crate) fn evidence_budget() -> Self {
        Self::known(FailureCode::EvidenceBudget, Recovery::FinishWithAvailableEvidence, "The shared evidence allowance is exhausted. Use delivered evidence and explain gaps; do not retry retrieval in this run.")
    }
    pub(crate) fn work_budget(message: &'static str) -> Self {
        Self::known(
            FailureCode::WorkBudget,
            Recovery::FinishWithAvailableEvidence,
            message,
        )
    }
    pub(crate) fn read_capacity(message: &'static str) -> Self {
        Self::known(FailureCode::ReadCapacity, Recovery::ReadNarrower, message)
    }
    pub(crate) fn provenance(message: &'static str) -> Self {
        Self::known(
            FailureCode::ProvenanceUnavailable,
            Recovery::ReadNarrower,
            message,
        )
    }
    pub(crate) fn research_selection(message: &'static str) -> Self {
        Self::known(
            FailureCode::ResearchSelection,
            Recovery::UseDirectEvidence,
            message,
        )
    }
    pub(crate) fn cancelled() -> Self {
        Self::known(FailureCode::Cancelled, Recovery::Stop, "Request cancelled")
    }
    pub(crate) fn busy(message: &'static str) -> Self {
        Self::known(FailureCode::Busy, Recovery::RetryLater, message)
    }
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            code: FailureCode::InternalError,
            recovery: Recovery::RetryLater,
            message: message.into(),
            safe: false,
        }
    }
    pub(crate) fn payload(&self) -> Value {
        json!({"status":"error","code":self.code,"message":if self.safe {self.message.as_str()} else {"The action failed internally. Try again later."},
            "retryable":matches!(self.code, FailureCode::Busy),"recovery":{"action":self.recovery}})
    }
}
impl From<String> for ToolError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}
// Static owner-authored availability messages are safe. Validation, budget,
// freshness and provenance sites select their specific constructors explicitly.
impl From<&'static str> for ToolError {
    fn from(message: &'static str) -> Self {
        Self::unavailable(message)
    }
}
