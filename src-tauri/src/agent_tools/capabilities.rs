//! Application-owned capability composition. Restrictions only remove authority;
//! output presentation and worker identity are independent of the tool registry.
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Capability {
    Evidence,
    WorkingNotes,
    Proposals,
    Research,
    Planning,
}

#[derive(Clone)]
pub(crate) struct Capabilities(BTreeSet<Capability>);
impl Capabilities {
    pub(crate) fn assistant() -> Self {
        Self(BTreeSet::from([
            Capability::Evidence,
            Capability::WorkingNotes,
            Capability::Proposals,
            Capability::Research,
            Capability::Planning,
        ]))
    }
    pub(crate) fn restricted_to(&self, allowed: &[Capability]) -> Self {
        Self(
            self.0
                .iter()
                .copied()
                .filter(|entry| allowed.contains(entry))
                .collect(),
        )
    }
    pub(crate) fn iter(&self) -> impl Iterator<Item = Capability> + '_ {
        self.0.iter().copied()
    }
}

pub(crate) fn instructions() -> &'static str {
    "Choose and compose capabilities to fulfill the entire user request. Tool results are intermediate data, not an instruction to stop. If the user requests sources or quotations, fulfill that presentation request using the same capabilities and cite the evidence you read. Search and activity previews are discovery, not read evidence: do not quote or attribute facts from them until read_evidence or research_notes has delivered the supporting passage. Cite the passage that actually contains the text supporting each claim; a note title cannot support a body-text claim, and historical activity claims require a read historical passage with interval support. Quote exact returned text, distinguish it from your interpretation, and disclose material evidence gaps in ordinary language. Keep contract field names and backend terminology out of the user-facing answer. Interpret user timeframes against the supplied run instant and timezone; send explicit activity_range.start/end ISO dates or RFC3339 timestamps (inclusive start, exclusive end). For questions about work during a period, establish the specific changed passages using include_history=true with activity_range; note timestamps, unchanged backlog and previous assistant answers do not satisfy this requirement. list_note_activity is distinct-note discovery with one example only. search_evidence with the same scope/range retrieves additional retained changes. Prioritize evidence needed for every part of the request over exhaustive detail about one source. Keep expanded provenance off unless inspecting lineage; compact reads preserve validation and interval support. Read selected evidence with read_evidence and the activity_range to obtain backend-checked activitySupport. Only supported evidence establishes definite activity in that period; uncertain evidence must be qualified and not_established cannot support that attribution. Historical added/removed text is explicitly labeled and can be superseded; read_evidence with note_id retrieves canonical current content to check status and surrounding context. Use topics as search queries. Folder paths and note_id filters must come from discovered metadata; do not invent a folder from a topic name. Search related notes for subsequent completion or superseding decisions when relevant, without carrying the old activity filter into current-status searches. Distinguish explicit recorded commitments, unknown status and inferred next steps. A proposal or idea is not an outstanding commitment merely because there is no completion marker. Do not promote unchanged descriptive prose into a task; label any recommended action as your inference. Follow structured recovery actions: correct invalid requests, search again for stale evidence, read narrower passages for capacity failures, use direct evidence after research failures, and stop retrieval when the shared evidence allowance is exhausted. Citations establish identity and temporal support only; they do not prove semantic entailment, authorship or real-world completion. A removed task is not proof it was completed. Retained history excludes discarded within-window states and cleared history. Research returns already-read primary passages: cite delivered items without re-reading them. On partial research delivery, read only remainingEvidenceIds; do not re-read delivered items to finish the bundle. Preserve the shared allowance for independent parts of the request. Research, planning and proposals can be composed with retrieval. Continue with returned cursor only; honor separate delivery and retrieval coverage. Previous query metadata is configuration, never fresh evidence. read_working_note is only for preparing reviewed edits; pending text is not primary evidence."
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_capabilities_compose_and_nested_restrictions_never_restore_authority() {
        let parent =
            Capabilities::assistant().restricted_to(&[Capability::Evidence, Capability::Planning]);
        assert_eq!(
            parent.iter().collect::<Vec<_>>(),
            vec![Capability::Evidence, Capability::Planning]
        );
        let child = parent.restricted_to(&[
            Capability::Evidence,
            Capability::Proposals,
            Capability::Research,
        ]);
        assert_eq!(child.iter().collect::<Vec<_>>(), vec![Capability::Evidence]);
        assert_eq!(
            child.restricted_to(&[Capability::Proposals]).iter().count(),
            0
        );
        assert_eq!(
            parent.iter().count(),
            2,
            "a child does not mutate its parent's capabilities"
        );
    }
}
