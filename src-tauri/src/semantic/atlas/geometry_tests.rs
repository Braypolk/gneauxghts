use super::*;

#[test]
fn complete_knn_rows_for_umap_keeps_full_rows_without_exact_fill() {
    let nodes = vec![
        test_node("a", "Alpha", 0.0, 0.0),
        test_node("b", "Beta", 1.0, 0.0),
        test_node("c", "Gamma", 0.0, 1.0),
        test_node("d", "Delta", 1.0, 1.0),
    ];
    let knn_rows = vec![
        vec![
            KnnNeighbor {
                index: 1,
                similarity: 0.9,
                distance: 0.1,
            },
            KnnNeighbor {
                index: 2,
                similarity: 0.8,
                distance: 0.2,
            },
        ],
        vec![
            KnnNeighbor {
                index: 0,
                similarity: 0.9,
                distance: 0.1,
            },
            KnnNeighbor {
                index: 3,
                similarity: 0.7,
                distance: 0.3,
            },
        ],
        vec![
            KnnNeighbor {
                index: 0,
                similarity: 0.8,
                distance: 0.2,
            },
            KnnNeighbor {
                index: 3,
                similarity: 0.75,
                distance: 0.25,
            },
        ],
        vec![
            KnnNeighbor {
                index: 1,
                similarity: 0.7,
                distance: 0.3,
            },
            KnnNeighbor {
                index: 2,
                similarity: 0.75,
                distance: 0.25,
            },
        ],
    ];
    let completed = complete_knn_rows_for_umap(&nodes, &knn_rows, 2);
    assert_eq!(completed.len(), 4);
    for (index, row) in completed.iter().enumerate() {
        assert_eq!(row.len(), 2, "row {index} should stay complete");
        let mut got = row
            .iter()
            .map(|neighbor| neighbor.index)
            .collect::<Vec<_>>();
        let mut expected = knn_rows[index]
            .iter()
            .map(|neighbor| neighbor.index)
            .collect::<Vec<_>>();
        got.sort_unstable();
        expected.sort_unstable();
        assert_eq!(got, expected, "row {index} should keep HNSW neighbors");
    }
}

#[test]
fn umap_iterations_scale_with_note_count() {
    assert!(umap_iterations_for_note_count(1) >= UMAP_ITERATIONS_BASE);
    assert!(umap_iterations_for_note_count(10_000) <= UMAP_ITERATIONS_MAX);
    assert!(umap_iterations_for_note_count(400) < UMAP_ITERATIONS_MAX);
    assert!(umap_iterations_for_note_count(400) > umap_iterations_for_note_count(16));
}

fn test_node(id: &str, title: &str, x: f32, y: f32) -> WorkingNode {
    WorkingNode {
        has_semantic_content: true,
        id: id.to_string(),
        note_id: Some(id.to_string()),
        note_path: format!("/vault/{id}.md"),
        title: title.to_string(),
        file_name: format!("{id}.md"),
        preview: String::new(),
        tags: Vec::new(),
        created_at_millis: 100,
        updated_at_millis: 100,
        last_viewed_at_millis: None,
        centrality: 0.5,
        importance: 0.0,
        embedding: vec![x, y, 1.0],
        x,
        y,
        cloud_id: None,
        parent_cloud_id: None,
        child_cloud_id: None,
        isolated: true,
    }
}

fn test_edge(source: &str, target: &str, weight: f32) -> LayoutEdge {
    LayoutEdge {
        source_id: source.to_string(),
        target_id: target.to_string(),
        weight,
    }
}

fn test_working_link(source: &str, target: &str, strength: f32) -> WorkingLink {
    WorkingLink {
        source_id: source.to_string(),
        target_id: target.to_string(),
        kind: "semantic".to_string(),
        score: strength,
        strength,
    }
}

fn test_cloud_spec(id: &str, radius: f32, centrality: f32, members: &[&str]) -> CloudSpec {
    CloudSpec {
        id: id.to_string(),
        parent_id: None,
        level: 0,
        member_node_ids: members.iter().map(|member| member.to_string()).collect(),
        core_node_ids: Vec::new(),
        outlier_node_ids: Vec::new(),
        child_cloud_ids: Vec::new(),
        centroid: [0.0, 0.0],
        radius,
        centrality,
    }
}

