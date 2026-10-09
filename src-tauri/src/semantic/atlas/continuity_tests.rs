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
    let knn = build_hnsw_knn_rows(nodes);
    let rendered = stable_layout::calculate(nodes, &mut specs, &clouds, prior, edges, &[], &knn);
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
    for old in &first.nodes {
        let current = next
            .nodes
            .iter()
            .find(|n| n.identity == old.identity)
            .unwrap();
        assert_eq!(
            current.position, old.position,
            "addition moved an accepted note"
        );
    }
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
        assert_eq!(
            n.position, old.position,
            "promotion moved accepted geometry"
        );
    }
    let continuation = promoted
        .clouds
        .iter()
        .find(|c| c.id == "established")
        .unwrap();
    let old_anchor = polled
        .clouds
        .iter()
        .find(|c| c.id == "established")
        .unwrap();
    assert_eq!(continuation.position, old_anchor.position);
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

#[test]
fn cloud_outlines_follow_member_distribution_instead_of_the_collision_circle() {
    let (mut nodes, edges) = fixture();
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    // Establish the promised horizontal input after the global initializer;
    // UMAP's orientation/aspect ratio is not the contour contract under test.
    for (i, n) in nodes.iter_mut().enumerate() {
        n.x = (i % 8) as f32 * 60.0;
        n.y = (i / 8) as f32 * 800.0;
    }
    for cloud in &mut prior.clouds {
        cloud.position = [
            210.0,
            if cloud.members.contains(&"identity:t0-0".into()) {
                0.0
            } else {
                800.0
            },
        ];
    }
    capture(&mut prior, &nodes, &[]);
    let horizontal = update(&mut nodes, &edges, &prior, 150);
    let cloud = horizontal
        .clouds
        .iter()
        .find(|c| c.active && c.members.contains(&"identity:t0-0".into()))
        .unwrap();
    let span = |axis: usize| {
        cloud
            .hull
            .iter()
            .map(|p| p[axis])
            .fold(f32::NEG_INFINITY, f32::max)
            - cloud
                .hull
                .iter()
                .map(|p| p[axis])
                .fold(f32::INFINITY, f32::min)
    };
    assert!(
        span(0) > span(1) * 1.5,
        "a horizontal note group should have an elongated blob, not a circle: {} x {}",
        span(0),
        span(1)
    );
    let replay = update(&mut nodes, &edges, &horizontal, 200);
    assert_eq!(
        cloud.hull,
        replay
            .clouds
            .iter()
            .find(|c| c.id == cloud.id)
            .unwrap()
            .hull
    );
}

