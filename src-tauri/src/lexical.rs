use crate::{
    index::{FileSignature, IndexedNote},
    note::DocumentKind,
    search::{build_search_preview, NoteSearchResult, ScoredSearchResult, TextRange},
};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tantivy::{
    collector::TopDocs,
    doc,
    query::QueryParser,
    schema::{Field, Schema, Value, STORED, STRING, TEXT},
    Index, IndexReader, IndexWriter, TantivyDocument, Term,
};

const INDEX_WRITER_MEMORY_BYTES: usize = 50_000_000;

#[derive(Clone, Copy)]
struct LexicalFields {
    note_path: Field,
    note_id: Field,
    file_name: Field,
    title: Field,
    section_label: Field,
    body: Field,
    paragraph_index: Field,
    document_kind: Field,
}

struct LexicalIndexInner {
    index: Index,
    reader: IndexReader,
    writer: IndexWriter,
    signatures: HashMap<String, FileSignature>,
}

pub(crate) struct LexicalIndex {
    fields: LexicalFields,
    inner: Mutex<LexicalIndexInner>,
}

impl LexicalIndex {
    pub(crate) fn new() -> Result<Self, String> {
        let mut schema_builder = Schema::builder();
        let fields = LexicalFields {
            note_path: schema_builder.add_text_field("note_path", STRING | STORED),
            note_id: schema_builder.add_text_field("note_id", STRING | STORED),
            file_name: schema_builder.add_text_field("file_name", TEXT | STORED),
            title: schema_builder.add_text_field("title", TEXT | STORED),
            section_label: schema_builder.add_text_field("section_label", TEXT | STORED),
            body: schema_builder.add_text_field("body", TEXT | STORED),
            paragraph_index: schema_builder.add_u64_field("paragraph_index", STORED),
            document_kind: schema_builder.add_text_field("document_kind", STRING | STORED),
        };
        let schema = schema_builder.build();
        let index = Index::create_in_ram(schema);
        let reader = index.reader().map_err(|err| err.to_string())?;
        let writer = index
            .writer(INDEX_WRITER_MEMORY_BYTES)
            .map_err(|err| err.to_string())?;

        Ok(Self {
            fields,
            inner: Mutex::new(LexicalIndexInner {
                index,
                reader,
                writer,
                signatures: HashMap::new(),
            }),
        })
    }

    /// Phase 5: retained for tests and emergency reconciliation. The
    /// production search path now relies on write-through updates from
    /// [`AppState::ensure_interactive_index`], [`AppState::upsert_note_indexes`],
    /// and [`AppState::remove_note_indexes`].
    #[allow(dead_code)]
    pub(crate) fn sync_with_notes_index(
        &self,
        entries: &HashMap<PathBuf, IndexedNote>,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Lexical index lock poisoned".to_string())?;
        if inner.signatures.len() == entries.len()
            && entries.iter().all(|(path, note)| {
                let note_path = path.to_string_lossy();
                inner
                    .signatures
                    .get(note_path.as_ref())
                    .is_some_and(|signature| signature == note.signature())
            })
        {
            return Ok(());
        }

        let mut changed = false;
        let mut seen_paths = HashSet::with_capacity(entries.len());

        for (path, note) in entries {
            let note_path = path.to_string_lossy().into_owned();
            seen_paths.insert(note_path.clone());
            if inner
                .signatures
                .get(&note_path)
                .is_some_and(|signature| signature == note.signature())
            {
                continue;
            }

            replace_note_locked(&mut inner, self.fields, &note_path, note)?;
            inner.signatures.insert(note_path, note.signature().clone());
            changed = true;
        }

        let stale_paths = inner
            .signatures
            .keys()
            .filter(|note_path| !seen_paths.contains(*note_path))
            .cloned()
            .collect::<Vec<_>>();
        for stale_path in stale_paths {
            delete_note_locked(&mut inner, self.fields, &stale_path);
            inner.signatures.remove(&stale_path);
            changed = true;
        }

        if changed {
            commit_locked(&mut inner)?;
        }

        Ok(())
    }