fn assert_specs_do_not_overlap(specs: &[CloudSpec], level: usize, gap: f32) {
    let specs = specs
        .iter()
        .filter(|spec| spec.level == level)
        .collect::<Vec<_>>();
    for left in 0..specs.len() {
        for right in (left + 1)..specs.len() {
            let dist = distance(specs[left].centroid, specs[right].centroid);
            let required = specs[left].radius + specs[right].radius + gap - 0.5;
            assert!(
                dist >= required,
                "{} and {} overlap: dist={dist}, required={required}",
                specs[left].id,
                specs[right].id
            );
        }
    }
}

#[test]
fn activity_does_not_change_structural_link_strength() {
    let mut recent_nodes = [test_node("a", "A", 0.0, 0.0), test_node("b", "B", 1.0, 0.0)];
    recent_nodes[0].note_path = "folder/a.md".to_string();
    recent_nodes[1].note_path = "folder/b.md".to_string();
    recent_nodes[0].last_viewed_at_millis = Some(100);
    recent_nodes[1].last_viewed_at_millis = Some(100);
    let mut stale_nodes = recent_nodes.clone();
    stale_nodes[0].last_viewed_at_millis = Some(1);
    stale_nodes[1].last_viewed_at_millis = Some(1);
    let mut recent_links = vec![test_working_link("a", "b", 0.5)];
    let mut stale_links = recent_links.clone();

    boost_links(&mut recent_links, &recent_nodes);
    boost_links(&mut stale_links, &stale_nodes);

    assert_eq!(recent_links[0].strength, stale_links[0].strength);
    assert_eq!(recent_links[0].strength, 0.5 + FOLDER_BOOST * 0.5);
}

#[test]
fn connected_components_respects_minimum_link_strength() {
    let nodes = [
        test_node("a", "A", 0.0, 0.0),
        test_node("b", "B", 1.0, 0.0),
        test_node("c", "C", 100.0, 0.0),
    ];
    let links = [
        LayoutEdge {
            source_id: "a".to_string(),
            target_id: "b".to_string(),
            weight: COMPONENT_MIN_STRENGTH,
        },
        LayoutEdge {
            source_id: "b".to_string(),
            target_id: "c".to_string(),
            weight: COMPONENT_MIN_STRENGTH - 0.01,
        },
    ];

    let mut components = connected_components(&nodes, &links);
    components.sort_by_key(|component| component.len());

    assert_eq!(components.len(), 2);
    assert_eq!(components[0], vec!["c".to_string()]);
    assert_eq!(components[1].len(), 2);
}

#[test]
fn many_topic_clusters_become_many_top_clouds() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for cluster in 0..12 {
        for ordinal in 0..20 {
            let id = format!("c{cluster:02}-{ordinal:02}");
            let mut node = test_node(&id, &format!("Cluster {cluster} Note {ordinal}"), 0.0, 0.0);
            let mut embedding = vec![0.0_f32; 12];
            embedding[cluster] = 1.0;
            embedding.push(ordinal as f32 / 20.0);
            node.embedding = embedding;
            node.centrality = if ordinal == 0 { 1.0 } else { 0.45 };
            nodes.push(node);
            if ordinal > 0 {
                edges.push(test_edge(
                    &format!("c{cluster:02}-{:02}", ordinal - 1),
                    &id,
                    0.82,
                ));
            }
            if ordinal > 1 {
                edges.push(test_edge(
                    &format!("c{cluster:02}-{:02}", ordinal - 2),
                    &id,
                    0.72,
                ));
            }
        }
    }

    let mut specs = assign_clouds(&mut nodes, &edges);
    let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
    assert!(
        top_level_count >= 10,
        "expected content-driven top clouds near cluster count, got {top_level_count}"
    );
    place_cloud_first_layout(&mut nodes, &edges, &mut specs, DEFAULT_LAYOUT_PULL);
    assert_specs_do_not_overlap(&specs, 0, TOP_LEVEL_CLOUD_GAP);
}

