// Canonical ordinary-note mutation, observation, lifecycle, and role-limited
// history boundary. Storage and post-publication coordination remain private
// implementation details so callers depend only on the closed domain contract.
#![allow(dead_code)]

mod post_publication;

use self::post_publication::{PublicationIssue, PublicationOutcome, PublicationStage};
use crate::index::AppState;
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

macro_rules! identity_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash)]
        pub(crate) struct $name(String);
    };
}

identity_type!(NoteIdentity);
identity_type!(RevisionIdentity);
identity_type!(LifecycleEventIdentity);
identity_type!(TurnIdentity);

impl NoteIdentity {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl TurnIdentity {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl RevisionIdentity {
    fn issue() -> Self {
        Self(crate::note::generate_note_id())
    }

    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

impl LifecycleEventIdentity {
    fn issue() -> Self {
        Self(crate::note::generate_note_id())
    }

    fn from_persisted(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PayloadVersion {
    V1,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TimelineRecordIdentity {
    Revision(RevisionIdentity),
    LifecycleEvent(LifecycleEventIdentity),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LifecycleEventKind {
    Created,
    Renamed,
    Moved,
    Forgotten,
    Recovered,
    Missing,
    Reattached,
    Purged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MutationSource {
    Editor,
    TaskAction,
    AcceptedChatProposal,
    ExternalEdit,
    VersionRestore,
    NoteCreation,
    BaselineInitialization,
    RecoveryReconciliation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MutationWarningStage {
    CanonicalRead,
    CatalogUpsert,
    TaskProjectionUpsert,
    CatalogRemove,
    TaskProjectionRemove,
    TaskViewRefresh,
    SemanticUpdate,
    SemanticMove,
    DirtyRecovery,
    Revision,
}

impl From<PublicationStage> for MutationWarningStage {
    fn from(stage: PublicationStage) -> Self {
        match stage {
            PublicationStage::CanonicalRead => Self::CanonicalRead,
            PublicationStage::CatalogUpsert => Self::CatalogUpsert,
            PublicationStage::TaskProjectionUpsert => Self::TaskProjectionUpsert,
            PublicationStage::CatalogRemove => Self::CatalogRemove,
            PublicationStage::TaskProjectionRemove => Self::TaskProjectionRemove,
            PublicationStage::SemanticUpdate => Self::SemanticUpdate,
            PublicationStage::SemanticMove => Self::SemanticMove,
            PublicationStage::DirtyRecovery => Self::DirtyRecovery,
            PublicationStage::Revision => Self::Revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteTimelineIssue {
    stage: MutationWarningStage,
    message: String,
}

impl NoteTimelineIssue {
    pub(crate) fn stage(&self) -> MutationWarningStage {
        self.stage
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl From<PublicationIssue> for NoteTimelineIssue {
    fn from(issue: PublicationIssue) -> Self {
        Self {
            stage: issue.stage.into(),
            message: issue.message,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteMutationWarning {
    #[serde(skip)]
    payload_version: PayloadVersion,
    message: String,
    issues: Vec<NoteTimelineIssue>,
}

impl NoteMutationWarning {
    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    pub(crate) fn issues(&self) -> &[NoteTimelineIssue] {
        &self.issues
    }

    pub(crate) fn single(
        stage: MutationWarningStage,
        message: String,
        issue_message: String,
    ) -> Self {
        Self {
            payload_version: PayloadVersion::V1,
            message,
            issues: vec![NoteTimelineIssue {
                stage,
                message: issue_message,
            }],
        }
    }

    pub(crate) fn merge(&mut self, other: Self) {
        self.message = format!("{}; {}", self.message, other.message);
        self.issues.extend(other.issues);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteMutationResult {
    payload_version: PayloadVersion,
    source: MutationSource,
    note_id: NoteIdentity,
    path: PathBuf,
    canonical_markdown: String,
    diagnostics: Vec<NoteTimelineIssue>,
    warning: Option<NoteMutationWarning>,
}

impl NoteMutationResult {
    fn from_publication(source: MutationSource, outcome: PublicationOutcome) -> Self {
        let warning = outcome
            .required_consistency_warning()
            .map(|warning| NoteMutationWarning {
                payload_version: PayloadVersion::V1,
                message: warning.message,
                issues: warning.issues.into_iter().map(Into::into).collect(),
            });
        Self {
            payload_version: PayloadVersion::V1,
            source,
            note_id: NoteIdentity::new(outcome.note_id),
            path: outcome.path,
            canonical_markdown: outcome.canonical_markdown,
            diagnostics: outcome.issues.into_iter().map(Into::into).collect(),
            warning,
        }
    }

    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn canonical_markdown(&self) -> &str {
        &self.canonical_markdown
    }

    pub(crate) fn warning(&self) -> Option<&NoteMutationWarning> {
        self.warning.as_ref()
    }

    pub(crate) fn diagnostics(&self) -> &[NoteTimelineIssue] {
        &self.diagnostics
    }

    pub(crate) fn report_degraded(&self, source: &str) {
        for issue in &self.diagnostics {
            eprintln!(
                "{source} committed {} but post-commit {:?} degraded: {}",
                self.path.display(),
                issue.stage,
                issue.message
            );
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteRevisionHeader {
    identity: RevisionIdentity,
    note_identity: NoteIdentity,
    predecessor: Option<TimelineRecordIdentity>,
    payload_version: PayloadVersion,
    source: MutationSource,
}

impl NoteRevisionHeader {
    fn issue(
        note_identity: NoteIdentity,
        predecessor: Option<TimelineRecordIdentity>,
        payload_version: PayloadVersion,
        source: MutationSource,
    ) -> Self {
        Self {
            identity: RevisionIdentity::issue(),
            note_identity,
            predecessor,
            payload_version,
            source,
        }
    }

    pub(crate) fn predecessor(&self) -> Option<&TimelineRecordIdentity> {
        self.predecessor.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecycleEventHeader {
    identity: LifecycleEventIdentity,
    note_identity: NoteIdentity,
    predecessor: Option<TimelineRecordIdentity>,
    payload_version: PayloadVersion,
    kind: LifecycleEventKind,
}

impl LifecycleEventHeader {
    fn issue(
        note_identity: NoteIdentity,
        predecessor: Option<TimelineRecordIdentity>,
        payload_version: PayloadVersion,
        kind: LifecycleEventKind,
    ) -> Self {
        Self {
            identity: LifecycleEventIdentity::issue(),
            note_identity,
            predecessor,
            payload_version,
            kind,
        }
    }

    pub(crate) fn payload_version(&self) -> PayloadVersion {
        self.payload_version
    }

    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteMutation {
    source: MutationSource,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    fallback_markdown: String,
}

impl NoteMutation {
    pub(crate) fn editor(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::Editor,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn task_action(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::TaskAction,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn accepted_chat_proposal(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::AcceptedChatProposal,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn version_restore(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::VersionRestore,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn note_creation(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::NoteCreation,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn baseline_initialization(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::BaselineInitialization,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    pub(crate) fn recovery_reconciliation(
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self::with_source(
            MutationSource::RecoveryReconciliation,
            path,
            previous_path,
            fallback_markdown,
        )
    }

    fn with_source(
        source: MutationSource,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        fallback_markdown: String,
    ) -> Self {
        Self {
            source,
            path,
            previous_path,
            fallback_markdown,
        }
    }

    pub(crate) fn source(&self) -> MutationSource {
        self.source
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VaultObservation {
    source: VaultObservationSource,
    kind: VaultObservationKind,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    observed_at_millis: u64,
    modified_at_millis: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VaultObservationKind {
    CanonicalState,
    ReconciliationScan,
    Lifecycle(LifecycleEventKind),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VaultObservationSource {
    Watcher,
    Reconciliation,
}

impl VaultObservation {
    pub(crate) fn external_edit(
        path: PathBuf,
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    ) -> Self {
        Self::canonical_state(
            VaultObservationSource::Watcher,
            path,
            observed_at_millis,
            modified_at_millis,
        )
    }

    pub(crate) fn reconciled_state(
        path: PathBuf,
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    ) -> Self {
        Self::canonical_state(
            VaultObservationSource::Reconciliation,
            path,
            observed_at_millis,
            modified_at_millis,
        )
    }

    pub(crate) fn reconciliation_scan(vault_root: PathBuf, observed_at_millis: u64) -> Self {
        Self {
            source: VaultObservationSource::Reconciliation,
            kind: VaultObservationKind::ReconciliationScan,
            path: vault_root,
            previous_path: None,
            observed_at_millis,
            modified_at_millis: None,
        }
    }

    fn canonical_state(
        source: VaultObservationSource,
        path: PathBuf,
        observed_at_millis: u64,
        modified_at_millis: Option<u64>,
    ) -> Self {
        Self {
            source,
            kind: VaultObservationKind::CanonicalState,
            path,
            previous_path: None,
            observed_at_millis,
            modified_at_millis,
        }
    }

    pub(crate) fn renamed(
        previous_path: impl Into<PathBuf>,
        path: impl Into<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self::lifecycle(
            VaultObservationSource::Watcher,
            LifecycleEventKind::Renamed,
            path.into(),
            Some(previous_path.into()),
            observed_at_millis,
        )
    }

    pub(crate) fn moved(
        previous_path: impl Into<PathBuf>,
        path: impl Into<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self::lifecycle(
            VaultObservationSource::Watcher,
            LifecycleEventKind::Moved,
            path.into(),
            Some(previous_path.into()),
            observed_at_millis,
        )
    }

    pub(crate) fn missing(path: impl Into<PathBuf>, observed_at_millis: u64) -> Self {
        Self::lifecycle(
            VaultObservationSource::Watcher,
            LifecycleEventKind::Missing,
            path.into(),
            None,
            observed_at_millis,
        )
    }

    pub(crate) fn reconciled_missing(path: impl Into<PathBuf>, observed_at_millis: u64) -> Self {
        Self::lifecycle(
            VaultObservationSource::Reconciliation,
            LifecycleEventKind::Missing,
            path.into(),
            None,
            observed_at_millis,
        )
    }

    fn lifecycle(
        source: VaultObservationSource,
        kind: LifecycleEventKind,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        observed_at_millis: u64,
    ) -> Self {
        Self {
            source,
            kind: VaultObservationKind::Lifecycle(kind),
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis: None,
        }
    }

    pub(crate) fn source(&self) -> VaultObservationSource {
        self.source
    }

    pub(crate) fn kind(&self) -> VaultObservationKind {
        self.kind
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NoteLifecycleOperation {
    kind: LifecycleEventKind,
    note_id: NoteIdentity,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    occurred_at_millis: u64,
}

impl NoteLifecycleOperation {
    pub(crate) fn forgotten(
        note_id: NoteIdentity,
        previous_path: PathBuf,
        path: PathBuf,
        occurred_at_millis: u64,
    ) -> Self {
        Self::new(
            LifecycleEventKind::Forgotten,
            note_id,
            path,
            Some(previous_path),
            occurred_at_millis,
        )
    }

    pub(crate) fn recovered(
        note_id: NoteIdentity,
        previous_path: PathBuf,
        path: PathBuf,
        occurred_at_millis: u64,
    ) -> Self {
        Self::new(
            LifecycleEventKind::Recovered,
            note_id,
            path,
            Some(previous_path),
            occurred_at_millis,
        )
    }

    pub(crate) fn purged(note_id: NoteIdentity, path: PathBuf, occurred_at_millis: u64) -> Self {
        Self::new(
            LifecycleEventKind::Purged,
            note_id,
            path,
            None,
            occurred_at_millis,
        )
    }

    fn new(
        kind: LifecycleEventKind,
        note_id: NoteIdentity,
        path: PathBuf,
        previous_path: Option<PathBuf>,
        occurred_at_millis: u64,
    ) -> Self {
        Self {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecycleReceipt {
    kind: LifecycleEventKind,
    note_id: NoteIdentity,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    occurred_at_millis: u64,
}

impl LifecycleReceipt {
    pub(crate) fn kind(&self) -> LifecycleEventKind {
        self.kind
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    pub(crate) fn occurred_at_millis(&self) -> u64 {
        self.occurred_at_millis
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AllowedScope {
    note_ids: HashSet<NoteIdentity>,
}

impl AllowedScope {
    pub(crate) fn only(note_id: NoteIdentity) -> Self {
        Self {
            note_ids: HashSet::from([note_id]),
        }
    }

    fn allows(&self, note_id: &NoteIdentity) -> bool {
        self.note_ids.contains(note_id)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ExplicitRestoreGrant {
    turn_id: TurnIdentity,
    note_id: NoteIdentity,
    revision_id: RevisionIdentity,
}

impl ExplicitRestoreGrant {
    fn new(turn_id: TurnIdentity, note_id: NoteIdentity, revision_id: RevisionIdentity) -> Self {
        Self {
            turn_id,
            note_id,
            revision_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HistoryModeGrant {
    note_id: NoteIdentity,
}

impl HistoryModeGrant {
    fn authorized(note_id: NoteIdentity) -> Self {
        Self { note_id }
    }
}

pub(crate) struct HistoryModeAccess<'a> {
    _state: &'a AppState,
    note_id: NoteIdentity,
}

impl HistoryModeAccess<'_> {
    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.note_id
    }
}

pub(crate) struct CurrentContentAccess<'a> {
    _state: &'a AppState,
    scope: AllowedScope,
}

impl CurrentContentAccess<'_> {
    pub(crate) fn allows(&self, note_id: &NoteIdentity) -> bool {
        self.scope.allows(note_id)
    }
}

pub(crate) struct AgentRestoreAccess<'a> {
    _state: &'a AppState,
    grant: ExplicitRestoreGrant,
}

impl AgentRestoreAccess<'_> {
    pub(crate) fn turn_id(&self) -> &TurnIdentity {
        &self.grant.turn_id
    }

    pub(crate) fn note_id(&self) -> &NoteIdentity {
        &self.grant.note_id
    }

    pub(crate) fn revision_id(&self) -> &RevisionIdentity {
        &self.grant.revision_id
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ObservationReceipt {
    source: VaultObservationSource,
    kind: VaultObservationKind,
    path: PathBuf,
    previous_path: Option<PathBuf>,
    observed_at_millis: u64,
    modified_at_millis: Option<u64>,
}

impl ObservationReceipt {
    pub(crate) fn source(&self) -> VaultObservationSource {
        self.source
    }

    pub(crate) fn kind(&self) -> VaultObservationKind {
        self.kind
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn previous_path(&self) -> Option<&Path> {
        self.previous_path.as_deref()
    }

    pub(crate) fn observed_at_millis(&self) -> u64 {
        self.observed_at_millis
    }

    pub(crate) fn modified_at_millis(&self) -> Option<u64> {
        self.modified_at_millis
    }
}

pub(crate) struct NoteTimeline<'a> {
    state: &'a AppState,
}

impl<'a> NoteTimeline<'a> {
    pub(crate) fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    /// Prepare user-authored Markdown for an app-owned publication while
    /// preserving the identity already owned by the logical note. Callers
    /// provide continuity evidence; the timeline keeps the repair policy
    /// and metadata representation private.
    pub(crate) fn prepare_publication(
        &self,
        continuity_path: Option<&Path>,
        retained_identity: Option<&NoteIdentity>,
        markdown: &str,
    ) -> Result<String, String> {
        let catalog_identity = continuity_path
            .map(|path| self.state.indexed_note_identity(path))
            .transpose()?
            .flatten();
        let authoritative_identity = retained_identity
            .map(NoteIdentity::as_str)
            .filter(|note_id| !note_id.trim().is_empty())
            .or(catalog_identity.as_deref());
        let embedded_identity = crate::note::parse_note(markdown)
            .frontmatter
            .managed
            .map(|metadata| metadata.id);

        match authoritative_identity {
            Some(note_id) if embedded_identity.as_deref() != Some(note_id) => {
                crate::note::repair_managed_note_identity(markdown, note_id)
            }
            _ => Ok(markdown.to_string()),
        }
    }

    pub(crate) fn mutate(&self, mutation: NoteMutation) -> NoteMutationResult {
        let NoteMutation {
            source,
            path,
            previous_path,
            fallback_markdown,
        } = mutation;
        NoteMutationResult::from_publication(
            source,
            post_publication::synchronize_canonical_file(
                self.state,
                path,
                previous_path,
                fallback_markdown,
            ),
        )
    }

    pub(crate) fn observe(&self, observation: VaultObservation) -> ObservationReceipt {
        let VaultObservation {
            source,
            mut kind,
            path,
            mut previous_path,
            observed_at_millis,
            modified_at_millis,
        } = observation;
        match kind {
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing) => {
                let _ = self.state.detach_indexed_note_identity(&path);
            }
            VaultObservationKind::CanonicalState => {
                if let Some(note_id) = identity_from_canonical_path(&path) {
                    let missing_path = self
                        .state
                        .prepare_safe_note_identity_reattachment(&path, note_id.as_str())
                        .ok()
                        .flatten();
                    if let Some(missing_path) = missing_path {
                        kind = VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached);
                        previous_path = Some(missing_path);
                    }
                }
            }
            VaultObservationKind::Lifecycle(
                LifecycleEventKind::Renamed | LifecycleEventKind::Moved,
            ) => {
                if let Some(previous_path) = &previous_path {
                    let _ = self
                        .state
                        .prepare_note_identity_transfer(previous_path, &path);
                }
            }
            _ => {}
        }
        ObservationReceipt {
            source,
            kind,
            path,
            previous_path,
            observed_at_millis,
            modified_at_millis,
        }
    }

    pub(crate) fn lifecycle(&self, operation: NoteLifecycleOperation) -> LifecycleReceipt {
        let NoteLifecycleOperation {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        } = operation;
        LifecycleReceipt {
            kind,
            note_id,
            path,
            previous_path,
            occurred_at_millis,
        }
    }

    pub(crate) fn history_mode(&self, grant: HistoryModeGrant) -> HistoryModeAccess<'a> {
        HistoryModeAccess {
            _state: self.state,
            note_id: grant.note_id,
        }
    }

    pub(crate) fn current_content(&self, scope: AllowedScope) -> CurrentContentAccess<'a> {
        CurrentContentAccess {
            _state: self.state,
            scope,
        }
    }

    pub(crate) fn agent_restore(&self, grant: ExplicitRestoreGrant) -> AgentRestoreAccess<'a> {
        AgentRestoreAccess {
            _state: self.state,
            grant,
        }
    }
}

fn identity_from_canonical_path(path: &Path) -> Option<NoteIdentity> {
    let markdown = fs::read_to_string(path).ok()?;
    crate::note::parse_note(&markdown)
        .frontmatter
        .managed
        .map(|metadata| metadata.id)
        .filter(|note_id| !note_id.trim().is_empty())
        .map(NoteIdentity::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::EventBus, index::AppState, semantic::SemanticState};
    use std::{fs, path::PathBuf};

    #[test]
    fn editor_mutation_assigns_its_closed_source() {
        let mutation = NoteMutation::editor(
            PathBuf::from("/vault/Note.md"),
            None,
            "# Note\n\nBody".to_string(),
        );

        assert_eq!(mutation.source(), MutationSource::Editor);
        assert_eq!(mutation.path(), PathBuf::from("/vault/Note.md"));
    }

    #[test]
    fn typed_entrypoints_cover_the_closed_mutation_source_vocabulary() {
        let path = PathBuf::from("/vault/Note.md");
        let markdown = "# Note\n\nBody".to_string();
        let mutations = [
            NoteMutation::task_action(path.clone(), None, markdown.clone()),
            NoteMutation::accepted_chat_proposal(path.clone(), None, markdown.clone()),
            NoteMutation::version_restore(path.clone(), None, markdown.clone()),
            NoteMutation::note_creation(path.clone(), None, markdown.clone()),
            NoteMutation::baseline_initialization(path.clone(), None, markdown.clone()),
            NoteMutation::recovery_reconciliation(path.clone(), None, markdown.clone()),
        ];

        assert_eq!(
            mutations.map(|mutation| mutation.source()),
            [
                MutationSource::TaskAction,
                MutationSource::AcceptedChatProposal,
                MutationSource::VersionRestore,
                MutationSource::NoteCreation,
                MutationSource::BaselineInitialization,
                MutationSource::RecoveryReconciliation,
            ]
        );
        let observation = VaultObservation::external_edit(path, 42, Some(41));
        assert_eq!(observation.source(), VaultObservationSource::Watcher);
        assert_eq!(observation.kind(), VaultObservationKind::CanonicalState);
        let reconciled =
            VaultObservation::reconciled_state(PathBuf::from("/vault/Reconciled.md"), 43, Some(40));
        assert_eq!(reconciled.source(), VaultObservationSource::Reconciliation);
        let scan = VaultObservation::reconciliation_scan(PathBuf::from("/vault"), 44);
        assert_eq!(scan.source(), VaultObservationSource::Reconciliation);
        assert_eq!(scan.kind(), VaultObservationKind::ReconciliationScan);

        let lifecycle = [
            VaultObservation::renamed("/vault/Old.md", "/vault/New.md", 43),
            VaultObservation::moved("/vault/New.md", "/vault/Folder/New.md", 44),
            VaultObservation::missing("/vault/Folder/New.md", 45),
        ];
        assert_eq!(
            lifecycle.map(|observation| observation.kind()),
            [
                VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Moved),
                VaultObservationKind::Lifecycle(LifecycleEventKind::Missing),
            ]
        );
    }

    #[test]
    fn mutate_preserves_the_authoritative_publication_outcome() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-pass-through-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-pass-through-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let note_path = notes.path().join("Note.md");
        let markdown = "---\ngneauxghts:\n  id: note-1\n  kind: note\n---\n\n# Note\n\nBody";
        fs::write(&note_path, markdown).expect("write canonical note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");

        let outcome = NoteTimeline::new(&state).mutate(NoteMutation::editor(
            note_path.clone(),
            None,
            markdown.to_string(),
        ));

        assert_eq!(outcome.payload_version(), PayloadVersion::V1);
        assert_eq!(outcome.source(), MutationSource::Editor);
        assert_eq!(outcome.note_id(), &NoteIdentity::new("note-1"));
        assert_eq!(outcome.path(), note_path);
        assert_eq!(outcome.canonical_markdown(), markdown);
        assert_eq!(outcome.warning(), None);
    }

    #[test]
    fn app_commit_preserves_identity_when_authored_content_becomes_empty() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-empty-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-empty-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let note_path = notes.path().join("Note.md");
        let original = "---\ngneauxghts:\n  id: stable-note-1\n  kind: note\n---\n\nBody";
        fs::write(&note_path, original).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        timeline.mutate(NoteMutation::editor(
            note_path.clone(),
            None,
            original.to_string(),
        ));

        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Note".to_string(),
            String::new(),
            Some(note_path.to_string_lossy().into_owned()),
        )
        .expect("publish empty authored content")
        .session
        .expect("saved session");

        assert_eq!(saved.note_id.as_deref(), Some("stable-note-1"));
        let canonical = fs::read_to_string(&note_path).expect("read repaired canonical note");
        assert_eq!(
            crate::note::parse_note(&canonical)
                .frontmatter
                .managed
                .expect("managed identity remains")
                .id,
            "stable-note-1"
        );
        assert_eq!(crate::note::strip_frontmatter(&canonical), "");
    }

    #[test]
    fn external_metadata_damage_preserves_known_identity_without_rewriting_until_commit() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-damaged-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-damaged-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let note_path = notes.path().join("Damaged.md");
        let original = "---\ngneauxghts:\n  id: stable-note-2\n  kind: note\n---\n\nOriginal";
        fs::write(&note_path, original).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        timeline.mutate(NoteMutation::editor(
            note_path.clone(),
            None,
            original.to_string(),
        ));

        let damaged = "Externally changed without managed metadata";
        fs::write(&note_path, damaged).expect("damage managed metadata externally");
        timeline.observe(VaultObservation::external_edit(
            note_path.clone(),
            42,
            Some(41),
        ));
        state
            .upsert_note_indexes(
                note_path.clone(),
                crate::index::build_indexed_note(&note_path, damaged, 41),
            )
            .expect("apply observed catalog state");

        assert_eq!(fs::read_to_string(&note_path).unwrap(), damaged);
        assert_eq!(
            state.indexed_note_identity(&note_path).unwrap().as_deref(),
            Some("stable-note-2")
        );

        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Damaged".to_string(),
            damaged.to_string(),
            Some(note_path.to_string_lossy().into_owned()),
        )
        .expect("commit damaged note")
        .session
        .expect("saved session");
        assert_eq!(saved.note_id.as_deref(), Some("stable-note-2"));
        assert!(fs::read_to_string(&note_path)
            .unwrap()
            .contains("id: stable-note-2"));
    }

    #[test]
    fn copied_identity_cannot_replace_the_original_and_is_repaired_on_commit() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-copy-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-copy-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let original_path = notes.path().join("Original.md");
        let copy_path = notes.path().join("Copy.md");
        let markdown =
            "---\ngneauxghts:\n  id: stable-original-note\n  kind: note\n---\n\nCopied body";
        fs::write(&original_path, markdown).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        timeline.mutate(NoteMutation::editor(
            original_path.clone(),
            None,
            markdown.to_string(),
        ));

        fs::write(&copy_path, markdown).expect("copy note byte for byte");
        timeline.observe(VaultObservation::external_edit(
            copy_path.clone(),
            42,
            Some(41),
        ));
        state
            .upsert_note_indexes(
                copy_path.clone(),
                crate::index::build_indexed_note(&copy_path, markdown, 41),
            )
            .expect("ingest copied note");

        let original_id = state
            .indexed_note_identity(&original_path)
            .unwrap()
            .expect("original identity");
        let copy_id = state
            .indexed_note_identity(&copy_path)
            .unwrap()
            .expect("copy identity");
        assert_eq!(original_id, "stable-original-note");
        assert_ne!(copy_id, original_id);
        assert_eq!(fs::read_to_string(&copy_path).unwrap(), markdown);

        // Re-observing in either order cannot transfer either association.
        state
            .upsert_note_indexes(
                original_path.clone(),
                crate::index::build_indexed_note(&original_path, markdown, 43),
            )
            .unwrap();
        state
            .upsert_note_indexes(
                copy_path.clone(),
                crate::index::build_indexed_note(&copy_path, markdown, 44),
            )
            .unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&original_path)
                .unwrap()
                .as_deref(),
            Some(original_id.as_str())
        );
        assert_eq!(
            state.indexed_note_identity(&copy_path).unwrap().as_deref(),
            Some(copy_id.as_str())
        );

        let saved = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Copy".to_string(),
            "Copied body".to_string(),
            Some(copy_path.to_string_lossy().into_owned()),
        )
        .expect("commit copied note")
        .session
        .expect("saved session");
        assert_eq!(saved.note_id.as_deref(), Some(copy_id.as_str()));
        assert_eq!(
            crate::note::parse_note(&fs::read_to_string(&copy_path).unwrap())
                .frontmatter
                .managed
                .expect("copy identity repaired")
                .id,
            copy_id
        );

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("restart app state");
        restarted
            .prewarm_notes_index(notes.path())
            .expect("rebuild index after restart");
        assert_eq!(
            restarted
                .indexed_note_identity(&original_path)
                .unwrap()
                .as_deref(),
            Some(original_id.as_str())
        );
        assert_eq!(
            restarted
                .indexed_note_identity(&copy_path)
                .unwrap()
                .as_deref(),
            Some(copy_id.as_str())
        );
    }

    #[test]
    fn identity_follows_moves_disappearance_and_safe_reattachment_in_any_refresh_order() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-path-identity-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-path-identity-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let original_path = notes.path().join("Original.md");
        let moved_path = notes.path().join("Folder").join("Moved.md");
        let renamed_path = notes.path().join("Folder").join("Renamed.md");
        let reattached_path = notes.path().join("Reattached.md");
        let markdown = "---\ngneauxghts:\n  id: stable-path-note\n  kind: note\n---\n\nPath body";
        fs::write(&original_path, markdown).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        timeline.mutate(NoteMutation::editor(
            original_path.clone(),
            None,
            markdown.to_string(),
        ));

        fs::create_dir_all(moved_path.parent().unwrap()).unwrap();
        fs::rename(&original_path, &moved_path).expect("move note");
        timeline.observe(VaultObservation::moved(
            original_path.clone(),
            moved_path.clone(),
            42,
        ));
        // Removal-first refresh preserves the reservation for the new path.
        state.remove_note_indexes(&original_path).unwrap();
        state
            .upsert_note_indexes(
                moved_path.clone(),
                crate::index::build_indexed_note(&moved_path, markdown, 42),
            )
            .unwrap();
        assert_eq!(
            state.indexed_note_identity(&moved_path).unwrap().as_deref(),
            Some("stable-path-note")
        );

        fs::rename(&moved_path, &renamed_path).expect("rename note");
        timeline.observe(VaultObservation::renamed(
            moved_path.clone(),
            renamed_path.clone(),
            43,
        ));
        // Upsert-first refresh also transfers the association safely.
        state
            .upsert_note_indexes(
                renamed_path.clone(),
                crate::index::build_indexed_note(&renamed_path, markdown, 43),
            )
            .unwrap();
        state.remove_note_indexes(&moved_path).unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("stable-path-note")
        );

        fs::remove_file(&renamed_path).expect("temporarily remove note");
        timeline.observe(VaultObservation::missing(renamed_path.clone(), 44));

        let unrelated =
            "---\ngneauxghts:\n  id: unrelated-note\n  kind: note\n---\n\nUnrelated body";
        fs::write(&renamed_path, unrelated).expect("reuse disappeared path");
        timeline.observe(VaultObservation::external_edit(
            renamed_path.clone(),
            45,
            Some(45),
        ));
        state
            .upsert_note_indexes(
                renamed_path.clone(),
                crate::index::build_indexed_note(&renamed_path, unrelated, 45),
            )
            .unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("unrelated-note")
        );

        fs::write(&reattached_path, markdown).expect("write stale copy elsewhere");
        let copy_receipt = timeline.observe(VaultObservation::external_edit(
            reattached_path.clone(),
            46,
            Some(46),
        ));
        assert_eq!(copy_receipt.kind(), VaultObservationKind::CanonicalState);
        state
            .upsert_note_indexes(
                reattached_path.clone(),
                crate::index::build_indexed_note(&reattached_path, markdown, 46),
            )
            .unwrap();
        let stale_copy_id = state
            .indexed_note_identity(&reattached_path)
            .unwrap()
            .expect("stale copy receives an identity");
        assert_ne!(stale_copy_id, "stable-path-note");

        fs::remove_file(&renamed_path).expect("remove unrelated path occupant");
        state.remove_note_indexes(&renamed_path).unwrap();
        fs::write(&renamed_path, markdown).expect("reattach at the missing path");
        let reattached = timeline.observe(VaultObservation::external_edit(
            renamed_path.clone(),
            47,
            Some(47),
        ));
        assert_eq!(
            reattached.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
        );
        state
            .upsert_note_indexes(
                renamed_path.clone(),
                crate::index::build_indexed_note(&renamed_path, markdown, 47),
            )
            .unwrap();
        assert_eq!(
            state
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("stable-path-note")
        );

        let saved_copy = crate::commands::note_persistence::persist_note_session_with_outcome(
            &state,
            "Reattached".to_string(),
            "Path body".to_string(),
            Some(reattached_path.to_string_lossy().into_owned()),
        )
        .expect("commit stale copy identity")
        .session
        .expect("saved copy session");
        assert_eq!(saved_copy.note_id.as_deref(), Some(stale_copy_id.as_str()));

        let restarted = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("restart app state");
        restarted
            .prewarm_notes_index(notes.path())
            .expect("rebuild index after restart");
        assert_eq!(
            restarted
                .indexed_note_identity(&renamed_path)
                .unwrap()
                .as_deref(),
            Some("stable-path-note")
        );
        assert_eq!(
            restarted
                .indexed_note_identity(&reattached_path)
                .unwrap()
                .as_deref(),
            Some(stale_copy_id.as_str())
        );
    }

    #[test]
    fn abandoned_move_reservation_cannot_assign_identity_to_a_later_unrelated_file() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-stale-transfer-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-stale-transfer-notes");
        let original_path = notes.path().join("Original.md");
        let target_path = notes.path().join("Target.md");
        let original = "---\ngneauxghts:\n  id: reserved-note\n  kind: note\n---\n\nReserved body";
        let unrelated =
            "---\ngneauxghts:\n  id: unrelated-target\n  kind: note\n---\n\nDifferent body";
        fs::write(&original_path, original).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .unwrap();
        state
            .upsert_note_indexes(
                original_path.clone(),
                crate::index::build_indexed_note(&original_path, original, 41),
            )
            .unwrap();

        NoteTimeline::new(&state).observe(VaultObservation::moved(
            original_path.clone(),
            target_path.clone(),
            42,
        ));
        fs::write(&target_path, unrelated).unwrap();
        state
            .upsert_note_indexes(
                target_path.clone(),
                crate::index::build_indexed_note(&target_path, unrelated, 43),
            )
            .unwrap();

        assert_eq!(
            state
                .indexed_note_identity(&target_path)
                .unwrap()
                .as_deref(),
            Some("unrelated-target")
        );
        assert_eq!(
            state
                .indexed_note_identity(&original_path)
                .unwrap()
                .as_deref(),
            Some("reserved-note")
        );
    }

    #[test]
    fn history_roles_receive_distinct_scoped_capabilities() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-capabilities-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        let note_id = NoteIdentity::new("note-1");
        let revision_id = RevisionIdentity::from_persisted("revision-1");

        let history = timeline.history_mode(HistoryModeGrant::authorized(note_id.clone()));
        let current = timeline.current_content(AllowedScope::only(note_id.clone()));
        let restore = timeline.agent_restore(ExplicitRestoreGrant::new(
            TurnIdentity::new("turn-1"),
            note_id.clone(),
            revision_id.clone(),
        ));

        assert_eq!(history.note_id(), &note_id);
        assert!(current.allows(&note_id));
        assert_eq!(restore.note_id(), &note_id);
        assert_eq!(restore.revision_id(), &revision_id);
        assert_eq!(restore.turn_id(), &TurnIdentity::new("turn-1"));
    }

    #[test]
    fn observe_returns_a_typed_receipt_without_claiming_unseen_history() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-observe-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let path = PathBuf::from("/vault/Observed.md");

        let receipt = NoteTimeline::new(&state).observe(VaultObservation::external_edit(
            path.clone(),
            42,
            Some(41),
        ));

        assert_eq!(receipt.path(), path);
        assert_eq!(receipt.source(), VaultObservationSource::Watcher);
        assert_eq!(receipt.kind(), VaultObservationKind::CanonicalState);
        assert_eq!(receipt.observed_at_millis(), 42);
        assert_eq!(receipt.modified_at_millis(), Some(41));

        let renamed = NoteTimeline::new(&state).observe(VaultObservation::renamed(
            "/vault/Observed.md",
            "/vault/Renamed.md",
            43,
        ));
        assert_eq!(
            renamed.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Renamed)
        );
        assert_eq!(
            renamed.previous_path(),
            Some(Path::new("/vault/Observed.md"))
        );
        assert_eq!(renamed.path(), Path::new("/vault/Renamed.md"));
    }

    #[test]
    fn reattachment_requires_identity_and_same_path_continuity() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-reattach-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("timeline-reattach-notes");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        let original_path = notes.path().join("Original.md");
        let stale_copy_path = notes.path().join("Stale Copy.md");
        let original_markdown =
            "---\ngneauxghts:\n  id: timeline-reattach-note-1\n  kind: note\n---\n\n# Original";
        fs::write(&original_path, original_markdown).expect("write original note");
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let timeline = NoteTimeline::new(&state);
        timeline.mutate(NoteMutation::editor(
            original_path.clone(),
            None,
            original_markdown.to_string(),
        ));

        fs::remove_file(&original_path).expect("remove original note");
        let missing = timeline.observe(VaultObservation::missing(original_path.clone(), 40));
        assert_eq!(
            missing.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Missing)
        );

        fs::write(&stale_copy_path, original_markdown).expect("write same identity elsewhere");
        let stale_copy = timeline.observe(VaultObservation::external_edit(
            stale_copy_path,
            41,
            Some(40),
        ));
        assert_eq!(stale_copy.kind(), VaultObservationKind::CanonicalState);

        fs::write(&original_path, original_markdown).expect("reattach original identity");
        let reattached = timeline.observe(VaultObservation::external_edit(
            original_path.clone(),
            42,
            Some(41),
        ));
        assert_eq!(
            reattached.kind(),
            VaultObservationKind::Lifecycle(LifecycleEventKind::Reattached)
        );
        assert_eq!(reattached.previous_path(), Some(original_path.as_path()));
        assert_eq!(reattached.path(), original_path);
    }

    #[test]
    fn lifecycle_returns_the_typed_identity_and_paths() {
        let _guard = crate::test_support::lock_test_env();
        let app_data = crate::test_support::TestDir::new("timeline-lifecycle-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let state = AppState::new(
            SemanticState::new_disabled("disabled"),
            EventBus::disabled(),
        )
        .expect("construct app state");
        let note_id = NoteIdentity::new("note-1");

        let receipt = NoteTimeline::new(&state).lifecycle(NoteLifecycleOperation::forgotten(
            note_id.clone(),
            PathBuf::from("/vault/Note.md"),
            PathBuf::from("/vault/.forgotten/Note.md"),
            42,
        ));

        assert_eq!(receipt.kind(), LifecycleEventKind::Forgotten);
        assert_eq!(receipt.note_id(), &note_id);
        assert_eq!(receipt.path(), Path::new("/vault/.forgotten/Note.md"));
        assert_eq!(receipt.previous_path(), Some(Path::new("/vault/Note.md")));
        assert_eq!(receipt.occurred_at_millis(), 42);
    }

    #[test]
    fn warning_serialization_retains_the_existing_ipc_shape() {
        let warning = NoteMutationWarning::single(
            MutationWarningStage::CatalogUpsert,
            "Saved with degraded synchronization".to_string(),
            "catalog unavailable".to_string(),
        );

        assert_eq!(
            serde_json::to_value(warning).unwrap(),
            serde_json::json!({
                "message": "Saved with degraded synchronization",
                "issues": [{
                    "stage": "catalogUpsert",
                    "message": "catalog unavailable"
                }]
            })
        );
    }

    #[test]
    fn domain_records_carry_versioned_payloads_and_explicit_predecessors() {
        let note_id = NoteIdentity::new("note-1");
        let first = NoteRevisionHeader::issue(
            note_id.clone(),
            None,
            PayloadVersion::V1,
            MutationSource::Editor,
        );
        let first_id = first.identity.clone();
        let renamed = LifecycleEventHeader::issue(
            note_id.clone(),
            Some(TimelineRecordIdentity::Revision(first_id.clone())),
            PayloadVersion::V1,
            LifecycleEventKind::Renamed,
        );
        let event_id = renamed.identity.clone();
        let second = NoteRevisionHeader::issue(
            note_id,
            Some(TimelineRecordIdentity::LifecycleEvent(event_id)),
            PayloadVersion::V1,
            MutationSource::Editor,
        );

        assert_eq!(first.identity.0.len(), 26);
        assert_eq!(renamed.identity.0.len(), 26);
        assert_eq!(second.identity.0.len(), 26);
        assert_ne!(first.identity.0, renamed.identity.0);
        assert_ne!(renamed.identity.0, second.identity.0);
        assert_eq!(first.predecessor(), None);
        assert_eq!(renamed.kind(), LifecycleEventKind::Renamed);
        assert_eq!(renamed.payload_version(), PayloadVersion::V1);
        assert_eq!(
            second.predecessor(),
            Some(&TimelineRecordIdentity::LifecycleEvent(
                renamed.identity.clone()
            ))
        );
    }

    #[test]
    fn mutation_result_preserves_required_warning_semantics_and_all_diagnostics() {
        let result = NoteMutationResult::from_publication(
            MutationSource::Editor,
            PublicationOutcome {
                note_id: "note-1".to_string(),
                path: PathBuf::from("/vault/Note.md"),
                canonical_markdown: "# Note".to_string(),
                issues: vec![
                    PublicationIssue {
                        stage: PublicationStage::CanonicalRead,
                        message: "read failed".to_string(),
                    },
                    PublicationIssue {
                        stage: PublicationStage::SemanticUpdate,
                        message: "semantic queue failed".to_string(),
                    },
                ],
            },
        );

        let warning = result.warning().expect("required warning");
        assert_eq!(warning.payload_version(), PayloadVersion::V1);
        assert_eq!(warning.issues().len(), 1);
        assert!(warning.message().contains("Canonical note file was saved"));
        assert_eq!(result.diagnostics().len(), 2);
    }
}
