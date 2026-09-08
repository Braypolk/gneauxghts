//! Durable capture distinct from immutable history. All endpoint/receipt changes
//! occur in the caller's SQLite transaction; no canonical file is written here.
use super::super::editing_window_policy::{
    finalization, token_outcome, Finalization, ReceiptState, TokenOutcome, TERMINAL_RETRY_RECEIPTS,
    WINDOW_MILLIS,
};
use super::*;

#[derive(Clone, Debug)]
pub(in super::super) struct WindowAdmission {
    /// None opens a new window; Some must identify the existing successful window.
    pub(in super::super) window_id: Option<String>,
    /// Elapsed admission time relative to the window's first successful save.
    /// Runtime must validate its process-local continuous-clock origin first.
    pub(in super::super) elapsed_millis: u64,
    pub(in super::super) wall_millis: u64,
    pub(in super::super) clock_discontinuity: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(in super::super) struct WindowEvidence {
    pub(in super::super) version: u64,
    pub(in super::super) first_wall_millis: u64,
    pub(in super::super) last_wall_millis: u64,
    pub(in super::super) min_wall_millis: u64,
    pub(in super::super) max_wall_millis: u64,
    pub(in super::super) elapsed_millis: u64,
    pub(in super::super) duration_millis: u64,
    pub(in super::super) clock_discontinuity: bool,
}
impl WindowEvidence {
    pub(in super::super) fn time_evidence(&self) -> RevisionTimeEvidence {
        RevisionTimeEvidence::EditingWindow {
            version: self.version,
            first_wall_millis: self.first_wall_millis,
            last_wall_millis: self.last_wall_millis,
            min_wall_millis: self.min_wall_millis,
            max_wall_millis: self.max_wall_millis,
            clock_discontinuity: self.clock_discontinuity,
        }
    }

