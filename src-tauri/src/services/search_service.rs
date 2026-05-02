//! Search application service.
//!
//! Thin delegating wrapper around the existing
//! `commands::search_commands` module. Search is already a clean
//! pipeline (lexical → optional semantic → merge), so the value of the
//! service layer here is mostly making the call hierarchy explicit
//! (Tauri command → service → existing implementation). Intentionally
//! kept minimal in this rewrite to avoid disturbing the search ranking
//! tests that were stabilised in earlier phases.

#[allow(dead_code)]
pub(crate) struct SearchService;

#[allow(dead_code)]
impl SearchService {
    pub(crate) fn new() -> Self {
        Self
    }
}
