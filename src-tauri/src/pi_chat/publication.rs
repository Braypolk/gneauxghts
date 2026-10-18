//! Scoped mutation admission and durable NoteTimeline proofs. Pi owns task scheduling.
use super::authority::{
    opaque_id, AuthoritySnapshot, AuthorityStore, DomainError, DomainResult, NoteScope, WriteGrant,
    WriteOperation, WritePolicy,
};
use super::notes;
use crate::{
    index::AppState,
    services::note_timeline::{
        HistoryError, NoteIdentity, NoteMutationResult, NoteMutationWarning, PublicationProof,
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};

#[cfg(test)]
thread_local! { static BEFORE_PROOF:std::cell::RefCell<Option<Box<dyn FnOnce()>>>=Default::default(); static FAULT:std::cell::Cell<Option<&'static str>>=const { std::cell::Cell::new(None) }; }
#[cfg(test)]
fn take_fault(at: &str) -> bool {
    FAULT.with(|fault| {
        if fault.get() == Some(at) {
            fault.set(None);
            true
        } else {
            false
        }
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Mutation {
    Create {
        folder: String,
        title: String,
        markdown: String,
    },
    Update {
        #[serde(rename = "noteId")]
        note_id: String,
        #[serde(rename = "expectedReadSourceId")]
        expected_read_source_id: String,
        markdown: String,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublicationTarget {
    pub note_id: Option<String>,
    pub path: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedMutation {
    pub intent_id: String,
    pub payload_hash: String,
    pub review_required: bool,
    pub target: PublicationTarget,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creation: Option<CreationPreview>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CreationPreview {
    pub destination: String,
    pub markdown: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum PublicationResult {
    Committed {
        #[serde(rename = "receiptId")]
        receipt_id: String,
        #[serde(rename = "noteId")]
        note_id: String,
        path: String,
        markdown: String,
        #[serde(rename = "commitWarning", skip_serializing_if = "Option::is_none")]
        commit_warning: Option<NoteMutationWarning>,
    },
    Blocked {
        code: String,
        message: String,
    },
    Unpublished,
}
#[derive(Clone, Deserialize, Serialize)]
struct Payload {
    mutation: Mutation,
    target: PublicationTarget,
    identity: String,
    raw_base_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    creation_markdown: Option<String>,
}
struct Intent {
    id: String,
    authority_id: String,
    revision: u64,
    payload: Payload,
    hash: String,
    review_required: bool,
    approved: bool,
    rejected: bool,
    proof: Option<PublicationProof>,
    result: Option<PublicationResult>,
}
fn schema(connection: &Connection) -> DomainResult<()> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS pi_chat_mutations (
      intent_id TEXT PRIMARY KEY,authority_id TEXT NOT NULL REFERENCES pi_chat_authorities(authority_id),authority_revision INTEGER NOT NULL,
      request_id TEXT NOT NULL,payload_json TEXT NOT NULL,payload_hash TEXT NOT NULL,review_required INTEGER NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,rejected INTEGER NOT NULL DEFAULT 0,proof_json TEXT,result_json TEXT,
      UNIQUE(authority_id,request_id));")?;
    Ok(())
}
fn encode(value: &impl Serialize) -> DomainResult<String> {
    serde_json::to_string(value)
        .map_err(|_| DomainError::new("storage", "Publication metadata is unavailable."))
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> DomainResult<T> {
    serde_json::from_str(value)
        .map_err(|_| DomainError::new("storage", "Publication metadata is invalid."))
}
fn load(connection: &Connection, id: &str) -> DomainResult<Intent> {
    schema(connection)?;
    let row=connection.query_row("SELECT authority_id,authority_revision,payload_json,payload_hash,review_required,approved,rejected,proof_json,result_json FROM pi_chat_mutations WHERE intent_id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,u64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,bool>(4)?,r.get::<_,bool>(5)?,r.get::<_,bool>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?))).optional()?;
    let (authority_id, revision, payload, hash, review_required, approved, rejected, proof, result) =
        row.ok_or_else(|| DomainError::new("unknown_intent", "Unknown publication intent."))?;
    Ok(Intent {
        id: id.into(),
        authority_id,
        revision,
        payload: decode(&payload)?,
        hash,
        review_required,
        approved,
        rejected,
        proof: proof.map(|s| decode(&s)).transpose()?,
        result: result.map(|s| decode(&s)).transpose()?,
    })
}
fn invalid(message: &str) -> DomainError {
    DomainError::new("invalid_mutation", message)
}
fn canonical_target(root: &Path, path: &Path) -> DomainResult<PathBuf> {
    crate::path_utils::canonical_agent_commit_target(root, path)
        .map_err(|_| invalid("Mutation target is outside the Running Vault or unavailable."))
}
fn running_root(state: &AppState, store: &AuthorityStore) -> DomainResult<PathBuf> {
    store.require_running_vault(state.running_vault())?;
    std::fs::canonicalize(state.running_vault().root())
        .map_err(|_| invalid("Running Vault is unavailable."))
}
fn folder_path(root: &Path, folder: &str) -> DomainResult<PathBuf> {
    let relative = Path::new(folder);
    if relative.is_absolute()
        || folder.contains('\\')
        || relative.components().any(|c| {
            !matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
    {
        return Err(invalid("Choose a folder relative to the Running Vault."));
    }
    let path = std::fs::canonicalize(root.join(relative))
        .map_err(|_| invalid("The target folder does not exist."))?;
    if !path.starts_with(root) || crate::state::is_forgotten_note_path(&path, root) {
        return Err(invalid("The target folder is unavailable."));
    }
    Ok(path)
}
fn grant_parts(snapshot: &AuthoritySnapshot) -> DomainResult<(&[WriteOperation], &NoteScope)> {
    match &snapshot.write.grant {
        WriteGrant::Off => Err(DomainError::new("write_off", "Write authority is Off.")),
        WriteGrant::Temporary {
            operations, scope, ..
        }
        | WriteGrant::Always { operations, scope } => Ok((operations, scope)),
    }
}
fn authorize(snapshot: &AuthoritySnapshot, payload: &Payload, root: &Path) -> DomainResult<()> {
    let (operations, scope) = grant_parts(snapshot)?;
    let operation = match payload.mutation {
        Mutation::Update { .. } => WriteOperation::Update,
        Mutation::Create { .. } => WriteOperation::Create,
    };
    if !operations.contains(&operation) {
        return Err(DomainError::new(
            "operation_denied",
            "This write operation is outside the grant.",
        ));
    }
    let path = Path::new(&payload.target.path);
    let note_allowed = matches!(payload.mutation, Mutation::Update { .. })
        && scope.note_ids.contains(&payload.identity);
    let folder_allowed = scope
        .folders
        .iter()
        .any(|folder| folder_path(root, folder).is_ok_and(|folder| path.starts_with(folder)));
    if !note_allowed && !folder_allowed {
        return Err(DomainError::new(
            "scope_denied",
            "This target is outside the write grant.",
        ));
    }
    Ok(())
}
fn creation_preview(payload: &Payload, root: &Path) -> Option<CreationPreview> {
    let canonical = payload.creation_markdown.as_ref()?;
    let parsed = crate::note::parse_note(canonical);
    let markdown = match parsed.frontmatter.raw_other {
        Some(other) => format!("---\n{other}---\n\n{}", parsed.body),
        None => parsed.body,
    };
    Some(CreationPreview {
        destination: Path::new(&payload.target.path)
            .strip_prefix(root)
            .ok()?
            .to_string_lossy()
            .into(),
        markdown,
    })
}
fn require_absent(path: &Path) -> DomainResult<()> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(DomainError::new(
            "target_exists",
            "A file already occupies this destination. Choose another title.",
        )),
        Err(_) => Err(invalid("The creation destination is unavailable.")),
    }
}
pub(crate) fn prepare(
    state: &AppState,
    store: &AuthorityStore,
    authority_id: &str,
    request_id: &str,
    mutation: Mutation,
) -> DomainResult<PreparedMutation> {
    if request_id.is_empty() || request_id.len() > 256 {
        return Err(invalid("A stable mutation request identity is required."));
    }
    store.with_effect(|| {
        let root=running_root(state,store)?;
        store.with_authority_locked(authority_id,None,|connection,snapshot|{
            schema(connection)?;
            let previous:Option<String>=connection.query_row("SELECT intent_id FROM pi_chat_mutations WHERE authority_id=?1 AND request_id=?2",params![authority_id,request_id],|r|r.get(0)).optional()?;
            if let Some(id)=previous {
                let intent=load(connection,&id)?;
                if encode(&intent.payload.mutation)? != encode(&mutation)? {return Err(DomainError::new("request_mismatch","The mutation request identity already binds a different payload."));}
                let creation=creation_preview(&intent.payload,&root);
                return Ok(PreparedMutation{intent_id:id,payload_hash:intent.hash,review_required:intent.review_required,target:intent.payload.target,creation});
            }
            let markdown=match &mutation { Mutation::Update{markdown,..}|Mutation::Create{markdown,..}=>markdown };
            if markdown.len()>8*1024*1024{return Err(invalid("Mutation content is too large."));}

            let (target,identity,raw_base_hash,creation_markdown)=match &mutation{
                Mutation::Create{folder,title,markdown}=>{
                    if title.trim().is_empty() || title.len()>512 {return Err(invalid("Choose a nonempty note title."));}
                    let directory=folder_path(&root,folder)?;
                    if !directory.is_dir() || directory.strip_prefix(&root).map_err(|_|invalid("Invalid folder."))?.components().any(|part|part.as_os_str().to_string_lossy().starts_with('.')) {return Err(invalid("Choose an existing visible vault folder."));}
                    let stem=crate::state::derive_file_stem_from_title_and_markdown(title,markdown);
                    if stem.starts_with('.') {return Err(invalid("Choose a visible note title."));}
                    let path=canonical_target(&root,&directory.join(format!("{stem}.md")))?;
                    require_absent(&path)?;
                    let identity=crate::note::generate_note_id();
                    // New metadata and identity belong to native creation, never model-provided frontmatter.
                    let parsed=crate::note::parse_note(&crate::note::normalize_wikilink_markdown(markdown));
                    let authored=match parsed.frontmatter.raw_other {Some(other)=>format!("---\n{other}---\n\n{}",parsed.body),None=>parsed.body};
                    let canonical=crate::note::prepare_note_markdown(&authored,None,Some(None)).map_err(|_|invalid("Invalid note content."))?.0;
                    let canonical=crate::note::repair_managed_note_identity(&canonical,&identity).map_err(|_|invalid("Invalid note identity."))?;
                    (PublicationTarget{note_id:Some(identity.clone()),path:path.to_string_lossy().into()},identity,String::new(),Some(canonical))
                }
                Mutation::Update{note_id,expected_read_source_id,..}=>{
                    let source=notes::receipt_in(connection,snapshot,expected_read_source_id)?;
                    if source.source.note_id != *note_id{return Err(invalid("The read source belongs to a different note."));}
                    let path=notes::source_navigation_note(state,snapshot,connection,note_id)?;
                    if path != source.canonical_path{return Err(DomainError::new("changed_base","The note location changed after the read."));}
                    let path=canonical_target(&root,&path)?;
                    (PublicationTarget{note_id:Some(note_id.clone()),path:path.to_string_lossy().into()},note_id.clone(),source.raw_base_hash,None)
                }
            };
            let payload=Payload{mutation,target:target.clone(),identity,raw_base_hash,creation_markdown};
            authorize(snapshot,&payload,&root)?;
            let json=encode(&payload)?;
            let hash=crate::semantic::db::content_hash(&format!("pi-chat-mutation-v1\0{json}"));
            let id=opaque_id()?;
            connection.execute("INSERT INTO pi_chat_mutations(intent_id,authority_id,authority_revision,request_id,payload_json,payload_hash,review_required) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,authority_id,snapshot.revision,request_id,json,hash,snapshot.write.review_before_applying])?;
            let creation=creation_preview(&payload,&root);
            Ok(PreparedMutation{intent_id:id,payload_hash:hash,review_required:snapshot.write.review_before_applying,target,creation})
        })
    })
}
pub(crate) fn approve(
    store: &AuthorityStore,
    authority_id: &str,
    intent_id: &str,
    hash: &str,
) -> DomainResult<()> {
    store.with_authority(authority_id, None, |connection, _| {
        let intent = load(connection, intent_id)?;
        if intent.authority_id != authority_id || intent.hash != hash || intent.rejected {
            return Err(DomainError::new(
                "approval_mismatch",
                "Approval does not match this exact pending mutation.",
            ));
        }
        connection.execute(
            "UPDATE pi_chat_mutations SET approved=1 WHERE intent_id=?1",
            [intent_id],
        )?;
        Ok(())
    })
}
pub(crate) fn reject(
    store: &AuthorityStore,
    authority_id: &str,
    intent_id: &str,
) -> DomainResult<()> {
    store.with_authority(authority_id,None,|connection,_|{
        let intent=load(connection,intent_id)?;
        if intent.authority_id!=authority_id{return Err(DomainError::new("foreign_intent","Mutation belongs to another conversation."));}
        connection.execute("UPDATE pi_chat_mutations SET rejected=1 WHERE intent_id=?1 AND proof_json IS NULL AND result_json IS NULL",[intent_id])?;Ok(())
    })
}
fn persist_result(
    store: &AuthorityStore,
    id: &str,
    result: &PublicationResult,
) -> DomainResult<()> {
    store.connection()?.execute(
        "UPDATE pi_chat_mutations SET result_json=?2 WHERE intent_id=?1",
        params![id, encode(result)?],
    )?;
    Ok(())
}
fn committed(outcome: NoteMutationResult) -> DomainResult<PublicationResult> {
    let session = crate::commands::note_persistence::build_note_session_from_mutation(&outcome);
    Ok(PublicationResult::Committed {
        receipt_id: opaque_id()?,
        note_id: outcome.note_id().as_str().into(),
        path: session
            .path
            .ok_or_else(|| invalid("Committed note has no path."))?,
        markdown: session.markdown,
        commit_warning: session.commit_warning,
    })
}
fn reconcile_locked(
    state: &AppState,
    store: &AuthorityStore,
    intent: &Intent,
) -> DomainResult<PublicationResult> {
    running_root(state, store)?;
    if let Some(result) = &intent.result {
        return Ok(result.clone());
    }
    if let Some(proof) = &intent.proof {
        match state
            .note_timeline()
            .reconcile_publication(proof)
            .map_err(|_| {
                DomainError::new(
                    "uncertain_publication",
                    "Publication proof cannot yet be reconciled.",
                )
            })? {
            Some(outcome) => {
                let result = committed(outcome)?;
                persist_result(store, &intent.id, &result)?;
                return Ok(result);
            }
            None => {}
        }
    }
    if intent.rejected {
        return Ok(PublicationResult::Blocked {
            code: "rejected".into(),
            message: "The exact mutation was rejected.".into(),
        });
    }
    Ok(PublicationResult::Unpublished)
}
pub(crate) fn reconcile(
    state: &AppState,
    store: &AuthorityStore,
    intent_id: &str,
) -> DomainResult<PublicationResult> {
    store.with_effect(|| reconcile_locked(state, store, &load(&store.connection()?, intent_id)?))
}

#[derive(Default)]
struct Editors {
    webview_generation: u64,
    quiesced: bool,
    terminal: bool,
    owners: HashSet<String>,
    admissions: HashMap<String, Admission>,
}
struct Admission {
    owner: String,
    id: String,
    target: PublicationTarget,
}
/// Ephemeral owner-controlled leases; never claims to infer unsaved WebView state.
#[derive(Default)]
pub(crate) struct EditorAdmissions {
    editors: Mutex<Editors>,
    webview_generation: AtomicU64,
}
impl EditorAdmissions {
    /// Native page replacement ends the old document lifetime. Do not wait on
    /// an in-flight publication from the page-load/main thread; bind joins it.
    pub(crate) fn advance_webview_generation(&self) {
        self.webview_generation.fetch_add(1, Ordering::SeqCst);
    }
    fn current_webview_generation(&self) -> u64 {
        self.webview_generation.load(Ordering::SeqCst)
    }
    pub(crate) fn quiesce_for_restart(&self) -> DomainResult<()> {
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        // Joining this lock settles every claimed effect before admission is withdrawn.
        editors.quiesced = true;
        editors.admissions.clear();
        Ok(())
    }
    pub(crate) fn resume_after_failed_restart(&self) -> DomainResult<()> {
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        if editors.terminal {
            return Err(DomainError::new(
                "closed",
                "Publication cannot resume after terminal shutdown.",
            ));
        }
        editors.quiesced = false;
        Ok(())
    }
    pub(crate) fn finish_restart_shutdown(&self) -> DomainResult<()> {
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        editors.quiesced = true;
        editors.terminal = true;
        editors.admissions.clear();
        editors.owners.clear();
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn bind(&self) -> DomainResult<String> {
        self.bind_for_generation(self.current_webview_generation())
    }
    fn bind_for_generation(&self, generation: u64) -> DomainResult<String> {
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        if editors.quiesced {
            return Err(DomainError::new(
                "closed",
                "Publication admission is closed for restart.",
            ));
        }
        if generation != self.current_webview_generation() {
            return Err(DomainError::new(
                "stale_editor_page",
                "The editor owner binding belongs to a replaced WebView page.",
            ));
        }
        if editors.webview_generation != generation {
            // Taking this mutex joins every already claimed native effect.
            editors.owners.clear();
            editors.admissions.clear();
            editors.webview_generation = generation;
        }
        if !editors.owners.is_empty() {
            return Err(DomainError::new(
                "editor_owner_exists",
                "The workspace already has an editor publication owner.",
            ));
        }
        let id = opaque_id()?;
        editors.owners.insert(id.clone());
        Ok(id)
    }
    pub(crate) fn admit(
        &self,
        store: &AuthorityStore,
        owner: &str,
        intent_id: &str,
        target: PublicationTarget,
    ) -> DomainResult<String> {
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        if editors.quiesced
            || editors.webview_generation != self.webview_generation.load(Ordering::SeqCst)
            || !editors.owners.contains(owner)
            || editors.admissions.contains_key(intent_id)
        {
            return Err(DomainError::new(
                "editor_conflict",
                "The editor publication lease is unavailable.",
            ));
        }
        let intent = load(&store.connection()?, intent_id)?;
        if intent.payload.target != target {
            return Err(DomainError::new(
                "editor_conflict",
                "Editor admission target does not match the native intent.",
            ));
        }
        let id = opaque_id()?;
        editors.admissions.insert(
            intent_id.into(),
            Admission {
                owner: owner.into(),
                id: id.clone(),
                target,
            },
        );
        Ok(id)
    }
    pub(crate) fn release(&self, owner: &str, id: &str) -> DomainResult<()> {
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        editors
            .admissions
            .retain(|_, admission| admission.owner != owner || admission.id != id);
        Ok(())
    }
    pub(crate) fn close(&self, owner: &str) -> DomainResult<()> {
        // Acquiring this lock joins any in-flight publication before acknowledging disposal.
        let mut editors = self
            .editors
            .lock()
            .map_err(|_| invalid("Editor owner is unavailable."))?;
        editors.owners.remove(owner);
        editors
            .admissions
            .retain(|_, admission| admission.owner != owner);
        Ok(())
    }
}
pub(crate) fn publish(
    state: &AppState,
    store: &AuthorityStore,
    editors: &EditorAdmissions,
    authority_id: &str,
    intent_id: &str,
) -> DomainResult<PublicationResult> {
    // Lock order: live editor owner → policy/effect gate → short SQL, then Timeline → proof SQL.
    let editor = editors
        .editors
        .lock()
        .map_err(|_| invalid("Editor owner is unavailable."))?;
    store.with_effect(||{
        let intent=load(&store.connection()?,intent_id)?;
        if intent.authority_id!=authority_id{return Err(DomainError::new("foreign_intent","Mutation belongs to another conversation."));}
        let prior=reconcile_locked(state,store,&intent)?;
        if !matches!(prior,PublicationResult::Unpublished){return Ok(prior);}
        if editor.quiesced{return Err(DomainError::new("closed","Publication admission is closed for restart."));}
        if editor.webview_generation!=editors.webview_generation.load(Ordering::SeqCst){return Err(DomainError::new("editor_conflict","The document owner belongs to a replaced WebView page."));}
        let admission=editor.admissions.get(intent_id).ok_or_else(||DomainError::new("editor_conflict","A live document-owner publication lease is required."))?;
        if !editor.owners.contains(&admission.owner) || admission.target!=intent.payload.target{return Err(DomainError::new("editor_conflict","The document owner lease is no longer valid."));}
        let root=running_root(state,store)?;
        let admission_result=store.with_authority_locked(authority_id,Some(intent.revision),|connection,snapshot|{
            authorize(snapshot,&intent.payload,&root)?;
            if (intent.review_required || snapshot.write.review_before_applying) && !intent.approved{return Err(DomainError::new("review_required","Approve this exact mutation before applying it."));}
            let path=canonical_target(&root,Path::new(&intent.payload.target.path))?;
            if path.to_string_lossy()!=intent.payload.target.path{return Err(DomainError::new("changed_base","The canonical target changed."));}
            match &intent.payload.mutation {
                Mutation::Update{note_id,expected_read_source_id,..}=>{
                    let source=notes::receipt_in(connection,snapshot,expected_read_source_id)?;
                    if source.source.note_id!=*note_id || source.canonical_path!=path || source.raw_base_hash!=intent.payload.raw_base_hash{return Err(DomainError::new("changed_base","The read source no longer matches this target."));}
                    let current=notes::source_navigation_note(state,snapshot,connection,note_id)?;
                    if current!=path{return Err(DomainError::new("changed_base","The note location changed."));}
                }
                Mutation::Create{folder,..}=>{
                    if path.parent()!=Some(folder_path(&root,folder)?.as_path()) {return Err(invalid("The destination folder changed. Prepare again."));}
                    require_absent(&path)?;
                }
            }
            Ok(path)
        });
        let path=match admission_result {Ok(path)=>path,Err(error)=>return Ok(PublicationResult::Blocked{code:error.code,message:error.message})};
        let record=|proof:&PublicationProof|->Result<(),HistoryError>{
            #[cfg(test)]
            BEFORE_PROOF.with(|hook|if let Some(callback)=hook.borrow_mut().take(){callback();});
            // Autocommit FULL durability is mandatory before NoteTimeline exposes new bytes.
            let connection=store.connection().map_err(|e|HistoryError::from(e.message))?;
            let recorded=connection.execute("UPDATE pi_chat_mutations SET proof_json=?2 WHERE intent_id=?1 AND payload_hash=?3",params![intent_id,encode(proof).map_err(|e|HistoryError::from(e.message))?,intent.hash]).map_err(|e|HistoryError::from(e.to_string()))?;
            if recorded != 1{return Err("Publication proof was not retained for its exact intent".into());}
            #[cfg(test)]
            if take_fault("afterProof") { return Err("simulated interruption after durable proof before canonical write".into()); }
            Ok(())
        };
        let identity=NoteIdentity::new(&intent.payload.identity);
        let outcome=match &intent.payload.mutation {
            Mutation::Update{markdown,..}=>state.note_timeline().update_note_with_proof(&path,&identity,&intent.payload.raw_base_hash,markdown,&record),
            Mutation::Create{..}=>state.note_timeline().create_note_with_proof(&path,&identity,intent.payload.creation_markdown.as_deref().ok_or_else(||invalid("Missing prepared creation content."))?,&record),
        };
        let result=match outcome {
            Ok(outcome)=>committed(outcome)?,
            Err(HistoryError::Stale(_))=>if matches!(intent.payload.mutation,Mutation::Create{..}) {PublicationResult::Blocked{code:"target_exists".into(),message:"The creation destination changed. Choose another title.".into()}} else {PublicationResult::Blocked{code:"changed_base".into(),message:"Canonical note content or identity changed. Read and prepare again.".into()}},
            Err(_)=>return Err(DomainError::new("uncertain_publication","Publication could not be confirmed. Reconcile before another attempt.")),
        };
        #[cfg(test)]
        if take_fault("lostAck") { return Err(DomainError::new("interrupted","simulated lost acknowledgement after canonical publication")); }
        persist_result(store,intent_id,&result)?;Ok(result)
    })
}

#[tauri::command]
pub(crate) fn pi_chat_get_write_defaults(
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, AuthorityStore>,
) -> DomainResult<WritePolicy> {
    store.require_running_vault(state.running_vault())?;
    store.vault_write()
}
#[tauri::command]
pub(crate) fn pi_chat_set_write_defaults(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, AuthorityStore>,
    write: WritePolicy,
) -> DomainResult<WritePolicy> {
    store.require_running_vault(state.running_vault())?;
    let write = store.set_vault_write(write)?;
    app.emit(
        "pi-chat-authority-changed",
        serde_json::json!({"retiredAuthorityIds":[],"writePolicyChanged":true}),
    )
    .ok();
    Ok(write)
}
#[tauri::command]
pub(crate) fn pi_chat_set_write_policy(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, AuthorityStore>,
    authority_id: String,
    expected_revision: u64,
    write: WritePolicy,
) -> DomainResult<AuthoritySnapshot> {
    store.require_running_vault(state.running_vault())?;
    let snapshot = store.set_write(&authority_id, expected_revision, write)?;
    // Review and Always grants are vault-wide; mounted conversations must reread
    // native authority instead of maintaining copied policy in Pi documents.
    app.emit(
        "pi-chat-authority-changed",
        serde_json::json!({"retiredAuthorityIds":[],"writePolicyChanged":true}),
    )
    .ok();
    Ok(snapshot)
}
#[tauri::command]
pub(crate) async fn pi_chat_prepare_mutation(
    app: tauri::AppHandle,
    authority_id: String,
    request_id: String,
    mutation: Mutation,
) -> DomainResult<PreparedMutation> {
    tauri::async_runtime::spawn_blocking(move || {
        prepare(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &authority_id,
            &request_id,
            mutation,
        )
    })
    .await
    .map_err(|_| invalid("Mutation preparation was interrupted."))?
}
#[tauri::command]
pub(crate) fn pi_chat_approve_mutation(
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, AuthorityStore>,
    authority_id: String,
    intent_id: String,
    payload_hash: String,
) -> DomainResult<()> {
    store.require_running_vault(state.running_vault())?;
    approve(&store, &authority_id, &intent_id, &payload_hash)
}
#[tauri::command]
pub(crate) fn pi_chat_reject_mutation(
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, AuthorityStore>,
    authority_id: String,
    intent_id: String,
) -> DomainResult<()> {
    store.require_running_vault(state.running_vault())?;
    reject(&store, &authority_id, &intent_id)
}
#[tauri::command]
pub(crate) async fn pi_chat_publish_mutation(
    app: tauri::AppHandle,
    authority_id: String,
    intent_id: String,
) -> DomainResult<PublicationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        publish(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &app.state::<EditorAdmissions>(),
            &authority_id,
            &intent_id,
        )
    })
    .await
    .map_err(|_| invalid("Publication was interrupted; reconcile its native intent."))?
}
#[tauri::command]
pub(crate) async fn pi_chat_reconcile_mutation(
    app: tauri::AppHandle,
    intent_id: String,
) -> DomainResult<PublicationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        reconcile(
            &app.state::<AppState>(),
            &app.state::<AuthorityStore>(),
            &intent_id,
        )
    })
    .await
    .map_err(|_| invalid("Publication reconciliation was interrupted."))?
}
#[tauri::command]
pub(crate) async fn pi_chat_bind_editor_owner(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> DomainResult<String> {
    if webview.label() != "main" {
        return Err(DomainError::new(
            "editor_conflict",
            "Only the main workspace WebView may bind its document owner.",
        ));
    }
    // Capture at command admission, before this work can queue behind an old
    // effect. A discarded page must never claim the replacement generation.
    let generation = app.state::<EditorAdmissions>().current_webview_generation();
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<EditorAdmissions>()
            .bind_for_generation(generation)
    })
    .await
    .map_err(|_| invalid("Editor owner binding was interrupted."))?
}
#[tauri::command]
pub(crate) fn pi_chat_admit_editor_publication(
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, AuthorityStore>,
    editors: tauri::State<'_, EditorAdmissions>,
    owner_id: String,
    intent_id: String,
    target: PublicationTarget,
) -> DomainResult<String> {
    store.require_running_vault(state.running_vault())?;
    editors.admit(&store, &owner_id, &intent_id, target)
}
#[tauri::command]
pub(crate) async fn pi_chat_release_editor_publication(
    app: tauri::AppHandle,
    owner_id: String,
    admission_id: String,
) -> DomainResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<EditorAdmissions>()
            .release(&owner_id, &admission_id)
    })
    .await
    .map_err(|_| invalid("Editor publication settlement was interrupted."))?
}
#[tauri::command]
pub(crate) async fn pi_chat_close_editor_owner(
    app: tauri::AppHandle,
    owner_id: String,
) -> DomainResult<()> {
    tauri::async_runtime::spawn_blocking(move || app.state::<EditorAdmissions>().close(&owner_id))
        .await
        .map_err(|_| invalid("Editor owner settlement was interrupted."))?
}

#[cfg(test)]
mod tests {
    use super::super::authority::{ConversationBinding, ReadMode, ReadPolicy};
    use super::*;
    use crate::test_support::{save_and_finalize, TestVault};
    fn setup(_vault: &TestVault) -> (AuthorityStore, AuthoritySnapshot, EditorAdmissions, String) {
        let data = crate::state::vault_data_dir().unwrap();
        let _settings = crate::chat_domain::ChatDomain::new(data.clone()).unwrap();
        let store = AuthorityStore::new(&data).unwrap();
        let snapshot = bind(&store, 1);
        let editors = EditorAdmissions::default();
        let owner = editors.bind().unwrap();
        (store, snapshot, editors, owner)
    }
    fn bind(store: &AuthorityStore, id: u64) -> AuthoritySnapshot {
        store
            .bind(
                ConversationBinding {
                    conversation_id: id,
                    provider_session_id: format!("provider-{id}"),
                },
                ReadPolicy {
                    mode: ReadMode::FullVault,
                    attached_note_ids: vec![],
                },
            )
            .unwrap()
    }
    fn scope() -> NoteScope {
        NoteScope {
            note_ids: vec![],
            folders: vec![".".into()],
        }
    }
    fn temporary(
        store: &AuthorityStore,
        snapshot: &AuthoritySnapshot,
        review: bool,
    ) -> AuthoritySnapshot {
        store
            .set_write(
                &snapshot.authority_id,
                snapshot.revision,
                WritePolicy {
                    grant: WriteGrant::Temporary {
                        conversation_id: 1,
                        operations: vec![WriteOperation::Update],
                        scope: scope(),
                    },
                    review_before_applying: review,
                },
            )
            .unwrap()
    }
    fn update(
        vault: &TestVault,
        store: &AuthorityStore,
        authority_id: &str,
        title: &str,
    ) -> Mutation {
        let note = save_and_finalize(&vault.state, title.into(), "Original".into(), None)
            .unwrap()
            .unwrap();
        let note_id = note.note_id.unwrap();
        let source = notes::read_note(&vault.state, store, authority_id, &note_id).unwrap();
        Mutation::Update {
            note_id,
            expected_read_source_id: source.source.source_id,
            markdown: "Synthetic authored content".into(),
        }
    }
    fn original(target: &PublicationTarget) {
        assert!(std::fs::read_to_string(&target.path)
            .unwrap()
            .ends_with("Original"));
    }
    fn admit(
        editors: &EditorAdmissions,
        store: &AuthorityStore,
        owner: &str,
        intent: &PreparedMutation,
    ) -> String {
        editors
            .admit(store, owner, &intent.intent_id, intent.target.clone())
            .unwrap()
    }
    fn committed_id(result: &PublicationResult) -> String {
        match result {
            PublicationResult::Committed { note_id, .. } => note_id.clone(),
            other => panic!("expected committed, got {other:?}"),
        }
    }
    fn revision_count(note_id: &str) -> u64 {
        Connection::open(
            crate::state::vault_data_dir()
                .unwrap()
                .join("history.sqlite3"),
        )
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM revisions WHERE note_id=?1",
            [note_id],
            |r| r.get(0),
        )
        .unwrap()
    }
    fn creation(title: &str) -> Mutation {
        serde_json::from_value(serde_json::json!({"operation":"create","folder":".","title":title,"markdown":"Created body\n"})).unwrap()
    }
    fn creation_authority(
        store: &AuthorityStore,
        snapshot: &AuthoritySnapshot,
        review: bool,
    ) -> AuthoritySnapshot {
        store
            .set_write(
                &snapshot.authority_id,
                snapshot.revision,
                WritePolicy {
                    grant: WriteGrant::Temporary {
                        conversation_id: 1,
                        operations: vec![
                            serde_json::from_value(serde_json::json!("create")).unwrap()
                        ],
                        scope: scope(),
                    },
                    review_before_applying: review,
                },
            )
            .unwrap()
    }
    #[test]
    fn create_requires_explicit_operation_exact_review_and_never_replaces_a_collision() {
        let vault = TestVault::new("pi-create-permission");
        let (store, snapshot, editors, owner) = setup(&vault);
        let update_only = temporary(&store, &snapshot, true);
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &snapshot.authority_id,
                "update-only",
                creation("Created")
            )
            .unwrap_err()
            .code,
            "operation_denied"
        );
        let authority = creation_authority(&store, &update_only, true);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "create",
            creation("Created"),
        )
        .unwrap();
        assert!(!Path::new(&intent.target.path).exists());
        admit(&editors, &store, &owner, &intent);
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&intent.intent_id).unwrap(), PublicationResult::Blocked { code,.. } if code=="review_required")
        );
        assert!(approve(
            &store,
            &authority.authority_id,
            &intent.intent_id,
            "wrong hash"
        )
        .is_err());
        approve(
            &store,
            &authority.authority_id,
            &intent.intent_id,
            &intent.payload_hash,
        )
        .unwrap();
        // An external creator can win after exact review. Never select a new path or replace it.
        std::fs::write(&intent.target.path, "Human file").unwrap();
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&intent.intent_id).unwrap(), PublicationResult::Blocked { code,.. } if code=="target_exists")
        );
        assert_eq!(
            std::fs::read_to_string(&intent.target.path).unwrap(),
            "Human file"
        );
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &authority.authority_id,
                "collision",
                creation("Created")
            )
            .unwrap_err()
            .code,
            "target_exists"
        );
    }
    #[test]
    fn create_lost_ack_reopens_one_identity_and_receipt_without_a_second_file() {
        let vault = TestVault::new("pi-create-restart");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = creation_authority(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "stable-create",
            creation("Created once"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        FAULT.with(|f| f.set(Some("lostAck")));
        assert!(publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &intent.intent_id
        )
        .is_err());
        let bytes = std::fs::read_to_string(&intent.target.path).unwrap();
        let reopened = AuthorityStore::new(vault.state.running_vault().data_dir()).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("create reopen"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let result = reconcile(&state, &reopened, &intent.intent_id).unwrap();
        let id = committed_id(&result);
        assert!(bytes.ends_with("Created body\n"));
        assert_eq!(revision_count(&id), 1);
        let replay = prepare(
            &state,
            &reopened,
            &authority.authority_id,
            "stable-create",
            creation("Created once"),
        )
        .unwrap();
        assert_eq!(replay.intent_id, intent.intent_id);
        assert_eq!(replay.target, intent.target);
        assert_eq!(
            encode(&reconcile(&state, &reopened, &replay.intent_id).unwrap()).unwrap(),
            encode(&result).unwrap()
        );
        assert_eq!(std::fs::read_to_string(&intent.target.path).unwrap(), bytes);
        assert!(!Path::new(&intent.target.path)
            .with_file_name("Created once 2.md")
            .exists());
        assert_eq!(
            prepare(
                &state,
                &reopened,
                &authority.authority_id,
                "stable-create",
                creation("Different")
            )
            .unwrap_err()
            .code,
            "request_mismatch"
        );
    }

    #[test]
    fn create_retries_a_pre_effect_interruption_with_the_original_identity_and_canonical_bytes() {
        let vault = TestVault::new("pi-create-before");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = creation_authority(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "before",
            creation("Before"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        FAULT.with(|f| f.set(Some("afterProof")));
        assert!(publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &intent.intent_id
        )
        .is_err());
        assert!(!Path::new(&intent.target.path).exists());
        editors.close(&owner).unwrap();
        let reopened = AuthorityStore::new(vault.state.running_vault().data_dir()).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("create before reopen"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        assert!(matches!(
            reconcile(&state, &reopened, &intent.intent_id).unwrap(),
            PublicationResult::Unpublished
        ));
        let replay = prepare(
            &state,
            &reopened,
            &authority.authority_id,
            "before",
            creation("Before"),
        )
        .unwrap();
        assert_eq!(replay.target, intent.target);
        assert_eq!(replay.payload_hash, intent.payload_hash);
        let owner = editors.bind().unwrap();
        admit(&editors, &reopened, &owner, &replay);
        let result = publish(
            &state,
            &reopened,
            &editors,
            &authority.authority_id,
            &replay.intent_id,
        )
        .unwrap();
        assert_eq!(Some(committed_id(&result)), intent.target.note_id);
        assert_eq!(revision_count(&committed_id(&result)), 1);
    }
    #[test]
    fn create_atomic_publication_preserves_a_file_arriving_after_proof() {
        let vault = TestVault::new("pi-create-late-collision");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = creation_authority(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "late",
            creation("Late"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        let path = intent.target.path.clone();
        BEFORE_PROOF.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                std::fs::write(path, "Late human file").unwrap()
            }))
        });
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&intent.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="target_exists")
        );
        assert_eq!(
            std::fs::read_to_string(&intent.target.path).unwrap(),
            "Late human file"
        );
        assert_eq!(revision_count(intent.target.note_id.as_ref().unwrap()), 0);
    }
    #[test]
    fn create_enforces_folder_scope_live_revocation_and_native_identity() {
        let vault = TestVault::new("pi-create-scope");
        let (store, snapshot, editors, owner) = setup(&vault);
        let root = vault.state.running_vault().root().to_path_buf();
        std::fs::create_dir(root.join("Projects")).unwrap();
        std::fs::create_dir(root.join(".private")).unwrap();
        let authority = store
            .set_write(
                &snapshot.authority_id,
                snapshot.revision,
                WritePolicy {
                    grant: WriteGrant::Temporary {
                        conversation_id: 1,
                        operations: vec![WriteOperation::Create],
                        scope: NoteScope {
                            note_ids: vec![],
                            folders: vec!["Projects".into()],
                        },
                    },
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &authority.authority_id,
                "outside",
                creation("Outside")
            )
            .unwrap_err()
            .code,
            "scope_denied"
        );
        for (index, folder) in [
            "../outside",
            "/tmp",
            ".private",
            "missing",
            "Projects/../../outside",
        ]
        .iter()
        .enumerate()
        {
            let mutation = Mutation::Create {
                folder: folder.to_string(),
                title: "Bad".into(),
                markdown: "Body".into(),
            };
            assert_eq!(
                prepare(
                    &vault.state,
                    &store,
                    &authority.authority_id,
                    &format!("bad-{index}"),
                    mutation
                )
                .unwrap_err()
                .code,
                "invalid_mutation"
            );
        }
        let intent=prepare(&vault.state,&store,&authority.authority_id,"scoped",Mutation::Create{
            folder:"Projects".into(),title:"Plan".into(),markdown:"---\nproject: atlas\ngneauxghts:\n  id: model-forged\n  created_at: 1900-01-01T00:00:00Z\n  trashed_at: yesterday\n---\n\n# Plan\n".into()
        }).unwrap();
        let preview = intent.creation.as_ref().unwrap();
        assert_eq!(preview.destination, "Projects/Plan.md");
        assert!(preview.markdown.contains("project: atlas"));
        assert!(!preview.markdown.contains("model-forged"));
        assert_ne!(intent.target.note_id.as_deref(), Some("model-forged"));
        admit(&editors, &store, &owner, &intent);
        approve(
            &store,
            &authority.authority_id,
            &intent.intent_id,
            &intent.payload_hash,
        )
        .unwrap();
        store
            .set_write(
                &authority.authority_id,
                authority.revision,
                WritePolicy {
                    grant: WriteGrant::Off,
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&intent.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="stale_authority")
        );
        assert!(!Path::new(&intent.target.path).exists());
    }
    #[cfg(unix)]
    #[test]
    fn create_rejects_symlink_destinations_and_folders_outside_the_vault() {
        let vault = TestVault::new("pi-create-links");
        let (store, snapshot, _editors, _owner) = setup(&vault);
        let authority = creation_authority(&store, &snapshot, false);
        let root = vault.state.running_vault().root().to_path_buf();
        std::os::unix::fs::symlink("/tmp", root.join("External")).unwrap();
        std::os::unix::fs::symlink(root.join("absent"), root.join("Dangling.md")).unwrap();
        let mutation = Mutation::Create {
            folder: "External".into(),
            title: "No".into(),
            markdown: "Body".into(),
        };
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &authority.authority_id,
                "external",
                mutation
            )
            .unwrap_err()
            .code,
            "invalid_mutation"
        );
        assert!(prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "dangling",
            creation("Dangling")
        )
        .is_err());
        assert!(std::fs::symlink_metadata(root.join("Dangling.md"))
            .unwrap()
            .file_type()
            .is_symlink());
    }
    #[test]
    fn real_update_requires_write_review_exact_payload_and_live_editor_owner() {
        assert!(serde_json::from_value::<Mutation>(serde_json::json!({"operation":"create","folder":".","title":"Bad","markdown":"Body","path":"/arbitrary"})).is_err());
        let vault = TestVault::new("pi-publication-review");
        let (store, snapshot, editors, owner) = setup(&vault);
        assert!(matches!(snapshot.write.grant, WriteGrant::Off));
        assert!(snapshot.write.review_before_applying);
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &snapshot.authority_id,
                "off",
                update(&vault, &store, &snapshot.authority_id, "Off")
            )
            .unwrap_err()
            .code,
            "write_off"
        );
        let authority = temporary(&store, &snapshot, true);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "review",
            update(&vault, &store, &snapshot.authority_id, "Exact Review"),
        )
        .unwrap();
        assert!(intent.review_required);
        assert_eq!(
            approve(
                &store,
                &authority.authority_id,
                &intent.intent_id,
                "changed payload"
            )
            .unwrap_err()
            .code,
            "approval_mismatch"
        );
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &authority.authority_id,
                "review",
                update(&vault, &store, &snapshot.authority_id, "Changed")
            )
            .unwrap_err()
            .code,
            "request_mismatch"
        );
        assert_eq!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &intent.intent_id
            )
            .unwrap_err()
            .code,
            "editor_conflict"
        );
        let admission = admit(&editors, &store, &owner, &intent);
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&intent.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="review_required")
        );
        original(&intent.target);
        approve(
            &store,
            &authority.authority_id,
            &intent.intent_id,
            &intent.payload_hash,
        )
        .unwrap();
        let result = publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &intent.intent_id,
        )
        .unwrap();
        let id = committed_id(&result);
        let raw = std::fs::read_to_string(&intent.target.path).unwrap();
        assert_eq!(
            crate::note::parse_note(&raw)
                .frontmatter
                .managed
                .unwrap()
                .id,
            id
        );
        assert!(raw.contains("Synthetic authored content"));
        assert_eq!(revision_count(&id), 2);
        // Duplicate tasks return the original receipt without another filesystem/history effect.
        assert_eq!(
            encode(
                &publish(
                    &vault.state,
                    &store,
                    &editors,
                    &authority.authority_id,
                    &intent.intent_id
                )
                .unwrap()
            )
            .unwrap(),
            encode(&result).unwrap()
        );
        editors.release(&owner, &admission).unwrap();
        assert_eq!(revision_count(&id), 2);
        let rejected = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "rejected",
            update(&vault, &store, &snapshot.authority_id, "Rejected"),
        )
        .unwrap();
        reject(&store, &authority.authority_id, &rejected.intent_id).unwrap();
        assert!(approve(
            &store,
            &authority.authority_id,
            &rejected.intent_id,
            &rejected.payload_hash
        )
        .is_err());
        assert!(
            matches!(reconcile(&vault.state,&store,&rejected.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="rejected")
        );
        original(&rejected.target);
    }
    #[test]
    fn grants_survive_reopen_are_conversation_or_vault_scoped_and_revoke_atomically() {
        let vault = TestVault::new("pi-publication-grants");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let same = AuthorityStore::new(&crate::state::vault_data_dir().unwrap()).unwrap();
        assert!(matches!(
            bind(&same, 1).write.grant,
            WriteGrant::Temporary {
                conversation_id: 1,
                ..
            }
        ));
        assert!(matches!(bind(&same, 2).write.grant, WriteGrant::Off));
        assert_eq!(
            store
                .set_write(
                    &authority.authority_id,
                    authority.revision,
                    WritePolicy {
                        grant: WriteGrant::Temporary {
                            conversation_id: 2,
                            operations: vec![WriteOperation::Update],
                            scope: scope()
                        },
                        review_before_applying: false
                    }
                )
                .unwrap_err()
                .code,
            "foreign_grant"
        );
        let pending = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "pending",
            update(&vault, &store, &snapshot.authority_id, "Revoked"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &pending);
        let off = store
            .set_write(
                &authority.authority_id,
                authority.revision,
                WritePolicy {
                    grant: WriteGrant::Off,
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert!(matches!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &pending.intent_id
            )
            .unwrap(),
            PublicationResult::Blocked { .. }
        ));
        original(&pending.target);
        let always = store
            .set_write(
                &authority.authority_id,
                off.revision,
                WritePolicy {
                    grant: WriteGrant::Always {
                        operations: vec![WriteOperation::Update],
                        scope: scope(),
                    },
                    review_before_applying: false,
                },
            )
            .unwrap();
        assert!(matches!(
            bind(&same, 3).write.grant,
            WriteGrant::Always { .. }
        ));
        assert!(matches!(
            same.snapshot(&bind(&same, 2).authority_id)
                .unwrap()
                .write
                .grant,
            WriteGrant::Always { .. }
        ));
        let other = bind(&same, 4);
        store
            .set_write(
                &other.authority_id,
                other.revision,
                WritePolicy {
                    grant: WriteGrant::Off,
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert!(matches!(
            store.snapshot(&always.authority_id).unwrap().write.grant,
            WriteGrant::Off
        ));
        let current = store.snapshot(&always.authority_id).unwrap();
        store
            .retire(&current.authority_id, current.revision)
            .unwrap();
        assert!(bind(&same, 1).retired);
        let foreign = crate::test_support::TestDir::new("pi-other-vault-authority");
        let foreign = AuthorityStore::new(foreign.path()).unwrap();
        assert_eq!(
            foreign
                .require_running_vault(vault.state.running_vault())
                .unwrap_err()
                .code,
            "vault_mismatch"
        );
    }
    #[test]
    fn update_uses_native_raw_blake3_receipt_and_rejects_changed_base_identity_or_scope() {
        let vault = TestVault::new("pi-publication-update");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let note = save_and_finalize(&vault.state, "Target".into(), "Original".into(), None)
            .unwrap()
            .unwrap();
        let id = note.note_id.unwrap();
        let path = note.path.unwrap();
        let read = notes::read_note(&vault.state, &store, &authority.authority_id, &id).unwrap();
        let mutation = Mutation::Update {
            note_id: id.clone(),
            expected_read_source_id: read.source.source_id.clone(),
            markdown: "Updated".into(),
        };
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "update",
            mutation.clone(),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        let result = publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &intent.intent_id,
        )
        .unwrap();
        assert_eq!(committed_id(&result), id);
        assert_eq!(revision_count(&id), 2);
        let old = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "old-source",
            mutation,
        )
        .unwrap();
        admit(&editors, &store, &owner, &old);
        let current = std::fs::read_to_string(&path).unwrap();
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&old.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="changed_base")
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), current);
        let fresh = notes::read_note(&vault.state, &store, &authority.authority_id, &id).unwrap();
        let new = Mutation::Update {
            note_id: id.clone(),
            expected_read_source_id: fresh.source.source_id,
            markdown: "Must not overwrite".into(),
        };
        let pending = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "raw-change",
            new.clone(),
        )
        .unwrap();
        admit(&editors, &store, &owner, &pending);
        // Managed-only bytes are outside authored hash, but inside the raw base proof.
        let changed = current.replacen(
            "gneauxghts:\n",
            "gneauxghts:\n  unknownManagedField: changed\n",
            1,
        );
        assert_ne!(changed, current);
        std::fs::write(&path, &changed).unwrap();
        assert!(
            matches!(publish(&vault.state,&store,&editors,&authority.authority_id,&pending.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="changed_base")
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), changed);
        let narrow = store
            .set_write(
                &authority.authority_id,
                authority.revision,
                WritePolicy {
                    grant: WriteGrant::Temporary {
                        conversation_id: 1,
                        operations: vec![WriteOperation::Update],
                        scope: NoteScope {
                            note_ids: vec![id],
                            folders: vec![],
                        },
                    },
                    review_before_applying: false,
                },
            )
            .unwrap();
        assert_eq!(
            prepare(
                &vault.state,
                &store,
                &narrow.authority_id,
                "wrong-scope",
                update(&vault, &store, &snapshot.authority_id, "Outside")
            )
            .unwrap_err()
            .code,
            "scope_denied"
        );
    }
    #[test]
    fn interruption_before_write_and_lost_ack_reopen_reconcile_without_duplicate_publication() {
        let vault = TestVault::new("pi-publication-recovery");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let before = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "before",
            update(&vault, &store, &snapshot.authority_id, "Before Effect"),
        )
        .unwrap();
        let admission = admit(&editors, &store, &owner, &before);
        FAULT.with(|f| f.set(Some("afterProof")));
        assert!(publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &before.intent_id
        )
        .is_err());
        original(&before.target);
        assert!(matches!(
            reconcile(&vault.state, &store, &before.intent_id).unwrap(),
            PublicationResult::Unpublished
        ));
        let first = publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &before.intent_id,
        )
        .unwrap();
        let first_id = committed_id(&first);
        assert_eq!(revision_count(&first_id), 2);
        editors.release(&owner, &admission).unwrap();
        let lost = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "lost",
            update(&vault, &store, &snapshot.authority_id, "Lost Ack"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &lost);
        FAULT.with(|f| f.set(Some("lostAck")));
        assert!(publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &lost.intent_id
        )
        .is_err());
        let raw = std::fs::read_to_string(&lost.target.path).unwrap();
        let id = crate::note::parse_note(&raw)
            .frontmatter
            .managed
            .unwrap()
            .id;
        assert_eq!(revision_count(&id), 2);
        // Reopen loses ephemeral admissions, preserves native intent + exact Timeline token.
        editors.close(&owner).unwrap();
        let reopened = AuthorityStore::new(&crate::state::vault_data_dir().unwrap()).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("reopen"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let result = reconcile(&state, &reopened, &lost.intent_id).unwrap();
        assert_eq!(committed_id(&result), id);
        assert_eq!(revision_count(&id), 2);
        let current = reopened.snapshot(&authority.authority_id).unwrap();
        reopened
            .set_write(
                &authority.authority_id,
                current.revision,
                WritePolicy {
                    grant: WriteGrant::Off,
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert_eq!(
            encode(
                &publish(
                    &state,
                    &reopened,
                    &EditorAdmissions::default(),
                    &authority.authority_id,
                    &lost.intent_id
                )
                .unwrap()
            )
            .unwrap(),
            encode(&result).unwrap()
        );
        assert_eq!(std::fs::read_to_string(&lost.target.path).unwrap(), raw);
        assert_eq!(revision_count(&id), 2);
        state.stop_rebuildable_projection_work().unwrap();
    }
    #[test]
    fn editor_target_admission_and_close_fail_closed_before_effect() {
        let vault = TestVault::new("pi-publication-editor");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "editor",
            update(&vault, &store, &snapshot.authority_id, "Protected"),
        )
        .unwrap();
        let mut wrong = intent.target.clone();
        wrong.path.push_str("-other");
        assert_eq!(
            editors
                .admit(&store, &owner, &intent.intent_id, wrong)
                .unwrap_err()
                .code,
            "editor_conflict"
        );
        admit(&editors, &store, &owner, &intent);
        editors.close(&owner).unwrap();
        assert_eq!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &intent.intent_id
            )
            .unwrap_err()
            .code,
            "editor_conflict"
        );
        original(&intent.target);
    }
    #[test]
    fn native_page_replacement_revokes_only_stale_editor_admissions() {
        let vault = TestVault::new("pi-publication-page-rebind");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "page-rebind",
            update(&vault, &store, &snapshot.authority_id, "Page Rebind"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        assert_eq!(editors.bind().unwrap_err().code, "editor_owner_exists");
        editors.advance_webview_generation();
        assert_eq!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &intent.intent_id
            )
            .unwrap_err()
            .code,
            "editor_conflict"
        );
        original(&intent.target);
        let replacement = editors.bind().unwrap();
        assert_ne!(owner, replacement);
        assert!(editors
            .admit(&store, &owner, &intent.intent_id, intent.target.clone())
            .is_err());
        // A late disposal from the old page cannot remove its replacement.
        editors.close(&owner).unwrap();
        assert_eq!(editors.bind().unwrap_err().code, "editor_owner_exists");
        admit(&editors, &store, &replacement, &intent);
        let result = publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &intent.intent_id,
        )
        .unwrap();
        assert_eq!(revision_count(&committed_id(&result)), 2);
    }

    #[test]
    fn replacement_page_bind_joins_real_publication_and_rejects_old_queued_generation() {
        use std::{
            sync::{mpsc, Arc},
            time::Duration,
        };
        let vault = TestVault::new("pi-publication-page-join");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "page-join",
            update(&vault, &store, &snapshot.authority_id, "Page Join"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        let editors = Arc::new(editors);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let mut release = crate::test_support::ReleaseOnDrop::new(release_tx);
        let state = vault.state.clone();
        let writer_store = store.clone();
        let writer_editors = editors.clone();
        let authority_id = authority.authority_id.clone();
        let intent_id = intent.intent_id.clone();
        let writer = std::thread::spawn(move || {
            BEFORE_PROOF.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(move || {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }))
            });
            publish(
                &state,
                &writer_store,
                &writer_editors,
                &authority_id,
                &intent_id,
            )
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        // An old-page command captured its generation before spawn_blocking,
        // then queued behind this real publication. Its response will be lost.
        let old_generation = editors.current_webview_generation();
        let (stale_tx, stale_rx) = mpsc::channel();
        let old_page = editors.clone();
        let stale_binding = std::thread::spawn(move || {
            stale_tx
                .send(old_page.bind_for_generation(old_generation))
                .unwrap();
        });
        assert!(stale_rx.recv_timeout(Duration::from_millis(50)).is_err());
        // Page-load notification itself never waits on publication/main-thread work.
        editors.advance_webview_generation();
        let (bound_tx, bound_rx) = mpsc::channel();
        let rebinder = editors.clone();
        let binding = std::thread::spawn(move || bound_tx.send(rebinder.bind()).unwrap());
        assert!(bound_rx.recv_timeout(Duration::from_millis(50)).is_err());
        release.release();
        let result = writer.join().unwrap().unwrap();
        assert_eq!(
            stale_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap_err()
                .code,
            "stale_editor_page"
        );
        stale_binding.join().unwrap();
        let replacement = bound_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        binding.join().unwrap();
        assert_ne!(replacement, owner);
        assert!(editors
            .admit(&store, &owner, &intent.intent_id, intent.target.clone())
            .is_err());
        let reconciled = reconcile(&vault.state, &store, &intent.intent_id).unwrap();
        assert_eq!(committed_id(&reconciled), committed_id(&result));
        assert_eq!(revision_count(&committed_id(&result)), 2);
        assert!(editors.bind().is_err());
    }

    #[test]
    fn citation_admission_revocation_and_editor_close_join_publication_without_sql_cycle() {
        use std::{
            sync::{mpsc, Arc},
            time::Duration,
        };
        let vault = TestVault::new("pi-publication-lock-order");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let note = save_and_finalize(
            &vault.state,
            "Existing".into(),
            "Existing content".into(),
            None,
        )
        .unwrap()
        .unwrap();
        let note_id = note.note_id.unwrap();
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "concurrent",
            update(&vault, &store, &snapshot.authority_id, "Concurrent"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        let editors = Arc::new(editors);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (published_tx, published_rx) = mpsc::channel();
        let state = vault.state.clone();
        let writer_store = store.clone();
        let writer_editors = editors.clone();
        let authority_id = authority.authority_id.clone();
        let intent_id = intent.intent_id.clone();
        let writer = std::thread::spawn(move || {
            BEFORE_PROOF.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(move || {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }))
            });
            let result = publish(
                &state,
                &writer_store,
                &writer_editors,
                &authority_id,
                &intent_id,
            );
            published_tx.send(result).unwrap();
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (read_tx, read_rx) = mpsc::channel();
        let state = vault.state.clone();
        let reader_store = store.clone();
        let authority_id = authority.authority_id.clone();
        let reader = std::thread::spawn(move || {
            let result =
                reader_store.with_authority(&authority_id, None, |connection, snapshot| {
                    notes::source_navigation_note(&state, snapshot, connection, &note_id)
                });
            read_tx.send(result).unwrap();
        });
        let (close_tx, close_rx) = mpsc::channel();
        let closing = editors.clone();
        let owner_id = owner.clone();
        let close = std::thread::spawn(move || {
            close_tx.send(closing.close(&owner_id)).unwrap();
        });
        assert!(read_rx.recv_timeout(Duration::from_millis(50)).is_err());
        assert!(close_rx.recv_timeout(Duration::from_millis(50)).is_err());
        release_tx.send(()).unwrap();
        assert!(matches!(
            published_rx
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap(),
            PublicationResult::Committed { .. }
        ));
        read_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        close_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        writer.join().unwrap();
        reader.join().unwrap();
        close.join().unwrap();
        let current = store.snapshot(&authority.authority_id).unwrap();
        store
            .set_write(
                &authority.authority_id,
                current.revision,
                WritePolicy {
                    grant: WriteGrant::Off,
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert!(matches!(
            reconcile(&vault.state, &store, &intent.intent_id).unwrap(),
            PublicationResult::Committed { .. }
        ));
    }
    #[test]
    fn choosing_temporary_replaces_always_without_hidden_vault_permission() {
        let vault = TestVault::new("pi-exclusive-write-selection");
        let (store, snapshot, _, _) = setup(&vault);
        let first = temporary(&store, &snapshot, true);
        let second = bind(&store, 2);
        let always = store
            .set_write(
                &second.authority_id,
                second.revision,
                WritePolicy {
                    grant: WriteGrant::Always {
                        operations: vec![WriteOperation::Update],
                        scope: scope(),
                    },
                    review_before_applying: true,
                },
            )
            .unwrap();
        // An earlier Temporary grant must not hide the current Always mode.
        assert!(matches!(
            store.snapshot(&first.authority_id).unwrap().write.grant,
            WriteGrant::Always { .. }
        ));
        let chosen = store
            .set_write(
                &always.authority_id,
                always.revision,
                WritePolicy {
                    grant: WriteGrant::Temporary {
                        conversation_id: 2,
                        operations: vec![WriteOperation::Update],
                        scope: scope(),
                    },
                    review_before_applying: true,
                },
            )
            .unwrap();
        assert!(matches!(
            chosen.write.grant,
            WriteGrant::Temporary {
                conversation_id: 2,
                ..
            }
        ));
        assert!(matches!(bind(&store, 3).write.grant, WriteGrant::Off));
        // Independently granted conversations keep their own Temporary grant.
        assert!(matches!(
            store.snapshot(&first.authority_id).unwrap().write.grant,
            WriteGrant::Temporary {
                conversation_id: 1,
                ..
            }
        ));
        let reopened = AuthorityStore::new(vault.state.running_vault().data_dir()).unwrap();
        assert!(matches!(bind(&reopened, 4).write.grant, WriteGrant::Off));
    }

    #[test]
    fn vault_review_projects_to_every_context_and_reopen_and_invalidates_direct_intents() {
        let vault = TestVault::new("pi-publication-vault-review");
        let (store, snapshot, editors, owner) = setup(&vault);
        let always = store
            .set_write(
                &snapshot.authority_id,
                snapshot.revision,
                WritePolicy {
                    grant: WriteGrant::Always {
                        operations: vec![WriteOperation::Update],
                        scope: scope(),
                    },
                    review_before_applying: false,
                },
            )
            .unwrap();
        let second = bind(&store, 2);
        assert!(!second.write.review_before_applying);
        assert!(matches!(second.write.grant, WriteGrant::Always { .. }));
        let direct = prepare(
            &vault.state,
            &store,
            &always.authority_id,
            "direct-before-review",
            update(
                &vault,
                &store,
                &snapshot.authority_id,
                "Direct Before Review",
            ),
        )
        .unwrap();
        assert!(!direct.review_required);
        admit(&editors, &store, &owner, &direct);
        let reviewed = store
            .set_vault_write(WritePolicy {
                grant: second.write.grant,
                review_before_applying: true,
            })
            .unwrap();
        assert!(reviewed.review_before_applying);
        let current = store.snapshot(&always.authority_id).unwrap();
        assert!(current.write.review_before_applying);
        assert!(current.revision > always.revision);
        let reopened = AuthorityStore::new(vault.state.running_vault().data_dir()).unwrap();
        assert!(bind(&reopened, 1).write.review_before_applying);
        assert!(bind(&reopened, 3).write.review_before_applying);
        assert!(
            matches!(publish(&vault.state,&store,&editors,&always.authority_id,&direct.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="stale_authority")
        );
        original(&direct.target);
        let fresh = prepare(
            &vault.state,
            &store,
            &always.authority_id,
            "review-now-required",
            update(&vault, &store, &snapshot.authority_id, "Review Now"),
        )
        .unwrap();
        assert!(fresh.review_required);
        admit(&editors, &store, &owner, &fresh);
        assert!(
            matches!(publish(&vault.state,&store,&editors,&always.authority_id,&fresh.intent_id).unwrap(),PublicationResult::Blocked{code,..} if code=="review_required")
        );
        approve(
            &store,
            &always.authority_id,
            &fresh.intent_id,
            &fresh.payload_hash,
        )
        .unwrap();
        assert!(matches!(
            publish(
                &vault.state,
                &store,
                &editors,
                &always.authority_id,
                &fresh.intent_id
            )
            .unwrap(),
            PublicationResult::Committed { .. }
        ));
    }
    #[test]
    fn lost_ack_reconciliation_repairs_or_reports_required_task_projection_and_retains_original_receipt_warning(
    ) {
        let vault = TestVault::new("pi-publication-warning-recovery");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let tasks = Connection::open(
            vault
                .state
                .running_vault()
                .data_dir()
                .join("app-state.sqlite3"),
        )
        .unwrap();
        let fail = || {
            tasks.execute_batch("CREATE TRIGGER fail_publication_task BEFORE INSERT ON app_state_note_tasks BEGIN SELECT RAISE(ABORT,'synthetic task projection failure'); END;").unwrap()
        };
        fail();
        let mutation = |title: &str| {
            let mut mutation = update(&vault, &store, &snapshot.authority_id, title);
            let Mutation::Update { markdown, .. } = &mut mutation else {
                unreachable!()
            };
            *markdown = "- [ ] Required projected task".into();
            mutation
        };
        let lost = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "warning-lost",
            mutation("Warning Lost Ack"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &lost);
        FAULT.with(|f| f.set(Some("lostAck")));
        assert!(publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &lost.intent_id
        )
        .is_err());
        let reopened = AuthorityStore::new(vault.state.running_vault().data_dir()).unwrap();
        let state = AppState::new(
            crate::semantic::SemanticState::new_disabled("warning reopen"),
            crate::app::EventBus::disabled(),
        )
        .unwrap();
        let result = reconcile(&state, &reopened, &lost.intent_id).unwrap();
        assert!(
            matches!(&result,PublicationResult::Committed{commit_warning:Some(warning),..} if warning.issues().iter().any(|issue|issue.stage()==crate::services::note_timeline::MutationWarningStage::TaskProjectionUpsert))
        );
        tasks
            .execute_batch("DROP TRIGGER fail_publication_task;")
            .unwrap();
        // A persisted warning is a historical fact; later repair never silently erases it.
        assert_eq!(
            encode(&reconcile(&state, &reopened, &lost.intent_id).unwrap()).unwrap(),
            encode(&result).unwrap()
        );
        fail();
        let repaired = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "repair-lost",
            mutation("Repair Lost Ack"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &repaired);
        FAULT.with(|f| f.set(Some("lostAck")));
        assert!(publish(
            &vault.state,
            &store,
            &editors,
            &authority.authority_id,
            &repaired.intent_id
        )
        .is_err());
        tasks
            .execute_batch("DROP TRIGGER fail_publication_task;")
            .unwrap();
        let original = std::fs::read_to_string(&repaired.target.path).unwrap();
        let result = reconcile(&state, &reopened, &repaired.intent_id).unwrap();
        let id = committed_id(&result);
        assert!(matches!(
            result,
            PublicationResult::Committed {
                commit_warning: None,
                ..
            }
        ));
        let count:u64=tasks.query_row("SELECT COUNT(*) FROM app_state_note_tasks WHERE note_id=?1 AND deleted_at_millis IS NULL",[&id],|r|r.get(0)).unwrap();
        assert_eq!(count, 1);
        assert_eq!(revision_count(&id), 2);
        assert_eq!(
            std::fs::read_to_string(&repaired.target.path).unwrap(),
            original
        );
        state.stop_rebuildable_projection_work().unwrap();
    }
    #[test]
    fn restart_quiescence_clears_unclaimed_admissions_and_resumes_only_live_owner_before_terminal_close(
    ) {
        let vault = TestVault::new("pi-publication-restart-admission");
        let (store, snapshot, editors, owner) = setup(&vault);
        let authority = temporary(&store, &snapshot, false);
        let intent = prepare(
            &vault.state,
            &store,
            &authority.authority_id,
            "restart",
            update(&vault, &store, &snapshot.authority_id, "Restart Admission"),
        )
        .unwrap();
        admit(&editors, &store, &owner, &intent);
        editors.quiesce_for_restart().unwrap();
        editors.quiesce_for_restart().unwrap();
        assert!(editors.bind().is_err());
        assert_eq!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &intent.intent_id
            )
            .unwrap_err()
            .code,
            "closed"
        );
        original(&intent.target);
        editors.resume_after_failed_restart().unwrap();
        assert_eq!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &intent.intent_id
            )
            .unwrap_err()
            .code,
            "editor_conflict"
        );
        admit(&editors, &store, &owner, &intent);
        assert!(matches!(
            publish(
                &vault.state,
                &store,
                &editors,
                &authority.authority_id,
                &intent.intent_id
            )
            .unwrap(),
            PublicationResult::Committed { .. }
        ));
        editors.quiesce_for_restart().unwrap();
        editors.finish_restart_shutdown().unwrap();
        editors.finish_restart_shutdown().unwrap();
        editors.quiesce_for_restart().unwrap();
        assert!(editors.resume_after_failed_restart().is_err());
        assert!(editors.bind().is_err());
        assert!(matches!(
            reconcile(&vault.state, &store, &intent.intent_id).unwrap(),
            PublicationResult::Committed { .. }
        ));
    }
}
