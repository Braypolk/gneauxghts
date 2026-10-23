//! Work-path regressions and explicitly invoked bounded profiling fixtures.
use super::*;
use super::{embed::EmbeddingInputKind, health_tests::active_status_state};

struct CountingQueryProvider {
    calls: Arc<AtomicU64>,
    delay: std::time::Duration,
}
impl EmbeddingProvider for CountingQueryProvider {
    fn minimum_text_score(&self) -> f32 {
        0.70
    }
    fn embed_texts(
        &self,
        texts: &[String],
        kind: EmbeddingInputKind,
    ) -> Result<Vec<Vec<f32>>, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(self.delay);
        let _ = kind;
        Ok(texts
            .iter()
            .map(|text| {
                if text == "zxqvnoidea" {
                    vec![0.0, 0.0, 1.0]
                } else {
                    vec![1.0, 0.0, 0.0]
                }
            })
            .collect())
    }
    fn prepare(&self) -> Result<(), String> {
        Ok(())
    }
    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            id: "counting-query".into(),
            label: "Counting query".into(),
            dimensions: 3,
            runtime_binary_path: None,
            runtime_bundled: false,
            model_path: None,
            model_repo_id: "test".into(),
            available: true,
            loading: false,
            ready: true,
            status: "ready".into(),
            error: None,
        }
    }
    fn image_representation(&self) -> Option<String> {
        Some("counting-query-images".into())
    }
    fn embed_image_query(&self, _: &[u8], _: Option<&str>) -> Result<Vec<f32>, String> {
        Ok(vec![1.0, 0.0, 0.0])
    }
    fn shutdown(&self) {}
}

#[test]
fn dock_modalities_share_query_preparation_without_ranking_discarded_passages() {
    let (mut state, _signals, temp) = active_status_state(RuntimeState::default());
    let calls = Arc::new(AtomicU64::new(0));
    let SemanticStateInner::Active(active) = &mut state.inner else {
        panic!()
    };
    active.provider = Arc::new(CountingQueryProvider {
        calls: calls.clone(),
        delay: std::time::Duration::ZERO,
    });
    // The ordinary note query owns text ranking; the media request asks only
    // for images, with independent generation/settings/current-byte checks.
    state
        .semantic_matches_for_text_scoped(
            "same exact query",
            None,
            12,
            None,
            Some(crate::note::DocumentKind::Note),
        )
        .unwrap();
    let (_, passages) = state
        .media_matches(
            Some("same exact query"),
            None,
            None,
            temp.path(),
            false,
            true,
        )
        .unwrap();
    assert!(passages.is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        state
            .debug_state()
            .snapshot()
            .unwrap()
            .metrics
            .ann_query_count,
        1
    );
    // Image-input search still retrieves passages and independently embeds
    // the image; its vector must never reuse a prepared text query.
    state
        .media_matches(
            Some("same exact query"),
            Some(b"image"),
            None,
            temp.path(),
            true,
            true,
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        state
            .debug_state()
            .snapshot()
            .unwrap()
            .metrics
            .ann_query_count,
        2
    );
    // A media admission error cannot poison later note retrieval.
    let mut settings = state.get_settings().unwrap();
    settings.semantic_search_enabled = false;
    state.set_settings(settings.clone()).unwrap();
    assert!(state
        .media_matches(
            Some("same exact query"),
            None,
            None,
            temp.path(),
            false,
            true
        )
        .is_err());
    settings.semantic_search_enabled = true;
    state.set_settings(settings).unwrap();
    state
        .semantic_matches_for_text_scoped(
            "same exact query",
            None,
            12,
            None,
            Some(crate::note::DocumentKind::Note),
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        state
            .debug_state()
            .snapshot()
            .unwrap()
            .metrics
            .ann_query_count,
        3
    );
}

