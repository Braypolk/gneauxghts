//! Short discovery/read selectors. These never grant citation authority.
use super::*;

pub(super) struct EvidenceReferences {
    prefix: String,
    issued: HashMap<String, String>,
    canonical: HashMap<String, String>,
}
impl Default for EvidenceReferences {
    fn default() -> Self {
        // Random suffix keeps references from independent contexts distinct.
        let identity = crate::note::generate_unique_id();
        Self {
            prefix: format!("E{}-", &identity[13..]),
            issued: HashMap::new(),
            canonical: HashMap::new(),
        }
    }
}
impl EvidenceReferences {
    fn register(&mut self, id: &str) -> String {
        if let Some(reference) = self.issued.get(id) {
            return reference.clone();
        }
        let reference = format!("{}{}", self.prefix, self.issued.len() + 1);
        self.issued.insert(id.into(), reference.clone());
        self.canonical.insert(reference.clone(), id.into());
        reference
    }
    pub(super) fn resolve(&self, id: &str) -> Result<String, AgentToolError> {
        if id.starts_with('E') {
            self.canonical.get(id).cloned().ok_or_else(|| {
                AgentToolError::invalid("Unknown evidence reference; use an exact evidenceId returned in this context, or discover evidence with find_notes")
            })
        } else {
            // Legacy canonical IDs still undergo the ordinary candidate checks.
            Ok(id.into())
        }
    }
    pub(super) fn readable_ids(&self, canonical: &HashSet<String>) -> HashSet<String> {
        canonical
            .iter()
            .cloned()
            .chain(
                canonical
                    .iter()
                    .filter_map(|id| self.issued.get(id).cloned()),
            )
            .collect()
    }
    fn prepare(&mut self, payload: &mut Value) {
        if let Some(items) = payload["items"].as_array_mut() {
            for item in items {
                if let Some(id) = item["evidenceId"].as_str() {
                    item["evidenceId"] = json!(self.register(id));
                }
            }
        }
        if let Some(ids) = payload["remainingEvidenceIds"].as_array_mut() {
            for id in ids {
                if let Some(value) = id.as_str() {
                    *id = json!(self.register(value));
                }
            }
        }
    }
}
impl AgentToolContext {
    pub(super) fn prepare_evidence_references(
        &self,
        payload: &mut Value,
    ) -> Result<(), AgentToolError> {
        self.evidence_references
            .lock()
            .map_err(|_| "Evidence references unavailable")?
            .prepare(payload);
        Ok(())
    }
    pub(super) fn resolve_evidence_ids(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<String>, AgentToolError> {
        let references = self
            .evidence_references
            .lock()
            .map_err(|_| "Evidence references unavailable")?;
        let mut seen = HashSet::new();
        ids.into_iter()
            .map(|id| references.resolve(&id))
            .collect::<Result<Vec<_>, _>>()
            .map(|ids| {
                ids.into_iter()
                    .filter(|id| seen.insert(id.clone()))
                    .collect()
            })
    }
}
