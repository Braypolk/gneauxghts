use super::*;
use crate::test_support::TestDir;

fn node(id: &str, theme: usize, ordinal: usize) -> WorkingNode {
    let mut embedding = vec![0.0; 4];
    embedding[theme] = 1.0;
    embedding[3] = ordinal as f32 * 0.001;
    WorkingNode {
        has_semantic_content: true,
        id: id.into(),
        note_id: Some(id.into()),
        note_path: format!("/vault/{id}.md"),
        title: id.into(),
        file_name: format!("{id}.md"),
        preview: String::new(),
        tags: Vec::new(),
        created_at_millis: 0,
        updated_at_millis: 0,
        last_viewed_at_millis: None,
        centrality: 0.5,
        importance: 0.5,
        embedding: normalized_embedding(embedding),
        x: theme as f32 * 1500.0 + ordinal as f32 * 60.0,
        y: 0.0,
        cloud_id: None,
        parent_cloud_id: None,
        child_cloud_id: None,
        isolated: true,
    }
}
fn fixture() -> (Vec<WorkingNode>, Vec<LayoutEdge>) {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for theme in 0..2 {
        for i in 0..8 {
            let id = format!("t{theme}-{i}");
            nodes.push(node(&id, theme, i));
            for j in 0..i {
                edges.push(LayoutEdge {
                    source_id: format!("t{theme}-{j}"),
                    target_id: id.clone(),
                    weight: 0.9,
                });
            }
        }
    }
    (nodes, edges)
}
fn update(nodes: &mut [WorkingNode], edges: &[LayoutEdge], prior: &MapState, now: u64) -> MapState {
    let (mut specs, clouds) = reconcile(nodes, edges, prior, now).unwrap();
    stable_layout::place(nodes, &mut specs, &clouds, prior);
    let mut rendered = specs
        .iter()
        .map(|s| geometry::build_cloud(s, nodes, &[]))
        .collect::<Vec<_>>();
    stable_layout::finish(&mut rendered, &clouds);
    let mut state = MapState {
        format_version: 1,
        generation: format!("g{now}"),
        model: "test".into(),
        clouds,
        ..MapState::default()
    };
    capture(&mut state, nodes, &rendered);
    state
}
#[test]
fn unchanged_inputs_and_restart_keep_world_positions_and_ids() {
    let (mut nodes, edges) = fixture();
    let first = update(&mut nodes, &edges, &MapState::default(), 100);
    let persisted: MapState = serde_json::from_slice(&serde_json::to_vec(&first).unwrap()).unwrap();
    let second = update(&mut nodes, &edges, &persisted, 200);
    for n in &first.nodes {
        let next = second
            .nodes
            .iter()
            .find(|p| p.identity == n.identity)
            .unwrap();
        assert_eq!(n.position, next.position);
        assert_eq!(n.cloud, next.cloud);
    }
    let a = first
        .clouds
        .iter()
        .filter(|c| c.active)
        .map(|c| (&c.id, c.position, &c.hull, c.observations))
        .collect::<Vec<_>>();
    let b = second
        .clouds
        .iter()
        .filter(|c| c.active)
        .map(|c| (&c.id, c.position, &c.hull, c.observations))
        .collect::<Vec<_>>();
    assert_eq!(a, b);
}
#[test]
fn adding_local_and_far_isolated_notes_does_not_recenter_unrelated_clouds() {
    let (mut nodes, mut edges) = fixture();
    let first = update(&mut nodes, &edges, &MapState::default(), 100);
    let unaffected = first
        .clouds
        .iter()
        .find(|c| c.active && c.members.contains(&"identity:t1-0".into()))
        .unwrap();
    nodes.push(node("added", 0, 9));
    for i in 0..8 {
        edges.push(LayoutEdge {
            source_id: "added".into(),
            target_id: format!("t0-{i}"),
            weight: 0.9,
        });
    }
    let mut isolated = node("isolated", 2, 0);
    isolated.x = 100_000.0;
    nodes.push(isolated);
    let next = update(&mut nodes, &edges, &first, 200);
    let retained = next.clouds.iter().find(|c| c.id == unaffected.id).unwrap();
    assert_eq!(retained.position, unaffected.position);
    assert!(next
        .nodes
        .iter()
        .find(|n| n.identity == "identity:isolated")
        .unwrap()
        .cloud
        .is_none());
    assert_eq!(
        next.nodes
            .iter()
            .find(|n| n.identity == "identity:added")
            .unwrap()
            .cloud,
        first.nodes[0].cloud
    );
}
#[test]
fn path_rename_preserves_identity_and_geometry_and_deletion_removes_members() {
    let (mut nodes, mut edges) = fixture();
    let first = update(&mut nodes, &edges, &MapState::default(), 100);
    let old_id = nodes[0].id.clone();
    nodes[0].id = "moved".into();
    nodes[0].note_path = "/vault/elsewhere/t0-0.md".into();
    for e in &mut edges {
        if e.source_id == old_id {
            e.source_id = "moved".into()
        }
        if e.target_id == old_id {
            e.target_id = "moved".into()
        }
    }
    nodes.retain(|n| n.note_id.as_deref() != Some("t1-7"));
    edges.retain(|e| e.source_id != "t1-7" && e.target_id != "t1-7");
    let next = update(&mut nodes, &edges, &first, 200);
    let original = first
        .nodes
        .iter()
        .find(|n| n.identity == "identity:t0-0")
        .unwrap();
    let moved = next
        .nodes
        .iter()
        .find(|n| n.identity == original.identity)
        .unwrap();
    assert_eq!(original.cloud, moved.cloud);
    assert_eq!(original.position, moved.position);
    assert!(!next
        .clouds
        .iter()
        .filter(|c| c.active)
        .any(|c| c.members.contains(&"identity:t1-7".into())));
}
#[test]
fn changed_dominant_theme_moves_one_note_without_exchanging_cloud_identity() {
    let (mut nodes, mut edges) = fixture();
    let first = update(&mut nodes, &edges, &MapState::default(), 100);
    let destination = first
        .nodes
        .iter()
        .find(|n| n.identity == "identity:t1-0")
        .unwrap()
        .cloud
        .clone();
    nodes[0].embedding = nodes[8].embedding.clone();
    edges.retain(|e| e.source_id != "t0-0" && e.target_id != "t0-0");
    for i in 0..8 {
        edges.push(LayoutEdge {
            source_id: "t0-0".into(),
            target_id: format!("t1-{i}"),
            weight: 0.9,
        });
    }
    let next = update(&mut nodes, &edges, &first, 200);
    assert_eq!(
        next.nodes
            .iter()
            .find(|n| n.identity == "identity:t0-0")
            .unwrap()
            .cloud,
        destination
    );
    assert_eq!(
        next.clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
            .count(),
        2
    );
}
#[test]
fn named_clouds_survive_recovery_and_cache_invalidation() {
    let temp = TestDir::new("atlas-map-memory");
    let store = AtlasMapStore::new(temp.path());
    let key = AtlasGenerationKey::default();
    let (mut nodes, edges) = fixture();
    let mut first = update(&mut nodes, &edges, &MapState::default(), 100);
    let id = first.clouds[0].id.clone();
    first.clouds[0].auto_name = Some("Gardening".into());
    store.save(key, &first).unwrap();
    let renamed = store
        .rename(key, &id, Some("  Kitchen garden  ".into()))
        .unwrap();
    assert_eq!(renamed.label.as_deref(), Some("Kitchen garden"));
    store.invalidate_jobs();
    let reopened = AtlasMapStore::new(temp.path());
    let saved = reopened.load(key).unwrap().unwrap();
    assert_eq!(saved.clouds[0].user_name.as_deref(), Some("Kitchen garden"));
    assert!(reopened.rename(key, &id, Some("bad\nname".into())).is_err());
    assert!(reopened.rename(key, &id, Some("x".repeat(81))).is_err());
    assert_eq!(
        reopened.rename(key, &id, None).unwrap().label.as_deref(),
        Some("Gardening")
    );
    assert!(reopened
        .load(AtlasGenerationKey {
            chat_visibility: AtlasChatVisibilityKey::All
        })
        .unwrap()
        .is_none());
}
#[test]
fn long_labels_and_dense_notes_have_readable_accepted_geometry() {
    let (mut nodes, edges) = fixture();
    for n in &mut nodes {
        n.x = 0.0;
        n.y = 0.0;
        n.file_name = format!("{} {}.md", "A long descriptive filename ".repeat(3), n.id);
    }
    let state = update(&mut nodes, &edges, &MapState::default(), 100);
    for (i, a) in nodes.iter().enumerate() {
        for b in &nodes[i + 1..] {
            assert!((a.x - b.x).hypot(a.y - b.y) >= 41.99);
        }
    }
    assert!(state
        .clouds
        .iter()
        .filter(|c| c.active)
        .all(|c| c.radius.is_finite() && c.radius > 0.0));
}

