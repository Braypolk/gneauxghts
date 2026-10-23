use crate::{
    index::{FileSignature, IndexedNote},
    note::DocumentKind,
    search::{build_search_preview, search_note, NoteSearchResult, ScoredSearchResult, TextRange},
};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tantivy::{
    collector::{Count, TopDocs},
    doc,
    query::{BooleanQuery, Occur, QueryParser, TermSetQuery},
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
    location: Field,
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

#[derive(Clone, Copy)]
pub(crate) enum LexicalLocation {
    Title,
    Body,
}
impl LexicalLocation {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::Body => "body",
        }
    }
}

pub(crate) struct LexicalPassageMatch {
    pub(crate) note_id: String,
    pub(crate) text: String,
    pub(crate) section_label: String,
    pub(crate) score: f32,
    pub(crate) location: LexicalLocation,
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
            location: schema_builder.add_text_field("location", STRING | STORED),
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

    /// Scope is part of the Tantivy query, before the bounded collector runs.
    /// Return indexed text with its source location rather than UI snippets;
    /// the retrieval owner validates against the corresponding canonical title/body.
    #[cfg(test)]
    pub(crate) fn passage_matches(
        &self,
        query_text: &str,
        allowed_ids: &HashSet<String>,
        limit: usize,
    ) -> Result<(Vec<LexicalPassageMatch>, usize), String> {
        if allowed_ids.is_empty() {
            return Ok((Vec::new(), 0));
        }
        let inner = self.inner.lock().map_err(|_| "Lexical index unavailable")?;
        self.passage_matches_locked(&inner, query_text, allowed_ids, limit)
    }

    /// Rank current indexed passages and use catalog paragraphs for pending
    /// projections. One lexical snapshot decides which source owns each note.
    pub(crate) fn passage_matches_with_catalog(
        &self,
        entries: &HashMap<PathBuf, IndexedNote>,
        query_text: &str,
        allowed_ids: &HashSet<String>,
        limit: usize,
    ) -> Result<Vec<LexicalPassageMatch>, String> {
        let inner = self.inner.lock().map_err(|_| "Lexical index unavailable")?;
        let normalized = query_text.to_lowercase();
        let terms: Vec<_> = normalized.split_whitespace().collect();
        let mut indexed_ids = HashSet::new();
        let mut pending: Vec<_> = entries
            .iter()
            .filter(|(_, note)| allowed_ids.contains(&note.note_id))
            .collect();
        pending.sort_by(|a, b| a.1.note_id.cmp(&b.1.note_id));
        let mut fallback = Vec::new();
        for (path, note) in pending {
            if inner.signatures.get(path.to_string_lossy().as_ref()) == Some(note.signature()) {
                indexed_ids.insert(note.note_id.clone());
            } else {
                // Reuse ordinary catalog matching, but return the whole matching
                // paragraph so retrieval can recover exact canonical bytes.
                for matched in search_note(Some(path), note, &normalized, &terms) {
                    if fallback.len() >= limit {
                        break;
                    }
                    let result = matched.result;
                    if let Some(paragraph) = note.paragraphs.iter().find(|p| {
                        p.section_label == result.section_label
                            && match result.start_line {
                                Some(line) => p.lines.iter().any(|entry| entry.line_number == line),
                                None => p.paragraph_index.is_none(),
                            }
                    }) {
                        fallback.push(LexicalPassageMatch {
                            note_id: note.note_id.clone(),
                            text: paragraph.text.clone(),
                            section_label: paragraph.section_label.clone(),
                            // Ordinary search scales BM25 by 1000 before comparing
                            // it with catalog relevance. Use that same unit here.
                            score: matched.score as f32 / 1000.0,
                            location: if paragraph.paragraph_index.is_none() {
                                LexicalLocation::Title
                            } else {
                                LexicalLocation::Body
                            },
                        });
                    }
                }
            }
        }
        let (mut indexed, _) =
            self.passage_matches_locked(&inner, query_text, &indexed_ids, limit)?;
        indexed.extend(fallback);
        Ok(indexed)
    }