fn inside_outline(point: [f32; 2], hull: &[[f32; 2]]) -> bool {
    let mut inside = false;
    for i in 0..hull.len() {
        let a = hull[i];
        let b = hull[(i + 1) % hull.len()];
        if (a[1] > point[1]) != (b[1] > point[1])
            && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}

#[test]
fn node_following_blobs_enclose_long_filenames_and_child_outlines() {
    let (mut nodes, edges) = fixture();
    for n in &mut nodes {
        n.file_name = format!("{}.md", "W".repeat(60));
    }
    let state = update(&mut nodes, &edges, &MapState::default(), 100);
    for n in &nodes {
        let cloud = state
            .clouds
            .iter()
            .find(|c| Some(&c.id) == n.cloud_id.as_ref())
            .unwrap();
        // Sixty wide characters at the renderer's world text size need ~186 units per side.
        for dx in [-186.0, 186.0] {
            assert!(inside_outline([n.x + dx, n.y + 18.0], &cloud.hull));
        }
        assert!(inside_outline([n.x, n.y], &cloud.hull));
    }
    // Exercise finish with an offset subgroup: parent containment follows its
    // actual visible outline, rather than merely the child member centers.
    let spec = CloudSpec {
        id: "parent".into(),
        parent_id: None,
        level: 0,
        member_node_ids: nodes.iter().map(|n| n.id.clone()).collect(),
        core_node_ids: vec![],
        outlier_node_ids: vec![],
        child_cloud_ids: vec!["child".into()],
        centroid: [1000.0, 0.0],
        radius: 1800.0,
        centrality: 1.0,
    };
    let child = CloudSpec {
        id: "child".into(),
        parent_id: Some("parent".into()),
        level: 1,
        member_node_ids: nodes[..8].iter().map(|n| n.id.clone()).collect(),
        core_node_ids: vec![],
        outlier_node_ids: vec![],
        child_cloud_ids: vec![],
        centroid: [210.0, 0.0],
        radius: 800.0,
        centrality: 1.0,
    };
    let clouds =
        stable_layout::calculate(&mut nodes, &mut [spec, child], &[], &state, &[], &[], &[]);
    assert!(clouds[1]
        .hull
        .iter()
        .all(|p| inside_outline(*p, &clouds[0].hull)));
}

#[test]
fn child_repartition_repairs_sibling_clearance_once_then_stays_stationary() {
    let (mut nodes, _) = fixture();
    let ids = nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>();
    let make = |id: &str, parent: Option<&str>, members: Vec<String>| CloudSpec {
        id: id.into(),
        parent_id: parent.map(str::to_string),
        level: usize::from(parent.is_some()),
        member_node_ids: members,
        core_node_ids: vec![],
        outlier_node_ids: vec![],
        child_cloud_ids: if parent.is_none() {
            vec!["a".into(), "b".into()]
        } else {
            vec![]
        },
        centroid: [0.0, 0.0],
        radius: 100.0,
        centrality: 1.0,
    };
    let mut prior = MapState::default();
    let mut initial = Vec::new();
    for step in 0..6 {
        let mut left = ids[..8].to_vec();
        let mut right = ids[8..].to_vec();
        if step >= 1 {
            std::mem::swap(&mut left[0], &mut right[0]);
        }
        let mut specs = vec![
            make("root", None, ids.clone()),
            make("a", Some("root"), left),
            make("b", Some("root"), right),
        ];
        apply_membership(&mut nodes, &specs);
        let memory = specs
            .iter()
            .map(|s| record(s, &nodes, prior.clouds.iter().find(|c| c.id == s.id), step))
            .collect::<Vec<_>>();
        let knn = build_hnsw_knn_rows(&nodes);
        let clouds =
            stable_layout::calculate(&mut nodes, &mut specs, &memory, &prior, &[], &[], &knn);
        prior = MapState {
            clouds: memory,
            ..MapState::default()
        };
        capture(&mut prior, &nodes, &clouds);
        let positions = nodes.iter().map(|n| [n.x, n.y]).collect::<Vec<_>>();
        let a = clouds.iter().find(|c| c.id == "a").unwrap();
        let b = clouds.iter().find(|c| c.id == "b").unwrap();
        assert!(!test_contours_overlap(&a.hull, &b.hull));
        if step <= 1 {
            initial = positions.clone();
        }
        if step > 1 {
            assert_eq!(positions, initial);
        }
        let movement = positions
            .iter()
            .zip(&initial)
            .map(|(a, b)| (a[0] - b[0]).hypot(a[1] - b[1]))
            .fold(0.0_f32, f32::max);
        println!("child partition update {step}: maximum displacement {movement}");
    }
    assert_eq!(
        nodes.iter().map(|n| [n.x, n.y]).collect::<Vec<_>>(),
        initial
    );
}

#[test]
fn repairs_only_expanded_legacy_clouds_and_then_keeps_the_repaired_map_stationary() {
    let (mut nodes, edges) = fixture();
    let mut damaged = update(&mut nodes, &edges, &MapState::default(), 100);
    let cloud_id = damaged.nodes[0].cloud.clone().unwrap();
    let healthy = damaged
        .nodes
        .iter()
        .filter(|n| n.cloud.as_ref() != Some(&cloud_id))
        .cloned()
        .collect::<Vec<_>>();
    for n in damaged
        .nodes
        .iter_mut()
        .filter(|n| n.cloud.as_ref() == Some(&cloud_id))
    {
        n.position[0] = 30_000.0 + n.position[0] * 100.0;
    }
    let cloud = damaged
        .clouds
        .iter_mut()
        .find(|c| c.id == cloud_id)
        .unwrap();
    cloud.position[0] = 30_000.0 + cloud.position[0] * 100.0;
    cloud.radius *= 100.0;
    cloud.user_name = Some("Remembered name".into());
    damaged.placement_version = 0;
    let repaired = update(&mut nodes, &edges, &damaged, 200);
    assert_eq!(repaired.placement_version, stable_layout::PLACEMENT_VERSION);
    for original in &healthy {
        assert_eq!(
            original.position,
            repaired
                .nodes
                .iter()
                .find(|n| n.identity == original.identity)
                .unwrap()
                .position
        );
    }
    let cloud = repaired.clouds.iter().find(|c| c.id == cloud_id).unwrap();
    assert_eq!(cloud.user_name.as_deref(), Some("Remembered name"));
    assert!(cloud.radius < 2000.0);
    assert!(cloud.position[0].abs() < 10_000.0);
    let reopened: MapState =
        serde_json::from_slice(&serde_json::to_vec(&repaired).unwrap()).unwrap();
    let repeated = update(&mut nodes, &edges, &reopened, 300);
    assert_eq!(
        repaired
            .nodes
            .iter()
            .map(|n| n.position)
            .collect::<Vec<_>>(),
        repeated
            .nodes
            .iter()
            .map(|n| n.position)
            .collect::<Vec<_>>()
    );
}

#[test]
fn reassignment_starts_from_accepted_positions_instead_of_stale_migration_hints() {
    let (mut nodes, mut edges) = fixture();
    let prior = update(&mut nodes, &edges, &MapState::default(), 100);
    let id = nodes[0].id.clone();
    nodes[0].embedding = vec![0.0, 0.0, 1.0, 0.0];
    nodes[0].x = 100_000.0;
    nodes[0].y = 100_000.0;
    edges.retain(|e| e.source_id != id && e.target_id != id);
    let next = update(&mut nodes, &edges, &prior, 200);
    let note = next
        .nodes
        .iter()
        .find(|n| n.identity == prior.nodes[0].identity)
        .unwrap();
    assert!(note.cloud.is_none());
    assert!(
        next.clouds
            .iter()
            .filter(|c| c.active)
            .all(|c| !inside_outline(note.position, &c.hull)),
        "isolated note stayed inside a cloud"
    );
    assert!(
        (note.position[0] - prior.nodes[0].position[0])
            .hypot(note.position[1] - prior.nodes[0].position[1])
            < 3000.0
    );
}

#[test]
fn metadata_and_deletion_do_not_translate_regions_with_overlapping_bounds() {
    let (mut nodes, mut edges) = fixture();
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    // Two tall, separated columns: enclosing circles overlap, note footprints do not.
    for (i, n) in nodes.iter_mut().enumerate() {
        n.x = (i / 8) as f32 * 300.0;
        n.y = (i % 8) as f32 * 120.0;
    }
    for cloud in &mut prior.clouds {
        cloud.position = if cloud.members.contains(&"identity:t0-0".into()) {
            [0.0, 420.0]
        } else {
            [300.0, 420.0]
        };
    }
    capture(&mut prior, &nodes, &[]);
    let baseline = update(&mut nodes, &edges, &prior, 200);
    nodes[0].file_name = "zz-0.md".into(); // Same visible footprint as t0-0.md.
    nodes[0].note_path = "/vault/renamed/zz-0.md".into();
    let renamed = update(&mut nodes, &edges, &baseline, 300);
    nodes.retain(|n| n.id != "t0-7");
    edges.retain(|e| e.source_id != "t0-7" && e.target_id != "t0-7");
    let deleted = update(&mut nodes, &edges, &renamed, 400);
    for state in [&renamed, &deleted] {
        for n in &state.nodes {
            let old = baseline
                .nodes
                .iter()
                .find(|p| p.identity == n.identity)
                .unwrap();
            assert_eq!(
                n.position, old.position,
                "metadata/deletion moved {}",
                n.identity
            );
        }
        for cloud in state
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.is_none())
        {
            let old = baseline.clouds.iter().find(|c| c.id == cloud.id).unwrap();
            assert_eq!(cloud.position, old.position);
        }
    }
    let restarted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&deleted).unwrap()).unwrap();
    let replay = update(&mut nodes, &edges, &restarted, 500);
    assert_eq!(
        serde_json::to_value(&deleted.nodes).unwrap(),
        serde_json::to_value(&replay.nodes).unwrap()
    );
}