    pub(crate) fn upsert_note(&self, path: &Path, note: &IndexedNote) -> Result<(), String> {
        let note_path = path.to_string_lossy().into_owned();
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Lexical index lock poisoned".to_string())?;
        if inner
            .signatures
            .get(&note_path)
            .is_some_and(|signature| signature == note.signature())
        {
            return Ok(());
        }

        replace_note_locked(&mut inner, self.fields, &note_path, note)?;
        inner.signatures.insert(note_path, note.signature().clone());
        commit_locked(&mut inner)
    }

    pub(crate) fn remove_note(&self, path: &Path) -> Result<(), String> {
        let note_path = path.to_string_lossy().into_owned();
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Lexical index lock poisoned".to_string())?;
        if inner.signatures.remove(&note_path).is_none() {
            return Ok(());
        }

        delete_note_locked(&mut inner, self.fields, &note_path);
        commit_locked(&mut inner)
    }

    /// Test-only: peek at whether a given path has a tracked lexical
    /// signature. Used by the foreground/background gating test in
    /// `index.rs` as the "did the queue process this job yet" signal,
    /// since `upsert_note` is what the queue worker calls.
    #[cfg(test)]
    pub(crate) fn contains_signature_for_test(&self, path: &Path) -> bool {
        let note_path = path.to_string_lossy().into_owned();
        match self.inner.lock() {
            Ok(inner) => inner.signatures.contains_key(&note_path),
            Err(_) => false,
        }
    }

    pub(crate) fn search(
        &self,
        query_text: &str,
        normalized_query: &str,
        query_terms: &[&str],
        limit: usize,
        exclude_path: Option<&Path>,
    ) -> Result<Vec<ScoredSearchResult>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Lexical index lock poisoned".to_string())?;
        if inner.signatures.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_parser = QueryParser::for_index(
            &inner.index,
            vec![
                self.fields.file_name,
                self.fields.title,
                self.fields.section_label,
                self.fields.body,
            ],
        );
        query_parser.set_conjunction_by_default();
        query_parser.set_field_boost(self.fields.file_name, 2.2);
        query_parser.set_field_boost(self.fields.title, 2.8);
        query_parser.set_field_boost(self.fields.section_label, 1.4);

        let (query, _) = query_parser.parse_query_lenient(query_text);
        let searcher = inner.reader.searcher();
        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(limit.max(1).saturating_mul(4)))
            .map_err(|err| err.to_string())?;
        let excluded_path = exclude_path.map(|path| path.to_string_lossy().into_owned());
        let mut results = Vec::new();

        for (score, doc_address) in top_docs {
            let document = searcher
                .doc::<TantivyDocument>(doc_address)
                .map_err(|err| err.to_string())?;
            let note_path = string_value(&document, self.fields.note_path)?;
            if excluded_path.as_deref() == Some(note_path.as_str()) {
                continue;
            }

            let body = string_value(&document, self.fields.body)?;
            let (excerpt, highlight_ranges, match_text) =
                lexical_preview(&body, normalized_query, query_terms);
            let section_label = string_value(&document, self.fields.section_label)?;
            let paragraph_index = u64_value(&document, self.fields.paragraph_index)? as usize;
            let rank_bonus = if section_label == "Title" {
                120usize
            } else {
                90usize.saturating_sub(paragraph_index * 8)
            };
            let scaled_score = (score.max(0.0) * 1000.0).round() as usize + rank_bonus;

            results.push(ScoredSearchResult {
                score: scaled_score,
                result: NoteSearchResult {
                    note_id: Some(string_value(&document, self.fields.note_id)?),
                    note_path: Some(note_path),
                    document_kind: DocumentKind::from_frontmatter_value(&string_value(
                        &document,
                        self.fields.document_kind,
                    )?),
                    file_name: string_value(&document, self.fields.file_name)?,
                    section_label,
                    excerpt,
                    highlight_ranges,
                    match_text,
                    reason_labels: Vec::new(),
                    lexical_score: Some(scaled_score as f32),
                    semantic_score: None,
                    start_line: None,
                    end_line: None,
                    block_anchor: None,
                },
            });
        }

        Ok(results)
    }
}

