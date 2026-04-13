mod auth;
mod config;
mod db;
mod routes;
mod state;

use anyhow::Result;
use axum::serve;
use config::Config;
use state::AppState;
use std::sync::Arc;
use tokio::{net::TcpListener, signal, time};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gneauxghts_sync_server=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env()?;
    tokio::fs::create_dir_all(&config.blob_root).await?;
    let pool = db::create_pool(&config.database_url).await?;
    db::ensure_schema(&pool).await?;

    let bind_addr = config.bind_addr;
    let app_base_url = config.app_base_url.clone();
    let app_state = Arc::new(AppState { config, pool });
    run_maintenance(&app_state).await;
    spawn_maintenance_loop(app_state.clone());
    let app = routes::router(app_state);
    let listener = TcpListener::bind(bind_addr).await?;

    tracing::info!(%bind_addr, %app_base_url, "sync server listening");
    serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn run_maintenance(state: &Arc<AppState>) {
    match db::run_maintenance(state).await {
        Ok(stats) => tracing::info!(
            deleted_magic_link_tokens = stats.deleted_magic_link_tokens,
            deleted_sessions = stats.deleted_sessions,
            deleted_sync_changes = stats.deleted_sync_changes,
            deleted_note_revisions = stats.deleted_note_revisions,
            deleted_blob_files = stats.deleted_blob_files,
            "sync server maintenance complete"
        ),
        Err(error) => tracing::warn!(error = %error, "sync server maintenance failed"),
    }
}