#[test]
fn isolated_filename_growth_moves_only_the_resized_note_and_then_settles() {
    let mut nodes = vec![node("a", 0, 0), node("b", 1, 0)];
    nodes[0].x = 0.0;
    nodes[1].x = 70.0;
    let mut prior = MapState::default();
    capture(&mut prior, &nodes, &[]);
    let first = update(&mut nodes, &[], &prior, 100);
    assert!(first.nodes.iter().all(|n| n.cloud.is_none()));
    nodes[0].file_name = format!("{}.md", "W".repeat(60));
    let resized = update(&mut nodes, &[], &first, 200);
    assert_eq!(resized.nodes[1].position, first.nodes[1].position);
    assert_ne!(resized.nodes[0].position, first.nodes[0].position);
    let dx = (nodes[0].x - nodes[1].x).abs();
    let dy = (nodes[0].y - nodes[1].y).abs();
    assert!(dx.hypot(dy) >= 42.0 && (dx >= 190.0 || dy >= 18.0));
    let replay = update(&mut nodes, &[], &resized, 300);
    for (a, b) in resized.nodes.iter().zip(&replay.nodes) {
        assert_eq!(a.position, b.position);
    }
}

#[test]
fn new_theme_placement_does_not_depend_on_incoming_cache_coordinates() {
    let (mut nodes, mut edges) = fixture();
    let prior = update(&mut nodes, &edges, &MapState::default(), 100);
    for i in 0..8 {
        nodes.push(node(&format!("fresh-{i}"), 2, i));
        for j in 0..i {
            edges.push(LayoutEdge {
                source_id: format!("fresh-{j}"),
                target_id: format!("fresh-{i}"),
                weight: 0.9,
            });
        }
    }
    let mut alternate = nodes.clone();
    for (i, n) in nodes.iter_mut().enumerate().skip(16) {
        n.x = 100_000.0 * i as f32;
        n.y = -100_000.0;
    }
    for (i, n) in alternate.iter_mut().enumerate().skip(16) {
        n.x = -1_000_000.0;
        n.y = 1_000_000.0 * i as f32;
    }
    let a = update(&mut nodes, &edges, &prior, 200);
    let b = update(&mut alternate, &edges, &prior, 200);
    for (left, right) in a.nodes.iter().zip(&b.nodes) {
        assert_eq!(
            left.position, right.position,
            "cache hint changed {}",
            left.identity
        );
    }
    let fresh = &a.nodes[16..];
    assert!(fresh[0].cloud.is_some());
    assert!(fresh.iter().all(|n| n.cloud == fresh[0].cloud));
    for n in fresh {
        assert!(
            (n.position[0] - fresh[0].position[0]).hypot(n.position[1] - fresh[0].position[1])
                < 600.0
        );
        assert!(n.position[0].abs() < 10_000.0 && n.position[1].abs() < 10_000.0);
    }
    for (old, current) in prior.nodes.iter().zip(&a.nodes) {
        assert_eq!(old.position, current.position);
    }
    let settled = update(&mut nodes, &edges, &a, 300);
    for (old, current) in a.nodes.iter().zip(&settled.nodes) {
        assert_eq!(old.position, current.position);
    }
}