#[test]
fn supported_subthemes_are_visible_before_promotion_and_polls_do_not_add_evidence() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for theme in 0..2 {
        for i in 0..20 {
            let id = format!("s{theme}-{i}");
            nodes.push(node(&id, theme, i));
            for j in 0..i {
                edges.push(LayoutEdge {
                    source_id: format!("s{theme}-{j}"),
                    target_id: id.clone(),
                    weight: 0.9,
                });
            }
        }
    }
    edges.push(LayoutEdge {
        source_id: "s0-0".into(),
        target_id: "s1-0".into(),
        weight: 0.4,
    });
    // An established broad region that has grown two strongly separated themes.
    let ids = nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>();
    let spec = CloudSpec {
        id: "established".into(),
        parent_id: None,
        level: 0,
        member_node_ids: ids,
        core_node_ids: Vec::new(),
        outlier_node_ids: Vec::new(),
        child_cloud_ids: Vec::new(),
        centroid: [0.0, 0.0],
        radius: 900.0,
        centrality: 1.0,
    };
    let mut prior = MapState {
        format_version: 1,
        generation: "old".into(),
        clouds: vec![record(&spec, &nodes, None, 0)],
        ..MapState::default()
    };
    apply_membership(&mut nodes, &[spec]);
    capture(&mut prior, &nodes, &[]);
    let visible = update(&mut nodes, &edges, &prior, 100);
    let children = visible
        .clouds
        .iter()
        .filter(|c| c.active && c.parent.is_some())
        .collect::<Vec<_>>();
    assert!(
        children.len() >= 2,
        "expected visible subthemes, got {}",
        children.len()
    );
    assert_eq!(
        visible
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
            .count(),
        1
    );
    let polled = update(&mut nodes, &edges, &visible, 200);
    for child in children {
        let next = polled.clouds.iter().find(|c| c.id == child.id).unwrap();
        assert_eq!(child.observations, next.observations);
        assert_eq!(child.position, next.position);
        assert_eq!(child.hull, next.hull);
    }
    assert!(promotion_due(&polled, BRANCH_PRESENTATION_MILLIS + 100));
    for n in &mut nodes {
        n.x = -10000.0;
        n.y = -10000.0;
    }
    let promoted = update(
        &mut nodes,
        &edges,
        &polled,
        BRANCH_PRESENTATION_MILLIS + 101,
    );
    for n in &promoted.nodes {
        let old = polled
            .nodes
            .iter()
            .find(|p| p.identity == n.identity)
            .unwrap();
        assert!(
            (n.position[0] - old.position[0]).hypot(n.position[1] - old.position[1]) < 200.0,
            "promoted note lost its saved position"
        );
    }
    assert!(
        promoted
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
            .count()
            >= 2
    );
    assert!(promoted
        .clouds
        .iter()
        .any(|c| c.active && c.family.as_deref() == Some("established")));
    assert!(!promotion_pending(&promoted));
}

