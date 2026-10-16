//! Evaluation leaf contract. Durable lifecycle belongs exclusively to Pi.
pub(crate) use crate::chat_domain::*;
#[path = "chat/citations.rs"]
pub(crate) mod citations;
#[path = "chat/date_time.rs"]
pub(crate) mod date_time;
#[path = "proposal_policy.rs"]
pub(crate) mod note_proposals;
#[path = "chat/structured_answer.rs"]
pub(crate) mod structured_answer;
