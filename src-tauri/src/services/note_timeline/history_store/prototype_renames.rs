//! Pi's exact unpublished rename correlation stays private to NoteTimeline.
//! Recovery captures an already published exact result or rolls back a prepared
//! base; it never replays accepted proposal bytes.
use super::*;

pub(super) fn initialize(connection: &Connection) -> Result<(), HistoryError> {
    // Additive, optional experiment metadata, after ordinary store admission.
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS prototype_prepared_renames (
        intent_id TEXT PRIMARY KEY REFERENCES prepared_intents(intent_id) ON DELETE CASCADE,
        source_relative TEXT NOT NULL, target_relative TEXT NOT NULL,
        base_markdown TEXT NOT NULL, base_hash TEXT NOT NULL)",
    )?;
    Ok(())
}

pub(in super::super) fn prepare(
    store: &Store,
    token: &str,
    source: &Path,
    target: &Path,
    base: &str,
) -> Result<(), HistoryError> {
    store.require_path(source)?;
    store.require_path(target)?;
    let connection = open_store(store)?;
    let key = editing_windows::receipt_key(token)?;
    if editing_windows::receipt_outcome(&connection, token)?
        != super::super::editing_window_policy::TokenOutcome::RecoverExactIntent
    {
        return Err("Rename preparation requires its live exact publication token".into());
    }
    let identity: String = connection.query_row(
        "SELECT note_id FROM prepared_intents WHERE intent_id=?1",
        [&key],
        |row| row.get(0),
    )?;
    if managed_note_identity(base).as_deref() != Ok(identity.as_str()) {
        return Err("Rename base belongs to another Note Identity".into());
    }
    let relative = |path: &Path| {
        path.strip_prefix(store.vault_root())
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|_| HistoryError::from("Rename location is outside selected vault"))
    };
    connection.execute(
        "INSERT INTO prototype_prepared_renames VALUES(?1,?2,?3,?4,?5)",
        params![
            key,
            relative(source)?,
            relative(target)?,
            base,
            hash(base.as_bytes())
        ],
    )?;
    Ok(())
}

pub(super) fn contains(connection: &Connection, key: &str) -> Result<bool, HistoryError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM prototype_prepared_renames WHERE intent_id=?1)",
        [key],
        |row| row.get(0),
    )?)
}

/// Caller holds canonical file mutation ownership. Token, identity, intended
/// authored bytes and relative destination must all match before touching files.
pub(in super::super) fn recover(
    store: &Store,
    token: &str,
    identity: &NoteIdentity,
    target: &Path,
    canonical: &str,
) -> Result<(), HistoryError> {
    let connection = open_store(store)?;
    if editing_windows::receipt_outcome(&connection, token)?
        != super::super::editing_window_policy::TokenOutcome::RecoverExactIntent
    {
        return Ok(());
    }
    let key = editing_windows::receipt_key(token)?;
    let retained = connection
        .query_row(
            "SELECT r.source_relative,r.target_relative,r.base_markdown,r.base_hash,
                i.note_id,i.authored_payload,i.result_hash
         FROM prototype_prepared_renames r JOIN prepared_intents i USING(intent_id)
         WHERE r.intent_id=?1",
            [&key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((source, destination, base, base_hash, note, intended, intended_hash)) = retained
    else {
        return Ok(());
    };
    let resolve = |relative: &str| -> Result<PathBuf, HistoryError> {
        let relative = Path::new(relative);
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err("Invalid relative prepared rename location".into());
        }
        Ok(store.vault_root().join(relative))
    };
    let source = resolve(&source)?;
    let destination = resolve(&destination)?;
    store.require_path(&source)?;
    store.require_path(&destination)?;
    let payload = AuthoredState::from_canonical(canonical).encode();
    if destination != target
        || note != identity.as_str()
        || payload != intended
        || hash(&payload) != intended_hash
        || hash(base.as_bytes()) != base_hash
        || managed_note_identity(&base).as_deref() != Ok(identity.as_str())
    {
        return Err("Prepared rename proof does not match its exact publication intent".into());
    }
    let read = |path: &Path| -> Result<Option<String>, HistoryError> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_file() => Ok(Some(fs::read_to_string(path)?)),
            Ok(_) => Err(HistoryError::Stale(
                "Rename recovery location is occupied; review again".into(),
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    };
    let moved = match read(&destination) {
        Ok(value) => value,
        Err(HistoryError::Stale(message)) => {
            editing_windows::abandon(&connection, &key)?;
            return Err(HistoryError::Stale(message));
        }
        Err(error) => return Err(error),
    };
    // Whole-vault relocation can leave the prepared absolute target at the
    // former root. This exact token/identity/payload proof plus its retained
    // relative destination authorizes capture there, never another file write.
    if moved.as_ref().is_some_and(|raw| {
        managed_note_identity(raw).as_deref() == Ok(identity.as_str())
            && AuthoredState::from_canonical(raw).encode() == intended
            && authored_content_hash(raw) == intended_hash
    }) {
        connection.execute(
            "UPDATE prepared_intents SET target_path=?2 WHERE intent_id=?1 AND note_id=?3",
            params![key, destination.to_string_lossy(), identity.as_str()],
        )?;
        let mut recovered = open_existing_connection(&connection)?;
        finalize_intent(&mut recovered, &key, &intended, None)?;
        return Ok(());
    }
    let original = match read(&source) {
        Ok(original) => original,
        Err(HistoryError::Stale(message)) => {
            editing_windows::abandon(&connection, &key)?;
            return Err(HistoryError::Stale(message));
        }
        Err(error) => return Err(error),
    };
    // Only the exact pre-publication base can be rolled back. A mismatching
    // file is preserved as an explicit conflict.
    let source_is_base = original.as_deref() == Some(base.as_str());
    let destination_is_base = moved.as_deref() == Some(base.as_str());
    if (original.is_none() || source_is_base) && destination_is_base {
        let expected_removal = crate::vault_watcher::record_expected_removal(&destination);
        let expected_write = original
            .is_none()
            .then(|| crate::vault_watcher::record_expected_write(&source, &base));
        if original.is_none() {
            crate::state::atomic_create_note(&source, base.as_bytes())?;
        }
        // Also handles a crash after exclusive source restoration but before
        // destination removal. Neither occupied source nor changed target wins.
        if read(&source)?.as_deref() != Some(base.as_str())
            || read(&destination)?.as_deref() != Some(base.as_str())
        {
            return Err(HistoryError::Stale(
                "Rename recovery changed; review current files again".into(),
            ));
        }
        fs::remove_file(&destination)?;
        expected_removal.commit();
        if let Some(expected) = expected_write {
            expected.commit();
        }
        editing_windows::abandon(&connection, &key)?;
        return Ok(());
    }
    if source_is_base && moved.is_none() {
        editing_windows::abandon(&connection, &key)?;
        return Ok(());
    }
    // We cannot prove an unpublished intermediate. Retire its capture without
    // altering either file and return an actionable draft conflict, not replay.
    editing_windows::abandon(&connection, &key)?;
    Err(HistoryError::Stale(
        "Interrupted rename conflicts with current files; review their current location and content before Keep".into(),
    ))
}