#[test]
fn unrelated_replacement_retires_the_named_identity_and_placeholder_notes_stay_outside() {
    let (mut nodes, edges) = fixture();
    let mut first = update(&mut nodes, &edges, &MapState::default(), 100);
    let old = first.nodes[0].cloud.clone().unwrap();
    first
        .clouds
        .iter_mut()
        .find(|c| c.id == old)
        .unwrap()
        .user_name = Some("Original theme".into());
    for n in &mut nodes[..8] {
        n.embedding = vec![0.0, 0.0, 1.0, 0.0];
    }
    for n in &mut nodes {
        n.x = -100000.0;
        n.y = -100000.0;
    }
    let next = update(&mut nodes, &edges, &first, 200);
    assert_ne!(next.nodes[0].cloud.as_deref(), Some(old.as_str()));
    let successor = next
        .clouds
        .iter()
        .find(|c| Some(&c.id) == next.nodes[0].cloud.as_ref())
        .unwrap();
    assert_eq!(successor.family.as_deref(), Some(old.as_str()));
    assert_eq!(next.nodes[0].position, first.nodes[0].position);
    assert!(next
        .clouds
        .iter()
        .any(|c| c.id == old && !c.active && c.user_name.as_deref() == Some("Original theme")));
    for n in &mut nodes {
        n.has_semantic_content = false;
    }
    let empty = update(&mut nodes, &edges, &next, 300);
    assert!(empty.clouds.iter().all(|c| !c.active));
    assert!(empty.nodes.iter().all(|n| n.cloud.is_none()));
}
#[test]
fn model_change_resets_evidence_without_erasing_names_or_places() {
    let (mut nodes, edges) = fixture();
    let mut state = update(&mut nodes, &edges, &MapState::default(), 100);
    let before = state.clouds[0].position;
    state.clouds[0].user_name = Some("My theme".into());
    state.clouds[0].merge_observations = 2;
    reset_model_evidence(&mut state, "another-model", 500);
    assert_eq!(state.clouds[0].observations, 0);
    assert_eq!(state.clouds[0].visible_since, 500);
    assert_eq!(state.clouds[0].merge_observations, 0);
    assert!(state.clouds[0].theme_prototype.is_empty());
    assert_eq!(state.clouds[0].position, before);
    assert_eq!(state.clouds[0].user_name.as_deref(), Some("My theme"));
}