#[test]
fn legacy_import_releases_only_colliding_footprints_once() {
    let mut nodes = vec![node("a", 0, 0), node("b", 1, 0), node("c", 2, 0)];
    nodes[0].x = 0.0;
    nodes[1].x = 0.0;
    nodes[2].x = 1000.0;
    let mut legacy = MapState::default();
    capture(&mut legacy, &nodes, &[]);
    legacy.placement_version = 0;
    let repaired = update(&mut nodes, &[], &legacy, 100);
    assert_eq!(repaired.nodes[0].position, legacy.nodes[0].position);
    assert_eq!(repaired.nodes[2].position, legacy.nodes[2].position);
    assert!((nodes[0].x - nodes[1].x).hypot(nodes[0].y - nodes[1].y) >= 42.0);
    assert_eq!(repaired.placement_version, stable_layout::PLACEMENT_VERSION);
    let restarted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&repaired).unwrap()).unwrap();
    let replay = update(&mut nodes, &[], &restarted, 200);
    for (old, current) in repaired.nodes.iter().zip(&replay.nodes) {
        assert_eq!(old.position, current.position);
    }
}

#[test]
fn spacing_migration_closes_remote_cloud_gap_without_repacking_neighborhoods() {
    let (mut nodes, mut edges) = fixture();
    for i in 0..8 {
        nodes.push(node(&format!("remote-{i}"), 2, i));
        for j in 0..i {
            edges.push(LayoutEdge {
                source_id: format!("remote-{j}"),
                target_id: format!("remote-{i}"),
                weight: 0.9,
            });
        }
    }
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    let remote_id = prior.nodes[16].cloud.clone().unwrap();
    // Two neighboring established roots are the main neighborhood; a third is
    // compact internally but stranded by old accepted coordinates.
    for (i, n) in nodes.iter_mut().enumerate() {
        n.x = if i < 16 {
            (i / 8) as f32 * 600.0 + (i % 8) as f32 * 50.0
        } else {
            10_000.0 + (i % 8) as f32 * 50.0
        };
        n.y = if i < 16 { 0.0 } else { 6_000.0 };
    }
    for cloud in &mut prior.clouds {
        let members = nodes
            .iter()
            .filter(|n| cloud.members.contains(&note_identity(n)))
            .collect::<Vec<_>>();
        if !members.is_empty() {
            cloud.position = [
                members.iter().map(|n| n.x).sum::<f32>() / members.len() as f32,
                members.iter().map(|n| n.y).sum::<f32>() / members.len() as f32,
            ];
        }
    }
    prior
        .clouds
        .iter_mut()
        .find(|c| c.id == remote_id)
        .unwrap()
        .user_name = Some("Remote theme".into());
    capture(&mut prior, &nodes, &[]);
    prior.placement_version = 1;
    let compact = update(&mut nodes, &edges, &prior, 200);
    for (old, next) in prior.nodes[..16].iter().zip(&compact.nodes[..16]) {
        assert_eq!(old.position, next.position, "main neighborhood moved");
    }
    let delta = [
        compact.nodes[16].position[0] - prior.nodes[16].position[0],
        compact.nodes[16].position[1] - prior.nodes[16].position[1],
    ];
    assert!(delta[0].hypot(delta[1]) > 8000.0, "remote gap was retained");
    for (old, next) in prior.nodes[16..].iter().zip(&compact.nodes[16..]) {
        assert_eq!(old.cloud, next.cloud);
        assert!((next.position[0] - old.position[0] - delta[0]).abs() < 0.01);
        assert!((next.position[1] - old.position[1] - delta[1]).abs() < 0.01);
    }
    assert!(compact
        .nodes
        .iter()
        .all(|n| n.position[0].abs() < 2000.0 && n.position[1].abs() < 2000.0));
    assert_eq!(
        compact
            .clouds
            .iter()
            .find(|c| c.id == remote_id)
            .unwrap()
            .user_name
            .as_deref(),
        Some("Remote theme")
    );
    let restarted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&compact).unwrap()).unwrap();
    let replay = update(&mut nodes, &edges, &restarted, 300);
    for (old, next) in compact.nodes.iter().zip(&replay.nodes) {
        assert_eq!(old.position, next.position);
    }
    nodes[16].file_name = "remotf-0.md".into();
    let renamed = update(&mut nodes, &edges, &replay, 400);
    for (old, next) in compact.nodes.iter().zip(&renamed.nodes) {
        assert_eq!(old.position, next.position);
    }
}

