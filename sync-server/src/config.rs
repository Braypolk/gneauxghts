use anyhow::{Context, Result};
use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Clone, Debug)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub blob_root: PathBuf,
    pub app_base_url: String,
    pub magic_link_ttl_minutes: i64,
    pub session_ttl_days: i64,
    pub allow_insecure_token_response: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let bind_addr = env::var("BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8787".to_string())
            .parse()
            .context("parse BIND_ADDR")?;
        let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
        let blob_root = PathBuf::from(
            env::var("BLOB_ROOT").unwrap_or_else(|_| "./sync-server-data/blobs".to_string()),
        );
        let app_base_url =
            env::var("APP_BASE_URL").unwrap_or_else(|_| "http://localhost:8787".to_string());
        let magic_link_ttl_minutes = env::var("MAGIC_LINK_TTL_MINUTES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(15);
        let session_ttl_days = env::var("SESSION_TTL_DAYS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(30);
        let allow_insecure_token_response = env::var("ALLOW_INSECURE_TOKEN_RESPONSE")
            .ok()
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(true);

        Ok(Self {
            bind_addr,
            database_url,
            blob_root,
            app_base_url,
            magic_link_ttl_minutes,
            session_ttl_days,
            allow_insecure_token_response,
        })
    }
}