#[test]
fn weak_bridges_do_not_collapse_distinct_topics() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for topic in 0..4 {
        for ordinal in 0..12 {
            let id = format!("t{topic}-{ordinal:02}");
            let mut node = test_node(&id, &format!("Topic {topic} Note {ordinal}"), 0.0, 0.0);
            // Orthogonal-ish topic axes so embedding similarity across topics stays low.
            let mut embedding = vec![0.0_f32; 4];
            embedding[topic] = 1.0;
            embedding.push(ordinal as f32 / 12.0);
            node.embedding = embedding;
            node.centrality = if ordinal == 0 { 1.0 } else { 0.4 };
            nodes.push(node);
            if ordinal > 0 {
                edges.push(test_edge(
                    &format!("t{topic}-{:02}", ordinal - 1),
                    &id,
                    0.88,
                ));
            }
            if ordinal > 1 {
                edges.push(test_edge(
                    &format!("t{topic}-{:02}", ordinal - 2),
                    &id,
                    0.78,
                ));
            }
        }
    }
    // Sparse weak bridges — previously these summed past the merge threshold.
    edges.push(test_edge("t0-00", "t1-00", 0.34));
    edges.push(test_edge("t1-00", "t2-00", 0.34));
    edges.push(test_edge("t2-00", "t3-00", 0.34));
    edges.push(test_edge("t0-05", "t2-05", 0.32));

    let specs = assign_clouds(&mut nodes, &edges);
    let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
    assert!(
        top_level_count >= 3,
        "weak bridges should not collapse 4 topics into {top_level_count} clouds"
    );
}

#[test]
fn large_parent_forms_subclouds_when_topics_separate() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for topic in 0..2 {
        for ordinal in 0..14 {
            let id = format!("s{topic}-{ordinal:02}");
            let mut node = test_node(&id, &format!("Sub {topic} Note {ordinal}"), 0.0, 0.0);
            let mut embedding = vec![0.0_f32; 2];
            embedding[topic] = 1.0;
            embedding.push(ordinal as f32 / 14.0);
            node.embedding = embedding;
            node.centrality = 0.5;
            nodes.push(node);
            if ordinal > 0 {
                edges.push(test_edge(&format!("s{topic}-{:02}", ordinal - 1), &id, 0.9));
            }
            if ordinal > 1 {
                edges.push(test_edge(
                    &format!("s{topic}-{:02}", ordinal - 2),
                    &id,
                    0.82,
                ));
            }
        }
    }
    edges.push(test_edge("s0-00", "s1-00", 0.5));
    edges.push(test_edge("s0-03", "s1-03", 0.48));

    let specs = assign_clouds(&mut nodes, &edges);
    let top = specs.iter().filter(|spec| spec.level == 0).count();
    let children = specs.iter().filter(|spec| spec.level == 1).count();
    assert!(
        top >= 2 || children >= 2,
        "expected either promoted top clouds or subclouds, got top={top} children={children}"
    );
}

#[test]
fn mature_subclouds_promote_to_top_level_when_parent_is_large() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for topic in 0..3 {
        for ordinal in 0..18 {
            let id = format!("t{topic}-{ordinal:02}");
            let mut node = test_node(&id, &format!("Topic {topic} Note {ordinal}"), 0.0, 0.0);
            node.embedding = vec![topic as f32 * 10.0, ordinal as f32 / 18.0, 1.0];
            node.centrality = if ordinal == 0 { 1.0 } else { 0.4 };
            nodes.push(node);
            if ordinal > 0 {
                edges.push(test_edge(&format!("t{topic}-{:02}", ordinal - 1), &id, 0.9));
            }
            if ordinal > 1 {
                edges.push(test_edge(&format!("t{topic}-{:02}", ordinal - 2), &id, 0.8));
            }
        }
    }
    // Weak bridges so the whole set is one component but topics stay separable.
    edges.push(test_edge("t0-00", "t1-00", 0.32));
    edges.push(test_edge("t1-00", "t2-00", 0.32));

    let specs = assign_clouds(&mut nodes, &edges);
    let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
    assert!(
        top_level_count >= 2,
        "expected promotion into multiple top clouds, got {top_level_count}"
    );
}

