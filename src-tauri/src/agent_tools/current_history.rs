use super::*;

pub(super) fn allowed_note_ids(
    access: &VaultAccess,
    granted: &HashSet<String>,
    run_grants: &HashSet<String>,
) -> Option<HashSet<String>> {
    match access {
        VaultAccess::Full => None,
        VaultAccess::Approved => Some(granted.union(run_grants).cloned().collect()),
        VaultAccess::None => Some(run_grants.clone()),
    }
}

pub(crate) fn filter_revision_sources(
    state: &AppState,
    service: &ChatService,
    vault_access: &VaultAccess,
    run_grants: &HashSet<String>,
    sources: &mut Vec<ChatSource>,
) -> Result<(), String> {
    let excluded = service.excluded_note_ids()?;
    let allowed = allowed_note_ids(vault_access, &service.granted_note_ids()?, run_grants);
    let scope = crate::services::note_timeline::AllowedScope::policy(allowed.as_ref(), &excluded);
    let timeline = state.note_timeline();
    let current = timeline.current_content(scope);
    let evidence: Vec<_> = sources
        .iter()
        .filter_map(|source| source.revision.clone())
        .collect();
    let valid = current
        .current_citations(&evidence)
        .map_err(|_| "Current citation evidence is unavailable")?;
    sources.retain_mut(|source| {
        if let Some(passage) = &source.passage {
            let Some((path, title)) = crate::services::evidence::validate_citation(
                state,
                passage,
                allowed.as_ref(),
                &excluded,
            ) else {
                return false;
            };
            source.note_path = Some(relative_path(service.notes_root(), &path));
            source.title = title;
        }
        let Some(citation) = &source.revision else {
            if source.passage.is_some() || source.kind == "web" {
                return true;
            }
            let Some(id) = source.note_id.as_ref() else {
                return false;
            };
            if excluded.contains(id) || allowed.as_ref().is_some_and(|ids| !ids.contains(id)) {
                return false;
            }
            let Ok(index) = state.notes_index.lock() else {
                return false;
            };
            let Some((path, note)) = index.get_note_by_note_id(id) else {
                return false;
            };
            let Ok(raw) = fs::read_to_string(path) else {
                return false;
            };
            if !note::parse_note(&raw).body.contains(&source.excerpt) {
                return false;
            }
            source.note_path = Some(relative_path(service.notes_root(), path));
            source.title = note.title.clone();
            return true;
        };
        if !valid.iter().any(|c| {
            c.note_id == citation.note_id
                && c.revision_id == citation.revision_id
                && c.current_excerpt == citation.current_excerpt
        }) {
            return false;
        }
        let Ok(index) = state.notes_index.lock() else {
            return false;
        };
        let Some((path, note)) = index.get_note_by_note_id(&citation.note_id) else {
            return false;
        };
        source.note_path = Some(relative_path(service.notes_root(), path));
        source.title = note.title.clone();
        true
    });
    Ok(())
}

impl AgentToolContext {
    // Identity survives authored-content changes; old excerpts and passage hashes
    // are deliberately not used to establish the current navigation hint.
    fn current_note_identity(&self, note_id: &str) -> Option<(PathBuf, String)> {
        let (path, _, _) = self.resolve_note(note_id).ok()?;
        let path = fs::canonicalize(path).ok()?;
        let root = fs::canonicalize(self.service.notes_root()).ok()?;
        if !crate::state::is_valid_note_path(&path, &root) {
            return None;
        }
        let raw = fs::read_to_string(&path).ok()?;
        let parsed = note::parse_note(&raw);
        let identity = parsed.frontmatter.managed.as_ref()?;
        if identity.id != note_id || identity.kind != DocumentKind::Note {
            return None;
        }
        let title = path.file_stem()?.to_str()?.to_string();
        Some((path, title))
    }

    pub(crate) fn note_reference_hint(&self, note_id: &str) -> Option<Value> {
        if !self.allowed(note_id).ok()? {
            return None;
        }
        let reference = self.current_note_identity(note_id)?;
        let hint =
            json!({"noteId":note_id,"title":crate::services::evidence::bounded(&reference.1, 256)});
        self.note_reference_versions
            .lock()
            .ok()?
            .entry(note_id.into())
            .or_insert(reference);
        Some(hint)
    }

    // Resolution holds exact provisional snapshots until history admission is
    // complete. Rejected candidates must never become validation obligations.
    pub(crate) fn retain_note_references(&self, admitted: &HashSet<String>) -> Result<(), String> {
        self.note_reference_versions
            .lock()
            .map_err(|_| "Note references unavailable")?
            .retain(|id, _| admitted.contains(id));
        Ok(())
    }

    pub(super) fn validate_note_references(
        &self,
        allowed: Option<&HashSet<String>>,
        excluded: &HashSet<String>,
    ) -> Result<(), String> {
        let versions = self
            .note_reference_versions
            .lock()
            .map_err(|_| "Note references unavailable")?;
        for (id, expected) in versions.iter() {
            if excluded.contains(id)
                || allowed.is_some_and(|ids| !ids.contains(id))
                || self.current_note_identity(id).as_ref() != Some(expected)
            {
                return Err(
                    "Conversational note access or identity changed; retry for current context"
                        .into(),
                );
            }
        }
        Ok(())
    }
}
