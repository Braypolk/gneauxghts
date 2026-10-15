use super::*;
use crate::{
    note::DocumentKind,
    semantic::embed::{ModelInfo, SemanticModelDownloadResult},
};
use std::sync::atomic::{AtomicUsize, Ordering};

fn note(id: &str, title: &str, embedding: Vec<f32>) -> AtlasLabelNote {
    AtlasLabelNote {
        id: id.to_string(),
        title: title.to_string(),
        tags: Vec::new(),
        embedding,
    }
}

struct MockProvider {
    calls: AtomicUsize,
    fail: bool,
}

impl MockProvider {
    fn new() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            fail: true,
        }
    }
}

impl EmbeddingProvider for MockProvider {
    fn embed_texts(
        &self,
        texts: &[String],
        kind: EmbeddingInputKind,
    ) -> Result<Vec<Vec<f32>>, String> {
        assert!(matches!(kind, EmbeddingInputKind::Document));
        self.calls.fetch_add(1, Ordering::Relaxed);
        if self.fail {
            return Err("mock provider failure".to_string());
        }
        Ok(texts
            .iter()
            .map(|text| {
                let lower = text.to_lowercase();
                if lower.contains("garden")
                    || lower.contains("soil")
                    || lower.contains("compost")
                    || lower.contains("vegetable")
                {
                    vec![1.0, 0.0]
                } else if lower.contains("airport")
                    || lower.contains("travel")
                    || lower.contains("trip")
                {
                    vec![0.0, 1.0]
                } else {
                    vec![0.5, 0.5]
                }
            })
            .collect())
    }

    fn prepare(&self) -> Result<(), String> {
        Ok(())
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            id: "mock".to_string(),
            label: "Mock".to_string(),
            dimensions: 2,
            runtime_bundled: false,
            runtime_binary_path: None,
            model_path: None,
            model_repo_id: "mock/repo".to_string(),
            available: true,
            loading: false,
            ready: true,
            status: "ready".to_string(),
            error: None,
        }
    }

    fn shutdown(&self) {}

    fn download_model_if_needed(&self) -> Result<SemanticModelDownloadResult, String> {
        Err("unused".to_string())
    }
}

fn atlas_node(id: &str, title: &str, embedding: &[f32]) -> (AtlasNode, Vec<f32>) {
    (
        AtlasNode {
            id: id.to_string(),
            note_id: None,
            note_path: id.to_string(),
            title: title.to_string(),
            file_name: format!("{id}.md"),
            document_kind: DocumentKind::Note,
            x: 0.0,
            y: 0.0,
            radius: 1.0,
            cloud_id: Some("cloud".to_string()),
            parent_cloud_id: None,
            child_cloud_id: None,
            cluster_id: Some("cloud".to_string()),
            subcluster_id: None,
            centrality: 0.0,
            importance: 0.0,
            last_viewed_at_millis: None,
            effective_open_count: None,
            created_at_millis: 0,
            updated_at_millis: 0,
            preview: String::new(),
            tags: Vec::new(),
            isolated: false,
        },
        embedding.to_vec(),
    )
}

pub(super) fn cloud(ids: &[&str]) -> AtlasCloud {
    AtlasCloud {
        user_name: None,
        family_id: None,
        family_name: None,
        id: format!("cloud-{}", ids.join("-")),
        parent_id: None,
        level: 0,
        label: None,
        label_source: "pending".to_string(),
        note_count: ids.len(),
        density: 0.0,
        color: [0; 4],
        centroid: [0.0; 2],
        radius: 1.0,
        hull: Vec::new(),
        member_node_ids: ids.iter().map(|id| (*id).to_string()).collect(),
        core_node_ids: ids.iter().map(|id| (*id).to_string()).collect(),
        outlier_node_ids: Vec::new(),
        child_cloud_ids: Vec::new(),
        representative_node_ids: Vec::new(),
    }
}

