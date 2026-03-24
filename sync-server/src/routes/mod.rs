mod auth_routes;
mod read_routes;
mod shared;
mod write_routes;

use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/auth/request-magic-link",
            post(auth_routes::request_magic_link),
        )
        .route("/auth/complete", post(auth_routes::complete_magic_link))
        .route("/v1/sync/manifest", get(read_routes::get_manifest))
        .route("/v1/sync/changes", get(read_routes::pull_changes))
        .route("/v1/sync/notes/batch", post(read_routes::get_notes_batch))
        .route("/v1/sync/notes/:note_id", get(read_routes::get_note))
        .route("/v1/sync/notes", post(write_routes::push_note_snapshot))
        .route("/v1/sync/trash", post(write_routes::push_trash_event))
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}