    fn passage_matches_locked(
        &self,
        inner: &LexicalIndexInner,
        query_text: &str,
        allowed_ids: &HashSet<String>,
        limit: usize,
    ) -> Result<(Vec<LexicalPassageMatch>, usize), String> {
        if allowed_ids.is_empty() {
            return Ok((Vec::new(), 0));
        }
        let mut parser = QueryParser::for_index(
            &inner.index,
            vec![
                self.fields.title,
                self.fields.section_label,
                self.fields.body,
            ],
        );
        parser.set_field_boost(self.fields.title, 2.8);
        let (text, _) = parser.parse_query_lenient(query_text);
        let scope = TermSetQuery::new(
            allowed_ids
                .iter()
                .map(|id| Term::from_field_text(self.fields.note_id, id)),
        );
        let query = BooleanQuery::new(vec![(Occur::Must, text), (Occur::Must, Box::new(scope))]);
        let searcher = inner.reader.searcher();
        let (docs, count) = searcher
            .search(
                &query,
                &(TopDocs::with_limit(limit.max(1)).order_by_score(), Count),
            )
            .map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for (score, address) in docs {
            let doc = searcher
                .doc::<TantivyDocument>(address)
                .map_err(|e| e.to_string())?;
            let location = match string_value(&doc, self.fields.location)?.as_str() {
                "title" => LexicalLocation::Title,
                "body" => LexicalLocation::Body,
                _ => return Err("Invalid lexical evidence location".into()),
            };
            results.push(LexicalPassageMatch {
                note_id: string_value(&doc, self.fields.note_id)?,
                text: string_value(&doc, self.fields.body)?,
                section_label: string_value(&doc, self.fields.section_label)?,
                score,
                location,
            });
        }
        Ok((results, count))
    }

