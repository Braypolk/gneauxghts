//! Publication admission stays inside NoteTimeline. The runtime supplies elapsed
//! time; storage durably binds that decision before canonical Markdown is written.
use super::{
    editing_window_policy::WINDOW_MILLIS, history_store, HistoryError, MutationSource,
    NoteIdentity, NoteTimeline, PreparedHistoryIntent, RevisionIdentity,
};
use std::path::Path;

impl NoteTimeline<'_> {
    pub(super) fn prepare_history_capture(
        &self,
        source: MutationSource,
        target_path: &Path,
        canonical: &str,
        kind: history_store::PublicationIntentKind,
        baseline: Option<history_store::BaselineSeed<'_>>,
    ) -> Result<PreparedHistoryIntent, HistoryError> {
        let note_id = crate::note::parse_note(canonical)
            .frontmatter
            .managed
            .map(|metadata| NoteIdentity::new(metadata.id))
            .ok_or("History preparation requires a managed Note Identity")?;
        self.runtime.ensure_note_ready(&note_id)?;
        let ordinary_editor = source == MutationSource::Editor
            && kind == history_store::PublicationIntentKind::Update
            && baseline
                .as_ref()
                .is_none_or(|seed| seed.path == target_path);
        if ordinary_editor {
            #[cfg(not(test))]
            self.runtime.start_window_scheduler();
            let pending =
                history_store::pending_window(&self.state.note_timeline().runtime.store, &note_id)?;
            // Sample after identity/Markdown/baseline preparation. Preparation
            // start time cannot admit a publication into an expired window.
            let mut admission = self
                .runtime
                .editing_window_admission(&note_id, pending.as_ref())?;
            if pending.is_some() && admission.elapsed_millis >= WINDOW_MILLIS {
                let expired = pending.as_ref().expect("pending window");
                history_store::mark_window_clock_discontinuity(
                    &self.state.note_timeline().runtime.store,
                    &note_id,
                    &expired.window_id,
                    expired.generation,
                    admission.clock_discontinuity,
                )?;
                self.finalize_editor_capture(&note_id)?;
                // Sealing may be slow. A new window starts at its own
                // admission, after the preceding boundary has completed.
                admission = self.runtime.editing_window_admission(&note_id, None)?;
            }
            return history_store::prepare_window_publication(
                &self.state.note_timeline().runtime.store,
                target_path,
                canonical,
                admission,
                baseline,
            );
        }
        // Actions through the dirty-editor save route retain their original
        // source. Rename/move publications also settle the prior editor endpoint.
        self.finalize_editor_capture(&note_id)?;
        history_store::prepare_publication(
            &self.state.note_timeline().runtime.store,
            source,
            target_path,
            canonical,
            kind,
            baseline,
        )
    }

    pub(super) fn finalize_editor_capture(
        &self,
        note_id: &NoteIdentity,
    ) -> Result<Option<RevisionIdentity>, HistoryError> {
        self.runtime.ensure_note_ready(note_id)?;
        let Some(window) =
            history_store::pending_window(&self.state.note_timeline().runtime.store, note_id)?
        else {
            return Ok(None);
        };
        let revision = history_store::seal_pending_window(
            &self.state.note_timeline().runtime.store,
            note_id,
            &window.window_id,
            window.generation,
        )?;
        #[cfg(feature = "e2e-wdio")]
        crate::e2e_process_fault::hit("window-sealed");
        self.runtime.forget_window_clock(note_id);
        Ok(revision)
    }
}

#[cfg(test)]
mod tests;