fn replace_note_locked(
    inner: &mut LexicalIndexInner,
    fields: LexicalFields,
    note_path: &str,
    note: &IndexedNote,
) -> Result<(), String> {
    delete_note_locked(inner, fields, note_path);
    for paragraph in &note.paragraphs {
        inner
            .writer
            .add_document(doc!(
                fields.note_path => note_path,
                fields.note_id => note.note_id.clone(),
                fields.file_name => note.file_name.clone(),
                fields.title => note.title.clone(),
                fields.section_label => paragraph.section_label.clone(),
                fields.body => paragraph.text.clone(),
                fields.paragraph_index => paragraph.paragraph_index.unwrap_or(0) as u64,
                fields.document_kind => note.document_kind.as_frontmatter_value(),
            ))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn delete_note_locked(inner: &mut LexicalIndexInner, fields: LexicalFields, note_path: &str) {
    inner
        .writer
        .delete_term(Term::from_field_text(fields.note_path, note_path));
}

fn commit_locked(inner: &mut LexicalIndexInner) -> Result<(), String> {
    inner.writer.commit().map_err(|err| err.to_string())?;
    inner.reader.reload().map_err(|err| err.to_string())
}

fn lexical_preview(
    body: &str,
    normalized_query: &str,
    query_terms: &[&str],
) -> (String, Vec<TextRange>, String) {
    build_search_preview(body, normalized_query, query_terms).unwrap_or_else(|| {
        let body_chars = body.chars().collect::<Vec<_>>();
        let mut excerpt = body_chars
            .iter()
            .take(180)
            .collect::<String>()
            .trim()
            .to_string();
        if body_chars.len() > 180 {
            excerpt.push('…');
        }
        (excerpt, Vec::new(), normalized_query.to_string())
    })
}

fn string_value(document: &TantivyDocument, field: Field) -> Result<String, String> {
    document
        .get_first(field)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("Missing stored string field {}", field.field_id()))
}

fn u64_value(document: &TantivyDocument, field: Field) -> Result<u64, String> {
    document
        .get_first(field)
        .and_then(|value| value.as_u64())
        .ok_or_else(|| format!("Missing stored u64 field {}", field.field_id()))
}

#[cfg(test)]
mod tests {
    use super::LexicalIndex;
    use crate::index::build_indexed_note;
    use std::{collections::HashMap, path::PathBuf};

    #[test]
    fn lexical_index_returns_title_and_body_matches() {
        let index = LexicalIndex::new().expect("create lexical index");
        let path = PathBuf::from("notes/project-atlas.md");
        let note = build_indexed_note(
            &path,
            "# Project Atlas\n\nThis note tracks roadmap for semantic retrieval in local markdown tools.\n\nNeed wording changes before release.\n",
            42,
        );
        let mut entries = HashMap::new();
        entries.insert(path.clone(), note);
        index
            .sync_with_notes_index(&entries)
            .expect("sync lexical index");

        let results = index
            .search(
                "wording changes",
                "wording changes",
                &["wording", "changes"],
                10,
                None,
            )
            .expect("search lexical index");

        assert!(!results.is_empty());
        assert_eq!(results[0].result.file_name, "project-atlas");
        assert_eq!(results[0].result.section_label, "Paragraph 2");
    }

    #[test]
    fn lexical_index_removes_deleted_notes() {
        let index = LexicalIndex::new().expect("create lexical index");
        let path = PathBuf::from("notes/project-atlas.md");
        let note = build_indexed_note(
            &path,
            "# Project Atlas\n\nNeed wording changes before release.\n",
            42,
        );
        index
            .upsert_note(&path, &note)
            .expect("upsert lexical note");
        assert!(!index
            .search("wording", "wording", &["wording"], 10, None)
            .expect("search before remove")
            .is_empty());

        index.remove_note(&path).expect("remove lexical note");

        assert!(index
            .search("wording", "wording", &["wording"], 10, None)
            .expect("search after remove")
            .is_empty());
    }
}
