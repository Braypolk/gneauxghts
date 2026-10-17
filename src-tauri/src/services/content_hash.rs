//! Stable authored-content identity shared by native search and Pi read receipts.
//! Managed frontmatter (identity, timestamps and lifecycle) is not authored content.
pub(crate) fn canonical_content_hash(raw: &str) -> String {
    let parsed = crate::note::parse_note(raw);
    blake3::hash(
        serde_json::to_string(&(parsed.body, parsed.frontmatter.raw_other))
            .unwrap_or_default()
            .as_bytes(),
    )
    .to_hex()
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipts_keep_the_legacy_authored_content_identity() {
        let first = "---\ngneauxghts:\n  id: first\n  created_at: 2026-01-01T00:00:00Z\n  updated_at: 2026-01-02T00:00:00Z\ntags: [work]\n---\n\nCafé body\n";
        let metadata = first
            .replace("first", "second")
            .replace("2026-01-02", "2026-09-02");
        assert_eq!(
            canonical_content_hash(first),
            canonical_content_hash(&metadata)
        );
        assert_ne!(
            canonical_content_hash(first),
            canonical_content_hash(&first.replace("body", "edit"))
        );
        assert_ne!(
            canonical_content_hash(first),
            canonical_content_hash(&first.replace("work", "home"))
        );
        // The previous implementation hashes exactly this JSON tuple, including
        // the optional unmanaged-property representation and canonical body.
        let legacy = blake3::hash("[\"Café body\\n\",\"tags: [work]\"]".as_bytes())
            .to_hex()
            .to_string();
        assert_eq!(canonical_content_hash(first), legacy);
    }
}