#[test]
fn coherent_group_without_separable_children_stays_one_top_cloud() {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for ordinal in 0..24 {
        let id = format!("n{ordinal:02}");
        let mut node = test_node(&id, &format!("Note {ordinal}"), 0.0, 0.0);
        // Near-identical embeddings — one coherent topic.
        node.embedding = vec![1.0, 0.02 * (ordinal as f32), 0.5];
        node.centrality = if ordinal == 0 { 1.0 } else { 0.5 };
        nodes.push(node);
    }
    // Dense clique so Leiden sees one community.
    for left in 0..nodes.len() {
        for right in (left + 1)..nodes.len() {
            edges.push(test_edge(
                &nodes[left].id,
                &nodes[right].id,
                0.9 - ((right - left) as f32) * 0.005,
            ));
        }
    }

    let specs = assign_clouds(&mut nodes, &edges);
    let top_level_count = specs.iter().filter(|spec| spec.level == 0).count();
    assert_eq!(
        top_level_count, 1,
        "coherent dense topic should remain one top cloud"
    );
}

#[test]
fn umap_cloud_separation_repacks_interleaved_clusters() {
    let mut nodes = Vec::new();
    let mut specs = Vec::new();
    let mut edges = Vec::new();
    for cluster in 0..5 {
        let cloud_id = format!("cloud-{}", cluster + 1);
        let mut member_ids = Vec::new();
        for ordinal in 0..12 {
            let id = format!("c{cluster}-{ordinal}");
            let angle = (ordinal as f32 / 12.0) * std::f32::consts::TAU;
            let mut node = test_node(
                &id,
                &format!("Cluster {cluster}"),
                angle.cos() * (80.0 + cluster as f32 * 3.0),
                angle.sin() * (80.0 + cluster as f32 * 3.0),
            );
            node.cloud_id = Some(cloud_id.clone());
            node.isolated = false;
            member_ids.push(id.clone());
            nodes.push(node);
            if ordinal > 0 {
                edges.push(test_edge(&format!("c{cluster}-{}", ordinal - 1), &id, 0.86));
            }
        }
        specs.push(CloudSpec {
            id: cloud_id,
            parent_id: None,
            level: 0,
            member_node_ids: member_ids,
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: Vec::new(),
            centroid: [0.0, 0.0],
            radius: 160.0,
            centrality: 1.0 - cluster as f32 * 0.1,
        });
    }

    separate_umap_clouds(&mut nodes, &edges, &mut specs, DEFAULT_LAYOUT_PULL);

    assert_specs_do_not_overlap(&specs, 0, TOP_LEVEL_CLOUD_GAP);
}

#[test]
fn strongly_linked_clouds_are_closer_but_do_not_overlap() {
    let mut specs = vec![
        test_cloud_spec("a", 120.0, 1.0, &["a1", "a2", "a3"]),
        test_cloud_spec("b", 120.0, 0.8, &["b1", "b2", "b3"]),
        test_cloud_spec("c", 120.0, 0.2, &["c1", "c2", "c3"]),
    ];
    let edges = [test_edge("a1", "b1", 0.95)];

    place_top_level_clouds(&mut specs, &edges, DEFAULT_LAYOUT_PULL);

    assert_specs_do_not_overlap(&specs, 0, TOP_LEVEL_CLOUD_GAP);
    let linked_distance = distance(specs[0].centroid, specs[1].centroid);
    let unlinked_distance = distance(specs[0].centroid, specs[2].centroid);
    assert!(linked_distance < unlinked_distance);
}