#[test]
fn affinity_migration_brings_related_roots_closer_once_without_repacking_notes() {
    let (mut nodes, mut edges) = fixture();
    for i in 0..8 {
        nodes.push(node(&format!("third-{i}"), 2, i));
        for j in 0..i {
            edges.push(LayoutEdge {
                source_id: format!("third-{j}"),
                target_id: format!("third-{i}"),
                weight: 0.9,
            });
        }
    }
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    for (i, n) in nodes.iter_mut().enumerate() {
        n.x = (i / 8) as f32 * 2000.0 + (i % 8) as f32 * 50.0;
        n.y = if (8..16).contains(&i) { 1000.0 } else { 0.0 };
    }
    for cloud in &mut prior.clouds {
        let members = nodes
            .iter()
            .filter(|n| cloud.members.contains(&note_identity(n)))
            .collect::<Vec<_>>();
        if !members.is_empty() {
            cloud.position = [
                members.iter().map(|n| n.x).sum::<f32>() / members.len() as f32,
                members.iter().map(|n| n.y).sum::<f32>() / members.len() as f32,
            ];
        }
    }
    capture(&mut prior, &nodes, &[]);
    prior.placement_version = 2;
    for i in 0..8 {
        edges.push(LayoutEdge {
            source_id: format!("t0-{i}"),
            target_id: format!("third-{i}"),
            weight: 0.95,
        });
    }
    let migrated = update(&mut nodes, &edges, &prior, 200);
    let separation = |s: &MapState| {
        (s.nodes[0].position[0] - s.nodes[16].position[0])
            .hypot(s.nodes[0].position[1] - s.nodes[16].position[1])
    };
    assert!(separation(&migrated) < separation(&prior) * 0.5);
    for group in 0..3 {
        let start = group * 8;
        let delta = [
            migrated.nodes[start].position[0] - prior.nodes[start].position[0],
            migrated.nodes[start].position[1] - prior.nodes[start].position[1],
        ];
        for i in start..start + 8 {
            assert_eq!(migrated.nodes[i].cloud, prior.nodes[i].cloud);
            for axis in 0..2 {
                assert!(
                    (migrated.nodes[i].position[axis]
                        - prior.nodes[i].position[axis]
                        - delta[axis])
                        .abs()
                        < 0.01
                );
            }
        }
    }
    assert_eq!(
        migrated.nodes[8].position, prior.nodes[8].position,
        "unrelated root moved"
    );
    let persisted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&migrated).unwrap()).unwrap();
    let reopened = update(&mut nodes, &edges, &persisted, 300);
    nodes[0].file_name = "t0-1.md".into();
    let edited = update(&mut nodes, &edges, &reopened, 400);
    for i in 0..nodes.len() {
        assert_eq!(migrated.nodes[i].position, reopened.nodes[i].position);
        assert_eq!(migrated.nodes[i].position, edited.nodes[i].position);
    }
}