fn spawn_maintenance_loop(state: Arc<AppState>) {
    let interval = db::maintenance_interval(&state);
    if interval.is_zero() {
        tracing::info!("sync server maintenance loop disabled");
        return;
    }
    tokio::spawn(async move {
        let mut ticker = time::interval(interval);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            run_maintenance(&state).await;
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        let mut signal =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
        if let Some(signal) = signal.as_mut() {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{Method, Request, StatusCode},
        Router,
    };
    use gneauxghts_sync_contract::{
        AuthSession, GetManifestResponse, PushNoteSnapshotResponse, PushTrashEventResponse,
        RequestMagicLinkResponse,
    };
    use serde::{de::DeserializeOwned, Serialize};
    use serde_json::json;
    use sqlx::{postgres::PgPoolOptions, Executor, PgPool};
    use tempfile::TempDir;
    use tower::util::ServiceExt;
    use uuid::Uuid;

    struct TestContext {
        admin_pool: PgPool,
        schema: String,
        _blob_root: TempDir,
        app_state: Arc<AppState>,
    }

    impl TestContext {
        async fn maybe_new() -> Option<Self> {
            let database_url = std::env::var("TEST_DATABASE_URL").ok()?;
            let admin_pool = PgPool::connect(&database_url).await.ok()?;
            let schema = format!("sync_server_test_{}", Uuid::new_v4().simple());
            admin_pool
                .execute(format!("CREATE SCHEMA {schema}").as_str())
                .await
                .ok()?;

            let schema_for_pool = schema.clone();
            let pool = PgPoolOptions::new()
                .max_connections(5)
                .after_connect(move |connection, _meta| {
                    let schema = schema_for_pool.clone();
                    Box::pin(async move {
                        connection
                            .execute(format!("SET search_path TO {schema}").as_str())
                            .await?;
                        Ok(())
                    })
                })
                .connect(&database_url)
                .await
                .ok()?;
            db::ensure_schema(&pool).await.ok()?;

            let blob_root = TempDir::new().ok()?;
            let config = Config {
                bind_addr: "127.0.0.1:0".parse().ok()?,
                database_url,
                blob_root: blob_root.path().to_path_buf(),
                app_base_url: "http://localhost:8787".to_string(),
                magic_link_ttl_minutes: 15,
                session_ttl_days: 30,
                allow_insecure_token_response: true,
                maintenance_interval_minutes: 0,
                sync_change_retention_days: 30,
                note_revision_retention_days: 30,
            };

            Some(Self {
                admin_pool,
                schema,
                _blob_root: blob_root,
                app_state: Arc::new(AppState { config, pool }),
            })
        }

        fn router(&self) -> Router {
            routes::router(self.app_state.clone())
        }

        async fn cleanup(self) {
            self.app_state.pool.close().await;
            let _ = self
                .admin_pool
                .execute(format!("DROP SCHEMA IF EXISTS {} CASCADE", self.schema).as_str())
                .await;
        }
    }

    async fn send_json_request<T: Serialize>(
        app: Router,
        method: Method,
        uri: &str,
        body: &T,
        bearer_token: Option<&str>,
    ) -> (StatusCode, String) {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(token) = bearer_token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let request = builder
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(body).expect("serialize request")))
            .expect("build request");
        let response = app.oneshot(request).await.expect("send request");
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        (status, String::from_utf8(body.to_vec()).expect("utf8 response"))
    }

    async fn send_json_request_expect<T: Serialize, R: DeserializeOwned>(
        app: Router,
        method: Method,
        uri: &str,
        body: &T,
        bearer_token: Option<&str>,
    ) -> (StatusCode, R) {
        let (status, body) = send_json_request(app, method, uri, body, bearer_token).await;
        let parsed = serde_json::from_str(&body).expect("parse response json");
        (status, parsed)
    }

    async fn create_session(context: &TestContext, email: &str) -> AuthSession {
        let (status, request_response): (StatusCode, RequestMagicLinkResponse) =
            send_json_request_expect(
                context.router(),
                Method::POST,
                "/auth/request-magic-link",
                &json!({ "email": email }),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        let magic_link_token = request_response
            .magic_link_token
            .expect("dev mode magic link token");

        let (status, session): (StatusCode, AuthSession) = send_json_request_expect(
            context.router(),
            Method::POST,
            "/auth/complete",
            &json!({
                "email": email,
                "magicLinkToken": magic_link_token,
                "deviceId": "test-device",
                "deviceName": "Test Device"
            }),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        session
    }

    #[tokio::test]
    async fn magic_link_tokens_are_single_use() {
        let Some(context) = TestContext::maybe_new().await else {
            return;
        };

        let (status, request_response): (StatusCode, RequestMagicLinkResponse) =
            send_json_request_expect(
                context.router(),
                Method::POST,
                "/auth/request-magic-link",
                &json!({ "email": "single-use@example.com" }),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        let token = request_response.magic_link_token.expect("magic link token");

        let (first_status, _first_session): (StatusCode, AuthSession) = send_json_request_expect(
            context.router(),
            Method::POST,
            "/auth/complete",
            &json!({
                "email": "single-use@example.com",
                "magicLinkToken": token,
                "deviceId": "device-a",
                "deviceName": "Device A"
            }),
            None,
        )
        .await;
        assert_eq!(first_status, StatusCode::OK);

        let (second_status, _) = send_json_request(
            context.router(),
            Method::POST,
            "/auth/complete",
            &json!({
                "email": "single-use@example.com",
                "magicLinkToken": token,
                "deviceId": "device-b",
                "deviceName": "Device B"
            }),
            None,
        )
        .await;
        assert_eq!(second_status, StatusCode::UNAUTHORIZED);

        context.cleanup().await;
    }

    #[tokio::test]
    async fn rejects_invalid_note_ids_and_relative_paths() {
        let Some(context) = TestContext::maybe_new().await else {
            return;
        };
        let session = create_session(&context, "validation@example.com").await;

        let (invalid_note_status, _) = send_json_request(
            context.router(),
            Method::POST,
            "/v1/sync/notes",
            &json!({
                "noteId": "nested/note",
                "baseRevision": 0,
                "relativePath": "note.md",
                "markdown": "# Note",
                "contentHash": "hash-1",
                "updatedAt": "2026-01-01T00:00:00Z"
            }),
            Some(&session.session_token),
        )
        .await;
        assert_eq!(invalid_note_status, StatusCode::BAD_REQUEST);

        let (invalid_path_status, _) = send_json_request(
            context.router(),
            Method::POST,
            "/v1/sync/notes",
            &json!({
                "noteId": "note-a",
                "baseRevision": 0,
                "relativePath": "../note.md",
                "markdown": "# Note",
                "contentHash": "hash-1",
                "updatedAt": "2026-01-01T00:00:00Z"
            }),
            Some(&session.session_token),
        )
        .await;
        assert_eq!(invalid_path_status, StatusCode::BAD_REQUEST);

        context.cleanup().await;
    }

    #[tokio::test]
    async fn rejects_duplicate_live_relative_paths() {
        let Some(context) = TestContext::maybe_new().await else {
            return;
        };
        let session = create_session(&context, "paths@example.com").await;

        let (first_status, first_response): (StatusCode, PushNoteSnapshotResponse) =
            send_json_request_expect(
                context.router(),
                Method::POST,
                "/v1/sync/notes",
                &json!({
                    "noteId": "note-a",
                    "baseRevision": 0,
                    "relativePath": "shared.md",
                    "markdown": "# Note A",
                    "contentHash": "hash-a",
                    "updatedAt": "2026-01-01T00:00:00Z"
                }),
                Some(&session.session_token),
            )
            .await;
        assert_eq!(first_status, StatusCode::OK);
        assert_eq!(
            serde_json::to_value(first_response.status).expect("status json"),
            json!("accepted")
        );

        let (second_status, second_body) = send_json_request(
            context.router(),
            Method::POST,
            "/v1/sync/notes",
            &json!({
                "noteId": "note-b",
                "baseRevision": 0,
                "relativePath": "shared.md",
                "markdown": "# Note B",
                "contentHash": "hash-b",
                "updatedAt": "2026-01-01T00:01:00Z"
            }),
            Some(&session.session_token),
        )
        .await;
        assert_eq!(second_status, StatusCode::CONFLICT);
        assert!(second_body.contains("relativePath"));

        context.cleanup().await;
    }

    #[tokio::test]
    async fn stale_base_revision_returns_conflict_with_remote_head() {
        let Some(context) = TestContext::maybe_new().await else {
            return;
        };
        let session = create_session(&context, "conflict@example.com").await;

        let (first_status, _): (StatusCode, PushNoteSnapshotResponse) = send_json_request_expect(
            context.router(),
            Method::POST,
            "/v1/sync/notes",
            &json!({
                "noteId": "note-a",
                "baseRevision": 0,
                "relativePath": "note-a.md",
                "markdown": "# First",
                "contentHash": "hash-first",
                "updatedAt": "2026-01-01T00:00:00Z"
            }),
            Some(&session.session_token),
        )
        .await;
        assert_eq!(first_status, StatusCode::OK);

        let (conflict_status, conflict_response): (StatusCode, PushNoteSnapshotResponse) =
            send_json_request_expect(
                context.router(),
                Method::POST,
                "/v1/sync/notes",
                &json!({
                    "noteId": "note-a",
                    "baseRevision": 0,
                    "relativePath": "note-a.md",
                    "markdown": "# Second",
                    "contentHash": "hash-second",
                    "updatedAt": "2026-01-01T00:01:00Z"
                }),
                Some(&session.session_token),
            )
            .await;
        assert_eq!(conflict_status, StatusCode::OK);
        assert_eq!(
            serde_json::to_value(conflict_response.status).expect("status json"),
            json!("conflict")
        );
        assert_eq!(conflict_response.current_revision, 1);
        assert_eq!(
            conflict_response
                .remote_head
                .as_ref()
                .expect("remote head")
                .revision,
            1
        );

        context.cleanup().await;
    }

    #[tokio::test]
    async fn trash_and_restore_round_trip_in_manifest() {
        let Some(context) = TestContext::maybe_new().await else {
            return;
        };
        let session = create_session(&context, "trash@example.com").await;

        let (create_status, _): (StatusCode, PushNoteSnapshotResponse) = send_json_request_expect(
            context.router(),
            Method::POST,
            "/v1/sync/notes",
            &json!({
                "noteId": "note-trash",
                "baseRevision": 0,
                "relativePath": "trash-me.md",
                "markdown": "# Trash Me",
                "contentHash": "hash-create",
                "updatedAt": "2026-01-01T00:00:00Z"
            }),
            Some(&session.session_token),
        )
        .await;
        assert_eq!(create_status, StatusCode::OK);

        let (trash_status, trash_response): (StatusCode, PushTrashEventResponse) =
            send_json_request_expect(
                context.router(),
                Method::POST,
                "/v1/sync/trash",
                &json!({
                    "noteId": "note-trash",
                    "baseRevision": 1,
                    "action": "trash",
                    "relativePath": "trash-me.md",
                    "markdown": "# Trash Me",
                    "contentHash": "hash-trash",
                    "updatedAt": "2026-01-01T00:01:00Z",
                    "trashedAt": "2026-01-01T00:01:00Z"
                }),
                Some(&session.session_token),
            )
            .await;
        assert_eq!(trash_status, StatusCode::OK);
        assert_eq!(trash_response.current_revision, 2);

        let (manifest_status, manifest_after_trash): (StatusCode, GetManifestResponse) =
            send_json_request_expect(
                context.router(),
                Method::GET,
                "/v1/sync/manifest",
                &json!({}),
                Some(&session.session_token),
            )
            .await;
        assert_eq!(manifest_status, StatusCode::OK);
        assert!(
            manifest_after_trash.notes[0].trashed_at.is_some(),
            "manifest should show trashed note"
        );

        let (restore_status, restore_response): (StatusCode, PushTrashEventResponse) =
            send_json_request_expect(
                context.router(),
                Method::POST,
                "/v1/sync/trash",
                &json!({
                    "noteId": "note-trash",
                    "baseRevision": 2,
                    "action": "restore",
                    "relativePath": "trash-me.md",
                    "markdown": "# Trash Me",
                    "contentHash": "hash-restore",
                    "updatedAt": "2026-01-01T00:02:00Z",
                    "trashedAt": null
                }),
                Some(&session.session_token),
            )
            .await;
        assert_eq!(restore_status, StatusCode::OK);
        assert_eq!(restore_response.current_revision, 3);

        let (manifest_status, manifest_after_restore): (StatusCode, GetManifestResponse) =
            send_json_request_expect(
                context.router(),
                Method::GET,
                "/v1/sync/manifest",
                &json!({}),
                Some(&session.session_token),
            )
            .await;
        assert_eq!(manifest_status, StatusCode::OK);
        assert!(
            manifest_after_restore.notes[0].trashed_at.is_none(),
            "manifest should show restored note"
        );

        context.cleanup().await;
    }
}