#[test]
fn moderate_balanced_split_waits_for_distinct_evidence_then_promotes_together() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for theme in 0..2 {
        for i in 0..20 {
            let id = format!("m{theme}-{i}");
            let mut n = node(&id, theme, i);
            n.embedding = if theme == 0 {
                vec![1.0, 0.0, 0.0, 0.0]
            } else {
                vec![0.7, 0.51_f32.sqrt(), 0.0, 0.0]
            };
            nodes.push(n);
            for j in 0..i {
                edges.push(LayoutEdge {
                    source_id: format!("m{theme}-{j}"),
                    target_id: id.clone(),
                    weight: 0.9,
                });
            }
        }
    }
    let spec = CloudSpec {
        id: "moderate-parent".into(),
        parent_id: None,
        level: 0,
        member_node_ids: nodes.iter().map(|n| n.id.clone()).collect(),
        core_node_ids: Vec::new(),
        outlier_node_ids: Vec::new(),
        child_cloud_ids: Vec::new(),
        centroid: [0.0, 0.0],
        radius: 900.0,
        centrality: 1.0,
    };
    let mut prior = MapState {
        format_version: 1,
        generation: "old".into(),
        clouds: vec![record(&spec, &nodes, None, 0)],
        ..Default::default()
    };
    apply_membership(&mut nodes, &[spec]);
    capture(&mut prior, &nodes, &[]);
    let visible = update(&mut nodes, &edges, &prior, 100);
    assert_eq!(
        visible
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_some())
            .count(),
        2
    );
    assert!(!promotion_pending(&visible));
    for n in &mut nodes {
        n.embedding[2] = 0.01;
        n.embedding = normalized_embedding(n.embedding.clone());
    }
    let evidence = update(&mut nodes, &edges, &visible, 200);
    assert!(promotion_pending(&evidence));
    let promoted = update(
        &mut nodes,
        &edges,
        &evidence,
        BRANCH_PRESENTATION_MILLIS + 101,
    );
    assert_eq!(
        promoted
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
            .count(),
        2
    );
    assert!(promoted
        .clouds
        .iter()
        .any(|c| c.id == "moderate-parent" && !c.active));
    assert!(!promotion_pending(&promoted));
}