#[test]
fn new_root_uses_aggregate_strong_links_ahead_of_raw_embedding_fallback() {
    let (mut nodes, mut edges) = fixture();
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    for (i, n) in nodes.iter_mut().enumerate() {
        n.x = if i < 8 { -4000.0 } else { 4000.0 };
        n.y = (i % 8) as f32 * 60.0;
    }
    for cloud in &mut prior.clouds {
        cloud.position = [
            if cloud.members.contains(&"identity:t0-0".into()) {
                -4000.0
            } else {
                4000.0
            },
            210.0,
        ];
    }
    capture(&mut prior, &nodes, &[]);
    for i in 0..8 {
        let mut fresh = node(&format!("new-{i}"), 2, i);
        // Raw similarity alone prefers the left root. Deliberate relationships
        // consistently support the right root, without changing the new theme.
        fresh.embedding[0] = 0.15;
        fresh.embedding = normalized_embedding(fresh.embedding);
        nodes.push(fresh);
        for j in 0..i {
            edges.push(LayoutEdge {
                source_id: format!("new-{j}"),
                target_id: format!("new-{i}"),
                weight: 0.9,
            });
        }
    }
    // This is a layout contract: give the production calculation three admitted
    // themes, then vary their relationships independently of community detection.
    let (mut specs, memory) = reconcile(&mut nodes, &edges, &prior, 200).unwrap();
    for i in 0..8 {
        edges.push(LayoutEdge {
            source_id: format!("new-{i}"),
            target_id: format!("t1-{i}"),
            weight: 1.0,
        });
    }
    let rendered =
        stable_layout::calculate(&mut nodes, &mut specs, &memory, &prior, &edges, &[], &[]);
    let mut next = MapState {
        clouds: memory,
        ..MapState::default()
    };
    capture(&mut next, &nodes, &rendered);
    assert!(next.nodes[16].cloud.is_some());
    assert_ne!(next.nodes[16].cloud, next.nodes[0].cloud);
    assert_ne!(next.nodes[16].cloud, next.nodes[8].cloud);
    assert!(next.nodes[16..].iter().all(|n| n.position[0] > 2000.0));
    for (old, current) in prior.nodes.iter().zip(&next.nodes) {
        assert_eq!(old.position, current.position);
    }
}

#[test]
fn interleaved_root_contours_are_separated_once_even_when_notes_do_not_collide() {
    let (mut nodes, edges) = fixture();
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    // Nested/interleaved rings have no dot collisions, but their filled clouds
    // occupy the same territory. Per-node clearance cannot detect this failure.
    for (i, n) in nodes.iter_mut().enumerate() {
        let angle = (i % 8) as f32 / 8.0 * std::f32::consts::TAU;
        let radius = if i < 8 { 160.0 } else { 100.0 };
        n.x = radius * angle.cos();
        n.y = radius * angle.sin();
    }
    for cloud in &mut prior.clouds {
        cloud.position = [0.0, 0.0];
    }
    capture(&mut prior, &nodes, &[]);
    prior.placement_version = 3;
    let repaired = update(&mut nodes, &edges, &prior, 200);
    let roots = repaired
        .clouds
        .iter()
        .filter(|c| c.active && c.parent.is_none())
        .collect::<Vec<_>>();
    assert_eq!(roots.len(), 2);
    // Independent polygon check: catch containment and crossing edges.
    assert!(
        !test_contours_overlap(&roots[0].hull, &roots[1].hull),
        "root clouds still interpenetrate"
    );
    for group in 0..2 {
        let start = group * 8;
        let delta = [
            repaired.nodes[start].position[0] - prior.nodes[start].position[0],
            repaired.nodes[start].position[1] - prior.nodes[start].position[1],
        ];
        for i in start..start + 8 {
            assert_eq!(prior.nodes[i].cloud, repaired.nodes[i].cloud);
            for axis in 0..2 {
                assert!(
                    (repaired.nodes[i].position[axis]
                        - prior.nodes[i].position[axis]
                        - delta[axis])
                        .abs()
                        < 0.01
                );
            }
        }
    }
    let persisted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&repaired).unwrap()).unwrap();
    let replay = update(&mut nodes, &edges, &persisted, 300);
    for (a, b) in repaired.nodes.iter().zip(&replay.nodes) {
        assert_eq!(a.position, b.position);
    }
}

