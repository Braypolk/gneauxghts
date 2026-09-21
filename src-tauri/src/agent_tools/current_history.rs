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
