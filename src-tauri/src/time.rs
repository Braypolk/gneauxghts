use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn current_time_millis() -> Result<u64, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    Ok(now.min(u128::from(u64::MAX)) as u64)
}