fn test_contours_overlap(a: &[[f32; 2]], b: &[[f32; 2]]) -> bool {
    if a.iter().any(|p| inside_outline(*p, b)) || b.iter().any(|p| inside_outline(*p, a)) {
        return true;
    }
    let side = |a: [f32; 2], b: [f32; 2], c: [f32; 2]| {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };
    (0..a.len()).any(|i| {
        (0..b.len()).any(|j| {
            let (p, q, r, s) = (a[i], a[(i + 1) % a.len()], b[j], b[(j + 1) % b.len()]);
            side(p, q, r) * side(p, q, s) < 0.0 && side(r, s, p) * side(r, s, q) < 0.0
        })
    })
}

#[test]
fn sibling_contours_separate_within_parent_and_remain_identical_after_restart() {
    check_sibling_clearance(3);
}

#[test]
fn newly_visible_siblings_get_clearance_on_an_already_current_map() {
    check_sibling_clearance(stable_layout::PLACEMENT_VERSION);
}

fn check_sibling_clearance(placement_version: u32) {
    let (mut nodes, _) = fixture();
    for (i, n) in nodes.iter_mut().enumerate() {
        let angle = (i % 8) as f32 / 8.0 * std::f32::consts::TAU;
        let radius = if i < 8 { 160.0 } else { 100.0 };
        n.x = radius * angle.cos();
        n.y = radius * angle.sin();
        n.cloud_id = Some("parent".into());
        n.child_cloud_id = Some(if i < 8 { "child-a" } else { "child-b" }.into());
    }
    let mut isolated = node("isolated", 2, 0);
    isolated.x = 0.0;
    isolated.y = 0.0;
    nodes.push(isolated);
    let mut specs = [
        ("parent", None, 0..16),
        ("child-a", Some("parent"), 0..8),
        ("child-b", Some("parent"), 8..16),
    ]
    .into_iter()
    .map(|(id, parent, members)| CloudSpec {
        id: id.into(),
        parent_id: parent.map(String::from),
        level: usize::from(parent.is_some()),
        member_node_ids: members.map(|i| nodes[i].id.clone()).collect(),
        core_node_ids: vec![],
        outlier_node_ids: vec![],
        child_cloud_ids: vec![],
        centroid: [0.0, 0.0],
        radius: 0.0,
        centrality: 0.5,
    })
    .collect::<Vec<_>>();
    let mut prior = MapState {
        clouds: vec![record(&specs[0], &nodes, None, 100)],
        ..MapState::default()
    };
    capture(&mut prior, &nodes, &[]);
    prior.placement_version = placement_version;
    let clouds = stable_layout::calculate(&mut nodes, &mut specs, &[], &prior, &[], &[], &[]);
    let parent = clouds.iter().find(|c| c.id == "parent").unwrap();
    let a = clouds.iter().find(|c| c.id == "child-a").unwrap();
    let b = clouds.iter().find(|c| c.id == "child-b").unwrap();
    assert!(!test_contours_overlap(&a.hull, &b.hull));
    assert!(a
        .hull
        .iter()
        .chain(&b.hull)
        .all(|p| inside_outline(*p, &parent.hull)));
    assert_eq!([nodes[16].x, nodes[16].y], [0.0, 0.0]);
    assert!(!inside_outline([0.0, 0.0], &parent.hull));
    for group in 0..2 {
        let start = group * 8;
        let delta = [
            nodes[start].x - prior.nodes[start].position[0],
            nodes[start].y - prior.nodes[start].position[1],
        ];
        for i in start..start + 8 {
            assert!((nodes[i].x - prior.nodes[i].position[0] - delta[0]).abs() < 0.01);
            assert!((nodes[i].y - prior.nodes[i].position[1] - delta[1]).abs() < 0.01);
        }
    }
    let mut accepted = MapState {
        clouds: specs.iter().map(|s| record(s, &nodes, None, 200)).collect(),
        ..MapState::default()
    };
    capture(&mut accepted, &nodes, &clouds);
    let persisted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&accepted).unwrap()).unwrap();
    let replay = stable_layout::calculate(
        &mut nodes,
        &mut specs,
        &persisted.clouds,
        &persisted,
        &[],
        &[],
        &[],
    );
    for cloud in &clouds {
        let next = replay.iter().find(|c| c.id == cloud.id).unwrap();
        assert_eq!(cloud.hull, next.hull);
        assert_eq!(cloud.centroid, next.centroid);
        assert_eq!(cloud.radius, next.radius);
        assert_eq!(cloud.core_node_ids, next.core_node_ids);
        assert_eq!(cloud.outlier_node_ids, next.outlier_node_ids);
        assert_eq!(cloud.label, next.label);
    }
    assert!(nodes
        .iter()
        .zip(&accepted.nodes)
        .all(|(n, s)| [n.x, n.y] == s.position));
}