#[test]
fn child_clouds_inside_parent_do_not_overlap() {
    let mut specs = vec![
        CloudSpec {
            id: "parent".to_string(),
            parent_id: None,
            level: 0,
            member_node_ids: vec![
                "a1".to_string(),
                "a2".to_string(),
                "a3".to_string(),
                "b1".to_string(),
                "b2".to_string(),
                "b3".to_string(),
            ],
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: vec!["child-a".to_string(), "child-b".to_string()],
            centroid: [0.0, 0.0],
            radius: 310.0,
            centrality: 1.0,
        },
        CloudSpec {
            id: "child-a".to_string(),
            parent_id: Some("parent".to_string()),
            level: 1,
            member_node_ids: vec!["a1".to_string(), "a2".to_string(), "a3".to_string()],
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: Vec::new(),
            centroid: [0.0, 0.0],
            radius: 105.0,
            centrality: 0.8,
        },
        CloudSpec {
            id: "child-b".to_string(),
            parent_id: Some("parent".to_string()),
            level: 1,
            member_node_ids: vec!["b1".to_string(), "b2".to_string(), "b3".to_string()],
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids: Vec::new(),
            centroid: [0.0, 0.0],
            radius: 105.0,
            centrality: 0.7,
        },
    ];
    let child_indices = [1, 2];

    place_child_centers(0, &child_indices, &mut specs, &[]);

    assert_specs_do_not_overlap(&specs, 1, CHILD_CLOUD_GAP);
    for child in specs.iter().filter(|spec| spec.level == 1) {
        assert!(distance(specs[0].centroid, child.centroid) + child.radius <= specs[0].radius);
    }
}

#[test]
fn far_weak_outlier_does_not_expand_cloud_core() {
    let nodes = [
        test_node("a", "Core Alpha", 0.0, 0.0),
        test_node("b", "Core Beta", 12.0, 0.0),
        test_node("c", "Core Gamma", 0.0, 12.0),
        test_node("d", "Core Delta", 14.0, 10.0),
        test_node("outlier", "Outlier", 1000.0, 1000.0),
    ];
    let edges = [
        test_edge("a", "b", 0.8),
        test_edge("a", "c", 0.8),
        test_edge("b", "d", 0.8),
    ];
    let mut specs = vec![CloudSpec {
        id: "cloud".to_string(),
        parent_id: None,
        level: 0,
        member_node_ids: nodes.iter().map(|node| node.id.clone()).collect(),
        core_node_ids: Vec::new(),
        outlier_node_ids: Vec::new(),
        child_cloud_ids: Vec::new(),
        centroid: [0.0, 0.0],
        radius: 220.0,
        centrality: 1.0,
    }];

    finalize_cloud_cores(&nodes, &edges, &mut specs);

    assert!(specs[0].outlier_node_ids.contains(&"outlier".to_string()));
    assert!(!specs[0].core_node_ids.contains(&"outlier".to_string()));
}

#[test]
fn layout_graph_keeps_dense_edges_under_degree_cap() {
    let nodes = (0..60)
        .map(|index| {
            let mut node = test_node(&format!("n{index:02}"), "Node", 0.0, 0.0);
            node.embedding = vec![index as f32, 1.0];
            node
        })
        .collect::<Vec<_>>();
    let mut links = Vec::new();
    for left in 0..nodes.len() {
        for right in (left + 1)..nodes.len() {
            links.push(test_working_link(
                &nodes[left].id,
                &nodes[right].id,
                0.55 + ((left + right) % 10) as f32 * 0.02,
            ));
        }
    }

    let layout_edges = build_layout_graph(&nodes, &links);

    let max_expected = nodes.len() * (LAYOUT_MAX_DEGREE / 2 + 1);
    assert!(
        layout_edges.len() <= max_expected,
        "{} edges exceeded cap {max_expected}",
        layout_edges.len()
    );
}

#[test]
fn highest_centrality_cloud_starts_at_origin() {
    let mut specs = vec![
        test_cloud_spec("low", 90.0, 0.1, &["low-a", "low-b", "low-c"]),
        test_cloud_spec("high", 90.0, 1.0, &["high-a", "high-b", "high-c"]),
        test_cloud_spec("mid", 90.0, 0.5, &["mid-a", "mid-b", "mid-c"]),
    ];

    place_top_level_clouds(&mut specs, &[], DEFAULT_LAYOUT_PULL);

    let high = specs.iter().find(|spec| spec.id == "high").unwrap();
    assert!(distance(high.centroid, [0.0, 0.0]) < 1.0);
    for spec in specs.iter().filter(|spec| spec.id != "high") {
        assert!(distance(spec.centroid, [0.0, 0.0]) > 1.0);
    }
}

