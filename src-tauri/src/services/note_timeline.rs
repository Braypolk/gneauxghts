// Canonical ordinary-note mutation, observation, lifecycle, and role-limited
// history boundary. Storage and post-publication coordination remain private
// implementation details so callers depend only on the closed domain contract.
mod activity;
mod editing_window_capture;
mod editing_window_policy;
mod forgotten;
pub(crate) use forgotten::resolve_forgotten_target_path;
#[cfg(test)]
pub(crate) use forgotten::{
    forgotten_note_identity, prepare_forgotten_note_markdown, publish_note_move,
    resolve_restore_target_path, AFTER_FORGET_METADATA_STAGED, BEFORE_FORGOTTEN_PUBLICATION,
};
mod history_store;
mod post_publication;
mod provenance;
pub(crate) use activity::RevisionCitation;
#[cfg(test)]
mod release_validation;
mod runtime;

// One owner; private files group its vocabulary and complete operations by responsibility.
mod administration;
mod current_content;
mod domain;
mod history_mode;
mod lifecycle;
mod observation;
mod publication;
#[cfg(any(test, feature = "e2e-wdio"))]
mod test_support;

#[cfg(test)]
use administration::{FAIL_NEXT_PURGE_PROJECTION_CLEANUP, FAIL_NEXT_PURGE_STAGE};
pub(crate) use current_content::*;
pub(crate) use domain::*;
pub(crate) use history_mode::*;
#[allow(unused_imports)]
pub(crate) use observation::ObservationReceipt;

#[cfg(feature = "e2e-wdio")]
pub(crate) use test_support::corrupt_history_store_for_test;
#[cfg(test)]
pub(crate) use test_support::*;
#[cfg(test)]
use test_support::{
    inject_purge_projection_cleanup_failure_once, inject_purge_staging_failure_once,
};

// Responsibility map:
// - domain: closed records, results, receipts, and capability vocabulary
// - history_mode/current_content: role-limited read operations
// - administration: recovery, initialization, health, deletion, compaction, and close
// - publication: preparation, save, and mutation publication
// - observation/lifecycle: external evidence and lifecycle or missing-note transitions
// Storage, runtime, provenance, editing-window, and post-publication policy remain in
// their existing private modules.

use self::post_publication::PublicationOutcome;
pub(crate) use self::runtime::NoteTimelineRuntime;
use self::runtime::{CurrentContentMutationGuard, CurrentContentVersion, OperationGuard};
use crate::{
    index::{build_indexed_note, AppState, NoteTimelineOwnerToken},
    path_utils::{collect_markdown_files_recursively, unique_path_in_dir},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as BASE64_URL_SAFE, Engine as _};
use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, DiffOp};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

pub(crate) struct NoteTimeline<'a> {
    state: &'a AppState,
    runtime: &'a NoteTimelineRuntime,
}

// Canonical coordinator for mutation, observation, recovery, and history access.

impl<'a> NoteTimeline<'a> {
    pub(crate) fn bind(
        state: &'a AppState,
        runtime: &'a NoteTimelineRuntime,
        _owner: NoteTimelineOwnerToken,
    ) -> Self {
        Self { state, runtime }
    }
}

impl<'a> NoteTimeline<'a> {
    pub(crate) fn history_mode(&self, grant: HistoryModeGrant) -> HistoryModeAccess<'a> {
        HistoryModeAccess {
            state: self.state,
            note_id: grant.note_id,
        }
    }

    pub(crate) fn open_history_mode(&self, note_id: NoteIdentity) -> HistoryModeAccess<'a> {
        self.history_mode(HistoryModeGrant::authorized(note_id))
    }

    pub(crate) fn current_content(&self, scope: AllowedScope) -> CurrentContentAccess<'a> {
        CurrentContentAccess {
            state: self.state,
            runtime: self.runtime,
            scope,
        }
    }
}

#[cfg(test)]
mod tests;
