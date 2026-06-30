use crate::{commands::DraftRef, index::AppState};
use std::path::Path;

#[derive(Clone, Debug)]
pub(crate) struct CurrentDocumentRequest {
    pub(crate) path: Option<String>,
    pub(crate) title: String,
    pub(crate) markdown: Option<String>,
    pub(crate) body_hash: Option<String>,
    pub(crate) body_not_needed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedCurrentDocument {
    pub(crate) draft: DraftRef,
    pub(crate) body: Option<String>,
}

impl CurrentDocumentRequest {
    pub(crate) fn from_path(
        path: Option<&Path>,
        title: impl Into<String>,
        markdown: Option<String>,
        body_hash: Option<String>,
    ) -> Self {
        Self {
            path: path.map(|path| path.to_string_lossy().into_owned()),
            title: title.into(),
            markdown,
            body_hash,
            body_not_needed: false,
        }
    }
}

pub(crate) fn resolve_current_document(
    state: &AppState,
    request: CurrentDocumentRequest,
) -> Result<ResolvedCurrentDocument, String> {
    let draft = DraftRef {
        path: request.path,
        title: request.title,
        hash: request.body_hash,
        body: request.markdown,
        body_not_needed: request.body_not_needed,
    };
    let body = state.resolve_draft_body(&draft)?;
    Ok(ResolvedCurrentDocument { draft, body })
}