#[test]
fn semantic_weights_preserve_dense_score_contrast_through_layout_selection() {
    let nodes = (0..32)
        .map(|i| test_node(&format!("n{i:02}"), "Note", 0.0, 0.0))
        .collect::<Vec<_>>();
    let rows = (0..nodes.len())
        .map(|a| {
            let mut row = (0..nodes.len())
                .filter(|b| *b != a)
                .map(|b| {
                    let similarity = if a / 2 == b / 2 {
                        0.94
                    } else {
                        0.81 + ((a + b) % 10) as f32 * 0.004
                    };
                    KnnNeighbor {
                        index: b,
                        similarity,
                        distance: 1.0 - similarity,
                    }
                })
                .collect::<Vec<_>>();
            row.sort_by(|a, b| b.similarity.total_cmp(&a.similarity));
            row.truncate(KNN_GRAPH_K);
            row
        })
        .collect::<Vec<_>>();
    let mut links = collect_links(&nodes, &rows, vec![]);
    boost_links(&mut links, &nodes);
    let strong = links
        .iter()
        .filter(|l| l.strength >= 0.7)
        .collect::<Vec<_>>();
    assert_eq!(
        strong.len(),
        16,
        "weak dense background should not look as strong as paired themes"
    );
    assert!(links
        .iter()
        .all(|l| l.strength.is_finite() && (0.0..=1.0).contains(&l.strength)));
    let distinct = links
        .iter()
        .map(|l| (l.strength * 10000.0) as u32)
        .collect::<HashSet<_>>();
    assert!(
        distinct.len() > 5,
        "raw cosine differences must survive normalization"
    );
    let graph = build_layout_graph(&nodes, &links);
    for link in strong {
        assert!(graph.iter().any(|e| e.source_id == link.source_id
            && e.target_id == link.target_id
            && e.weight == link.strength));
    }
    let mut reversed = rows.clone();
    for row in &mut reversed {
        row.reverse();
    }
    let mut replay = collect_links(&nodes, &reversed, vec![]);
    boost_links(&mut replay, &nodes);
    for link in &links {
        let other = replay
            .iter()
            .find(|l| l.source_id == link.source_id && l.target_id == link.target_id)
            .unwrap();
        assert!((link.strength - other.strength).abs() < 1e-6);
    }
}

#[test]
fn semantic_weights_do_not_promote_weak_or_flat_neighborhoods_to_certainty() {
    for score in [0.31, 0.6, 0.83, 0.9, 0.99] {
        let nodes = [test_node("a", "A", 0.0, 0.0), test_node("b", "B", 0.0, 0.0)];
        let rows = vec![
            vec![KnnNeighbor {
                index: 1,
                similarity: score,
                distance: 1.0 - score,
            }],
            vec![KnnNeighbor {
                index: 0,
                similarity: score,
                distance: 1.0 - score,
            }],
        ];
        let mut links = collect_links(&nodes, &rows, vec![]);
        boost_links(&mut links, &nodes);
        assert!(links[0].strength < score);
        if score < 0.6 {
            assert!(links[0].strength < 0.7);
        }
    }
}

#[test]
fn layout_keeps_authored_links_above_degree_limit_and_semantic_duplicates() {
    let nodes = (0..24)
        .map(|i| test_node(&format!("n{i}"), "Note", 0.0, 0.0))
        .collect::<Vec<_>>();
    let mut links = Vec::new();
    for node in &nodes[1..] {
        links.push(test_working_link("n0", &node.id, 0.8));
        let mut authored = test_working_link("n0", &node.id, 1.0);
        authored.kind = "wikilink".into();
        links.push(authored);
    }
    let graph = build_layout_graph(&nodes, &links);
    assert_eq!(graph.len(), 23);
    assert!(graph.iter().all(|e| e.weight == 1.0));
}
