//! Read-only resolution of ordinary note links for answer promotion.
//! Callers admit current Note Identity access before resolving any source path.
use crate::chat::ChatSource;
use std::{fs, path::{Path, PathBuf}};

#[cfg(test)]
pub(crate) fn promote_links(markdown:&str,sources:&[ChatSource],root:&Path)->Result<String,String> {
    promote_links_with_lookup(markdown,sources,root,|id|resolve_unique_note_path(root,id))
}

/// Legacy ChatService has no catalog handle; its permission-gated caller may
/// resolve a unique disk identity, never an arbitrary first matching file.
#[cfg(any(test,not(feature="pi-prototype")))]
pub(crate) fn resolve_unique_note_path(root:&Path,id:&str)->Result<Option<PathBuf>,String> {
    let mut found=None;
    for path in crate::path_utils::collect_markdown_files_recursively(root)? {
        if !crate::state::is_valid_note_path(&path,root) {continue;}
        if crate::state::resolve_note_id_from_path(&path).ok().as_deref()==Some(id) {
            if found.is_some() {return Err("Source Note Identity is ambiguous".into());}
            found=Some(path);
        }
    }
    Ok(found)
}

pub(crate) fn promote_links_with_lookup(
    markdown:&str,sources:&[ChatSource],root:&Path,
    mut lookup:impl FnMut(&str)->Result<Option<PathBuf>,String>,
)->Result<String,String> {
    use pulldown_cmark::{Event,Parser,Tag};
    let mut edits=Vec::new();
    for (event,range) in Parser::new(markdown).into_offset_iter() {
        if let Event::Start(Tag::Link{dest_url,..})=event {
            if let Some(id)=dest_url.strip_prefix("passage:") {
                let source=sources.iter().find(|s|s.passage.as_ref().is_some_and(|p|p.id==id)).ok_or("Answer source unavailable")?;
                let passage=source.passage.as_ref().ok_or("Source identity unavailable")?;
                if source.note_id.as_deref().is_some_and(|id|id!=passage.note_id) {return Err("Source identity binding changed".into());}
                // Recorded paths are historical presentation metadata, never a
                // fallback read capability after a move, removal or replacement.
                let path=lookup(&passage.note_id)?.ok_or("Source Note Identity is unavailable; restore its access or availability before Save")?;
                let canonical_root=fs::canonicalize(root).map_err(|e|e.to_string())?;
                let canonical_path=fs::canonicalize(&path).map_err(|_|"Source note unavailable")?;
                let relative=canonical_path.strip_prefix(&canonical_root).map_err(|_|"Source note is outside the running vault")?;
                if relative.components().any(|c|matches!(c,std::path::Component::ParentDir)) {return Err("Invalid source path".into());}
                let raw=fs::read_to_string(&canonical_path).map_err(|_|"Source note unavailable")?;
                let parsed=crate::note::parse_note(&raw);
                let same_identity=match parsed.frontmatter.managed.as_ref() {
                    Some(metadata)=>metadata.id==passage.note_id && metadata.kind==crate::note::DocumentKind::Note,
                    // Unmanaged legacy identity can only be re-proven by the
                    // exact admitted bytes. Unique text alone cannot bind a replacement.
                    None=>crate::note::note_id_from_path_or_markdown(Some(&canonical_path),&raw).as_deref()==Some(&passage.note_id)
                        && crate::services::evidence::canonical_content_hash(&raw)==passage.content_hash,
                };
                if !same_identity {return Err("Source Note Identity changed; Save cannot link a replacement note".into());}
                let target=relative.to_string_lossy().replace('\\',"/");
                let target=target.trim_end_matches(".md");
                if target.contains([']','[','\n','|']) || source.title.contains([']','[','\n','|']) {return Err("Invalid source link target".into());}
                let fragment=source_link_fragment(&canonical_path,&raw,source).map(|reference|format!("#{reference}")).unwrap_or_default();
                edits.push((range,format!("[[{target}{fragment}|{}]]",source.title)));
            }
        }
    }
    let mut result=markdown.to_string();
    for (range,text) in edits.into_iter().rev() {result.replace_range(range,&text);}
    Ok(result)
}

