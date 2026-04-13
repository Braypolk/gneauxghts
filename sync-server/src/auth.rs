use crate::{db, state::AppState};
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
};
use std::sync::Arc;

#[derive(Clone)]
pub struct AuthenticatedSession {
    pub vault_id: uuid::Uuid,
}

impl FromRequestParts<Arc<AppState>> for AuthenticatedSession {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let authorization = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    "Missing authorization header".to_string(),
                )
            })?;

        let token = authorization
            .strip_prefix("Bearer ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    "Invalid authorization header".to_string(),
                )
            })?;

        let token_hash = blake3::hash(token.as_bytes()).to_hex().to_string();
        let session = db::authenticate_session(state, &token_hash)
            .await
            .map_err(internal_error)?;
        let Some(session) = session else {
            return Err((StatusCode::UNAUTHORIZED, "Invalid session".to_string()));
        };

        Ok(Self {
            vault_id: session.vault_id,
        })
    }
}

pub fn internal_error(error: impl ToString) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