/// Measures shared work through the actual semantic text/media APIs with
/// controlled inference cost. It is not a real-model or WebView benchmark.
#[test]
#[ignore = "explicit query work measurement"]
fn profile_dock_query_work() {
    let median = |values: &mut Vec<u128>| {
        values.sort();
        values[values.len() / 2]
    };
    for count in [128, 1024] {
        let (mut state, _signals, temp) = active_status_state(RuntimeState::default());
        let calls = Arc::new(AtomicU64::new(0));
        let SemanticStateInner::Active(active) = &mut state.inner else {
            panic!()
        };
        active.provider = Arc::new(CountingQueryProvider {
            calls: calls.clone(),
            delay: std::time::Duration::from_millis(40),
        });
        let mut connection = open_database(&active.db_path).unwrap();
        let mut paths = std::collections::HashSet::new();
        let mut corpus_bytes = 0;
        for i in 0..count {
            let path = temp
                .path()
                .join(format!("{i:04}.md"))
                .to_string_lossy()
                .into_owned();
            let text = "ordinary greenhouse note prose ".repeat(520);
            corpus_bytes += text.len();
            fs::write(&path, &text).unwrap();
            db::upsert_note_chunks(
                &mut connection,
                &path,
                &format!("Note {i}"),
                1,
                &content_hash(&text),
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
                crate::note::DocumentKind::Note,
                &Default::default(),
                &[chunking::SemanticChunk {
                    ordinal: 0,
                    section_label: "Body".into(),
                    text: text.clone(),
                    text_hash: content_hash(&text),
                    start_line: 1,
                    end_line: 1,
                    block_anchor: None,
                }],
                &[vec![1.0, 0.0, 0.0]],
            )
            .unwrap();
            paths.insert(path);
        }
        drop(connection);
        let allowed_paths = paths.iter().cloned().collect::<Vec<_>>();
        let reset = |state: &mut SemanticState| {
            let SemanticStateInner::Active(active) = &mut state.inner else {
                panic!()
            };
            active.query_embedding = Default::default();
        };
        let mut old = Vec::new();
        let mut new = Vec::new();
        let mut old_calls = 0;
        let mut new_calls = 0;
        let mut old_scored = 0;
        let mut new_scored = 0;
        for _ in 0..7 {
            for before in [true, false] {
                reset(&mut state);
                let calls_before = calls.load(Ordering::SeqCst);
                let metrics_before = state.debug_state().snapshot().unwrap().metrics;
                let started = Instant::now();
                let notes = state
                    .semantic_matches_for_text_scoped(
                        "inexpensive greenhouse",
                        None,
                        12,
                        Some(&allowed_paths),
                        Some(crate::note::DocumentKind::Note),
                    )
                    .unwrap();
                if before {
                    reset(&mut state);
                }
                let (images, passages) = state
                    .media_matches(
                        Some("inexpensive greenhouse"),
                        None,
                        Some(&paths),
                        temp.path(),
                        before,
                        true,
                    )
                    .unwrap();
                let elapsed = started.elapsed().as_micros();
                let metrics_after = state.debug_state().snapshot().unwrap().metrics;
                assert_eq!(notes.len(), 12);
                assert!(images.is_empty());
                assert_eq!(passages.len(), if before { 12 } else { 0 });
                let work = calls.load(Ordering::SeqCst) - calls_before;
                let scored =
                    metrics_after.ann_query_rerank_total - metrics_before.ann_query_rerank_total;
                if before {
                    old.push(elapsed);
                    old_calls = work;
                    old_scored = scored;
                } else {
                    new.push(elapsed);
                    new_calls = work;
                    new_scored = scored;
                }
            }
        }
        eprintln!("query-work-profile notes={count} corpus_bytes={corpus_bytes} samples=7 warm_fs=true fake_inference_ms=40 old_calls={old_calls} new_calls={new_calls} old_scored={old_scored} new_scored={new_scored} old_total_us={} new_total_us={}", median(&mut old), median(&mut new));
    }
}

#[test]
fn atlas_query_filters_real_index_rows_before_returning_map_matches() {
    let (mut state, _signals, temp) = active_status_state(RuntimeState::default());
    let SemanticStateInner::Active(active) = &mut state.inner else {
        panic!()
    };
    active.provider = Arc::new(CountingQueryProvider {
        calls: Arc::new(AtomicU64::new(0)),
        delay: std::time::Duration::ZERO,
    });
    let mut connection = open_database(&active.db_path).unwrap();
    for (title, vector) in [
        ("Irrigation", vec![0.8, 0.6, 0.0]),
        ("Invoices", vec![0.6, 0.8, 0.0]),
        ("Rain barrel", vec![0.0, 1.0, 0.0]),
    ] {
        let path = temp.path().join(format!("{title}.md"));
        fs::write(&path, title).unwrap();
        let chunk = chunking::SemanticChunk {
            ordinal: 0,
            section_label: "Body".into(),
            text: title.into(),
            text_hash: title.into(),
            start_line: 1,
            end_line: 1,
            block_anchor: None,
        };
        db::upsert_note_chunks(
            &mut connection,
            path.to_str().unwrap(),
            title,
            current_time_millis().unwrap(),
            "hash",
            "2026-10-22T00:00:00Z",
            "2026-10-22T00:00:00Z",
            crate::note::DocumentKind::Note,
            &db::SemanticNoteMetadata {
                note_id: title.into(),
                tags_json: "[\"garden\"]".into(),
                presentation_hash: format!("{}:hash", indexer::NOTE_PRESENTATION_ALGORITHM_VERSION),
                ..Default::default()
            },
            &[chunk],
            &[vector],
        )
        .unwrap();
    }
    let search = |query: &str| {
        state
            .search_vault_atlas(
                atlas::AtlasGenerationKey,
                query.into(),
                Default::default(),
                temp.path(),
            )
            .unwrap()
    };
    let response = search("rain");
    assert_eq!(response.matches.len(), 2); // lexical Rain barrel + semantic Irrigation
    assert!(!response
        .matches
        .iter()
        .any(|hit| hit.note_path.ends_with("Invoices.md")));
    assert!(search("zxqvnoidea").matches.is_empty());
    assert_eq!(search("tag:garden").matches.len(), 3);
    assert!(search("tag:absent").matches.is_empty());
}
