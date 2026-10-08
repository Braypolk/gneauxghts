use super::*;
use crate::test_support::TestDir;

#[test]
fn atlas_activity_payload_preserves_unknown_history_and_reads_older_cache_nodes() {
    let old = serde_json::json!({
        "id":"note", "noteId":"note", "notePath":"/vault/note.md", "title":"Note", "fileName":"note.md", "documentKind":"note",
        "x":1.0, "y":2.0, "radius":5.0, "cloudId":null, "parentCloudId":null, "childCloudId":null, "clusterId":null, "subclusterId":null,
        "centrality":0.5, "importance":0.5, "lastViewedAtMillis":null, "createdAtMillis":1, "updatedAtMillis":1, "preview":"body", "tags":[], "isolated":true
    });
    let mut nodes = vec![serde_json::from_value::<AtlasNode>(old).unwrap()];
    assert_eq!(nodes[0].effective_open_count, None);
    let viewed = 100;
    let now = viewed + crate::state::OPEN_COUNT_DECAY_INTERVAL_MS * 2;
    let activity = HashMap::from([(
        "note".to_string(),
        NoteActivity {
            last_viewed_at_millis: viewed,
            open_count: 5,
            last_counted_open_at_millis: viewed,
        },
    )]);
    apply_opening_activity(&mut nodes, &activity, now);
    assert_eq!(nodes[0].effective_open_count, Some(3));
    assert_eq!(
        serde_json::to_value(&nodes[0]).unwrap()["effectiveOpenCount"],
        3
    );
    assert_eq!((nodes[0].x, nodes[0].y), (1.0, 2.0));
    apply_opening_activity(&mut nodes, &HashMap::new(), now);
    assert_eq!(nodes[0].effective_open_count, None);
    assert_eq!(nodes[0].last_viewed_at_millis, None);
}

fn test_dependencies(source_key: &str, input_hash: &str) -> AtlasDependencies {
    AtlasDependencies {
        source_key: source_key.to_string(),
        input_hash: input_hash.to_string(),
        note_ann_generation: "ann-1".to_string(),
        edge_generation: "edge-1".to_string(),
        edge_algorithm_version: "edge-v1".to_string(),
        cloud_algorithm_version: ATLAS_CLOUD_ALGORITHM_VERSION,
        layout_algorithm_version: ATLAS_LAYOUT_ALGORITHM_VERSION,
    }
}

#[test]
fn atomic_publication_keeps_previous_generation_until_pointer_flip() {
    let temp = TestDir::new("atomic");
    let cache = temp.path().to_path_buf();
    let key = AtlasGenerationKey::default();
    let root = atlas_root(&cache);
    let old_artifact = AtlasGenerationArtifact {
        response: empty_atlas("ready", "", 1).expect("old response"),
    };
    let new_artifact = AtlasGenerationArtifact {
        response: empty_atlas("ready", "", 2).expect("new response"),
    };
    atomic_write_json(&root.join("generation-hidden-old.json"), &old_artifact)
        .expect("old artifact");
    atomic_write_json(
        &ready_pointer_path(&cache, key),
        &AtlasReadyPointer {
            format_version: ATLAS_GENERATION_FORMAT_VERSION,
            structural_generation: "old".to_string(),
            target_epoch: 1,
            published_at_millis: 1,
            artifact_file: "generation-hidden-old.json".to_string(),
            dependencies: test_dependencies("hidden", "old"),
        },
    )
    .expect("old pointer");
    atomic_write_json(&root.join("generation-hidden-new.json"), &new_artifact)
        .expect("new artifact");
    let before: AtlasReadyPointer =
        read_json(&ready_pointer_path(&cache, key)).expect("read old pointer");
    assert_eq!(before.structural_generation, "old");

    let mut next = before;
    next.structural_generation = "new".to_string();
    next.target_epoch = 2;
    next.artifact_file = "generation-hidden-new.json".to_string();
    atomic_write_json(&ready_pointer_path(&cache, key), &next).expect("flip pointer");
    let after: AtlasReadyPointer =
        read_json(&ready_pointer_path(&cache, key)).expect("read new pointer");
    assert_eq!(after.structural_generation, "new");
}

