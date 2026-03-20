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
use tokio::{net::TcpListener, signal};

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
    let app = routes::router(app_state);
    let listener = TcpListener::bind(bind_addr).await?;

    tracing::info!(%bind_addr, %app_base_url, "sync server listening");
    serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
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