    pub(super) fn validate(&self) -> Result<(), HistoryError> {
        if self.version != 1
            || self.duration_millis != WINDOW_MILLIS
            || self.elapsed_millis >= self.duration_millis
            || self.min_wall_millis > self.first_wall_millis.min(self.last_wall_millis)
            || self.max_wall_millis < self.first_wall_millis.max(self.last_wall_millis)
            || (!self.clock_discontinuity
                && (self.first_wall_millis > self.last_wall_millis
                    || self.min_wall_millis != self.first_wall_millis
                    || self.max_wall_millis != self.last_wall_millis))
        {
            return Err(corrupt("Invalid Editing Window time evidence"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(in super::super) struct PendingWindow {
    pub(in super::super) note_id: String,
    pub(in super::super) window_id: String,
    pub(in super::super) generation: u64,
    pub(in super::super) anchor_revision_id: String,
    pub(in super::super) result_hash: String,
    pub(in super::super) evidence: WindowEvidence,
    pub(in super::super) endpoint_intent_id: String,
    payload: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(in super::super) enum CaptureOutcome {
    PendingWindow {
        window_id: String,
        result_hash: String,
    },
    Unchanged {
        result_hash: String,
    },
    Revision {
        revision_id: String,
    },
}

#[derive(Deserialize, Serialize)]
struct Token {
    instance: String,
    generation: u64,
    note: String,
    epoch: u64,
    sequence: u64,
    nonce: String,
}
const PREFIX: &str = "publication-v1:";

pub(super) fn initialize(connection: &Connection) -> Result<(), HistoryError> {
    // Only fresh, explicitly authorized stores reach this initializer.
    let transaction = connection
        .unchecked_transaction()
        .map_err(HistoryError::from)?;
    transaction.execute_batch("
      CREATE TABLE IF NOT EXISTS publication_scopes (
        note_id TEXT PRIMARY KEY, deletion_epoch INTEGER NOT NULL DEFAULT 0 CHECK(deletion_epoch >= 0),
        issued_sequence INTEGER NOT NULL DEFAULT 0 CHECK(issued_sequence >= 0),
        retired_through INTEGER NOT NULL DEFAULT 0 CHECK(retired_through BETWEEN 0 AND issued_sequence));
      CREATE TABLE IF NOT EXISTS publication_receipts (
        intent_id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES publication_scopes(note_id),
        deletion_epoch INTEGER NOT NULL CHECK(deletion_epoch >= 0),
        sequence INTEGER NOT NULL CHECK(sequence > 0),
        kind TEXT NOT NULL CHECK(kind IN ('point','window')),
        status TEXT NOT NULL CHECK(status IN ('prepared','finalized','abandoned')),
        live INTEGER NOT NULL DEFAULT 1 CHECK(live IN (0,1)), outcome TEXT,
        UNIQUE(note_id, sequence));
      CREATE TABLE IF NOT EXISTS pending_window_preparations (
        intent_id TEXT PRIMARY KEY REFERENCES prepared_intents(intent_id) ON DELETE CASCADE,
        window_id TEXT NOT NULL, anchor_revision_id TEXT NOT NULL,
        evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_editing_windows (
        note_id TEXT PRIMARY KEY,
        window_id TEXT NOT NULL UNIQUE,
        history_generation INTEGER NOT NULL,
        anchor_revision_id TEXT NOT NULL REFERENCES revisions(revision_id),
        endpoint_intent_id TEXT NOT NULL UNIQUE REFERENCES publication_receipts(intent_id),
        result_hash TEXT NOT NULL, payload BLOB NOT NULL, evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revision_window_evidence (
        revision_id TEXT PRIMARY KEY REFERENCES revisions(revision_id) ON DELETE CASCADE,
        window_id TEXT NOT NULL UNIQUE, evidence TEXT NOT NULL, finalized_at_millis INTEGER NOT NULL);
    ").map_err(|e| HistoryError::from(e).with_context(format!("Initialize Editing Window storage")))?;
    Ok(transaction.commit().map_err(HistoryError::from)?)
}

pub(super) fn issue_token(tx: &Transaction<'_>, note: &str) -> Result<String, HistoryError> {
    reject_purged_note_identity(tx, note)?;
    tx.execute(
        "INSERT OR IGNORE INTO publication_scopes(note_id) VALUES (?1)",
        [note],
    )
    .map_err(HistoryError::from)?;
    tx.execute(
        "UPDATE publication_scopes SET issued_sequence = issued_sequence + 1 WHERE note_id = ?1",
        [note],
    )
    .map_err(HistoryError::from)?;
    let token = tx
        .query_row(
            "SELECT store_instance_id, history_generation, deletion_epoch, issued_sequence
        FROM history_metadata, publication_scopes WHERE singleton = 1 AND note_id = ?1",
            [note],
            |r| {
                Ok(Token {
                    instance: r.get(0)?,
                    generation: r.get(1)?,
                    note: note.into(),
                    epoch: r.get(2)?,
                    sequence: r.get(3)?,
                    nonce: crate::note::generate_unique_id(),
                })
            },
        )
        .map_err(HistoryError::from)?;
    Ok(format!(
        "{PREFIX}{}",
        serde_json::to_string(&token).map_err(HistoryError::from)?
    ))
}
// Boundary tokens are never durable keys. Callers validate the entire token
// before using its nonce; internal recovery already holds a scoped receipt row.
pub(super) fn receipt_key(id: &str) -> Result<String, HistoryError> {
    Ok(parse_token(id)?.nonce)
}
fn parse_token(id: &str) -> Result<Token, HistoryError> {
    serde_json::from_str(id.strip_prefix(PREFIX).ok_or("Unknown publication token")?)
        .map_err(|_| "Unknown publication token".into())
}
pub(super) fn register_receipt(
    tx: &Transaction<'_>,
    id: &str,
    window: bool,
) -> Result<(), HistoryError> {
    let token = parse_token(id)?;
    tx.execute(
        "INSERT INTO publication_receipts(intent_id,note_id,deletion_epoch,sequence,kind,status) VALUES (?1,?2,?3,?4,?5,'prepared')",
        params![token.nonce, token.note, token.epoch, token.sequence, if window { "window" } else { "point" }],
    ).map_err(HistoryError::from)?;
    Ok(())
}

pub(super) fn receipt_outcome(c: &Connection, id: &str) -> Result<TokenOutcome, HistoryError> {
    let token = parse_token(id)?;
    let scope = c.query_row(
        "SELECT store_instance_id,history_generation,deletion_epoch,retired_through,issued_sequence
         FROM history_metadata,publication_scopes WHERE singleton=1 AND note_id=?1",
        [&token.note], |r| Ok((r.get::<_,String>(0)?,r.get::<_,u64>(1)?,r.get::<_,u64>(2)?,r.get::<_,u64>(3)?,r.get::<_,u64>(4)?))
    ).optional().map_err(HistoryError::from)?;
    let Some((instance, generation, epoch, retired, issued)) = scope else {
        return Ok(TokenOutcome::Stale);
    };
    if token.instance != instance || token.generation != generation || token.epoch != epoch {
        return Ok(TokenOutcome::Stale);
    }
    if token.sequence == 0 || token.sequence > issued {
        return Ok(TokenOutcome::Unknown);
    }
    let receipt = c.query_row("SELECT note_id,deletion_epoch,sequence,status FROM publication_receipts WHERE intent_id=?1",
        [&token.nonce], |r| Ok((r.get::<_,String>(0)?,r.get::<_,u64>(1)?,r.get::<_,u64>(2)?,r.get::<_,String>(3)?)))
        .optional().map_err(HistoryError::from)?;
    let retained = match receipt {
        Some((note, epoch, sequence, status)) => {
            if note != token.note || epoch != token.epoch || sequence != token.sequence {
                return Ok(TokenOutcome::Unknown);
            }
            Some(match status.as_str() {
                "prepared" => ReceiptState::Pending,
                "finalized" => ReceiptState::Captured,
                "abandoned" => ReceiptState::Abandoned,
                _ => return Err(corrupt("Invalid publication receipt status")),
            })
        }
        None => None,
    };
    Ok(token_outcome(true, token.sequence, retired, retained))
}

pub(super) fn finish(
    tx: &Transaction<'_>,
    key: &str,
    outcome: Option<&CaptureOutcome>,
) -> Result<(), HistoryError> {
    let note: String = tx
        .query_row(
            "SELECT note_id FROM publication_receipts WHERE intent_id=?1",
            [key],
            |r| r.get(0),
        )
        .map_err(HistoryError::from)?;
    let outcome_json = outcome
        .map(serde_json::to_string)
        .transpose()
        .map_err(HistoryError::from)?;
    tx.execute("UPDATE publication_receipts SET status=?2,outcome=?3 WHERE intent_id=?1 AND status='prepared'",
        params![key, if outcome.is_some() { "finalized" } else { "abandoned" }, outcome_json]).map_err(HistoryError::from)?;
    #[cfg(test)]
    if take_fault(FaultPoint::ReceiptOutcome) {
        return Err("injected receipt outcome failure".into());
    }
    tx.execute("DELETE FROM prepared_intents WHERE intent_id=?1", [key])
        .map_err(HistoryError::from)?;
    #[cfg(test)]
    if take_fault(FaultPoint::PreparationRemoval) {
        return Err("injected preparation removal failure".into());
    }
    if outcome.is_none() {
        tx.execute("DELETE FROM restore_origins WHERE intent_id=?1", [key])
            .map_err(HistoryError::from)?;
    }
    retire(tx, &note)
}
pub(super) fn abandon(c: &Connection, key: &str) -> Result<(), HistoryError> {
    let tx = c.unchecked_transaction().map_err(HistoryError::from)?;
    let prepared: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM prepared_intents WHERE intent_id=?1)",
            [key],
            |r| r.get(0),
        )
        .map_err(HistoryError::from)?;
    if prepared {
        finish(&tx, key, None)?;
    }
    tx.commit().map_err(HistoryError::from)
}

pub(super) fn require_no_window(c: &Connection, note: &str) -> Result<(), HistoryError> {
    let count: u64 = c
        .query_row(
            "SELECT COUNT(*) FROM pending_editing_windows WHERE note_id = ?1",
            [note],
            |r| r.get(0),
        )
        .map_err(HistoryError::from)?;
    if count != 0 {
        return Err("Finalize pending Editing Window before distinct history action".into());
    }
    Ok(())
}

pub(super) fn pending(
    c: &Connection,
    note: Option<&str>,
) -> Result<Vec<PendingWindow>, HistoryError> {
    let mut statement = c.prepare(&scoped_verification_sql("SELECT note_id, window_id, history_generation, anchor_revision_id, result_hash, evidence, endpoint_intent_id, payload
      FROM pending_editing_windows WHERE ?1 IS NULL OR note_id = ?1 ORDER BY note_id", note)).map_err(HistoryError::from)?;
    let values = statement
        .query_map([note], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Vec<u8>>(7)?,
            ))
        })
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?;
    values
        .into_iter()
        .map(
            |(
                note_id,
                window_id,
                generation,
                anchor_revision_id,
                result_hash,
                evidence,
                endpoint_intent_id,
                payload,
            )| {
                Ok(PendingWindow {
                    note_id,
                    window_id,
                    generation,
                    anchor_revision_id,
                    result_hash,
                    evidence: serde_json::from_str(&evidence).map_err(corrupt)?,
                    endpoint_intent_id,
                    payload,
                })
            },
        )
        .collect()
}

pub(super) fn prepare(
    tx: &Transaction<'_>,
    id: &str,
    note: &str,
    path: &Path,
    admission: WindowAdmission,
) -> Result<(), HistoryError> {
    // The mutation owner must settle each admitted publication before another.
    let unresolved: u64 = tx.query_row("SELECT COUNT(*) FROM prepared_intents WHERE note_id = ?1 AND status = 'prepared' AND intent_id != ?2", params![note,id], |r|r.get(0)).map_err(HistoryError::from)?;
    if unresolved != 0 {
        return Err("Recover previous publication before window admission".into());
    }
    let head = load_head(tx, note)?.ok_or("Editing Window requires a finalized baseline")?;
    if head.current_path != path {
        return Err("Finalize lifecycle transition before Editing Window admission".into());
    }
    let anchor = head
        .revision_id
        .ok_or("Editing Window requires a finalized anchor")?;
    let old = pending(tx, Some(note))?.pop();
    let (window, evidence) = match old {
        Some(old) => {
            validate_pending(tx, &old, false)?;
            if admission.window_id.as_deref() != Some(old.window_id.as_str())
                || admission.elapsed_millis < old.evidence.elapsed_millis
                || admission.elapsed_millis >= WINDOW_MILLIS
            {
                return Err("Stale or expired Editing Window admission".into());
            }
            let mut evidence = old.evidence;
            evidence.clock_discontinuity |=
                admission.clock_discontinuity || admission.wall_millis < evidence.last_wall_millis;
            evidence.last_wall_millis = admission.wall_millis;
            evidence.min_wall_millis = evidence.min_wall_millis.min(admission.wall_millis);
            evidence.max_wall_millis = evidence.max_wall_millis.max(admission.wall_millis);
            evidence.elapsed_millis = admission.elapsed_millis;
            (old.window_id, evidence)
        }
        None => {
            if admission.window_id.is_some() || admission.elapsed_millis != 0 {
                return Err("Stale Editing Window admission".into());
            }
            (
                crate::note::generate_unique_id(),
                WindowEvidence {
                    version: 1,
                    first_wall_millis: admission.wall_millis,
                    last_wall_millis: admission.wall_millis,
                    min_wall_millis: admission.wall_millis,
                    max_wall_millis: admission.wall_millis,
                    elapsed_millis: 0,
                    duration_millis: WINDOW_MILLIS,
                    clock_discontinuity: admission.clock_discontinuity,
                },
            )
        }
    };
    evidence.validate()?;
    tx.execute("INSERT INTO pending_window_preparations(intent_id, window_id, anchor_revision_id, evidence) VALUES (?1,?2,?3,?4)", params![id,window,anchor,serde_json::to_string(&evidence).map_err(HistoryError::from)?]).map_err(HistoryError::from)?;
    Ok(())
}

pub(super) fn capture(
    tx: &Transaction<'_>,
    id: &str,
    intent: &PreparedIntent,
    payload: &[u8],
) -> Result<bool, HistoryError> {
    let disposition = tx.query_row("SELECT window_id, anchor_revision_id, evidence FROM pending_window_preparations WHERE intent_id = ?1", [id], |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).optional().map_err(HistoryError::from)?;
    let Some((window, anchor, evidence_json)) = disposition else {
        if intent.revision_id.is_none() {
            return Err(corrupt("Missing durable Editing Window disposition"));
        }
        return Ok(false);
    };
    let evidence: WindowEvidence =
        serde_json::from_str(&evidence_json).map_err(HistoryError::from)?;
    evidence.validate()?;
    if intent.source != "editor"
        || intent.lifecycle_event_id.is_some()
        || evidence.last_wall_millis != intent.committed_at_millis
    {
        return Err(corrupt("Invalid Editing Window publication disposition"));
    }
    let head = load_head(tx, &intent.note_id)?.ok_or("Missing Editing Window anchor")?;
    if head.revision_id.as_deref() != Some(&anchor) || head.current_path != intent.target_path {
        return Err("Stale Editing Window anchor or path".into());
    }
    let old = pending(tx, Some(&intent.note_id))?.pop();
    if let Some(old) = &old {
        validate_pending(tx, old, false)?;
        if old.window_id != window
            || old.anchor_revision_id != anchor
            || old.evidence.elapsed_millis > evidence.elapsed_millis
            || old.evidence.first_wall_millis != evidence.first_wall_millis
            || old.evidence.min_wall_millis < evidence.min_wall_millis
            || old.evidence.max_wall_millis > evidence.max_wall_millis
            || (old.evidence.clock_discontinuity && !evidence.clock_discontinuity)
        {
            return Err("Stale Editing Window capture".into());
        }
    } else if evidence.elapsed_millis != 0 {
        return Err(corrupt("Missing assigned Editing Window"));
    }
    let canonical_hash = old
        .as_ref()
        .map(|w| w.result_hash.as_str())
        .or(head.result_hash.as_deref());
    let outcome = if canonical_hash == Some(intent.result_hash.as_str()) {
        CaptureOutcome::Unchanged {
            result_hash: intent.result_hash.clone(),
        }
    } else {
        let compressed =
            zstd::stream::encode_all(Cursor::new(payload), 3).map_err(HistoryError::from)?;
        tx.execute("INSERT INTO pending_editing_windows(note_id,window_id,history_generation,anchor_revision_id,endpoint_intent_id,result_hash,payload,evidence)
          SELECT ?1,?2,history_generation,?3,?4,?5,?6,?7 FROM history_metadata WHERE singleton = 1
          ON CONFLICT(note_id) DO UPDATE SET endpoint_intent_id=excluded.endpoint_intent_id,result_hash=excluded.result_hash,payload=excluded.payload,evidence=excluded.evidence",
          params![intent.note_id,window,anchor,id,intent.result_hash,compressed,evidence_json]).map_err(HistoryError::from)?;
        CaptureOutcome::PendingWindow {
            window_id: window,
            result_hash: intent.result_hash.clone(),
        }
    };
    finish(tx, id, Some(&outcome))?;
    Ok(true)
}

pub(super) fn validate_pending(
    c: &Connection,
    window: &PendingWindow,
    verify_anchor: bool,
) -> Result<Vec<u8>, HistoryError> {
    window.evidence.validate()?;
    let matches: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM revisions r JOIN timeline_heads h ON h.note_id=r.note_id
      JOIN history_metadata m ON m.singleton=1 JOIN publication_receipts p ON p.intent_id=?4
      JOIN publication_scopes s ON s.note_id=p.note_id
      WHERE r.revision_id=?1 AND r.note_id=?2 AND h.revision_id=r.revision_id AND h.result_hash=r.result_hash AND m.history_generation=?3
        AND p.note_id=r.note_id AND p.status='finalized' AND p.kind='window' AND p.deletion_epoch=s.deletion_epoch
        AND p.sequence<=s.issued_sequence)",
      params![window.anchor_revision_id,window.note_id,window.generation,window.endpoint_intent_id],|r|r.get(0)).map_err(HistoryError::from)?;
    if !matches {
        return Err(corrupt("Invalid Editing Window anchor, scope, or receipt"));
    }
    if retained_outcome(c, &window.endpoint_intent_id)?
        != (CaptureOutcome::PendingWindow {
            window_id: window.window_id.clone(),
            result_hash: window.result_hash.clone(),
        })
    {
        return Err(corrupt("Invalid pending Editing Window capture outcome"));
    }
    let bytes = zstd::stream::decode_all(Cursor::new(&window.payload)).map_err(corrupt)?;
    AuthoredState::decode(&bytes)?;
    if hash(&bytes) != window.result_hash {
        return Err(corrupt("Editing Window payload hash mismatch"));
    }
    // Finalization must recheck its immutable base even after cached attestation.
    if verify_anchor {
        reconstruct_revision(c, &window.anchor_revision_id)?;
    }
    Ok(bytes)
}

pub(super) fn seal(
    c: &mut Connection,
    note: &str,
    window_id: &str,
    generation: u64,
) -> Result<Option<RevisionIdentity>, HistoryError> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(HistoryError::from)?;
    let current_generation: u64 = tx
        .query_row(
            "SELECT history_generation FROM history_metadata WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .map_err(HistoryError::from)?;
    if generation != current_generation {
        return Err("Stale Editing Window generation".into());
    }
    let Some(window) = pending(&tx, Some(note))?.pop() else {
        return Ok(tx.query_row("SELECT r.revision_id FROM revision_window_evidence e JOIN revisions r ON r.revision_id=e.revision_id WHERE e.window_id=?1 AND r.note_id=?2",params![window_id,note],|r|r.get::<_,String>(0)).optional().map(|r|r.map(RevisionIdentity::from_persisted)).map_err(HistoryError::from)?);
    };
    if window.window_id != window_id {
        return Err("Stale Editing Window identity".into());
    }
    let unresolved: u64 = tx
        .query_row(
            "SELECT COUNT(*) FROM prepared_intents WHERE note_id=?1 AND status='prepared'",
            [note],
            |r| r.get(0),
        )
        .map_err(HistoryError::from)?;
    if unresolved != 0 {
        return Err("Settle admitted publication before sealing Editing Window".into());
    }
    let bytes = validate_pending(&tx, &window, true)?;
    let head = load_head(&tx, note)?.ok_or("Missing window timeline head")?;
    let mut result = None;
    if finalization(
        head.result_hash
            .as_deref()
            .ok_or("Missing window anchor hash")?,
        &window.result_hash,
    ) == Finalization::AppendNetRevision
    {
        let revision = RevisionIdentity::issue();
        append_revision(
            &tx,
            RevisionAppend {
                prepared_base: None,
                revision_id: &revision.0,
                note_id: note,
                predecessor: Some((&head.record_kind, &head.record_id)),
                base_revision_id: Some(&window.anchor_revision_id),
                source: MutationSource::Editor,
                // Private interval table is authoritative. Domain/wire promotion is issue 40;
                // these APIs are not yet enabled in the production writer.
                time_evidence: RevisionTimeEvidence::Committed {
                    committed_at_millis: window.evidence.last_wall_millis,
                },
                authored_payload: &bytes,
                result_hash: &window.result_hash,
                intent_id: Some(&window.endpoint_intent_id),
                path: &head.current_path,
                record_count: head.record_count + 1,
            },
        )?;
        tx.execute("INSERT INTO revision_window_evidence(revision_id,window_id,evidence,finalized_at_millis) VALUES (?1,?2,?3,?4)",params![revision.0,window_id,serde_json::to_string(&window.evidence).map_err(HistoryError::from)?,crate::time::current_time_millis().map_err(HistoryError::from)?]).map_err(HistoryError::from)?;
        result = Some(revision);
    }
    tx.execute(
        "DELETE FROM pending_editing_windows WHERE note_id=?1",
        [note],
    )
    .map_err(HistoryError::from)?;
    retire(&tx, note)?;
    #[cfg(test)]
    if take_fault(FaultPoint::Finalize) {
        return Err("injected Editing Window sealing failure".into());
    }
    tx.commit().map_err(HistoryError::from)?;
    Ok(result)
}

pub(super) fn capture_outcome(c: &Connection, id: &str) -> Result<CaptureOutcome, HistoryError> {
    if receipt_outcome(c, id)? != TokenOutcome::ReturnOriginalOutcome {
        return Err("Publication has no retained successful capture outcome".into());
    }
    retained_outcome(c, &receipt_key(id)?)
}
fn retained_outcome(c: &Connection, key: &str) -> Result<CaptureOutcome, HistoryError> {
    let json: String = c
        .query_row(
            "SELECT outcome FROM publication_receipts WHERE intent_id=?1 AND status='finalized'",
            [key],
            |r| r.get(0),
        )
        .map_err(corrupt)?;
    serde_json::from_str(&json).map_err(corrupt)
}

fn retire(tx: &Transaction<'_>, note: &str) -> Result<(), HistoryError> {
    let mut statement=tx.prepare("SELECT p.intent_id,p.sequence FROM publication_receipts p
      WHERE p.note_id=?1 AND p.live=0 AND p.status != 'prepared'
        AND NOT EXISTS(SELECT 1 FROM prepared_intents i WHERE i.intent_id=p.intent_id)
        AND NOT EXISTS(SELECT 1 FROM pending_editing_windows w WHERE w.endpoint_intent_id=p.intent_id)
        AND NOT EXISTS(SELECT 1 FROM revisions r WHERE r.intent_id=p.intent_id)
        AND NOT EXISTS(SELECT 1 FROM lifecycle_events l WHERE l.intent_id=p.intent_id)
        AND NOT EXISTS(SELECT 1 FROM restore_origins o WHERE o.intent_id=p.intent_id)
      ORDER BY p.sequence DESC LIMIT -1 OFFSET ?2").map_err(HistoryError::from)?;
    let rows = statement
        .query_map(params![note, TERMINAL_RETRY_RECEIPTS as u64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?))
        })
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?;
    for (id, sequence) in rows {
        tx.execute("UPDATE publication_scopes SET retired_through=MAX(retired_through,?2) WHERE note_id=?1",params![note,sequence]).map_err(HistoryError::from)?;
        tx.execute("DELETE FROM publication_receipts WHERE intent_id=?1", [id])
            .map_err(HistoryError::from)?;
    }
    Ok(())
}
pub(super) fn release(c: &mut Connection, id: &str) -> Result<(), HistoryError> {
    match receipt_outcome(c, id)? {
        TokenOutcome::Stale | TokenOutcome::Unknown => {
            return Err("Stale or unknown publication receipt".into())
        }
        _ => {}
    }
    let id = receipt_key(id)?;
    let id = id.as_str();
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(HistoryError::from)?;
    let note: String = tx
        .query_row(
            "SELECT note_id FROM publication_receipts WHERE intent_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(HistoryError::from)?;
    tx.execute(
        "UPDATE publication_receipts SET live=0 WHERE intent_id=?1",
        [id],
    )
    .map_err(HistoryError::from)?;
    retire(&tx, &note)?;
    Ok(tx.commit().map_err(HistoryError::from)?)
}
pub(super) fn release_recovered_receipts(c: &Connection) -> Result<(), HistoryError> {
    let tx = c.unchecked_transaction().map_err(HistoryError::from)?;
    tx.execute("UPDATE publication_receipts SET live=0", [])
        .map_err(HistoryError::from)?;
    let mut stmt = tx
        .prepare("SELECT note_id FROM publication_scopes")
        .map_err(HistoryError::from)?;
    let notes = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?;
    drop(stmt);
    for note in notes {
        retire(&tx, &note)?;
    }
    Ok(tx.commit().map_err(HistoryError::from)?)
}
pub(super) fn delete_note(tx: &Transaction<'_>, note: &str) -> Result<(), HistoryError> {
    tx.execute(
        "DELETE FROM pending_editing_windows WHERE note_id=?1",
        [note],
    )
    .map_err(HistoryError::from)?;
    tx.execute(
        "UPDATE publication_scopes SET deletion_epoch=deletion_epoch+1 WHERE note_id=?1",
        [note],
    )
    .map_err(HistoryError::from)?;
    Ok(())
}

pub(super) fn validate_preparation(c: &Connection, key: &str) -> Result<(), HistoryError> {
    let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM prepared_intents i JOIN publication_receipts p ON p.intent_id=i.intent_id
        JOIN publication_scopes s ON s.note_id=p.note_id WHERE i.intent_id=?1 AND i.note_id=p.note_id
        AND p.deletion_epoch=s.deletion_epoch AND p.sequence>0 AND p.sequence<=s.issued_sequence
        AND i.status='prepared' AND p.status='prepared' AND p.outcome IS NULL
        AND ((p.kind='window' AND i.revision_id IS NULL) OR (p.kind='point' AND i.revision_id IS NOT NULL)))",[key],|r|r.get(0)).map_err(HistoryError::from)?;
    if !valid {
        return Err(corrupt("Invalid scoped unresolved preparation"));
    }
    Ok(())
}

pub(super) fn verify_retained_revision(c: &Connection, revision: &str) -> Result<(), HistoryError> {
    let row=c.query_row("SELECT r.note_id,r.result_hash,r.source,r.committed_at_millis,r.intent_id,p.note_id,p.status,p.kind,p.deletion_epoch,s.deletion_epoch,p.sequence,s.issued_sequence,e.window_id,e.evidence
        FROM revisions r LEFT JOIN publication_receipts p ON p.intent_id=r.intent_id LEFT JOIN publication_scopes s ON s.note_id=p.note_id
        LEFT JOIN revision_window_evidence e ON e.revision_id=r.revision_id WHERE r.revision_id=?1",[revision],|r|Ok((
        r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<u64>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<u64>>(8)?,r.get::<_,Option<u64>>(9)?,r.get::<_,Option<u64>>(10)?,r.get::<_,Option<u64>>(11)?,r.get::<_,Option<String>>(12)?,r.get::<_,Option<String>>(13)?))).map_err(HistoryError::from)?;
    let (
        note,
        hash,
        source,
        wall,
        key,
        receipt_note,
        status,
        kind,
        epoch,
        current_epoch,
        sequence,
        issued,
        window,
        evidence,
    ) = row;
    let Some(key) = key else {
        if window.is_some() {
            return Err(corrupt("Window revision has no receipt"));
        }
        return Ok(());
    };
    if receipt_note.as_deref() != Some(&note)
        || status.as_deref() != Some("finalized")
        || epoch != current_epoch
        || sequence.is_none()
        || sequence > issued
    {
        return Err(corrupt("Invalid retained revision receipt scope"));
    }
    let outcome = retained_outcome(c, &key)?;
    match window {
        Some(window_id) => {
            let evidence: WindowEvidence = serde_json::from_str(
                &evidence.ok_or_else(|| corrupt("Missing retained interval"))?,
            )
            .map_err(corrupt)?;
            evidence.validate()?;
            if source != "editor"
                || kind.as_deref() != Some("window")
                || wall != Some(evidence.last_wall_millis)
                || outcome
                    != (CaptureOutcome::PendingWindow {
                        window_id,
                        result_hash: hash,
                    })
            {
                return Err(corrupt(
                    "Invalid retained window evidence or receipt outcome",
                ));
            }
        }
        None => {
            if kind.as_deref() != Some("point")
                || outcome
                    != (CaptureOutcome::Revision {
                        revision_id: revision.into(),
                    })
            {
                return Err(corrupt("Invalid retained point receipt outcome"));
            }
        }
    }
    Ok(())
}

pub(super) fn verify(c: &Connection, note: Option<&str>) -> Result<(), HistoryError> {
    verify_cancellable(c, note, &|| Ok(()))
}

// A scoped verifier must use an indexed equality, not an optional-filter plan.
fn scoped_verification_sql(sql: &str, note: Option<&str>) -> String {
    if note.is_some() {
        sql.replace("?1 IS NULL OR ", "")
    } else {
        sql.to_owned()
    }
}

pub(super) fn verify_cancellable(
    c: &Connection,
    note: Option<&str>,
    checkpoint: &dyn Fn() -> Result<(), HistoryError>,
) -> Result<(), HistoryError> {
    let mut stmt = c.prepare(&scoped_verification_sql("SELECT DISTINCT note_id FROM revisions WHERE (?1 IS NULL OR note_id=?1) AND source='editor'", note)).map_err(HistoryError::from)?;
    let notes = stmt
        .query_map([note], |r| r.get::<_, String>(0))
        .map_err(HistoryError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(HistoryError::from)?;
    for note_id in notes {
        checkpoint()?;
        verify_editor_revision_format(c, &note_id, None)?;
    }

    for window in pending(c, note)? {
        checkpoint()?;
        validate_pending(c, &window, true)?;
    }
    let mut preparations = c
        .prepare(&scoped_verification_sql(
            "SELECT intent_id FROM prepared_intents WHERE ?1 IS NULL OR note_id=?1",
            note,
        ))
        .map_err(HistoryError::from)?;
    for row in preparations
        .query_map([note], |r| r.get::<_, String>(0))
        .map_err(HistoryError::from)?
    {
        checkpoint()?;
        validate_preparation(c, &row.map_err(HistoryError::from)?)?;
    }
    let mut revisions = c
        .prepare(&scoped_verification_sql(
            "SELECT revision_id FROM revisions WHERE ?1 IS NULL OR note_id=?1",
            note,
        ))
        .map_err(HistoryError::from)?;
    for row in revisions
        .query_map([note], |r| r.get::<_, String>(0))
        .map_err(HistoryError::from)?
    {
        checkpoint()?;
        verify_retained_revision(c, &row.map_err(HistoryError::from)?)?;
    }
    let missing: u64 = c.query_row(&scoped_verification_sql("SELECT COUNT(*) FROM prepared_intents i WHERE i.status='prepared' AND i.revision_id IS NULL AND (?1 IS NULL OR i.note_id=?1) AND NOT EXISTS(SELECT 1 FROM pending_window_preparations w WHERE w.intent_id=i.intent_id)", note), [note], |r| r.get(0)).map_err(HistoryError::from)?;
    if missing != 0 {
        return Err(corrupt("Missing durable Editing Window disposition"));
    }
    let incomplete: u64 = c.query_row(&scoped_verification_sql("SELECT COUNT(*) FROM prepared_intents i WHERE (?1 IS NULL OR i.note_id=?1) AND NOT EXISTS(SELECT 1 FROM publication_receipts p WHERE p.intent_id=i.intent_id)", note),[note],|r|r.get(0)).map_err(HistoryError::from)?;
    if incomplete != 0 {
        return Err(corrupt("Missing scoped publication receipt"));
    }
    let mut dispositions=c.prepare(&scoped_verification_sql("SELECT w.intent_id,w.window_id,w.anchor_revision_id,w.evidence,i.note_id,i.committed_at_millis,i.source,i.lifecycle_event_id FROM pending_window_preparations w JOIN prepared_intents i ON i.intent_id=w.intent_id WHERE i.status='prepared' AND (?1 IS NULL OR i.note_id=?1)", note)).map_err(HistoryError::from)?;
    let rows = dispositions
        .query_map([note], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, u64>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(HistoryError::from)?;
    for row in rows {
        checkpoint()?;
        let (_, window, anchor, json, note, wall, source, lifecycle) =
            row.map_err(HistoryError::from)?;
        let evidence: WindowEvidence = serde_json::from_str(&json).map_err(HistoryError::from)?;
        evidence.validate()?;
        let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM revisions r JOIN timeline_heads h ON h.note_id=r.note_id WHERE r.revision_id=?1 AND r.note_id=?2 AND h.revision_id=r.revision_id)",params![anchor,note],|r|r.get(0)).map_err(HistoryError::from)?;
        if !valid || wall != evidence.last_wall_millis || source != "editor" || lifecycle.is_some()
        {
            return Err(corrupt("Invalid prepared window disposition"));
        }
        let old = pending(c, Some(&note))?.pop();
        if let Some(old) = old {
            if old.window_id != window
                || old.anchor_revision_id != anchor
                || old.evidence.first_wall_millis != evidence.first_wall_millis
                || old.evidence.elapsed_millis > evidence.elapsed_millis
            {
                return Err(corrupt("Invalid prepared window continuity"));
            }
        } else if evidence.elapsed_millis != 0 {
            return Err(corrupt("Missing prepared window assignment"));
        }
    }
    let multiple:u64=c.query_row(&scoped_verification_sql("SELECT COUNT(*) FROM (SELECT i.note_id FROM prepared_intents i JOIN pending_window_preparations w ON w.intent_id=i.intent_id WHERE status='prepared' AND (?1 IS NULL OR i.note_id=?1) GROUP BY i.note_id HAVING COUNT(*)>1)", note),[note],|r|r.get(0)).map_err(HistoryError::from)?;
    if multiple != 0 {
        return Err(corrupt("Multiple unresolved window publications"));
    }
    let mut stmt=c.prepare(&scoped_verification_sql("SELECT p.intent_id,p.status,p.kind,p.outcome,i.authored_payload,i.result_hash,i.note_id,p.note_id,p.deletion_epoch,s.deletion_epoch,p.sequence,s.issued_sequence
        FROM publication_receipts p LEFT JOIN prepared_intents i ON i.intent_id=p.intent_id
        LEFT JOIN publication_scopes s ON s.note_id=p.note_id WHERE ?1 IS NULL OR p.note_id=?1", note)).map_err(HistoryError::from)?;
    let rows = stmt
        .query_map([note], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<Vec<u8>>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, u64>(8)?,
                r.get::<_, u64>(9)?,
                r.get::<_, u64>(10)?,
                r.get::<_, u64>(11)?,
            ))
        })
        .map_err(HistoryError::from)?;
    for row in rows {
        checkpoint()?;
        let (
            key,
            status,
            kind,
            outcome,
            payload,
            result_hash,
            intent_note,
            note,
            epoch,
            current_epoch,
            sequence,
            issued,
        ) = row.map_err(HistoryError::from)?;
        if epoch != current_epoch
            || sequence == 0
            || sequence > issued
            || key.is_empty()
            || key.starts_with(PREFIX)
        {
            return Err(corrupt("Invalid publication receipt scope"));
        }
        if status == "prepared" {
            let payload = payload.ok_or_else(|| corrupt("Missing unresolved preparation"))?;
            AuthoredState::decode(&payload)?;
            if intent_note.as_deref() != Some(&note)
                || result_hash.as_deref() != Some(hash(&payload).as_str())
                || outcome.is_some()
            {
                return Err(corrupt("Invalid unresolved preparation"));
            }
        } else {
            if payload.is_some() {
                return Err(corrupt("Terminal publication retains preparation"));
            }
            if status == "finalized" {
                let parsed = retained_outcome(c, &key)?;
                match parsed {
                    CaptureOutcome::PendingWindow { .. } if kind != "window" => {
                        return Err(corrupt("Invalid receipt capture kind"))
                    }
                    CaptureOutcome::Revision { revision_id } => {
                        let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM revisions WHERE revision_id=?1 AND intent_id=?2 AND note_id=?3)",params![revision_id,key,note],|r|r.get(0)).map_err(HistoryError::from)?;
                        if kind != "point" || !valid {
                            return Err(corrupt("Invalid retained revision receipt"));
                        }
                    }
                    _ => {}
                }
            } else if status != "abandoned" || outcome.is_some() {
                return Err(corrupt("Invalid abandoned receipt"));
            }
        }
    }
    let invalid: u64 = c.query_row(&scoped_verification_sql("SELECT COUNT(*) FROM revisions r JOIN revision_window_evidence e ON r.revision_id=e.revision_id
        LEFT JOIN publication_receipts p ON p.intent_id=r.intent_id
        WHERE (?1 IS NULL OR r.note_id=?1) AND (p.intent_id IS NULL OR p.note_id!=r.note_id OR p.status!='finalized' OR p.kind!='window'
          OR r.source!='editor' OR r.base_revision_id IS NULL OR EXISTS(SELECT 1 FROM pending_editing_windows w WHERE w.window_id=e.window_id))", note),[note],|r|r.get(0)).map_err(HistoryError::from)?;
    if invalid != 0 {
        return Err(corrupt(
            "Invalid retained Editing Window evidence or endpoint reference",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_window_disposition_is_corrupt_and_cannot_publish_a_reserved_identity() {
        let _guard = crate::test_support::lock_test_env();
        let fixture = Fixture::new();
        let intent = fixture.prepare("B", 0);
        let canonical = Fixture::markdown("B");
        fs::write(&fixture.path, &canonical).unwrap();
        open_store(&Store::for_test())
            .unwrap()
            .execute(
                "DELETE FROM pending_window_preparations WHERE intent_id=?1",
                [receipt_key(intent.as_str()).unwrap()],
            )
            .unwrap();
        assert!(verify(&open_store(&Store::for_test()).unwrap(), None)
            .unwrap_err()
            .to_string()
            .contains("Missing durable Editing Window disposition"));
        assert!(finalize_publication(
            &Store::for_test(),
            &intent,
            MutationSource::Editor,
            &fixture.path,
            &canonical
        )
        .unwrap_err()
        .to_string()
        .contains("Missing durable Editing Window disposition"));
        assert!(recover_pending(&Store::for_test()).is_err());
        assert_eq!(
            revisions(&Store::for_test(), &fixture.note).unwrap().len(),
            1
        );
        assert_eq!(fs::read_to_string(&fixture.path).unwrap(), canonical);
        assert_eq!(prepared_intent_count(&Store::for_test(), "prepared"), 1);
    }
    struct Fixture {
        _data: crate::test_support::TestDir,
        notes: crate::test_support::TestDir,
        path: PathBuf,
        note: NoteIdentity,
        baseline: RevisionIdentity,
    }
    impl Fixture {
        fn new() -> Self {
            let data = crate::test_support::TestDir::new("window-data");
            crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
            let notes = crate::test_support::TestDir::new("window-notes");
            crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
            crate::state::ensure_vault_scaffold(notes.path()).unwrap();
            let path = notes.path().join("Window.md");
            let note = NoteIdentity::new("window-note");
            let markdown = Self::markdown("A");
            let intent = prepare_publication(
                &Store::for_test(),
                MutationSource::NoteCreation,
                &path,
                &markdown,
                PublicationIntentKind::Create,
                None,
            )
            .unwrap();
            fs::write(&path, &markdown).unwrap();
            finalize_publication(
                &Store::for_test(),
                &intent,
                MutationSource::NoteCreation,
                &path,
                &markdown,
            )
            .unwrap();
            let baseline = publication_revision_identity(&Store::for_test(), &intent).unwrap();
            release_publication_receipt(&Store::for_test(), &intent).unwrap();
            Self {
                _data: data,
                notes,
                path,
                note,
                baseline,
            }
        }
        fn markdown(body: &str) -> String {
            format!("---\ngneauxghts:\n  id: window-note\n  kind: note\n---\n\n{body}")
        }
        fn prepare(&self, body: &str, elapsed: u64) -> PreparedHistoryIntent {
            prepare_window_publication(
                &Store::for_test(),
                &self.path,
                &Self::markdown(body),
                WindowAdmission {
                    window_id: pending_windows(&Store::for_test())
                        .unwrap()
                        .first()
                        .map(|w| w.window_id.clone()),
                    elapsed_millis: elapsed,
                    wall_millis: 1_000_000 + elapsed,
                    clock_discontinuity: false,
                },
                None,
            )
            .unwrap()
        }
        fn capture(&self, body: &str, elapsed: u64) -> PreparedHistoryIntent {
            let intent = self.prepare(body, elapsed);
            let markdown = Self::markdown(body);
            fs::write(&self.path, &markdown).unwrap();
            finalize_publication(
                &Store::for_test(),
                &intent,
                MutationSource::Editor,
                &self.path,
                &markdown,
            )
            .unwrap();
            release_publication_receipt(&Store::for_test(), &intent).unwrap();
            intent
        }
        fn seal(&self) -> Option<RevisionIdentity> {
            let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
            seal_pending_window(&Store::for_test(), &self.note, &w.window_id, w.generation).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            crate::state::set_notes_root_override(None).unwrap();
        }
    }

    #[test]
    fn existing_current_store_indexes_pending_admission_without_hiding_orphan_intents() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let store = Store::for_test();
        let c = open_store(&store).unwrap();
        c.execute_batch("DROP INDEX IF EXISTS prepared_intents_pending_by_note")
            .unwrap();
        drop(c);
        // Reopen a valid current store created before the access-path addition.
        let c = open_store(&store).unwrap();
        let plan: String = c.query_row(
            "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM prepared_intents WHERE note_id=?1 AND status='prepared' AND intent_id!=?2",
            params![f.note.as_str(), "next-intent"], |row| row.get(3),
        ).unwrap();
        assert!(
            plan.contains("SEARCH prepared_intents USING INDEX prepared_intents_pending_by_note"),
            "{plan}"
        );
        drop(c);
        let unresolved = f.prepare("B", 0);
        let c = open_store(&store).unwrap();
        // Corrupt orphan evidence must still block the direct prepared-intent
        // guard; a receipts-first join would silently miss this row.
        c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
        c.execute(
            "DELETE FROM publication_receipts WHERE intent_id=?1",
            [receipt_key(unresolved.as_str()).unwrap()],
        )
        .unwrap();
        drop(c);
        let before = fs::read(&f.path).unwrap();
        let error = prepare_window_publication(
            &store,
            &f.path,
            &Fixture::markdown("C"),
            WindowAdmission {
                window_id: None,
                elapsed_millis: 0,
                wall_millis: 1_000_000,
                clock_discontinuity: false,
            },
            None,
        )
        .err()
        .expect("orphan preparation must refuse admission");
        assert!(
            error
                .to_string()
                .contains("Recover previous publication before window admission"),
            "{error}"
        );
        assert_eq!(fs::read(&f.path).unwrap(), before);
        assert_eq!(
            open_store(&store)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM prepared_intents", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn every_token_scope_field_is_validated_before_any_nonce_lookup_can_authorize_work() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let intent = f.prepare("B", 0);
        let store = Store::for_test();
        let c = open_store(&store).unwrap();
        let original: serde_json::Value =
            serde_json::from_str(intent.as_str().strip_prefix(PREFIX).unwrap()).unwrap();
        let known_other_nonce: String = c
            .query_row(
                "SELECT intent_id FROM publication_receipts WHERE sequence=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        for (field, value) in [
            ("instance", serde_json::json!("other")),
            ("generation", serde_json::json!(999)),
            ("note", serde_json::json!("other")),
            ("epoch", serde_json::json!(999)),
            ("sequence", serde_json::json!(1)),
            ("sequence", serde_json::json!(999)),
            ("nonce", serde_json::json!(known_other_nonce)),
            ("nonce", serde_json::json!("missing")),
        ] {
            let mut forged = original.clone();
            forged[field] = value;
            let forged = PreparedHistoryIntent::from_persisted(format!("{PREFIX}{forged}"));
            assert!(
                matches!(
                    receipt_outcome(&c, forged.as_str()).unwrap(),
                    TokenOutcome::Stale | TokenOutcome::Unknown
                ),
                "{field}"
            );
            assert!(
                publication_revision_identity(&store, &forged).is_err(),
                "{field}"
            );
            assert!(
                prepare_restore_origin(&store, &forged, &f.baseline).is_err(),
                "{field}"
            );
            assert!(
                finalize_publication(
                    &store,
                    &forged,
                    MutationSource::Editor,
                    &f.path,
                    &Fixture::markdown("B")
                )
                .is_err(),
                "{field}"
            );
            assert!(abandon_publication(&store, &forged).is_err(), "{field}");
            assert!(
                release_publication_receipt(&store, &forged).is_err(),
                "{field}"
            );
            assert_eq!(fs::read_to_string(&f.path).unwrap(), Fixture::markdown("A"));
            assert_eq!(
                receipt_outcome(&c, intent.as_str()).unwrap(),
                TokenOutcome::RecoverExactIntent
            );
            assert_eq!(
                c.query_row(
                    "SELECT live FROM publication_receipts WHERE intent_id=?1",
                    [receipt_key(intent.as_str()).unwrap()],
                    |r| r.get::<_, u64>(0)
                )
                .unwrap(),
                1
            );
        }
        // These compact keys have never stored serialized boundary scope.
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM publication_receipts WHERE intent_id LIKE 'publication-v1:%'",
                [],
                |r| r.get::<_, u64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM prepared_intents WHERE revision_id IS NOT NULL",
                [],
                |r| r.get::<_, u64>(0)
            )
            .unwrap(),
            0
        );
        assert!(publication_revision_identity(&store, &intent).is_err());
    }

    #[test]
    fn terminal_outcome_and_preparation_removal_roll_back_together_and_retry_exactly() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let intent = f.prepare("B", 0);
        let store = Store::for_test();
        let canonical = Fixture::markdown("B");
        fs::write(&f.path, &canonical).unwrap();
        for fault in [FaultPoint::ReceiptOutcome, FaultPoint::PreparationRemoval] {
            inject_fault_once(fault);
            assert!(finalize_publication(
                &store,
                &intent,
                MutationSource::Editor,
                &f.path,
                &canonical
            )
            .is_err());
            let c = open_store(&store).unwrap();
            assert_eq!(
                receipt_outcome(&c, intent.as_str()).unwrap(),
                TokenOutcome::RecoverExactIntent
            );
            assert_eq!(
                c.query_row(
                    "SELECT COUNT(*) FROM prepared_intents WHERE length(authored_payload)>0",
                    [],
                    |r| r.get::<_, u64>(0)
                )
                .unwrap(),
                1
            );
            assert_eq!(
                c.query_row(
                    "SELECT COUNT(*) FROM pending_window_preparations",
                    [],
                    |r| r.get::<_, u64>(0)
                )
                .unwrap(),
                1
            );
            assert!(pending_windows(&store).unwrap().is_empty());
        }
        finalize_publication(&store, &intent, MutationSource::Editor, &f.path, &canonical).unwrap();
        let before = publication_capture_outcome(&store, &intent).unwrap();
        let c = open_store(&store).unwrap();
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM prepared_intents", [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM pending_window_preparations",
                [],
                |r| r.get::<_, u64>(0)
            )
            .unwrap(),
            0
        );
        f.seal();
        finalize_publication(
            &store,
            &intent,
            MutationSource::TaskAction,
            Path::new("wrong"),
            "wrong",
        )
        .unwrap();
        assert_eq!(
            publication_capture_outcome(&store, &intent).unwrap(),
            before
        );
        assert!(matches!(before, CaptureOutcome::PendingWindow { .. }));
        assert_eq!(revisions(&store, &f.note).unwrap().len(), 2);
        // The point no-op has its own exact outcome after its preparation disappears.
        let noop = prepare_publication(
            &store,
            MutationSource::TaskAction,
            &f.path,
            &canonical,
            PublicationIntentKind::Update,
            None,
        )
        .unwrap();
        finalize_publication(
            &store,
            &noop,
            MutationSource::TaskAction,
            &f.path,
            &canonical,
        )
        .unwrap();
        let expected = CaptureOutcome::Unchanged {
            result_hash: authored_content_hash(&canonical),
        };
        assert_eq!(
            publication_capture_outcome(&store, &noop).unwrap(),
            expected
        );
        recover_pending(&store).unwrap();
        assert_eq!(
            publication_capture_outcome(&store, &noop).unwrap(),
            expected
        );
        let canonical = Fixture::markdown("C");
        let point = prepare_publication(
            &store,
            MutationSource::TaskAction,
            &f.path,
            &canonical,
            PublicationIntentKind::Update,
            None,
        )
        .unwrap();
        let reserved = publication_revision_identity(&store, &point).unwrap();
        fs::write(&f.path, &canonical).unwrap();
        for fault in [FaultPoint::ReceiptOutcome, FaultPoint::PreparationRemoval] {
            inject_fault_once(fault);
            assert!(finalize_publication(
                &store,
                &point,
                MutationSource::TaskAction,
                &f.path,
                &canonical
            )
            .is_err());
            assert_eq!(revisions(&store, &f.note).unwrap().len(), 2);
            assert_eq!(
                receipt_outcome(&c, point.as_str()).unwrap(),
                TokenOutcome::RecoverExactIntent
            );
            assert_eq!(
                publication_revision_identity(&store, &point).unwrap(),
                reserved
            );
        }
        finalize_publication(
            &store,
            &point,
            MutationSource::TaskAction,
            &f.path,
            &canonical,
        )
        .unwrap();
        assert_eq!(
            publication_capture_outcome(&store, &point).unwrap(),
            CaptureOutcome::Revision {
                revision_id: reserved.0.clone()
            }
        );
        assert_eq!(
            publication_revision_identity(&store, &point).unwrap(),
            reserved
        );
        finalize_publication(
            &store,
            &point,
            MutationSource::Editor,
            Path::new("wrong"),
            "wrong",
        )
        .unwrap();
        assert_eq!(revisions(&store, &f.note).unwrap().len(), 3);
    }