#[test]
fn warm_generation_is_served_stale_while_new_epoch_builds() {
    let dependencies = test_dependencies("hidden", "input");
    let pointer = AtlasReadyPointer {
        format_version: ATLAS_GENERATION_FORMAT_VERSION,
        structural_generation: "generation-1".to_string(),
        target_epoch: 4,
        published_at_millis: 10,
        artifact_file: "generation-hidden-1.json".to_string(),
        dependencies: dependencies.clone(),
    };
    assert!(pointer_is_compatible(&pointer, &dependencies, 4));
    assert!(!pointer_is_compatible(&pointer, &dependencies, 5));
    let mut changed_input = dependencies.clone();
    changed_input.input_hash = "edited".to_string();
    assert!(!pointer_is_compatible(&pointer, &changed_input, 4));
    let mut changed_source = dependencies.clone();
    changed_source.source_key = "remembered:set-b".to_string();
    assert!(!pointer_is_compatible(&pointer, &changed_source, 4));
    let mut changed_layout = dependencies.clone();
    changed_layout.layout_algorithm_version += 1;
    assert!(!pointer_is_compatible(&pointer, &changed_layout, 4));
    let mut changed_edge = dependencies.clone();
    changed_edge.edge_generation = "edge-2".to_string();
    assert!(!pointer_is_compatible(&pointer, &changed_edge, 4));
}

#[test]
fn label_pointer_requires_current_algorithm_and_model() {
    let mut pointer = AtlasLabelReadyPointer {
        format_version: ATLAS_GENERATION_FORMAT_VERSION,
        structural_generation: "structure-1".to_string(),
        membership_fingerprint: "members-1".to_string(),
        algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
        model_fingerprint: "model-1".to_string(),
        label_generation: "labels-1".to_string(),
        artifact_file: "labels.json".to_string(),
    };
    assert!(label_pointer_is_compatible(
        &pointer,
        "structure-1",
        "members-1",
        "model-1"
    ));
    pointer.algorithm_version = "chunk-keybert-atlas-v7".to_string();
    assert!(!label_pointer_is_compatible(
        &pointer,
        "structure-1",
        "members-1",
        "model-1"
    ));
    pointer.algorithm_version = LABEL_ALGORITHM_VERSION.to_string();
    pointer.model_fingerprint = "model-2".to_string();
    assert!(!label_pointer_is_compatible(
        &pointer,
        "structure-1",
        "members-1",
        "model-1"
    ));
}

#[test]
fn label_artifact_complete_defaults_true_for_legacy_payloads() {
    let legacy = serde_json::json!({
        "structuralGeneration": "structure-1",
        "membershipFingerprint": "members-1",
        "algorithmVersion": LABEL_ALGORITHM_VERSION,
        "modelFingerprint": "model-1",
        "labelGeneration": "labels-1",
        "labels": {
            "cloud-a": { "label": "garden", "confidence": 0.9, "source": "keybert" }
        }
    });
    let artifact: AtlasLabelGenerationArtifact =
        serde_json::from_value(legacy).expect("legacy artifact");
    assert!(artifact.complete);
    assert_eq!(artifact.labels.len(), 1);

    let incomplete = AtlasLabelGenerationArtifact {
        structural_generation: "structure-1".to_string(),
        membership_fingerprint: "members-1".to_string(),
        algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
        model_fingerprint: "model-1".to_string(),
        label_generation: "labels-1".to_string(),
        labels: HashMap::from([(
            "cloud-a".to_string(),
            AtlasPublishedLabel {
                label: "garden".to_string(),
                confidence: 0.9,
                source: "keybert".to_string(),
            },
        )]),
        complete: false,
    };
    let encoded = serde_json::to_value(&incomplete).expect("encode");
    assert_eq!(encoded["complete"], false);
    let roundtrip: AtlasLabelGenerationArtifact =
        serde_json::from_value(encoded).expect("roundtrip");
    assert!(!roundtrip.complete);
}

#[test]
fn variant_targets_coalesce_to_newest_epoch() {
    let key = AtlasGenerationKey {
        chat_visibility: AtlasChatVisibilityKey::Remembered,
    };
    let mut pending = PendingIndexState::default();
    for epoch in [3, 8, 5] {
        pending
            .atlas_requests
            .entry(key)
            .and_modify(|target| *target = (*target).max(epoch))
            .or_insert(epoch);
    }
    assert_eq!(pending.atlas_requests.get(&key), Some(&8));
    pending.atlas_building.insert(key, 8);
    assert!(pending
        .atlas_building
        .get(&key)
        .is_some_and(|epoch| *epoch >= 8));
    assert!(request_is_superseded(&pending, key, 7));
    assert!(!request_is_superseded(&pending, key, 8));
}