fn serialize_embedding(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn insert_chunk(
    connection: &Connection,
    note_path: &str,
    ordinal: usize,
    section_label: &str,
    text: &str,
    embedding: &[f32],
) {
    connection
        .execute(
            "
                INSERT OR IGNORE INTO notes (
                    path, title, modified_millis, content_hash, chunk_count, indexed_at_millis
                ) VALUES (?1, ?1, 0, 'hash', 1, 0)
                ",
            [note_path],
        )
        .expect("note");
    let ann_label = blake3::hash(format!("{note_path}\0{ordinal}").as_bytes()).as_bytes()[0] as u64
        | ((ordinal as u64) << 8)
        | 1;
    connection
        .execute(
            "
                INSERT INTO chunks (
                    note_path, ordinal, ann_label, section_label, text, text_hash,
                    start_line, end_line, embedding_blob, embedding_dim, indexed_at_millis
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?8, 0)
                ",
            rusqlite::params![
                note_path,
                ordinal,
                ann_label,
                section_label,
                text,
                format!("hash-{note_path}-{ordinal}"),
                serialize_embedding(embedding),
                embedding.len(),
            ],
        )
        .expect("chunk");
}

#[test]
fn sanitizes_urls_markdown_code_images_and_wikilinks() {
    let value = sanitize_label_text(
        "Keep [recipe text](https://site.test/wprm-recipe-container) \
             ![wprm image](https://site.test/wprm.png) `secret code` \
             https://site.test/wprm/recipe [[Target Page|Useful Alias]] **bold words**\n\
             ```rust\nwprm recipe container\n```",
    );
    assert_eq!(value, "Keep recipe text Useful Alias bold words");
    assert!(!value.to_lowercase().contains("wprm"));
    assert!(!value.contains("https"));
}

#[test]
fn chooses_embedding_medoids_nearest_centroid() {
    let notes = [
        note("a", "A", vec![1.0, 0.0]),
        note("b", "B", vec![0.9, 0.1]),
        note("c", "C", vec![0.0, 1.0]),
    ];
    let refs = notes.iter().collect::<Vec<_>>();
    assert_eq!(medoid_note_ids(&refs, 1), vec!["b"]);
    assert_eq!(medoid_placeholder(&refs).as_deref(), Some("B"));
}

#[test]
fn membership_fingerprint_binds_structural_generation_and_members() {
    let first = cloud_membership_fingerprint("generation-a", &[cloud(&["a", "b"])]);
    let next_generation = cloud_membership_fingerprint("generation-b", &[cloud(&["a", "b"])]);
    let next_members = cloud_membership_fingerprint("generation-a", &[cloud(&["a", "c"])]);
    assert_ne!(first, next_generation);
    assert_ne!(first, next_members);
}

#[test]
fn topic_names_reflect_member_content() {
    let mut connection = crate::semantic::test_support::memory_database();
    insert_chunk(&connection, "a", 0, "Title", "From the notes", &[1.0, 0.0]);
    insert_chunk(
        &connection,
        "a",
        1,
        "Soil Care",
        "Garden soil needs compost and mulch for healthy vegetables.",
        &[1.0, 0.0],
    );
    insert_chunk(
        &connection,
        "b",
        1,
        "Planting",
        "Vegetable beds benefit from compost tea before planting season.",
        &[0.95, 0.05],
    );
    insert_chunk(
        &connection,
        "c",
        1,
        "Travel",
        "Airport delays ruined the weekend trip itinerary.",
        &[0.0, 1.0],
    );

    let (node_a, emb_a) = atlas_node("a", "From the notes", &[1.0, 0.0]);
    let (node_b, emb_b) = atlas_node("b", "Weekly log", &[0.95, 0.05]);
    let (node_c, emb_c) = atlas_node("c", "Trip", &[0.0, 1.0]);
    let nodes = vec![node_a, node_b, node_c];
    let embeddings = HashMap::from([
        ("a".to_string(), emb_a),
        ("b".to_string(), emb_b),
        ("c".to_string(), emb_c),
    ]);
    let clouds = vec![cloud(&["a", "b"]), cloud(&["c"])];
    let provider = MockProvider::new();
    let (labels, metrics) = generate_labels_progressive(
        &mut connection,
        &provider,
        &clouds,
        &nodes,
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("labels");

    assert!(metrics.selected_chunk_count > 0);
    assert!(metrics.provider_text_count > 0);
    let garden = &labels[&clouds[0].id].label.to_lowercase();
    assert_eq!(labels[&clouds[0].id].source, CloudLabelSource::Topic);
    assert!(
        garden.contains("soil")
            || garden.contains("compost")
            || garden.contains("vegetable")
            || garden.contains("garden"),
        "expected content label, got {garden}"
    );
    // Connector-only unigrams should lose to content terms.
    assert_ne!(garden.as_str(), "from");
    assert!(
        !garden.contains(' '),
        "expected single-word label, got {garden}"
    );
    let travel = &labels[&clouds[1].id].label.to_lowercase();
    assert_eq!(labels[&clouds[1].id].source, CloudLabelSource::Topic);
    assert!(
        travel == "airport" || travel == "trip" || travel == "travel",
        "expected travel content label, got {travel}"
    );
    assert!(!travel.contains(' '));
}

#[test]
fn parent_names_cover_subthemes_without_repeating_a_child() {
    let mut connection = crate::semantic::test_support::memory_database();
    let provider = MockProvider::new();
    let vocabulary = topic_names::TOPIC_NOUNS
        .split_whitespace()
        .map(|word| {
            let vector = match word {
                "research" => vec![1.0, 0.0],
                "history" => vec![0.0, 1.0],
                "learning" => vec![1.0, 1.0],
                "education" => vec![0.9, 1.0],
                _ => vec![-1.0, -1.0],
            };
            (word.to_string(), vector)
        })
        .collect::<Vec<_>>();
    save_atlas_label_embeddings(
        &mut connection,
        &vocabulary,
        &model_cache_fingerprint(&provider),
        LABEL_ALGORITHM_VERSION,
    )
    .unwrap();
    let mut nodes = Vec::new();
    let mut embeddings = HashMap::new();
    let research_ids = (0..8).map(|i| format!("research-{i}")).collect::<Vec<_>>();
    for id in &research_ids {
        let (node, embedding) = atlas_node(id, "Research", &[1.0, 0.0]);
        nodes.push(node);
        embeddings.insert(id.clone(), embedding);
    }
    let (node, embedding) = atlas_node("history", "History", &[0.0, 1.0]);
    nodes.push(node);
    embeddings.insert("history".into(), embedding);
    let mut member_ids = research_ids.iter().map(String::as_str).collect::<Vec<_>>();
    let mut research = cloud(&member_ids);
    member_ids.push("history");
    let mut parent = cloud(&member_ids);
    let mut history = cloud(&["history"]);
    research.parent_id = Some(parent.id.clone());
    history.parent_id = Some(parent.id.clone());
    parent.child_cloud_ids = vec![research.id.clone(), history.id.clone()];
    let mut clouds = vec![parent.clone(), research.clone(), history.clone()];
    for _ in 0..2 {
        let (labels, _) = generate_labels_progressive(
            &mut connection,
            &provider,
            &clouds,
            &nodes,
            &embeddings,
            |_, _| Ok(()),
        )
        .unwrap();
        assert_eq!(labels[&research.id].label, "research");
        assert_eq!(labels[&history.id].label, "history");
        assert_eq!(labels[&parent.id].label, "learning");
        // Input order and a warm embedding cache cannot change the names.
        clouds.reverse();
    }
    // A user-authored child name is reserved too, even when its automatic
    // topic would have been different. Comparison ignores case and whitespace.
    clouds
        .iter_mut()
        .find(|c| c.id == research.id)
        .unwrap()
        .user_name = Some(" Learning ".into());
    let (labels, _) = generate_labels_progressive(
        &mut connection,
        &provider,
        &clouds,
        &nodes,
        &embeddings,
        |_, _| Ok(()),
    )
    .unwrap();
    assert_eq!(labels[&parent.id].label, "education");
    // The same rule works recursively, even when cloud IDs sort parents first.
    let mut grandparent = parent.clone();
    grandparent.id = "ancestor".into();
    grandparent.child_cloud_ids = vec![parent.id.clone()];
    for cloud in &mut clouds {
        cloud.user_name = None;
        if cloud.id == parent.id {
            cloud.parent_id = Some(grandparent.id.clone());
        }
    }
    clouds.push(grandparent.clone());
    let (labels, _) = generate_labels_progressive(
        &mut connection,
        &provider,
        &clouds,
        &nodes,
        &embeddings,
        |_, _| Ok(()),
    )
    .unwrap();
    assert_eq!(labels[&parent.id].label, "learning");
    assert_eq!(labels[&grandparent.id].label, "education");
    assert_eq!(provider.calls.load(Ordering::Relaxed), 0);
}

#[test]
fn phrase_cache_hit_skips_embedding_provider() {
    let mut connection = crate::semantic::test_support::memory_database();
    insert_chunk(
        &connection,
        "a",
        1,
        "Soil Care",
        "Garden soil needs compost for healthy vegetables.",
        &[1.0, 0.0],
    );
    insert_chunk(
        &connection,
        "b",
        1,
        "Planting",
        "Garden beds benefit from compost tea.",
        &[0.95, 0.05],
    );
    let (node_a, emb_a) = atlas_node("a", "Notes", &[1.0, 0.0]);
    let (node_b, emb_b) = atlas_node("b", "Log", &[0.95, 0.05]);
    let nodes = vec![node_a, node_b];
    let embeddings = HashMap::from([("a".to_string(), emb_a), ("b".to_string(), emb_b)]);
    let clouds = vec![cloud(&["a", "b"])];
    let provider = MockProvider::new();

    let (_, first_metrics) = generate_labels_progressive(
        &mut connection,
        &provider,
        &clouds,
        &nodes,
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("first");
    let calls_after_first = provider.calls.load(Ordering::Relaxed);
    let (_, second_metrics) = generate_labels_progressive(
        &mut connection,
        &provider,
        &clouds,
        &nodes,
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("cached");

    assert!(first_metrics.provider_text_count > 0);
    assert!(second_metrics.cache_hit_count > 0);
    assert_eq!(second_metrics.provider_text_count, 0);
    assert_eq!(provider.calls.load(Ordering::Relaxed), calls_after_first);
}

#[test]
fn provider_failure_returns_without_labels() {
    let mut connection = crate::semantic::test_support::memory_database();
    insert_chunk(
        &connection,
        "a",
        1,
        "Soil Care",
        "Garden soil needs compost.",
        &[1.0, 0.0],
    );
    let (node, embedding) = atlas_node("a", "Garden Planning", &[1.0, 0.0]);
    let result = generate_labels_progressive(
        &mut connection,
        &MockProvider::failing(),
        &[cloud(&["a"])],
        &[node],
        &HashMap::from([("a".to_string(), embedding)]),
        |_, _| Ok(()),
    );
    assert_eq!(
        result.expect_err("provider failure"),
        "mock provider failure"
    );
}

#[test]
fn progressive_callback_fires_once_per_cloud_in_sorted_id_order() {
    let mut connection = crate::semantic::test_support::memory_database();
    insert_chunk(
        &connection,
        "a",
        1,
        "Soil Care",
        "Garden soil needs compost and mulch for healthy vegetables.",
        &[1.0, 0.0],
    );
    insert_chunk(
        &connection,
        "b",
        1,
        "Planting",
        "Vegetable beds benefit from compost tea before planting season.",
        &[0.95, 0.05],
    );
    insert_chunk(
        &connection,
        "c",
        1,
        "Travel",
        "Airport delays ruined the weekend trip itinerary.",
        &[0.0, 1.0],
    );
    let (node_a, emb_a) = atlas_node("a", "From the notes", &[1.0, 0.0]);
    let (node_b, emb_b) = atlas_node("b", "Weekly log", &[0.95, 0.05]);
    let (node_c, emb_c) = atlas_node("c", "Trip", &[0.0, 1.0]);
    let nodes = vec![node_a, node_b, node_c];
    let embeddings = HashMap::from([
        ("a".to_string(), emb_a),
        ("b".to_string(), emb_b),
        ("c".to_string(), emb_c),
    ]);
    // cloud-c sorts before cloud-a-b by id.
    let mut child = cloud(&["a", "b"]);
    child.parent_id = Some("cloud-c".to_string());
    let clouds = vec![child, cloud(&["c"])];
    let mut expected_ids = clouds
        .iter()
        .map(|cloud| cloud.id.clone())
        .collect::<Vec<_>>();
    expected_ids.sort();

    let mut seen = Vec::new();
    let mut seen_labels = HashSet::new();
    let (labels, _) = generate_labels_progressive(
        &mut connection,
        &MockProvider::new(),
        &clouds,
        &nodes,
        &embeddings,
        |cloud_id, assignment| {
            seen.push(cloud_id.to_string());
            assert!(
                seen_labels.insert(assignment.label.to_lowercase()),
                "duplicate progressive label {}",
                assignment.label
            );
            Ok(())
        },
    )
    .expect("labels");

    assert_eq!(seen, expected_ids);
    assert_eq!(labels.len(), expected_ids.len());
    for cloud_id in &expected_ids {
        assert!(labels.contains_key(cloud_id));
    }
}

#[test]
fn edits_additions_and_removals_relabel_using_cached_topic_embeddings() {
    let mut connection = crate::semantic::test_support::memory_database();
    let provider = MockProvider::new();
    let (mut a, garden_embedding) = atlas_node("a", "Garden", &[1.0, 0.0]);
    let mut embeddings = HashMap::from([("a".to_string(), garden_embedding)]);
    let (initial, _) = generate_labels_progressive(
        &mut connection,
        &provider,
        &[cloud(&["a"])],
        &[a.clone()],
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("initial");
    assert_eq!(initial["cloud-a"].label, "gardening");
    let calls = provider.calls.load(Ordering::Relaxed);

    a.title = "Travel".into();
    a.tags = vec!["travel".into()];
    embeddings.insert("a".into(), vec![0.0, 1.0]);
    let (edited, edited_metrics) = generate_labels_progressive(
        &mut connection,
        &provider,
        &[cloud(&["a"])],
        &[a.clone()],
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("edited");
    assert_eq!(edited["cloud-a"].label, "travel");
    assert_eq!(edited_metrics.provider_text_count, 0);

    let (b, garden_embedding) = atlas_node("b", "Garden", &[1.0, 0.0]);
    embeddings.insert("b".into(), garden_embedding);
    let (added, _) = generate_labels_progressive(
        &mut connection,
        &provider,
        &[cloud(&["a"]), cloud(&["b"])],
        &[a, b.clone()],
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("added");
    assert_eq!(added["cloud-a"].label, "travel");
    assert_eq!(added["cloud-b"].label, "gardening");

    embeddings.remove("a");
    let (removed, _) = generate_labels_progressive(
        &mut connection,
        &provider,
        &[cloud(&["b"])],
        &[b],
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("removed");
    assert_eq!(removed.len(), 1);
    assert_eq!(removed["cloud-b"].label, "gardening");
    assert_eq!(provider.calls.load(Ordering::Relaxed), calls);
}

#[test]
fn publication_failure_stops_later_callbacks() {
    let mut connection = crate::semantic::test_support::memory_database();
    let (node, embedding) = atlas_node("a", "Garden", &[1.0, 0.0]);
    let mut seen = 0;
    let result = generate_labels_progressive(
        &mut connection,
        &MockProvider::new(),
        &[cloud(&["a"]), cloud(&["b"])],
        &[node],
        &HashMap::from([("a".into(), embedding)]),
        |_, _| {
            seen += 1;
            Err("superseded".into())
        },
    );
    assert_eq!(result.expect_err("publication must stop"), "superseded");
    assert_eq!(seen, 1);
}

#[test]
fn exhausted_sibling_vocabulary_never_borrows_another_familys_tag() {
    let mut connection = crate::semantic::test_support::memory_database();
    let mut nodes = Vec::new();
    let mut embeddings = HashMap::new();
    let mut clouds = Vec::new();
    for i in 0..132 {
        let id = format!("root-{i}");
        let (node, embedding) = atlas_node(&id, "Garden", &[1.0, 0.0]);
        nodes.push(node);
        embeddings.insert(id.clone(), embedding);
        clouds.push(cloud(&[&id]));
    }
    let (mut node, embedding) = atlas_node("child", "Mycology", &[0.5, 0.5]);
    node.tags = vec!["mycology".into()];
    nodes.push(node);
    embeddings.insert("child".into(), embedding);
    let mut child = cloud(&["child"]);
    child.parent_id = Some(clouds[0].id.clone());
    clouds.push(child);
    let (labels, _) = generate_labels_progressive(
        &mut connection,
        &MockProvider::new(),
        &clouds,
        &nodes,
        &embeddings,
        |_, _| Ok(()),
    )
    .expect("large map");
    assert_eq!(labels.len(), clouds.len());
    for cloud in clouds.iter().filter(|cloud| cloud.parent_id.is_none()) {
        assert_ne!(labels[&cloud.id].label, "mycology");
    }
}