    #[test]
    fn repeated_sqlite_replacement_retains_one_net_revision_and_bounded_receipts() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let first = f.capture("B0", 0);
        for n in 1..300 {
            f.capture(&format!("B{n}"), n * 1000);
        }
        let c = open_store(&Store::for_test()).unwrap();
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 1);
        assert_eq!(pending_windows(&Store::for_test()).unwrap().len(), 1);
        assert_eq!(
            receipt_outcome(&c, first.as_str()).unwrap(),
            TokenOutcome::Stale
        );
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM publication_receipts", [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            66
        ); // anchor + endpoint + 64 retry receipts
        assert_eq!(
            c.query_row(
                "SELECT COALESCE(SUM(length(authored_payload)),0) FROM prepared_intents",
                [],
                |r| r.get::<_, u64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            current_content_hash(&Store::for_test(), &f.note).unwrap(),
            Some(authored_content_hash(&Fixture::markdown("B299")))
        );
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        let sealed = f.seal().unwrap();
        assert_eq!(
            seal_pending_window(&Store::for_test(), &f.note, &w.window_id, w.generation).unwrap(),
            Some(sealed.clone())
        );
        assert_eq!(
            reconstruct(&Store::for_test(), &f.note, &sealed)
                .unwrap()
                .body()
                .trim(),
            "B299"
        );
        assert_eq!(
            reconstruct(&Store::for_test(), &f.note, &f.baseline)
                .unwrap()
                .body()
                .trim(),
            "A"
        );
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 2);
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Verified
        ));
    }

    #[test]
    fn prepared_bytes_do_not_replace_successful_endpoint_and_recovery_uses_assignment() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        f.capture("B", 0);
        let before = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        let intent = f.prepare("C", 299_999);
        assert_eq!(
            pending_windows(&Store::for_test()).unwrap()[0].result_hash,
            before.result_hash
        );
        assert!(seal_pending_window(
            &Store::for_test(),
            &f.note,
            &before.window_id,
            before.generation
        )
        .is_err());
        fs::write(&f.path, Fixture::markdown("C")).unwrap();
        recover_pending(&Store::for_test()).unwrap();
        recover_pending(&Store::for_test()).unwrap();
        let recovered = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        assert_eq!(recovered.window_id, before.window_id);
        assert_eq!(recovered.evidence.elapsed_millis, 299_999);
        let expected = publication_capture_outcome(&Store::for_test(), &intent).unwrap();
        // A delayed duplicate is resolved from its receipt, never from newer bytes/path.
        finalize_publication(
            &Store::for_test(),
            &intent,
            MutationSource::TaskAction,
            Path::new("unrelated"),
            "newer bytes",
        )
        .unwrap();
        assert_eq!(
            publication_capture_outcome(&Store::for_test(), &intent).unwrap(),
            expected
        );
        f.seal();
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 2);
    }

    #[test]
    fn no_op_cancellation_keeps_baseline_and_independent_lifecycle_evidence() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let events = lifecycle_events(&Store::for_test(), &f.note).unwrap();
        f.capture("B", 0);
        f.capture("A", 1);
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        assert!(f.seal().is_none());
        assert!(
            seal_pending_window(&Store::for_test(), &f.note, &w.window_id, w.generation)
                .unwrap()
                .is_none()
        );
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 1);
        assert_eq!(
            lifecycle_events(&Store::for_test(), &f.note).unwrap(),
            events
        );
        let unchanged = f.capture("A", 0);
        assert!(pending_windows(&Store::for_test()).unwrap().is_empty());
        assert!(matches!(
            publication_capture_outcome(&Store::for_test(), &unchanged).unwrap(),
            CaptureOutcome::Unchanged { .. }
        ));
    }

    #[test]
    fn failed_and_identical_publications_preserve_first_and_last_successful_evidence() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        f.capture("B", 0);
        let before = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        let failed = f.prepare("C", 50);
        abandon_publication(&Store::for_test(), &failed).unwrap();
        release_publication_receipt(&Store::for_test(), &failed).unwrap();
        f.capture("B", 100);
        let after = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        assert_eq!(before.evidence, after.evidence);
        assert_eq!(before.endpoint_intent_id, after.endpoint_intent_id);
        assert_eq!(
            receipt_outcome(&open_store(&Store::for_test()).unwrap(), failed.as_str()).unwrap(),
            TokenOutcome::RemainAbandoned
        );
        assert!(finalize_publication(
            &Store::for_test(),
            &failed,
            MutationSource::Editor,
            &f.path,
            &Fixture::markdown("C")
        )
        .is_err());
        assert!(prepare_window_publication(
            &Store::for_test(),
            &f.path,
            &Fixture::markdown("D"),
            WindowAdmission {
                window_id: Some(before.window_id),
                elapsed_millis: 300_000,
                wall_millis: 1_300_000,
                clock_discontinuity: false
            },
            None,
        )
        .is_err());
    }

    #[test]
    fn sealing_failure_rolls_back_append_endpoint_deletion_and_receipt_retirement() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        f.capture("B", 0);
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        inject_fault_once(FaultPoint::Finalize);
        assert!(
            seal_pending_window(&Store::for_test(), &f.note, &w.window_id, w.generation).is_err()
        );
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 1);
        assert_eq!(
            pending_windows(&Store::for_test()).unwrap()[0].result_hash,
            w.result_hash
        );
        assert_eq!(
            open_store(&Store::for_test())
                .unwrap()
                .query_row("SELECT COUNT(*) FROM revision_window_evidence", [], |r| r
                    .get::<_, u64>(
                    0
                ))
                .unwrap(),
            0
        );
        f.seal();
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 2);
    }

    #[test]
    fn live_and_referenced_receipts_survive_watermark_and_clear_invalidates_old_scope() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let live = f.prepare("B", 0);
        fs::write(&f.path, Fixture::markdown("B")).unwrap();
        finalize_publication(
            &Store::for_test(),
            &live,
            MutationSource::Editor,
            &f.path,
            &Fixture::markdown("B"),
        )
        .unwrap();
        for n in 1..80 {
            f.capture(&format!("B{n}"), n);
        }
        let c = open_store(&Store::for_test()).unwrap();
        assert_eq!(
            receipt_outcome(&c, live.as_str()).unwrap(),
            TokenOutcome::ReturnOriginalOutcome
        );
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        let cleared = DeletionMarker::issue(
            DeletionScope::Note(f.note.clone()),
            HistoryDeletionKind::Clear,
            crate::time::current_time_millis().unwrap(),
            w.generation,
        );
        clear_note_history(
            &Store::for_test(),
            &f.note,
            &f.path,
            &fs::read_to_string(&f.path).unwrap(),
            &cleared,
        )
        .unwrap();
        assert_eq!(
            receipt_outcome(&c, live.as_str()).unwrap(),
            TokenOutcome::Stale
        );
        assert!(pending_windows(&Store::for_test()).unwrap().is_empty());
        assert!(
            seal_pending_window(&Store::for_test(), &f.note, &w.window_id, w.generation + 1)
                .is_err()
        );
        assert!(
            seal_pending_window(&Store::for_test(), &f.note, &w.window_id, w.generation)
                .unwrap()
                .is_none()
        );
        let mut wrong: Token =
            serde_json::from_str(live.as_str().strip_prefix(PREFIX).unwrap()).unwrap();
        wrong.sequence = 99999;
        assert_eq!(
            receipt_outcome(
                &c,
                &format!("{PREFIX}{}", serde_json::to_string(&wrong).unwrap())
            )
            .unwrap(),
            TokenOutcome::Stale
        );
        wrong.epoch += 1;
        assert_eq!(
            receipt_outcome(
                &c,
                &format!("{PREFIX}{}", serde_json::to_string(&wrong).unwrap())
            )
            .unwrap(),
            TokenOutcome::Unknown
        );
        wrong.instance = "different store".into();
        assert_eq!(
            receipt_outcome(
                &c,
                &format!("{PREFIX}{}", serde_json::to_string(&wrong).unwrap())
            )
            .unwrap(),
            TokenOutcome::Stale
        );
    }

    #[test]
    fn corrupt_pending_payload_anchor_and_timing_fail_health_and_seal_after_attestation() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        f.capture("B", 0);
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Verified
        ));
        let c = open_store(&Store::for_test()).unwrap();
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        for (column, bad) in [
            ("payload", "X'00'"),
            ("result_hash", "'wrong'"),
            ("anchor_revision_id", "'missing'"),
            ("evidence", "'{}'"),
        ] {
            let original: rusqlite::types::Value = c
                .query_row(
                    &format!("SELECT {column} FROM pending_editing_windows"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
            c.execute(
                &format!("UPDATE pending_editing_windows SET {column}={bad}"),
                [],
            )
            .unwrap();
            assert!(
                matches!(
                    integrity_snapshot(&Store::for_test()),
                    HistoryStoreIntegrity::Corrupt
                ),
                "{column}"
            );
            assert!(
                seal_pending_window(&Store::for_test(), &f.note, &w.window_id, w.generation)
                    .is_err(),
                "{column}"
            );
            c.execute(
                &format!("UPDATE pending_editing_windows SET {column}=?1"),
                [original],
            )
            .unwrap();
            c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        }
        f.seal();
    }

    #[test]
    fn unresolved_disposition_and_missing_receipt_are_integrity_failures() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        let intent = f.prepare("B", 0);
        let c = open_store(&Store::for_test()).unwrap();
        c.execute(
            "UPDATE pending_window_preparations SET anchor_revision_id='missing' WHERE intent_id=?1",
            [receipt_key(intent.as_str()).unwrap()],
        )
        .unwrap();
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Corrupt
        ));
        c.execute(
            "UPDATE pending_window_preparations SET anchor_revision_id=?1 WHERE intent_id=?2",
            params![f.baseline.0, receipt_key(intent.as_str()).unwrap()],
        )
        .unwrap();
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Verified
        ));
        c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
        c.execute(
            "DELETE FROM publication_receipts WHERE intent_id=?1",
            [receipt_key(intent.as_str()).unwrap()],
        )
        .unwrap();
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Corrupt
        ));
    }
    #[test]
    fn twelve_sqlite_windows_and_abandoned_retry_receipts_stay_bounded() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        for n in 0..12 {
            f.capture(&format!("window {n}"), 0);
            f.seal();
        }
        assert_eq!(revisions(&Store::for_test(), &f.note).unwrap().len(), 13);
        let first = f.prepare("failed", 0);
        abandon_publication(&Store::for_test(), &first).unwrap();
        release_publication_receipt(&Store::for_test(), &first).unwrap();
        for _ in 0..80 {
            let intent = f.prepare("failed", 0);
            abandon_publication(&Store::for_test(), &intent).unwrap();
            release_publication_receipt(&Store::for_test(), &intent).unwrap();
        }
        assert_eq!(
            receipt_outcome(&open_store(&Store::for_test()).unwrap(), first.as_str()).unwrap(),
            TokenOutcome::Stale
        );
        assert_eq!(
            open_store(&Store::for_test())
                .unwrap()
                .query_row("SELECT COUNT(*) FROM publication_receipts", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            77
        );
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Verified
        ));
    }

    #[test]
    fn backward_wall_evidence_survives_sealing_and_window_identity_stays_private() {
        let _guard = crate::test_support::lock_test_env();
        let f = Fixture::new();
        f.capture("B", 0);
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        let intent = prepare_window_publication(
            &Store::for_test(),
            &f.path,
            &Fixture::markdown("C"),
            WindowAdmission {
                window_id: Some(w.window_id),
                elapsed_millis: 100,
                wall_millis: 5,
                clock_discontinuity: true,
            },
            None,
        )
        .unwrap();
        assert!(publication_revision_identity(&Store::for_test(), &intent).is_err());
        fs::write(&f.path, Fixture::markdown("C")).unwrap();
        finalize_publication(
            &Store::for_test(),
            &intent,
            MutationSource::Editor,
            &f.path,
            &Fixture::markdown("C"),
        )
        .unwrap();
        release_publication_receipt(&Store::for_test(), &intent).unwrap();
        let w = pending_windows(&Store::for_test()).unwrap().pop().unwrap();
        assert_eq!(w.evidence.first_wall_millis, 1_000_000);
        assert_eq!(w.evidence.last_wall_millis, 5);
        assert!(w.evidence.clock_discontinuity);
        f.seal();
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Verified
        ));
        open_store(&Store::for_test())
            .unwrap()
            .execute("UPDATE revision_window_evidence SET window_id='wrong'", [])
            .unwrap();
        assert!(matches!(
            integrity_snapshot(&Store::for_test()),
            HistoryStoreIntegrity::Corrupt
        ));
    }
}