#[test]
fn atlas_visibilities_for_mutation_batch_skips_hidden_for_chat_recall_only() {
    assert_eq!(
        atlas_visibilities_for_mutation_batch(false, true, false, false),
        [
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ]
    );
    assert_eq!(
        atlas_visibilities_for_mutation_batch(true, false, false, false),
        [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ]
    );
    assert_eq!(
        atlas_visibilities_for_mutation_batch(true, true, false, false),
        [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ]
    );
    assert_eq!(
        atlas_visibilities_for_mutation_batch(false, true, true, false),
        [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ]
    );
    assert_eq!(
        atlas_visibilities_for_mutation_batch(false, false, false, true),
        [
            AtlasChatVisibilityKey::Hidden,
            AtlasChatVisibilityKey::Remembered,
            AtlasChatVisibilityKey::All,
        ]
    );
}

#[test]
fn atlas_structural_build_covers_epoch_skips_redundant_enqueue() {
    let key = AtlasGenerationKey {
        chat_visibility: AtlasChatVisibilityKey::Hidden,
    };
    let mut pending = PendingIndexState::default();
    assert!(!atlas_structural_build_covers_epoch(&pending, key, 4));
    pending.atlas_building.insert(key, 4);
    assert!(atlas_structural_build_covers_epoch(&pending, key, 4));
    assert!(atlas_structural_build_covers_epoch(&pending, key, 3));
    assert!(!atlas_structural_build_covers_epoch(&pending, key, 5));
}

#[test]
fn persisted_visibility_variants_distinguish_remembered_chat_set() {
    let row = |path: &str, kind, chunk_count| StoredAtlasNoteMetadata {
        note_path: path.to_string(),
        title: path.to_string(),
        modified_millis: 1,
        document_kind: kind,
        note_id: String::new(),
        preview: String::new(),
        tags: Vec::new(),
        wikilink_targets: Vec::new(),
        chunk_count,
        presentation_hash: format!("presentation-{path}"),
    };
    let note = row("note.md", DocumentKind::Note, 1);
    let remembered = row("remembered.md", DocumentKind::ChatIndex, 2);
    let navigation_only = row("navigation.md", DocumentKind::ChatIndex, 0);
    let transcript = row("transcript.md", DocumentKind::ChatTranscript, 4);
    assert!(atlas_row_visible(&note, AtlasChatVisibilityKey::Hidden));
    assert!(!atlas_row_visible(
        &remembered,
        AtlasChatVisibilityKey::Hidden
    ));
    assert!(atlas_row_visible(
        &remembered,
        AtlasChatVisibilityKey::Remembered
    ));
    assert!(!atlas_row_visible(
        &navigation_only,
        AtlasChatVisibilityKey::Remembered
    ));
    assert!(atlas_row_visible(
        &navigation_only,
        AtlasChatVisibilityKey::All
    ));
    assert!(!atlas_row_visible(&transcript, AtlasChatVisibilityKey::All));
}

#[test]
fn gc_preserves_every_referenced_variant_and_removes_orphans() {
    let temp = TestDir::new("gc");
    let cache = temp.path().to_path_buf();
    let root = atlas_root(&cache);
    fs::create_dir_all(&root).expect("atlas root");
    for visibility in [
        AtlasChatVisibilityKey::Hidden,
        AtlasChatVisibilityKey::Remembered,
        AtlasChatVisibilityKey::All,
    ] {
        let name = format!("generation-{}-kept.json", visibility.signature_value());
        fs::write(root.join(&name), b"{}").expect("artifact");
        atomic_write_json(
            &ready_pointer_path(
                &cache,
                AtlasGenerationKey {
                    chat_visibility: visibility,
                },
            ),
            &AtlasReadyPointer {
                format_version: ATLAS_GENERATION_FORMAT_VERSION,
                structural_generation: "kept".to_string(),
                target_epoch: 1,
                published_at_millis: 1,
                artifact_file: name,
                dependencies: test_dependencies(visibility.signature_value(), "input"),
            },
        )
        .expect("pointer");
    }
    fs::write(root.join("generation-hidden-orphan.json"), b"{}").expect("orphan");
    gc_unreferenced_generations(&cache).expect("gc");
    assert!(!root.join("generation-hidden-orphan.json").exists());
    assert!(root.join("generation-hidden-kept.json").exists());
    assert!(root.join("generation-remembered-kept.json").exists());
    assert!(root.join("generation-all-kept.json").exists());
}

