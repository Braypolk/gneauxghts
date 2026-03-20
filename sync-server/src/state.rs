use crate::config::Config;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: PgPool,
}