#[test]
fn sparse_leaf_compacts_without_moving_unrelated_cloud_and_replay_is_exact() {
    let (mut nodes, edges) = fixture();
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    for (i, n) in nodes[..8].iter_mut().enumerate() {
        n.x = -2000.0 + (i % 4) as f32 * 260.0;
        n.y = (i / 4) as f32 * 650.0;
    }
    capture(&mut prior, &nodes, &[]);
    prior.placement_version = 4;
    let repaired = update(&mut nodes, &edges, &prior, 200);
    let span = |notes: &[MapNote]| {
        let xs = notes.iter().map(|n| n.position[0]).collect::<Vec<_>>();
        let ys = notes.iter().map(|n| n.position[1]).collect::<Vec<_>>();
        (xs.iter().copied().reduce(f32::max).unwrap()
            - xs.iter().copied().reduce(f32::min).unwrap())
            * (ys.iter().copied().reduce(f32::max).unwrap()
                - ys.iter().copied().reduce(f32::min).unwrap())
    };
    assert!(
        span(&repaired.nodes[..8]) < span(&prior.nodes[..8]) * 0.4,
        "sparse leaf still encloses mostly empty space"
    );
    for (old, new) in prior.nodes[8..].iter().zip(&repaired.nodes[8..]) {
        assert_eq!(old.position, new.position);
    }
    for (i, a) in repaired.nodes[..8].iter().enumerate() {
        for b in &repaired.nodes[i + 1..8] {
            assert!(
                (a.position[0] - b.position[0]).hypot(a.position[1] - b.position[1]) >= 41.99,
                "compaction introduced a note collision"
            );
        }
    }
    let replay = update(&mut nodes, &edges, &repaired, 300);
    for (a, b) in repaired.nodes.iter().zip(&replay.nodes) {
        assert_eq!(a.position, b.position);
    }
    for (a, b) in repaired.clouds.iter().zip(&replay.clouds) {
        assert_eq!(a.hull, b.hull);
    }
}

#[test]
fn long_titles_do_not_hide_internal_gaps_and_neighborhoods_keep_their_spacing() {
    let (mut nodes, edges) = fixture();
    let mut prior = update(&mut nodes, &edges, &MapState::default(), 100);
    for (i, n) in nodes[..8].iter_mut().enumerate() {
        n.file_name = format!("{}.md", "W".repeat(60));
        n.x = -1500.0;
        n.y = if i < 3 {
            i as f32 * 48.0
        } else {
            420.0 + (i - 3) as f32 * 48.0
        };
    }
    capture(&mut prior, &nodes, &[]);
    prior.placement_version = 5;
    let repaired = update(&mut nodes, &edges, &prior, 200);
    assert!(
        repaired.nodes[3].position[1] - repaired.nodes[2].position[1] < 150.0,
        "long filenames still mask the empty gap between neighborhoods"
    );
    for (start, end) in [(0, 3), (3, 8)] {
        let shift = [
            repaired.nodes[start].position[0] - prior.nodes[start].position[0],
            repaired.nodes[start].position[1] - prior.nodes[start].position[1],
        ];
        for i in start..end {
            for axis in 0..2 {
                assert!(
                    (repaired.nodes[i].position[axis]
                        - prior.nodes[i].position[axis]
                        - shift[axis])
                        .abs()
                        < 0.01
                );
            }
            assert_eq!(repaired.nodes[i].cloud, prior.nodes[i].cloud);
        }
    }
    for (a, b) in prior.nodes[3..].iter().zip(&repaired.nodes[3..]) {
        assert_eq!(a.position, b.position);
    }
    let persisted: MapState =
        serde_json::from_slice(&serde_json::to_vec(&repaired).unwrap()).unwrap();
    let replay = update(&mut nodes, &edges, &persisted, 300);
    for (a, b) in repaired.nodes.iter().zip(&replay.nodes) {
        assert_eq!(a.position, b.position);
    }
    for (a, b) in repaired.clouds.iter().zip(&replay.clouds) {
        assert_eq!(a.hull, b.hull);
    }
}