#[test]
fn atlas_visibility_filters_hidden_chat_rows_and_adds_navigation_only_chats() {
    let stored = vec![
        StoredAtlasNoteEmbedding {
            note_path: "/vault/note.md".to_string(),
            note_title: "Note".to_string(),
            modified_millis: 1,
            semantic_input_hash: "note-hash".to_string(),
            structure_hash: "note-structure".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            embedding: vec![1.0, 0.0, 0.0],
        },
        StoredAtlasNoteEmbedding {
            note_path: "/vault/Chats/remembered/Conversation.md".to_string(),
            note_title: "Remembered".to_string(),
            modified_millis: 1,
            semantic_input_hash: "recall-hash".to_string(),
            structure_hash: "recall-structure".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            embedding: vec![0.0, 1.0, 0.0],
        },
    ];
    let note_meta = AtlasNoteMetadata {
        note_id: Some("note".to_string()),
        note_path: "/vault/note.md".to_string(),
        file_name: "note.md".to_string(),
        title: "Note".to_string(),
        preview: String::new(),
        tags: Vec::new(),
        document_kind: DocumentKind::Note,
        modified_millis: 1,
    };
    let hidden = visible_atlas_notes(
        stored.clone(),
        &HashMap::from([(note_meta.note_path.clone(), note_meta.clone())]),
        3,
    );
    assert_eq!(hidden.len(), 1);
    assert_eq!(hidden[0].note_path, "/vault/note.md");

    let chat_meta = AtlasNoteMetadata {
        note_id: Some("chat".to_string()),
        note_path: "/vault/Chats/new/Conversation.md".to_string(),
        file_name: "Conversation.md".to_string(),
        title: "New chat".to_string(),
        preview: String::new(),
        tags: Vec::new(),
        document_kind: DocumentKind::ChatIndex,
        modified_millis: 2,
    };
    let all = visible_atlas_notes(
        stored,
        &HashMap::from([
            (note_meta.note_path.clone(), note_meta),
            (chat_meta.note_path.clone(), chat_meta),
        ]),
        3,
    );
    assert_eq!(all.len(), 2);
    let chat = all
        .iter()
        .find(|note| note.note_title == "New chat")
        .expect("navigation-only chat");
    assert!(chat
        .semantic_input_hash
        .starts_with(NAVIGATION_ONLY_SEMANTIC_HASH_PREFIX));
}