fn source_link_fragment(path:&Path,raw:&str,source:&ChatSource)->Option<String> {
    let passage=source.passage.as_ref()?;
    if passage.location!="body" || passage.excerpt.is_empty() {return None;}
    let body=crate::note::parse_note(raw).body;
    let start=if passage.historical.is_none()
        && crate::services::evidence::canonical_content_hash(raw)==passage.content_hash
        && body.get(passage.start..passage.end)==Some(passage.excerpt.as_str()) {passage.start}
    else {
        let start=body.find(&passage.excerpt)?;
        if body.rfind(&passage.excerpt)?!=start {return None;}
        start
    };
    crate::index::body_link_reference(raw,path.file_stem()?.to_str()?,start)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn promotion_preserves_specific_passage_destinations_and_authored_links() {
        let root = crate::test_support::TestDir::new("promotion-link-positions");
        let path = root.path().join("Source.md");
        let raw = crate::note::repair_managed_note_identity("---\ncategory: example\n---\n# Source\n\nSame éclair.\n\n## Details\n\nSame éclair.\n", "source-id").unwrap();
        fs::write(&path, &raw).unwrap();
        let body = crate::note::parse_note(&raw).body;
        let start = body.rfind("Same éclair.").unwrap();
        let mut source = ChatSource {
            kind: "passage".into(),
            note_id: None,
            note_path: Some(path.to_string_lossy().into_owned()),
            title: "Source".into(),
            excerpt: "Same éclair.".into(),
            url: None,
            anchor: Some("proof".into()),
            revision: None,
            passage: Some(crate::services::evidence::PassageCitation {
                id: "proof".into(),
                note_id: "source-id".into(),
                content_hash: crate::services::evidence::canonical_content_hash(&raw),
                location: "body".into(),
                start,
                end: start + "Same éclair.".len(),
                excerpt: "Same éclair.".into(),
                revisions: vec![],
                historical: None,
            }),
        };
        let answer = "Claim. [Source 1](passage:proof) [[Other#Heading|Other]] [[Other#^block]] [site](https://example.com)";
        assert_eq!(promote_links(answer, &[source.clone()], root.path()).unwrap(),
            "Claim. [[Source#Paragraph 3|Source]] [[Other#Heading|Other]] [[Other#^block]] [site](https://example.com)");

        source.passage.as_mut().unwrap().historical =
            Some(crate::services::note_timeline::HistoricalPassage {
                revision_id: "revision".into(),
                content_revision_id: "original".into(),
                change_kind: "removed".into(),
                time_evidence: crate::services::note_timeline::RevisionTimeEvidence::Committed {
                    committed_at_millis: 1,
                },
                source: crate::services::note_timeline::MutationSource::Editor,
            });
        // Historical offsets belong to the retained revision, even when the
        // citation's freshness hash matches the current note.
        assert_eq!(
            promote_links("[S1](passage:proof)", &[source.clone()], root.path()).unwrap(),
            "[[Source|Source]]"
        );

        // A unique surviving excerpt can be located after edits; stale offsets
        // cannot select a different paragraph, even when its length is the same.
        fs::write(&path, crate::note::repair_managed_note_identity("# Source\n\nInserted.\n\nSame éclair. ^detail\n", "source-id").unwrap()).unwrap();
        assert_eq!(
            promote_links("[S1](passage:proof)", &[source.clone()], root.path()).unwrap(),
            "[[Source#^detail|Source]]"
        );
        source.passage.as_mut().unwrap().historical = None;
        assert_eq!(
            promote_links("[S1](passage:proof)", &[source.clone()], root.path()).unwrap(),
            "[[Source#^detail|Source]]"
        );
        fs::write(&path, crate::note::repair_managed_note_identity("Different.\n\nSame éclair.\n\nSame éclair.\n", "source-id").unwrap()).unwrap();
        assert_eq!(
            promote_links("[S1](passage:proof)", &[source.clone()], root.path()).unwrap(),
            "[[Source|Source]]"
        );
        fs::remove_file(&path).unwrap();
        assert!(promote_links("[S1](passage:proof)", &[source.clone()], root.path()).is_err());

        // Properties and titles have no body position in ordinary note links.
        source.passage.as_mut().unwrap().location = "properties".into();
        fs::write(&path, &raw).unwrap();
        assert_eq!(
            promote_links("[S1](passage:proof)", &[source], root.path()).unwrap(),
            "[[Source|Source]]"
        );
    }

    fn fixture_source(path:&Path,raw:&str)->ChatSource {
        let body=crate::note::parse_note(raw).body;
        let start=body.find("Claim.").unwrap();
        ChatSource{kind:"passage".into(),note_id:Some("source-id".into()),note_path:Some(path.to_string_lossy().into()),title:"Source".into(),excerpt:"Claim.".into(),url:None,anchor:None,revision:None,
            passage:Some(crate::services::evidence::PassageCitation{id:"proof".into(),note_id:"source-id".into(),content_hash:crate::services::evidence::canonical_content_hash(raw),location:"body".into(),start,end:start+6,excerpt:"Claim.".into(),revisions:vec![],historical:None})}
    }
    #[test]
    fn rename_follows_identity_and_replaced_recorded_paths_never_gain_fragments() {
        let root=crate::test_support::TestDir::new("promotion-source-identity");
        let old=root.path().join("Source.md");
        let raw=crate::note::repair_managed_note_identity("# Source\n\nClaim. ^claim", "source-id").unwrap();
        fs::write(&old,&raw).unwrap();
        let source=fixture_source(&old,&raw);
        let moved=root.path().join("Moved.md");fs::rename(&old,&moved).unwrap();
        fs::write(&old,"# Replacement\n\nClaim. ^wrong").unwrap();
        assert_eq!(promote_links("[S](passage:proof)",&[source.clone()],root.path()).unwrap(),"[[Moved#^claim|Source]]");
        fs::remove_file(&moved).unwrap();
        assert!(promote_links("[S](passage:proof)",&[source.clone()],root.path()).is_err());
        // A stale catalog path pointing at a replacement is independently rejected.
        assert!(promote_links_with_lookup("[S](passage:proof)",&[source.clone()],root.path(),|_|Ok(Some(old.clone()))).is_err());
        // Two surviving copies cannot choose an arbitrary owner.
        fs::write(&old,&raw).unwrap();fs::write(&moved,&raw).unwrap();
        assert!(promote_links("[S](passage:proof)",&[source],root.path()).unwrap_err().contains("ambiguous"));
    }
    #[test]
    fn permission_rejection_precedes_source_reads_and_outside_paths_are_rejected() {
        let root=crate::test_support::TestDir::new("promotion-source-scope");
        let outside=crate::test_support::TestDir::new("promotion-source-outside");
        let path=outside.path().join("Source.md");
        let raw=crate::note::repair_managed_note_identity("# Source\n\nClaim. ^claim", "source-id").unwrap();
        fs::write(&path,&raw).unwrap();let source=fixture_source(&path,&raw);
        for reason in ["Source excluded","Source grant revoked"] {
            let error=promote_links_with_lookup("[S](passage:proof)",&[source.clone()],root.path(),|_|Err(reason.into())).unwrap_err();
            assert_eq!(error,reason);
        }
        assert!(promote_links_with_lookup("[S](passage:proof)",&[source],root.path(),|_|Ok(Some(path.clone()))).unwrap_err().contains("outside"));
    }

}