    /// Search the usable lexical projection and fall back to catalog paragraphs
    /// for notes that have not caught up yet. Both decisions share one lexical
    /// snapshot, so background completion cannot duplicate or omit a note.
    pub(crate) fn search_with_catalog(
        &self,
        entries: &HashMap<PathBuf, IndexedNote>,
        query_text: &str,
        normalized_query: &str,
        query_terms: &[&str],
        limit: usize,
        exclude_path: Option<&Path>,
        allowed_ids: Option<&HashSet<String>>,
    ) -> Result<Vec<ScoredSearchResult>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Lexical index lock poisoned".to_string())?;
        let mut results = entries
            .iter()
            .filter(|(path, note)| {
                Some(path.as_path()) != exclude_path
                    && note.document_kind == DocumentKind::Note
                    && allowed_ids.is_none_or(|ids| ids.contains(&note.note_id))
                    && inner.signatures.get(path.to_string_lossy().as_ref())
                        != Some(note.signature())
            })
            .flat_map(|(path, note)| search_note(Some(path), note, normalized_query, query_terms))
            .collect::<Vec<_>>();
        // Pending replacements use catalog bytes, rather than returning an
        // old indexed paragraph alongside the fallback result.
        results.extend(
            self.search_locked(
                &inner,
                query_text,
                normalized_query,
                query_terms,
                limit,
                exclude_path,
                allowed_ids,
            )?
            .into_iter()
            .filter(|candidate| {
                candidate.result.note_path.as_deref().is_some_and(|path| {
                    entries
                        .get(Path::new(path))
                        .is_some_and(|note| inner.signatures.get(path) == Some(note.signature()))
                })
            }),
        );
        Ok(results)
    }

    #[cfg(test)]
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
        self.search_locked(
            &inner,
            query_text,
            normalized_query,
            query_terms,
            limit,
            exclude_path,
            None,
        )
    }

    fn search_locked(
        &self,
        inner: &LexicalIndexInner,
        query_text: &str,
        normalized_query: &str,
        query_terms: &[&str],
        limit: usize,
        exclude_path: Option<&Path>,
        allowed_ids: Option<&HashSet<String>>,
    ) -> Result<Vec<ScoredSearchResult>, String> {
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

        let (text_query, _) = query_parser.parse_query_lenient(query_text);
        // This helper serves ordinary note search. Admission must precede the
        // bounded collector so chat paragraphs cannot consume its candidate cap.
        // Scoped passage queries retain their independent ID scope.
        let ordinary_notes = TermSetQuery::new([Term::from_field_text(
            self.fields.document_kind,
            DocumentKind::Note.as_frontmatter_value(),
        )]);
        let mut clauses: Vec<(Occur, Box<dyn tantivy::query::Query>)> = vec![
            (Occur::Must, text_query),
            (Occur::Must, Box::new(ordinary_notes)),
        ];
        if let Some(path) = exclude_path {
            clauses.push((
                Occur::MustNot,
                Box::new(TermSetQuery::new([Term::from_field_text(
                    self.fields.note_path,
                    &path.to_string_lossy(),
                )])),
            ));
        }
        if let Some(ids) = allowed_ids {
            clauses.push((
                Occur::Must,
                Box::new(TermSetQuery::new(
                    ids.iter()
                        .map(|id| Term::from_field_text(self.fields.note_id, id)),
                )),
            ));
        }
        let query = BooleanQuery::new(clauses);
        let searcher = inner.reader.searcher();
        let top_docs = searcher
            .search(
                &query,
                &TopDocs::with_limit(limit.max(1).saturating_mul(4)).order_by_score(),
            )
            .map_err(|err| err.to_string())?;
        let mut results = Vec::new();

        for (score, doc_address) in top_docs {
            let document = searcher
                .doc::<TantivyDocument>(doc_address)
                .map_err(|err| err.to_string())?;
            let note_path = string_value(&document, self.fields.note_path)?;
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
        let location = if paragraph.paragraph_index.is_none() {
            LexicalLocation::Title
        } else {
            LexicalLocation::Body
        };
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
                fields.location => location.as_str(),
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
        assert_eq!(results[0].result.section_label, "Paragraph 3");
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

    #[test]
    fn ordinary_search_and_scoped_passages_agree_before_and_after_indexing() {
        use std::collections::HashSet;
        let index = LexicalIndex::new().unwrap();
        let first_path = PathBuf::from("notes/First.md");
        let second_path = PathBuf::from("notes/Second.md");
        let first = build_indexed_note(
            &first_path,
            "---\ngneauxghts:\n  id: first-id\n---\n# First\n\nneedle in the first note",
            1,
        );
        let second = build_indexed_note(
            &second_path,
            "---\ngneauxghts:\n  id: second-id\n---\n# Second\n\nneedle in the second note",
            1,
        );
        let entries = HashMap::from([(first_path.clone(), first), (second_path.clone(), second)]);
        let search = || {
            index
                .search_with_catalog(&entries, "needle", "needle", &["needle"], 40, None, None)
                .unwrap()
        };
        let fallback = search();
        assert_eq!(fallback.len(), 2);
        for (path, note) in &entries {
            index.upsert_note(path, note).unwrap();
        }
        let indexed = search();
        let paths = |hits: &[crate::search::ScoredSearchResult]| {
            hits.iter()
                .map(|hit| hit.result.note_path.clone())
                .collect::<HashSet<_>>()
        };
        assert_eq!(paths(&fallback), paths(&indexed));
        let (passages, available) = index
            .passage_matches("needle", &HashSet::from(["second-id".to_string()]), 3)
            .unwrap();
        assert_eq!(available, 1);
        assert_eq!(passages.len(), 1);
        assert_eq!(passages[0].note_id, "second-id");
    }

    #[test]
    fn current_note_exclusion_precedes_the_bounded_collector() {
        let index = LexicalIndex::new().unwrap();
        let current_path = PathBuf::from("notes/needle-current.md");
        let other_path = PathBuf::from("notes/other.md");
        let body = (0..200)
            .map(|i| format!("needle passage {i}"))
            .collect::<Vec<_>>()
            .join("\n\n");
        let current = build_indexed_note(&current_path, &format!("# needle\n\n{body}"), 1);
        let other = build_indexed_note(&other_path, "# Other\n\nA longer ordinary paragraph includes needle among many unrelated words about gardening and weather.", 1);
        let entries = HashMap::from([(current_path.clone(), current), (other_path.clone(), other)]);
        let search = || {
            index
                .search_with_catalog(
                    &entries,
                    "needle",
                    "needle",
                    &["needle"],
                    40,
                    Some(&current_path),
                    None,
                )
                .unwrap()
        };
        let fallback = search();
        assert_eq!(fallback.len(), 1);
        assert_eq!(fallback[0].result.note_path.as_deref(), other_path.to_str());
        for (path, note) in &entries {
            index.upsert_note(path, note).unwrap();
        }
        let indexed = search();
        assert_eq!(
            indexed.len(),
            1,
            "current-note paragraphs must not fill the collector before exclusion"
        );
        assert_eq!(indexed[0].result.note_path.as_deref(), other_path.to_str());
    }

    #[test]
    fn scoped_ordinary_search_admits_before_collector_and_pending_fallback() {
        let index = LexicalIndex::new().unwrap();
        let mut entries = HashMap::new();
        for i in 0..24 {
            let path = PathBuf::from(format!("notes/Needle {i}.md"));
            let note = build_indexed_note(
                &path,
                &format!("---\ngneauxghts:\n  id: old-{i}\n---\n\nneedle"),
                1,
            );
            entries.insert(path, note);
        }
        let path = PathBuf::from("notes/Recent.md");
        let note = build_indexed_note(&path, "---\ngneauxghts:\n  id: recent\n---\n\nA longer ordinary paragraph includes needle among many unrelated words about gardening and weather.", 2);
        entries.insert(path.clone(), note);
        let scope = std::collections::HashSet::from(["recent".to_string()]);
        let run = || {
            index
                .search_with_catalog(
                    &entries,
                    "needle",
                    "needle",
                    &["needle"],
                    1,
                    None,
                    Some(&scope),
                )
                .unwrap()
        };
        let fallback = run();
        assert_eq!(fallback.len(), 1);
        assert_eq!(fallback[0].result.note_path.as_deref(), path.to_str());
        for (path, note) in &entries {
            index.upsert_note(path, note).unwrap();
        }
        let indexed = run();
        assert_eq!(
            indexed.len(),
            1,
            "out-of-scope title matches cannot consume bounded collector"
        );
        assert_eq!(indexed[0].result.note_path.as_deref(), path.to_str());
    }

    #[test]
    fn pending_replacements_search_current_content_without_stale_or_duplicate_results() {
        let index = LexicalIndex::new().unwrap();
        let path = PathBuf::from("notes/changing.md");
        let old = build_indexed_note(&path, "# Changing\n\nshared obsoleteword", 42);
        let current = build_indexed_note(&path, "# Changing\n\nshared replacementword", 43);
        let mut entries = HashMap::from([(path.clone(), current)]);
        let search = |query: &str, exclude| {
            index
                .search_with_catalog(&entries, query, query, &[query], 10, exclude, None)
                .unwrap()
        };

        assert_eq!(
            search("replacementword", None).len(),
            1,
            "an entirely empty lexical index still searches discovered notes"
        );
        index.upsert_note(&path, &old).unwrap();
        assert!(search("obsoleteword", None).is_empty());
        let results = search("shared", None);
        assert_eq!(results.len(), 1);
        assert!(results[0].result.excerpt.contains("replacementword"));
        assert!(
            search("replacementword", Some(path.as_path())).is_empty(),
            "the open-note override must remain the only source for its path"
        );

        index.upsert_note(&path, &entries[&path]).unwrap();
        assert_eq!(search("shared", None).len(), 1);
        entries.remove(&path);
        assert!(
            index
                .search_with_catalog(&entries, "shared", "shared", &["shared"], 10, None, None)
                .unwrap()
                .is_empty(),
            "a removed catalog note is no longer searchable"
        );
    }
}