#[test]
fn gradual_theme_change_eventually_moves_and_merge_requires_sustained_updates() {
    let (mut nodes, mut edges) = fixture();
    let mut state = update(&mut nodes, &edges, &MapState::default(), 100);
    let original = state.nodes[0].cloud.clone();
    let destination = state.nodes[8].cloud.clone();
    for step in 1..=10 {
        let angle = step as f32 / 10.0 * std::f32::consts::FRAC_PI_2;
        nodes[0].embedding = vec![angle.cos(), angle.sin(), 0.0, 0.0];
        state = update(&mut nodes, &edges, &state, 100 + step);
    }
    assert_ne!(state.nodes[0].cloud, original);
    assert_eq!(state.nodes[0].cloud, destination);
    edges.clear();
    for i in 0..nodes.len() {
        for j in i + 1..nodes.len() {
            edges.push(LayoutEdge {
                source_id: nodes[i].id.clone(),
                target_id: nodes[j].id.clone(),
                weight: 0.9,
            });
        }
    }
    for step in 1..=3 {
        for n in &mut nodes {
            n.embedding = normalized_embedding(vec![1.0, 1.0, step as f32 * 0.01, 0.0]);
        }
        state = update(&mut nodes, &edges, &state, 200 + step);
        assert_eq!(
            state
                .clouds
                .iter()
                .filter(|c| c.active && c.parent.is_none())
                .count(),
            if step < 3 { 2 } else { 1 }
        );
    }
    let repeat = update(&mut nodes, &edges, &state, 999);
    assert_eq!(
        repeat
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
            .count(),
        1
    );
}

#[test]
fn two_thousand_note_fixture_has_stationary_geometry_and_bounded_update_cost() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for theme in 0..20 {
        for i in 0..100 {
            let id = format!("large-{theme}-{i}");
            let mut n = node(&id, 0, i);
            n.embedding = vec![0.0; 20];
            n.embedding[theme] = 1.0;
            n.x = (theme % 5) as f32 * 10000.0 + (i % 10) as f32 * 100.0;
            n.y = (theme / 5) as f32 * 10000.0 + (i / 10) as f32 * 100.0;
            nodes.push(n);
            for j in i.saturating_sub(8)..i {
                edges.push(LayoutEdge {
                    source_id: format!("large-{theme}-{j}"),
                    target_id: id.clone(),
                    weight: 0.9,
                });
            }
        }
    }
    let started = std::time::Instant::now();
    let first = update(&mut nodes, &edges, &MapState::default(), 100);
    let initial = started.elapsed();
    let started = std::time::Instant::now();
    let next = update(&mut nodes, &edges, &first, 200);
    let repeated = started.elapsed();
    assert_eq!(first.nodes.len(), 2000);
    assert_eq!(
        first
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
            .count(),
        20
    );
    for n in &first.nodes {
        let current = next
            .nodes
            .iter()
            .find(|p| p.identity == n.identity)
            .unwrap();
        assert_eq!(n.position, current.position);
        assert_eq!(n.cloud, current.cloud);
    }
    println!("Atlas 2000-note sequence: initial={initial:?} repeat={repeated:?}; retained=20/20 roots, displacement=0, membership churn=0");
    // A generous regression guard, not a production latency promise (debug build).
    assert!(repeated.as_secs() < 15);
}
