use crate::{auth::internal_error, db, state::AppState};
use axum::{extract::State, http::StatusCode, Json};
use gneauxghts_sync_contract::{
    AuthSession, CompleteMagicLinkRequest, RequestMagicLinkRequest, RequestMagicLinkResponse,
};
use std::sync::Arc;
use uuid::Uuid;

pub(super) async fn request_magic_link(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RequestMagicLinkRequest>,
) -> Result<Json<RequestMagicLinkResponse>, (StatusCode, String)> {
    let email = request.email.trim().to_lowercase();
    if email.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Email is required".to_string()));
    }

    let user = db::find_or_create_user(&state.pool, &email)
        .await
        .map_err(internal_error)?;
    let raw_token = Uuid::new_v4().to_string();
    let token_hash = blake3::hash(raw_token.as_bytes()).to_hex().to_string();
    let expires_at = sqlx::query_scalar::<_, String>(
        "INSERT INTO magic_link_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + make_interval(mins => $4::int))
         RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(Uuid::new_v4())
    .bind(user.id)
    .bind(token_hash)
    .bind(state.config.magic_link_ttl_minutes)
    .fetch_one(&state.pool)
    .await
    .map_err(internal_error)?;

    tracing::info!(email = %user.email, "created magic link token");
    Ok(Json(RequestMagicLinkResponse {
        accepted: true,
        expires_at,
        magic_link_token: state
            .config
            .allow_insecure_token_response
            .then_some(raw_token),
    }))
}

pub(super) async fn complete_magic_link(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CompleteMagicLinkRequest>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = request.email.trim().to_lowercase();
    let token_hash = blake3::hash(request.magic_link_token.as_bytes())
        .to_hex()
        .to_string();

    let mut transaction = state.pool.begin().await.map_err(internal_error)?;
    let user_id = sqlx::query_scalar::<_, Uuid>(
        "UPDATE magic_link_tokens
         SET consumed_at = NOW()
         FROM users
         WHERE users.id = magic_link_tokens.user_id
           AND users.email = $1
           AND magic_link_tokens.token_hash = $2
           AND magic_link_tokens.consumed_at IS NULL
           AND magic_link_tokens.expires_at > NOW()
         RETURNING magic_link_tokens.user_id",
    )
    .bind(&email)
    .bind(&token_hash)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(internal_error)?
    .ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "Invalid or expired magic link".to_string(),
        )
    })?;

    let vault = db::find_or_create_vault_tx(&mut transaction, user_id)
        .await
        .map_err(internal_error)?;
    db::touch_device_tx(
        &mut transaction,
        vault.id,
        &request.device_id,
        request.device_name.as_deref(),
    )
    .await
    .map_err(internal_error)?;

    let raw_session_token = Uuid::new_v4().to_string();
    let session_token_hash = blake3::hash(raw_session_token.as_bytes())
        .to_hex()
        .to_string();
    let expires_at = sqlx::query_scalar::<_, String>(
        "INSERT INTO sessions (id, user_id, vault_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + make_interval(days => $5::int))
         RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(vault.id)
    .bind(session_token_hash)
    .bind(state.config.session_ttl_days)
    .fetch_one(&mut *transaction)
    .await
    .map_err(internal_error)?;
    transaction.commit().await.map_err(internal_error)?;

    Ok(Json(AuthSession {
        session_token: raw_session_token,
        user_id: user_id.to_string(),
        vault_id: vault.id.to_string(),
        device_id: request.device_id,
        expires_at,
    }))
}