#[test]
fn atlas_native_worker_preserves_names_and_places_through_rebuild_restart_and_cache_loss() {
    use crate::semantic::chunking::SemanticChunk;
    use crate::semantic::db::{
        rebuild_edges_with_provenance, upsert_note_chunks, SemanticNoteMetadata,
    };
    use crate::semantic::{health_tests::active_status_state, RuntimeState, SemanticStateInner};
    let (state, _signals, temp) = active_status_state(RuntimeState::default());
    let SemanticStateInner::Active(active) = &state.inner else {
        unreachable!()
    };
    let mut db = open_database(&active.db_path).unwrap();
    let seed = |db: &mut rusqlite::Connection, i: usize| {
        let path = temp.path().join(format!("garden-{i}.md"));
        fs::write(&path, format!("# Garden {i}\nVegetables and garden soil")).unwrap();
        let hash = format!("garden-{i}");
        upsert_note_chunks(
            db,
            &path.to_string_lossy(),
            &hash,
            1,
            &hash,
            "",
            "",
            DocumentKind::Note,
            &SemanticNoteMetadata {
                note_id: hash.clone(),
                semantic_input_hash: hash.clone(),
                presentation_hash: hash.clone(),
                ..Default::default()
            },
            &[SemanticChunk {
                ordinal: 0,
                section_label: "Garden".into(),
                text: "Vegetables and garden soil".into(),
                text_hash: hash.clone(),
                start_line: 1,
                end_line: 2,
                block_anchor: None,
            }],
            &[vec![1.0, 0.0, 0.0]],
        )
        .unwrap();
    };
    for i in 0..8 {
        seed(&mut db, i);
    }
    let prepare = |db: &mut rusqlite::Connection| {
        active.note_ann.rebuild_from_connection(db).unwrap();
        rebuild_edges_with_provenance(
            db,
            8,
            0.3,
            &active.note_ann.generation_id().unwrap(),
            "status-test",
            |_, _| {},
        )
        .unwrap();
    };
    prepare(&mut db);
    let key = AtlasGenerationKey::default();
    let pending = Arc::new(Mutex::new(PendingIndexState::default()));
    let mut worker = AtlasWorkerContext {
        map_store: active.atlas_map.clone(),
        db_path: active.db_path.clone(),
        cache_dir: active.atlas_cache_dir.clone(),
        dimensions: 3,
        provider: active.provider.clone(),
        debug: active.debug.clone(),
        note_ann: active.note_ann.clone(),
        pending: pending.clone(),
    };
    let first = worker.build_and_publish(key, 0).unwrap();
    assert!(!first.clouds.is_empty());
    assert!(first.world_layout);
    let id = first
        .clouds
        .iter()
        .find(|c| c.parent_id.is_none())
        .unwrap()
        .id
        .clone();
    worker
        .map_store
        .rename(key, &id, Some("Kitchen garden".into()))
        .unwrap();
    let label_request = pending.lock().unwrap().atlas_label_requests[&key].clone();
    worker
        .build_and_publish_labels(key, &label_request)
        .unwrap();
    assert_eq!(
        worker
            .map_store
            .load(key)
            .unwrap()
            .unwrap()
            .clouds
            .iter()
            .find(|c| c.id == id)
            .unwrap()
            .user_name
            .as_deref(),
        Some("Kitchen garden")
    );
    // A new owner reopens durable map memory; rebuildable positions have never been saved.
    worker.map_store = Arc::new(AtlasMapStore::new(temp.path()));
    let restarted = worker.build_and_publish(key, 0).unwrap();
    assert_eq!(
        restarted
            .clouds
            .iter()
            .find(|c| c.id == id)
            .unwrap()
            .label
            .as_deref(),
        Some("Kitchen garden")
    );
    for node in &first.nodes {
        let next = restarted
            .nodes
            .iter()
            .find(|n| n.note_id == node.note_id)
            .unwrap();
        assert_eq!((node.x, node.y), (next.x, next.y));
    }
    seed(&mut db, 8);
    prepare(&mut db);
    let added = worker.build_and_publish(key, 1).unwrap();
    assert_eq!(added.nodes.len(), 9);
    assert!(added.clouds.iter().any(|c| c.id == id));
    let head = worker.map_store.load(key).unwrap().unwrap();
    // Crash after durable admission but before its derived ready pointer: reads repair it.
    fs::remove_file(ready_pointer_path(&worker.cache_dir, key)).unwrap();
    let repaired = active.vault_atlas(key, HashMap::new(), 1).unwrap();
    assert_eq!(repaired.structural_generation, head.generation);
    assert!(ready_pointer_path(&worker.cache_dir, key).exists());
    // Corrupt structural artifacts enqueue a rebuild, while names remain available.
    fs::write(&head.artifact_path, b"broken").unwrap();
    let corrupt = active.vault_atlas(key, HashMap::new(), 1).unwrap();
    assert_ne!(corrupt.status, "ready");
    assert!(active
        .work_queue
        .stage(|p| p.atlas_requests.contains_key(&key))
        .unwrap());
    state.clear_atlas_cache().unwrap();
    let recovered = worker.build_and_publish(key, 1).unwrap();
    assert_eq!(
        recovered
            .clouds
            .iter()
            .find(|c| c.id == id)
            .unwrap()
            .user_name
            .as_deref(),
        Some("Kitchen garden")
    );
    // Visibility filtering removes existing files from the served inventory immediately.
    let mut eligible = persisted_atlas_inputs(&db, key).unwrap().metadata;
    let excluded_path = recovered.nodes[0].note_path.clone();
    let excluded_id = recovered.nodes[0].id.clone();
    eligible.remove(&excluded_path);
    let mut filtered = recovered.clone();
    suppress_missing_atlas_nodes(&mut filtered, &eligible);
    assert!(!filtered.nodes.iter().any(|n| n.id == excluded_id));
    assert!(!filtered
        .links
        .iter()
        .any(|l| l.source_id == excluded_id || l.target_id == excluded_id));
    assert!(!filtered
        .clouds
        .iter()
        .any(|c| c.member_node_ids.contains(&excluded_id)));
    // Newer queued content may not advance durable evidence with an older result.
    let admitted = worker.map_store.load(key).unwrap().unwrap().generation;
    pending.lock().unwrap().atlas_requests.insert(key, 99);
    assert_eq!(
        worker.build_and_publish(key, 1).unwrap_err(),
        ATLAS_SUPERSEDED
    );
    assert_eq!(
        worker.map_store.load(key).unwrap().unwrap().generation,
        admitted
    );
    pending.lock().unwrap().atlas_requests.clear();
    for n in &recovered.nodes {
        fs::remove_file(&n.note_path).unwrap();
    }
    let empty = worker.build_and_publish(key, 2).unwrap();
    assert!(empty.nodes.is_empty());
    assert!(empty.clouds.is_empty());
}
