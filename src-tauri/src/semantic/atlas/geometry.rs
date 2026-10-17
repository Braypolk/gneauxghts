//! Private Atlas geometry implementation; one semantic owner remains authoritative.
use hnswlib_rs::{Cosine, Hnsw, HnswConfig, InMemoryVectorStore};
use leiden_rs::{GraphDataBuilder, Leiden, LeidenConfig, QualityType};
use ndarray::Array2;
use rayon::prelude::*;
use std::panic::{catch_unwind, AssertUnwindSafe};
use umap_rs::{GraphParams, OptimizationParams, Umap, UmapConfig};
type EdgeAdjacency = HashMap<String, Vec<usize>>;

fn build_edge_adjacency(edges: &[LayoutEdge]) -> EdgeAdjacency {
    let mut adjacency = EdgeAdjacency::new();
    for (index, edge) in edges.iter().enumerate() {
        adjacency
            .entry(edge.source_id.clone())
            .or_default()
            .push(index);
        adjacency
            .entry(edge.target_id.clone())
            .or_default()
            .push(index);
    }
    adjacency
}

struct TopGroupPartition {
    members: Vec<String>,
    /// Children already computed for this exact member set; None means assign_clouds must detect.
    precomputed_children: Option<Vec<Vec<String>>>,
}

use super::*;

pub(super) fn collect_links(
    nodes: &[WorkingNode],
    knn_rows: &[Vec<KnnNeighbor>],
    hard_links: Vec<AtlasHardLink>,
) -> Vec<WorkingLink> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    // Local score contrast is computed once from each note's semantic neighbors.
    // Mean distance from the best match adapts to the embedding distribution;
    // a small floor prevents near-identical scores amplifying numerical noise.
    let neighborhoods = knn_rows
        .iter()
        .map(|row| {
            let mut scores = row
                .iter()
                .filter(|n| n.similarity.is_finite() && n.similarity >= SEMANTIC_MIN_SCORE)
                .map(|n| n.similarity)
                .collect::<Vec<_>>();
            scores.sort_by(f32::total_cmp);
            let best = scores.iter().copied().fold(SEMANTIC_MIN_SCORE, f32::max);
            let scale = (scores.iter().map(|score| best - score).sum::<f32>()
                / scores.len().max(1) as f32)
                .max(0.01);
            (best, scale)
        })
        .collect::<Vec<_>>();
    let mut merged: HashMap<(String, String, String), WorkingLink> = HashMap::new();
    for (source_index, neighbors) in knn_rows.iter().enumerate() {
        let Some(source) = nodes.get(source_index) else {
            continue;
        };
        for neighbor in neighbors {
            let Some(target) = nodes.get(neighbor.index) else {
                continue;
            };
            if source.id == target.id
                || !neighbor.similarity.is_finite()
                || neighbor.similarity < SEMANTIC_MIN_SCORE
            {
                continue;
            }
            let (source_id, target_id) = ordered_pair(source.id.clone(), target.id.clone());
            let key = (source_id.clone(), target_id.clone(), "semantic".to_string());
            let affinity = |index: usize| {
                let (best, scale) = neighborhoods
                    .get(index)
                    .copied()
                    .unwrap_or((neighbor.similarity, 1.0));
                (-(best - neighbor.similarity).max(0.0) / scale).exp()
            };
            let strength = normalize_edge_strength(neighbor.similarity)
                * (affinity(source_index) * affinity(neighbor.index)).sqrt();
            merged
                .entry(key)
                .and_modify(|existing| {
                    if neighbor.similarity > existing.score {
                        existing.score = neighbor.similarity;
                        existing.strength = strength;
                    }
                })
                .or_insert(WorkingLink {
                    source_id,
                    target_id,
                    kind: "semantic".to_string(),
                    score: neighbor.similarity,
                    strength,
                });
        }
    }

    for hard_link in hard_links {
        if hard_link.source_note_path == hard_link.target_note_path
            || !node_ids.contains(&hard_link.source_note_path)
            || !node_ids.contains(&hard_link.target_note_path)
        {
            continue;
        }
        let (source_id, target_id) =
            ordered_pair(hard_link.source_note_path, hard_link.target_note_path);
        let link = WorkingLink {
            source_id: source_id.clone(),
            target_id: target_id.clone(),
            kind: "wikilink".to_string(),
            score: 1.0,
            strength: WIKILINK_STRENGTH,
        };
        merged.insert((source_id, target_id, "wikilink".to_string()), link);
    }

    merged.into_values().collect()
}

pub(super) fn build_hnsw_knn_rows(nodes: &[WorkingNode]) -> Vec<Vec<KnnNeighbor>> {
    let k = KNN_GRAPH_K.min(nodes.len().saturating_sub(1));
    if nodes.len() < 2 || k == 0 {
        return vec![Vec::new(); nodes.len()];
    }
    let Some(dimensions) = nodes
        .iter()
        .map(|node| node.embedding.len())
        .find(|dimensions| *dimensions > 0)
    else {
        return exact_knn_rows(nodes, k);
    };
    if nodes.iter().any(|node| {
        node.embedding.len() != dimensions || node.embedding.iter().any(|value| !value.is_finite())
    }) {
        return exact_knn_rows(nodes, k);
    }

    let capacity = nodes.len().saturating_mul(2).max(1024).next_power_of_two();
    let graph = Hnsw::new(
        Cosine::new(),
        HnswConfig::new(dimensions, capacity)
            .m(16)
            .ef_construction(200)
            .ef_search(k.saturating_mul(4).max(64))
            .seed(ATLAS_LAYOUT_ALGORITHM_VERSION as u64),
    );
    let vectors = InMemoryVectorStore::<f32>::new(dimensions, capacity);
    for (index, node) in nodes.iter().enumerate() {
        if graph
            .set(&vectors, index as u64, node.embedding.as_slice())
            .is_err()
        {
            return exact_knn_rows(nodes, k);
        }
    }

    let rows: Option<Vec<Vec<KnnNeighbor>>> = nodes
        .par_iter()
        .enumerate()
        .map(|(source_index, source)| {
            let hits = graph
                .search(&vectors, source.embedding.as_slice(), k + 1, None)
                .ok()?;
            let mut neighbors = Vec::<KnnNeighbor>::new();
            for hit in hits {
                let target_index = hit.key as usize;
                if target_index == source_index || target_index >= nodes.len() {
                    continue;
                }
                let similarity =
                    atlas_cosine_similarity(&source.embedding, &nodes[target_index].embedding);
                push_unique_neighbor(&mut neighbors, target_index, similarity);
            }
            neighbors.sort_by(|left, right| {
                right
                    .similarity
                    .total_cmp(&left.similarity)
                    .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
            });
            neighbors.truncate(k);
            Some(neighbors)
        })
        .collect();
    rows.unwrap_or_else(|| exact_knn_rows(nodes, k))
}

fn exact_knn_rows(nodes: &[WorkingNode], k: usize) -> Vec<Vec<KnnNeighbor>> {
    nodes
        .par_iter()
        .enumerate()
        .map(|(source_index, source)| {
            let mut neighbors = nodes
                .iter()
                .enumerate()
                .filter_map(|(target_index, target)| {
                    if source_index == target_index {
                        return None;
                    }
                    let similarity = atlas_cosine_similarity(&source.embedding, &target.embedding);
                    Some(KnnNeighbor {
                        index: target_index,
                        similarity,
                        distance: cosine_distance_for_umap(similarity),
                    })
                })
                .collect::<Vec<_>>();
            neighbors.sort_by(|left, right| {
                right
                    .similarity
                    .total_cmp(&left.similarity)
                    .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
            });
            neighbors.truncate(k);
            neighbors
        })
        .collect()
}

fn push_unique_neighbor(neighbors: &mut Vec<KnnNeighbor>, target_index: usize, similarity: f32) {
    if neighbors
        .iter()
        .any(|neighbor| neighbor.index == target_index)
    {
        return;
    }
    neighbors.push(KnnNeighbor {
        index: target_index,
        similarity,
        distance: cosine_distance_for_umap(similarity),
    });
}

fn cosine_distance_for_umap(similarity: f32) -> f32 {
    (1.0 - similarity.clamp(-1.0, 1.0)).max(0.000_1)
}

pub(super) fn place_uncached_nodes_from_neighbors(
    nodes: &mut [WorkingNode],
    cached_positions: &HashMap<String, (f32, f32)>,
    knn_rows: &[Vec<KnnNeighbor>],
) {
    let cached_by_index = nodes
        .iter()
        .enumerate()
        .filter_map(|(index, node)| {
            cached_positions
                .get(&node.note_path)
                .copied()
                .map(|pos| (index, pos))
        })
        .collect::<HashMap<_, _>>();
    for (index, node) in nodes.iter_mut().enumerate() {
        if cached_positions.contains_key(&node.note_path) {
            continue;
        }
        let mut weighted_x = 0.0_f32;
        let mut weighted_y = 0.0_f32;
        let mut total_weight = 0.0_f32;
        for neighbor in knn_rows.get(index).into_iter().flatten() {
            let Some((x, y)) = cached_by_index.get(&neighbor.index).copied() else {
                continue;
            };
            let weight = neighbor.similarity.max(0.05);
            weighted_x += x * weight;
            weighted_y += y * weight;
            total_weight += weight;
        }
        if total_weight <= f32::EPSILON {
            continue;
        }
        let angle = stable_angle(&node.id);
        let jitter = 18.0 + (stable_hash(&node.id) % 700) as f32 / 100.0;
        node.x = weighted_x / total_weight + angle.cos() * jitter;
        node.y = weighted_y / total_weight + angle.sin() * jitter;
    }
}

/// Structural link weights may depend on durable note structure only. Activity
/// is an overlay (drift/staleness/search) and must not perturb graph topology,
/// centrality, clouds, or cached layout.
pub(super) fn boost_links(links: &mut [WorkingLink], nodes: &[WorkingNode]) {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    links.par_iter_mut().for_each(|link| {
        let Some(source) = node_by_id.get(link.source_id.as_str()) else {
            return;
        };
        let Some(target) = node_by_id.get(link.target_id.as_str()) else {
            return;
        };
        if parent_folder(&source.note_path) == parent_folder(&target.note_path) {
            link.strength += FOLDER_BOOST * (1.0 - link.strength);
        }
        link.strength = link.strength.clamp(0.0, 1.0);
    });
}

pub(super) fn apply_centrality(nodes: &mut [WorkingNode], links: &[WorkingLink]) {
    let mut totals = HashMap::<String, f32>::new();
    let mut degrees = HashMap::<String, usize>::new();
    for link in links {
        *totals.entry(link.source_id.clone()).or_default() += link.strength;
        *totals.entry(link.target_id.clone()).or_default() += link.strength;
        *degrees.entry(link.source_id.clone()).or_default() += 1;
        *degrees.entry(link.target_id.clone()).or_default() += 1;
    }
    let max_total = totals.values().copied().fold(0.0_f32, f32::max).max(1.0);
    for node in nodes {
        node.centrality = totals.get(&node.id).copied().unwrap_or(0.0) / max_total;
        let degree = degrees.get(&node.id).copied().unwrap_or(0);
        node.importance =
            (node.centrality * 0.72 + (degree as f32 / KNN_GRAPH_K as f32) * 0.28).clamp(0.0, 1.0);
    }
}

pub(super) fn build_layout_graph(nodes: &[WorkingNode], links: &[WorkingLink]) -> Vec<LayoutEdge> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<HashSet<_>>();
    let mut by_node = HashMap::<String, Vec<&WorkingLink>>::new();
    for link in links {
        if !node_ids.contains(&link.source_id) || !node_ids.contains(&link.target_id) {
            continue;
        }
        by_node
            .entry(link.source_id.clone())
            .or_default()
            .push(link);
        by_node
            .entry(link.target_id.clone())
            .or_default()
            .push(link);
    }

    let mut ranks = HashMap::<(String, String), (usize, usize)>::new();
    for (node_id, incident_links) in &mut by_node {
        incident_links.sort_by(|left, right| {
            (right.kind == "wikilink")
                .cmp(&(left.kind == "wikilink"))
                .then_with(|| right.strength.total_cmp(&left.strength))
                .then_with(|| left.source_id.cmp(&right.source_id))
                .then_with(|| left.target_id.cmp(&right.target_id))
        });
        for (rank, link) in incident_links.iter().enumerate() {
            let key = (link.source_id.clone(), link.target_id.clone());
            let entry = ranks.entry(key).or_insert((usize::MAX, usize::MAX));
            if link.source_id == *node_id {
                entry.0 = rank;
            } else {
                entry.1 = rank;
            }
        }
    }

    let mut candidates = links
        .iter()
        .filter(|link| {
            if !node_ids.contains(&link.source_id) || !node_ids.contains(&link.target_id) {
                return false;
            }
            if link.kind == "wikilink" || link.strength >= 0.78 {
                return true;
            }
            ranks
                .get(&(link.source_id.clone(), link.target_id.clone()))
                .is_some_and(|(source_rank, target_rank)| {
                    *source_rank < LAYOUT_LINKS_PER_NODE && *target_rank < LAYOUT_LINKS_PER_NODE
                })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        let left_kind = if left.kind == "wikilink" { 1 } else { 0 };
        let right_kind = if right.kind == "wikilink" { 1 } else { 0 };
        right_kind
            .cmp(&left_kind)
            .then_with(|| right.strength.total_cmp(&left.strength))
            .then_with(|| left.source_id.cmp(&right.source_id))
            .then_with(|| left.target_id.cmp(&right.target_id))
    });

    let mut selected = HashMap::<(String, String), f32>::new();
    let mut degrees = HashMap::<String, usize>::new();
    for link in candidates {
        let source_degree = degrees.get(&link.source_id).copied().unwrap_or(0);
        let target_degree = degrees.get(&link.target_id).copied().unwrap_or(0);
        if selected.contains_key(&(link.source_id.clone(), link.target_id.clone())) {
            continue;
        }
        if link.kind != "wikilink"
            && (source_degree >= LAYOUT_MAX_DEGREE || target_degree >= LAYOUT_MAX_DEGREE)
        {
            continue;
        }
        let weight = layout_link_weight(link);
        selected.insert((link.source_id.clone(), link.target_id.clone()), weight);
        degrees.insert(link.source_id.clone(), source_degree + 1);
        degrees.insert(link.target_id.clone(), target_degree + 1);
    }

    let index_by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut dsu = DisjointSet::new(nodes.len());
    let mut backbone = links
        .iter()
        .filter(|link| link.strength >= COMPONENT_MIN_STRENGTH || link.kind == "wikilink")
        .collect::<Vec<_>>();
    backbone.sort_by(|left, right| {
        right
            .strength
            .total_cmp(&left.strength)
            .then_with(|| left.source_id.cmp(&right.source_id))
            .then_with(|| left.target_id.cmp(&right.target_id))
    });
    for link in backbone {
        let (Some(&source), Some(&target)) = (
            index_by_id.get(&link.source_id),
            index_by_id.get(&link.target_id),
        ) else {
            continue;
        };
        if dsu.union(source, target) {
            let key = (link.source_id.clone(), link.target_id.clone());
            selected
                .entry(key)
                .or_insert_with(|| layout_link_weight(link));
        }
    }

    selected
        .into_iter()
        .map(|((source_id, target_id), weight)| LayoutEdge {
            source_id,
            target_id,
            weight,
        })
        .collect()
}

fn layout_link_weight(link: &WorkingLink) -> f32 {
    if link.kind == "wikilink" {
        (link.strength + 0.22).clamp(0.0, 1.0)
    } else {
        link.strength.clamp(0.0, 1.0)
    }
}

fn connected_components(nodes: &[WorkingNode], edges: &[LayoutEdge]) -> Vec<Vec<String>> {
    let mut adjacency = HashMap::<String, Vec<String>>::new();
    for node in nodes {
        adjacency.entry(node.id.clone()).or_default();
    }
    for edge in edges {
        if edge.weight < COMPONENT_MIN_STRENGTH {
            continue;
        }
        adjacency
            .entry(edge.source_id.clone())
            .or_default()
            .push(edge.target_id.clone());
        adjacency
            .entry(edge.target_id.clone())
            .or_default()
            .push(edge.source_id.clone());
    }

    let mut seen = HashSet::new();
    let mut components = Vec::new();
    for node in nodes {
        if !seen.insert(node.id.clone()) {
            continue;
        }
        let mut stack = vec![node.id.clone()];
        let mut component = Vec::new();
        while let Some(current) = stack.pop() {
            component.push(current.clone());
            if let Some(neighbors) = adjacency.get(&current) {
                for neighbor in neighbors {
                    if seen.insert(neighbor.clone()) {
                        stack.push(neighbor.clone());
                    }
                }
            }
        }
        component.sort();
        components.push(component);
    }
    components
}

#[cfg(test)]
pub(super) fn assign_clouds(nodes: &mut [WorkingNode], edges: &[LayoutEdge]) -> Vec<CloudSpec> {
    assign_clouds_with_promotion(nodes, edges, true)
}

pub(super) fn candidate_clouds(nodes: &mut [WorkingNode], edges: &[LayoutEdge]) -> Vec<CloudSpec> {
    assign_clouds_with_promotion(nodes, edges, false)
}

fn assign_clouds_with_promotion(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    promote: bool,
) -> Vec<CloudSpec> {
    let adjacency = build_edge_adjacency(edges);
    let components = connected_components(nodes, edges);
    let mut top_groups = components
        .into_par_iter()
        .flat_map(|component| {
            if component.len() < CLOUD_MIN_NOTES {
                return Vec::new();
            }
            partition_by_content(&component, nodes, edges, &adjacency)
        })
        .collect::<Vec<_>>();
    top_groups = merge_high_affinity_groups(top_groups, nodes, edges, &adjacency);
    let mut top_groups = if promote {
        promote_mature_subclouds(top_groups, nodes, edges, &adjacency, 1)
    } else {
        top_groups
            .into_iter()
            .map(|members| TopGroupPartition {
                members,
                precomputed_children: None,
            })
            .collect()
    };
    top_groups.sort_by(|left, right| {
        group_centrality(&right.members, nodes)
            .total_cmp(&group_centrality(&left.members, nodes))
            .then_with(|| right.members.len().cmp(&left.members.len()))
            .then_with(|| left.members[0].cmp(&right.members[0]))
    });

    cloud_specs_for_groups(
        nodes,
        edges,
        top_groups.into_iter().map(|g| g.members).collect(),
    )
}

pub(super) fn cloud_specs_for_groups(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    groups: Vec<Vec<String>>,
) -> Vec<CloudSpec> {
    let adjacency = build_edge_adjacency(edges);
    let top_groups = groups
        .into_iter()
        .map(|members| TopGroupPartition {
            members,
            precomputed_children: None,
        })
        .collect::<Vec<_>>();
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();

    // Detect child communities in parallel before assigning sequential cloud IDs.
    let prepared = top_groups
        .into_par_iter()
        .map(|top| {
            let group = top.members;
            let child_groups = match top.precomputed_children {
                Some(children) => children,
                None => detect_child_communities(&group, nodes, edges, &adjacency),
            };
            let centrality = group_centrality(&group, nodes);
            let centroid = centroid_for_ids(&group, nodes);
            (group, child_groups, centrality, centroid)
        })
        .collect::<Vec<_>>();

    let mut specs = Vec::<CloudSpec>::new();
    for (cloud_index, (group, child_groups, centrality, centroid)) in
        prepared.into_iter().enumerate()
    {
        let cloud_id = format!("cloud-{}", cloud_index + 1);
        for member_id in &group {
            if let Some(index) = node_index.get(member_id).copied() {
                nodes[index].cloud_id = Some(cloud_id.clone());
                nodes[index].parent_cloud_id = None;
                nodes[index].child_cloud_id = None;
                nodes[index].isolated = false;
            }
        }

        let mut child_cloud_ids = Vec::new();
        let mut child_specs = Vec::new();
        for (child_index, child_group) in child_groups.into_iter().enumerate() {
            let child_id = format!("{cloud_id}-child-{}", child_index + 1);
            for member_id in &child_group {
                if let Some(index) = node_index.get(member_id).copied() {
                    nodes[index].parent_cloud_id = Some(cloud_id.clone());
                    nodes[index].child_cloud_id = Some(child_id.clone());
                }
            }
            child_cloud_ids.push(child_id.clone());
            child_specs.push(CloudSpec {
                id: child_id,
                parent_id: Some(cloud_id.clone()),
                level: 1,
                radius: child_cloud_radius(child_group.len()),
                centrality: group_centrality(&child_group, nodes),
                centroid: centroid_for_ids(&child_group, nodes),
                member_node_ids: child_group,
                core_node_ids: Vec::new(),
                outlier_node_ids: Vec::new(),
                child_cloud_ids: Vec::new(),
            });
        }

        let child_area_radius = child_specs
            .iter()
            .map(|spec| spec.radius * spec.radius)
            .sum::<f32>()
            .sqrt()
            * 1.2;
        specs.push(CloudSpec {
            id: cloud_id,
            parent_id: None,
            level: 0,
            radius: top_cloud_radius(group.len()).max(child_area_radius + 58.0),
            centrality,
            centroid,
            member_node_ids: group,
            core_node_ids: Vec::new(),
            outlier_node_ids: Vec::new(),
            child_cloud_ids,
        });
        specs.extend(child_specs);
    }
    specs
}

fn homogeneous_theme(group: &[String], nodes: &[WorkingNode]) -> bool {
    let by_id = nodes
        .iter()
        .map(|n| (n.id.as_str(), n))
        .collect::<HashMap<_, _>>();
    let center = embedding_centroid(group, &by_id);
    !center.is_empty()
        && group.iter().all(|id| {
            by_id.get(id.as_str()).is_some_and(|n| {
                crate::semantic::similarity::cosine_similarity(&n.embedding, &center) >= 0.96
            })
        })
}

fn partition_by_content(
    group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    if group.len() < CLOUD_MIN_NOTES * 2 || homogeneous_theme(group, nodes) {
        return vec![group.to_vec()];
    }
    let resolution = structure_based_resolution(group, edges, adjacency);
    let seed = stable_hash(&group.join("\0"));
    let mut groups = leiden_partition_group(group, edges, adjacency, resolution, seed);
    if groups.len() <= 1 {
        groups = leiden_partition_group(
            group,
            edges,
            adjacency,
            (resolution * 1.75).min(4.5),
            seed ^ 0x9e37,
        );
    }
    if groups.len() <= 1 {
        let soft_target = TOP_CLOUD_SOFT_MAX.min(group.len()).max(CLOUD_MIN_NOTES * 2);
        let soft_max = group.len().div_ceil(CLOUD_MIN_NOTES).max(2);
        groups = seeded_partition_group(group, nodes, edges, adjacency, soft_target, soft_max);
    }
    groups = merge_small_groups(groups, nodes, edges, adjacency);
    groups = merge_high_affinity_groups(groups, nodes, edges, adjacency);
    groups.sort_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left.first().cmp(&right.first()))
    });
    if groups.is_empty() {
        vec![group.to_vec()]
    } else {
        groups
    }
}

fn structure_based_resolution(
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f64 {
    let n = group.len().max(1) as f64;
    let group_set = group.iter().cloned().collect::<HashSet<_>>();
    let mut seen = HashSet::<usize>::new();
    let mut strong_edge_count = 0usize;
    for id in group {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            if !seen.insert(edge_index) {
                continue;
            }
            let edge = &edges[edge_index];
            if edge.weight >= COMMUNITY_EDGE_MIN_STRENGTH
                && group_set.contains(&edge.source_id)
                && group_set.contains(&edge.target_id)
                && edge.source_id != edge.target_id
            {
                strong_edge_count += 1;
            }
        }
    }
    let density = (2.0 * strong_edge_count as f64) / (n * (n - 1.0)).max(1.0);
    // Higher resolution → more communities. Dense weak knn graphs need a push.
    let resolution = 1.35 + n.ln() * 0.28 - density * 0.55;
    resolution.clamp(1.1, 4.5)
}

fn partition_group(
    group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    target_size: usize,
    max_groups: usize,
) -> Vec<Vec<String>> {
    if group.len() < CLOUD_MIN_NOTES * 2 || max_groups <= 1 {
        return vec![group.to_vec()];
    }
    let desired_groups = group
        .len()
        .div_ceil(target_size.max(CLOUD_MIN_NOTES))
        .clamp(2, max_groups.max(2));
    let resolution = (desired_groups as f64 / group.len().max(1) as f64)
        .mul_add(14.0, 1.1)
        .clamp(1.1, 4.5);
    let seed = stable_hash(&group.join("\0"));
    let mut groups = leiden_partition_group(group, edges, adjacency, resolution, seed);
    if groups.len() <= 1 {
        groups = leiden_partition_group(
            group,
            edges,
            adjacency,
            (resolution * 1.6).min(4.5),
            seed ^ 0x51,
        );
    }
    if groups.len() <= 1 {
        groups = seeded_partition_group(group, nodes, edges, adjacency, target_size, max_groups);
    }
    groups = merge_small_groups(groups, nodes, edges, adjacency);
    groups = merge_high_affinity_groups(groups, nodes, edges, adjacency);
    if max_groups > 0 && groups.len() > max_groups {
        groups = merge_to_target_groups(groups, nodes, edges, adjacency, max_groups);
    }
    groups.sort_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left.first().cmp(&right.first()))
    });
    groups
}

fn leiden_partition_group(
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    resolution: f64,
    seed: u64,
) -> Vec<Vec<String>> {
    let index_by_id = group
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut builder = GraphDataBuilder::new(group.len());
    let mut edge_count = 0usize;
    let mut seen = HashSet::<usize>::new();
    for id in group {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            if !seen.insert(edge_index) {
                continue;
            }
            let edge = &edges[edge_index];
            let (Some(&source), Some(&target)) = (
                index_by_id.get(edge.source_id.as_str()),
                index_by_id.get(edge.target_id.as_str()),
            ) else {
                continue;
            };
            if source == target || edge.weight < COMMUNITY_EDGE_MIN_STRENGTH {
                continue;
            }
            if builder
                .add_edge(source, target, f64::from(edge.weight))
                .is_ok()
            {
                edge_count += 1;
            }
        }
    }
    if edge_count == 0 {
        return Vec::new();
    }
    let Ok(graph) = builder.build() else {
        return Vec::new();
    };
    let config = LeidenConfig::builder()
        .quality(QualityType::RBConfiguration)
        .resolution(resolution)
        .max_iterations(24)
        .min_iterations(2)
        .seed(seed)
        // Prefer the parallel local-moving path whenever the group is large
        // enough for leiden-rs (it still requires n >= 100 internally).
        .parallel_local_moving_threshold(1)
        .parallel_aggregation_threshold(1)
        .build();
    let Ok(result) = Leiden::new(config).run(&graph) else {
        return Vec::new();
    };
    let mut by_community = HashMap::<usize, Vec<String>>::new();
    for (index, id) in group.iter().enumerate() {
        by_community
            .entry(result.partition.community_of(index))
            .or_default()
            .push(id.clone());
    }
    let mut groups = by_community.into_values().collect::<Vec<_>>();
    for group in &mut groups {
        group.sort();
    }
    groups.sort_by(|left, right| left[0].cmp(&right[0]));
    groups
}

fn seeded_partition_group(
    group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    target_size: usize,
    max_groups: usize,
) -> Vec<Vec<String>> {
    let group_count = group
        .len()
        .div_ceil(target_size.max(CLOUD_MIN_NOTES))
        .clamp(2, max_groups.max(2));
    let seeds = choose_seed_ids(group, nodes, group_count);
    if seeds.len() < 2 {
        return vec![group.to_vec()];
    }
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let local_adjacency = adjacency_for_group(group, edges, adjacency);
    let seed_by_label = seeds
        .iter()
        .filter_map(|seed| {
            node_by_id
                .get(seed.as_str())
                .map(|node| (seed.clone(), *node))
        })
        .collect::<HashMap<_, _>>();
    let mut groups = HashMap::<String, Vec<String>>::new();
    for id in group {
        let Some(node) = node_by_id.get(id.as_str()) else {
            continue;
        };
        let label = seeds
            .iter()
            .max_by(|left, right| {
                let left_score =
                    seed_assignment_score(node, left, &seed_by_label, &local_adjacency);
                let right_score =
                    seed_assignment_score(node, right, &seed_by_label, &local_adjacency);
                left_score
                    .total_cmp(&right_score)
                    .then_with(|| right.cmp(left))
            })
            .cloned()
            .unwrap_or_else(|| id.clone());
        groups.entry(label).or_default().push(id.clone());
    }
    let mut groups = groups.into_values().collect::<Vec<_>>();
    for group in &mut groups {
        group.sort();
    }
    groups
}

fn choose_seed_ids(group: &[String], nodes: &[WorkingNode], count: usize) -> Vec<String> {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut candidates = group.to_vec();
    candidates.sort_by(|left, right| {
        let left_node = node_by_id.get(left.as_str());
        let right_node = node_by_id.get(right.as_str());
        right_node
            .map(|node| node.centrality)
            .unwrap_or(0.0)
            .total_cmp(&left_node.map(|node| node.centrality).unwrap_or(0.0))
            .then_with(|| left.cmp(right))
    });
    let mut seeds = Vec::<String>::new();
    if let Some(first) = candidates.first() {
        seeds.push(first.clone());
    }
    while seeds.len() < count && seeds.len() < candidates.len() {
        let Some(best) = candidates
            .iter()
            .filter(|candidate| !seeds.contains(candidate))
            .max_by(|left, right| {
                let left_score = seed_spread_score(left, &seeds, &node_by_id);
                let right_score = seed_spread_score(right, &seeds, &node_by_id);
                left_score
                    .total_cmp(&right_score)
                    .then_with(|| right.cmp(left))
            })
        else {
            break;
        };
        seeds.push(best.clone());
    }
    seeds
}

fn seed_spread_score(
    candidate: &str,
    seeds: &[String],
    node_by_id: &HashMap<&str, &WorkingNode>,
) -> f32 {
    let Some(candidate_node) = node_by_id.get(candidate) else {
        return 0.0;
    };
    let min_distance = seeds
        .iter()
        .filter_map(|seed| node_by_id.get(seed.as_str()))
        .map(|seed_node| {
            1.0 - atlas_cosine_similarity(&candidate_node.embedding, &seed_node.embedding)
        })
        .fold(1.0_f32, f32::min);
    min_distance + candidate_node.centrality * 0.35
}

fn seed_assignment_score(
    node: &WorkingNode,
    seed_id: &str,
    seed_by_label: &HashMap<String, &WorkingNode>,
    adjacency: &HashMap<String, Vec<(String, f32)>>,
) -> f32 {
    let semantic = seed_by_label
        .get(seed_id)
        .map(|seed| atlas_cosine_similarity(&node.embedding, &seed.embedding))
        .unwrap_or(0.0);
    let direct = adjacency
        .get(&node.id)
        .into_iter()
        .flatten()
        .find_map(|(neighbor, weight)| (neighbor == seed_id).then_some(*weight))
        .unwrap_or(0.0);
    semantic * 0.55 + direct * 0.45
}

fn adjacency_for_group(
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> HashMap<String, Vec<(String, f32)>> {
    let group_set = group.iter().cloned().collect::<HashSet<_>>();
    let mut local = HashMap::<String, Vec<(String, f32)>>::new();
    for id in group {
        local.entry(id.clone()).or_default();
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == *id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if group_set.contains(neighbor) {
                local
                    .entry(id.clone())
                    .or_default()
                    .push((neighbor.clone(), edge.weight));
            }
        }
    }
    local
}

fn merge_small_groups(
    mut groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    loop {
        let Some((small_index, _)) = groups
            .iter()
            .enumerate()
            .filter(|(_, group)| group.len() < CLOUD_MIN_NOTES)
            .min_by(|left, right| left.1.len().cmp(&right.1.len()))
        else {
            break;
        };
        let small_group = groups.remove(small_index);
        if groups.is_empty() {
            return if small_group.len() >= CLOUD_MIN_NOTES {
                vec![small_group]
            } else {
                Vec::new()
            };
        }
        let target_index = strongest_group_index(&small_group, &groups, nodes, edges, adjacency);
        groups[target_index].extend(small_group);
        groups[target_index].sort();
    }
    groups.retain(|group| group.len() >= CLOUD_MIN_NOTES);
    groups
}

fn merge_to_target_groups(
    mut groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    target: usize,
) -> Vec<Vec<String>> {
    if target == 0 {
        return Vec::new();
    }
    while groups.len() > target {
        let mut best_pair = None;
        let mut best_score = f32::MIN;
        for left in 0..groups.len() {
            for right in (left + 1)..groups.len() {
                let score = group_affinity(&groups[left], &groups[right], nodes, edges, adjacency);
                if score > best_score {
                    best_score = score;
                    best_pair = Some((left, right));
                }
            }
        }
        let Some((left, right)) = best_pair else {
            break;
        };
        let mut merged = groups.remove(right);
        groups[left].append(&mut merged);
        groups[left].sort();
    }
    groups
}

fn merge_high_affinity_groups(
    mut groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    loop {
        let mut best_pair = None;
        let mut best_score = f32::MIN;
        for left in 0..groups.len() {
            for right in (left + 1)..groups.len() {
                let score = group_affinity(&groups[left], &groups[right], nodes, edges, adjacency);
                if score >= HIGH_AFFINITY_MERGE_THRESHOLD && score > best_score {
                    best_score = score;
                    best_pair = Some((left, right));
                }
            }
        }
        let Some((left, right)) = best_pair else {
            break;
        };
        let mut merged = groups.remove(right);
        groups[left].append(&mut merged);
        groups[left].sort();
    }
    groups
}

fn promote_mature_subclouds(
    groups: Vec<Vec<String>>,
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    remaining_depth: usize,
) -> Vec<TopGroupPartition> {
    groups
        .into_par_iter()
        .flat_map(|group| {
            let child_groups = detect_child_communities(&group, nodes, edges, adjacency);
            let mature: Vec<Vec<String>> = child_groups
                .iter()
                .filter(|child| child.len() >= SUBCLOUD_PROMOTE_MIN)
                .cloned()
                .collect();
            let separation = if child_groups.len() >= 2 {
                partition_separation(&child_groups, edges, adjacency)
            } else {
                0.0
            };
            let should_promote = mature.len() >= 2
                && (group.len() >= TOP_CLOUD_SOFT_MAX
                    || separation >= CHILD_PARTITION_SEPARATION_MIN);

            if !should_promote {
                return vec![TopGroupPartition {
                    members: group,
                    precomputed_children: Some(child_groups),
                }];
            }

            let mature_ids: HashSet<String> = mature.iter().flatten().cloned().collect();
            let leftovers: Vec<String> = group
                .into_iter()
                .filter(|id| !mature_ids.contains(id))
                .collect();

            let mut next_groups = mature;
            if leftovers.len() >= CLOUD_MIN_NOTES {
                next_groups.push(leftovers);
            } else if !leftovers.is_empty() && !next_groups.is_empty() {
                let target =
                    strongest_group_index(&leftovers, &next_groups, nodes, edges, adjacency);
                next_groups[target].extend(leftovers);
                next_groups[target].sort();
            }

            if remaining_depth > 0 {
                promote_mature_subclouds(next_groups, nodes, edges, adjacency, remaining_depth - 1)
            } else {
                next_groups
                    .into_iter()
                    .map(|members| TopGroupPartition {
                        members,
                        precomputed_children: None,
                    })
                    .collect()
            }
        })
        .collect()
}

fn strongest_group_index(
    source: &[String],
    groups: &[Vec<String>],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> usize {
    groups
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| {
            let left_score = group_affinity(source, left, nodes, edges, adjacency);
            let right_score = group_affinity(source, right, nodes, edges, adjacency);
            left_score
                .total_cmp(&right_score)
                .then_with(|| right.len().cmp(&left.len()))
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn group_affinity(
    left: &[String],
    right: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let left_set = left.iter().cloned().collect::<HashSet<_>>();
    let right_set = right.iter().cloned().collect::<HashSet<_>>();
    let mut bridge_weight = 0.0_f32;
    let mut bridge_count = 0usize;
    let (scan_ids, other_set) = if left.len() <= right.len() {
        (left, &right_set)
    } else {
        (right, &left_set)
    };
    for id in scan_ids {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == *id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if !other_set.contains(neighbor) {
                continue;
            }
            let crosses = (left_set.contains(&edge.source_id)
                && right_set.contains(&edge.target_id))
                || (left_set.contains(&edge.target_id) && right_set.contains(&edge.source_id));
            if !crosses {
                continue;
            }
            bridge_weight += edge.weight;
            bridge_count += 1;
        }
    }
    let embedding = group_embedding_similarity(left, right, nodes);
    if bridge_count == 0 {
        // No structural link — only treat near-identical centroids as affinity.
        return if embedding >= 0.92 { embedding } else { 0.0 };
    }
    let mean_bridge = bridge_weight / bridge_count as f32;
    let possible = (left.len() * right.len()).max(1) as f32;
    let density = (bridge_count as f32 / possible).sqrt();
    // Require both strong and relatively dense bridges; sparse knn/wikilink
    // bridges alone should not collapse distinct communities.
    let bridge_score = mean_bridge * density;
    if embedding >= 0.92 && mean_bridge >= 0.55 {
        bridge_score.max(embedding * density.max(0.25))
    } else {
        bridge_score
    }
}

fn group_embedding_similarity(left: &[String], right: &[String], nodes: &[WorkingNode]) -> f32 {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let left_centroid = embedding_centroid(left, &node_by_id);
    let right_centroid = embedding_centroid(right, &node_by_id);
    atlas_cosine_similarity(&left_centroid, &right_centroid).max(0.0)
}

fn embedding_centroid(ids: &[String], node_by_id: &HashMap<&str, &WorkingNode>) -> Vec<f32> {
    let Some(dimensions) = ids
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()))
        .map(|node| node.embedding.len())
        .find(|len| *len > 0)
    else {
        return Vec::new();
    };
    let mut centroid = vec![0.0_f32; dimensions];
    let mut count = 0usize;
    for id in ids {
        let Some(node) = node_by_id.get(id.as_str()) else {
            continue;
        };
        if node.embedding.len() != dimensions {
            continue;
        }
        for (sum, value) in centroid.iter_mut().zip(&node.embedding) {
            *sum += *value;
        }
        count += 1;
    }
    if count > 0 {
        for value in &mut centroid {
            *value /= count as f32;
        }
    }
    centroid
}

fn detect_child_communities(
    parent_group: &[String],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Vec<Vec<String>> {
    if parent_group.len() < CHILD_CLOUD_MIN_NOTES * 2 || homogeneous_theme(parent_group, nodes) {
        return Vec::new();
    }
    let target_size = CHILD_TARGET_MAX_NOTES
        .min(parent_group.len())
        .max(CHILD_CLOUD_MIN_NOTES);
    let max_groups = parent_group.len().div_ceil(CHILD_CLOUD_MIN_NOTES).max(2);
    let mut groups = partition_group(
        parent_group,
        nodes,
        edges,
        adjacency,
        target_size,
        max_groups,
    );
    if groups.len() < 2
        || partition_separation(&groups, edges, adjacency) < CHILD_PARTITION_SEPARATION_MIN
    {
        return Vec::new();
    }

    for index in 0..groups.len() {
        let mut retained = Vec::new();
        let mut loose = Vec::new();
        let group = groups[index].clone();
        for id in group {
            let attachment = node_internal_affinity(&id, &groups[index], edges, adjacency);
            if groups[index].len().saturating_sub(loose.len()) > CLOUD_MIN_NOTES
                && attachment < 0.34
            {
                loose.push(id);
            } else {
                retained.push(id);
            }
        }
        groups[index] = retained;
        for loose_id in loose {
            let target = strongest_group_index(
                std::slice::from_ref(&loose_id),
                &groups,
                nodes,
                edges,
                adjacency,
            );
            if node_internal_affinity(&loose_id, &groups[target], edges, adjacency) >= 0.5 {
                groups[target].push(loose_id);
                groups[target].sort();
            }
        }
    }
    groups.retain(|group| group.len() >= CLOUD_MIN_NOTES);
    if groups.len() < 2 {
        Vec::new()
    } else {
        groups
    }
}

fn partition_separation(
    groups: &[Vec<String>],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let mut group_by_node = HashMap::<String, usize>::new();
    for (index, group) in groups.iter().enumerate() {
        for id in group {
            group_by_node.insert(id.clone(), index);
        }
    }
    let mut internal = 0.0_f32;
    let mut external = 0.0_f32;
    let mut seen = HashSet::<usize>::new();
    for id in group_by_node.keys() {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            if !seen.insert(edge_index) {
                continue;
            }
            let edge = &edges[edge_index];
            let (Some(source), Some(target)) = (
                group_by_node.get(&edge.source_id),
                group_by_node.get(&edge.target_id),
            ) else {
                continue;
            };
            if source == target {
                internal += edge.weight;
            } else {
                external += edge.weight;
            }
        }
    }
    if internal + external <= f32::EPSILON {
        return 0.0;
    }
    internal / (internal + external)
}

fn node_internal_affinity(
    node_id: &str,
    group: &[String],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let group_set = group.iter().cloned().collect::<HashSet<_>>();
    adjacency
        .get(node_id)
        .into_iter()
        .flatten()
        .filter_map(|&edge_index| {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == node_id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            group_set.contains(neighbor).then_some(edge.weight)
        })
        .sum()
}

fn group_centrality(group: &[String], nodes: &[WorkingNode]) -> f32 {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let total = group
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()))
        .map(|node| node.centrality)
        .sum::<f32>();
    total / group.len().max(1) as f32
}

fn centroid_for_ids(ids: &[String], nodes: &[WorkingNode]) -> [f32; 2] {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let refs = ids
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()).copied())
        .collect::<Vec<_>>();
    centroid(&refs)
}

fn top_cloud_radius(note_count: usize) -> f32 {
    (95.0 + (note_count as f32).sqrt() * 18.0).clamp(125.0, 420.0)
}

fn child_cloud_radius(note_count: usize) -> f32 {
    (38.0 + (note_count as f32).sqrt() * 13.0).clamp(58.0, 180.0)
}

pub(super) fn apply_umap_layout(nodes: &mut [WorkingNode], knn_rows: &[Vec<KnnNeighbor>]) -> bool {
    let n = nodes.len();
    let Some(dimensions) = nodes
        .iter()
        .map(|node| node.embedding.len())
        .find(|dimensions| *dimensions > 0)
    else {
        return false;
    };
    if n < 4
        || nodes.iter().any(|node| {
            node.embedding.len() != dimensions
                || node.embedding.iter().any(|value| !value.is_finite())
        })
    {
        return false;
    }
    let neighbor_count = KNN_GRAPH_K
        .min(n.saturating_sub(1))
        .clamp(2, n.saturating_sub(1));
    if neighbor_count >= n {
        return false;
    }

    let mut data = Array2::<f32>::zeros((n, dimensions));
    for (row, node) in nodes.iter().enumerate() {
        for (column, value) in node.embedding.iter().enumerate() {
            data[(row, column)] = *value;
        }
    }

    let completed_rows = complete_knn_rows_for_umap(nodes, knn_rows, neighbor_count);
    if completed_rows.iter().any(|row| row.len() != neighbor_count) {
        return false;
    }
    let mut knn_indices = Array2::<u32>::zeros((n, neighbor_count));
    let mut knn_dists = Array2::<f32>::zeros((n, neighbor_count));
    for (row_index, row) in completed_rows.iter().enumerate() {
        for (neighbor_index, neighbor) in row.iter().enumerate() {
            knn_indices[(row_index, neighbor_index)] = neighbor.index as u32;
            knn_dists[(row_index, neighbor_index)] = neighbor.distance;
        }
    }

    let mut init = Array2::<f32>::zeros((n, 2));
    for (index, node) in nodes.iter().enumerate() {
        init[(index, 0)] = node.x / 360.0;
        init[(index, 1)] = node.y / 360.0;
    }

    let config = UmapConfig {
        n_components: 2,
        graph: GraphParams {
            n_neighbors: neighbor_count,
            ..Default::default()
        },
        optimization: OptimizationParams {
            n_epochs: Some(umap_iterations_for_note_count(n)),
            learning_rate: 0.9,
            negative_sample_rate: 5,
            repulsion_strength: 1.15,
        },
        ..Default::default()
    };

    let result = catch_unwind(AssertUnwindSafe(|| {
        let umap = Umap::new(config);
        let fitted = umap.fit(
            data.view(),
            knn_indices.view(),
            knn_dists.view(),
            init.view(),
        );
        fitted.embedding().to_owned()
    }));
    let Ok(embedding) = result else {
        return false;
    };
    if embedding.nrows() != n
        || embedding.ncols() != 2
        || embedding.iter().any(|value| !value.is_finite())
    {
        return false;
    }
    apply_normalized_embedding(nodes, &embedding);
    true
}

fn umap_iterations_for_note_count(note_count: usize) -> usize {
    let scaled =
        UMAP_ITERATIONS_BASE as f32 + UMAP_ITERATIONS_SQRT_SCALE * (note_count as f32).sqrt();
    (scaled.round() as usize).clamp(UMAP_ITERATIONS_BASE, UMAP_ITERATIONS_MAX)
}

fn complete_knn_rows_for_umap(
    nodes: &[WorkingNode],
    knn_rows: &[Vec<KnnNeighbor>],
    neighbor_count: usize,
) -> Vec<Vec<KnnNeighbor>> {
    let mut completed = knn_rows
        .par_iter()
        .enumerate()
        .map(|(row_index, row)| {
            let mut merged = Vec::<KnnNeighbor>::with_capacity(neighbor_count);
            for neighbor in row {
                if neighbor.index != row_index {
                    push_unique_neighbor(&mut merged, neighbor.index, neighbor.similarity);
                }
                if merged.len() == neighbor_count {
                    break;
                }
            }
            merged.sort_by(|left, right| {
                right
                    .similarity
                    .total_cmp(&left.similarity)
                    .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
            });
            merged.truncate(neighbor_count);
            merged
        })
        .collect::<Vec<_>>();

    let deficient_indices = completed
        .iter()
        .enumerate()
        .filter_map(|(row_index, merged)| {
            if merged.len() < neighbor_count {
                Some(row_index)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    if deficient_indices.is_empty() {
        return completed;
    }

    // Exact-fill only rows that HNSW left short — never an unconditional all-pairs pass.
    let exact_rows = exact_knn_rows(nodes, neighbor_count);
    for row_index in deficient_indices {
        let Some(exact_row) = exact_rows.get(row_index) else {
            continue;
        };
        let merged = &mut completed[row_index];
        for neighbor in exact_row {
            push_unique_neighbor(merged, neighbor.index, neighbor.similarity);
            if merged.len() == neighbor_count {
                break;
            }
        }
        merged.sort_by(|left, right| {
            right
                .similarity
                .total_cmp(&left.similarity)
                .then_with(|| nodes[left.index].id.cmp(&nodes[right.index].id))
        });
        merged.truncate(neighbor_count);
    }
    completed
}

fn apply_normalized_embedding(nodes: &mut [WorkingNode], embedding: &Array2<f32>) {
    let min_x = embedding
        .column(0)
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max_x = embedding
        .column(0)
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = embedding
        .column(1)
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max_y = embedding
        .column(1)
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let width = (max_x - min_x).abs().max(0.000_1);
    let height = (max_y - min_y).abs().max(0.000_1);
    let target_span = (nodes.len() as f32).sqrt().clamp(4.0, 36.0) * 170.0;
    let scale = target_span / width.max(height);
    let center_x = (min_x + max_x) / 2.0;
    let center_y = (min_y + max_y) / 2.0;
    nodes.par_iter_mut().enumerate().for_each(|(index, node)| {
        node.x = (embedding[(index, 0)] - center_x) * scale;
        node.y = (embedding[(index, 1)] - center_y) * scale;
    });
}

pub(super) fn refresh_cloud_geometry(specs: &mut [CloudSpec], nodes: &[WorkingNode]) {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let updates = specs
        .par_iter()
        .map(|spec| {
            let centroid = centroid_for_ids(&spec.member_node_ids, nodes);
            let member_radius = spec
                .member_node_ids
                .iter()
                .filter_map(|id| node_by_id.get(id.as_str()).copied())
                .map(|node| distance([node.x, node.y], centroid))
                .fold(0.0_f32, f32::max);
            let base = if spec.level == 0 {
                top_cloud_radius(spec.member_node_ids.len())
            } else {
                child_cloud_radius(spec.member_node_ids.len())
            };
            let radius = base.max(member_radius + if spec.level == 0 { 86.0 } else { 44.0 });
            (centroid, radius)
        })
        .collect::<Vec<_>>();
    for (spec, (centroid, radius)) in specs.iter_mut().zip(updates) {
        spec.centroid = centroid;
        spec.radius = radius;
    }
}

pub(super) fn separate_umap_clouds(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
    layout_pull: f32,
) {
    refresh_cloud_geometry(specs, nodes);
    compact_cloud_members(nodes, specs, 0);
    refresh_cloud_geometry(specs, nodes);

    let previous_top_centers = specs
        .iter()
        .filter(|spec| spec.level == 0)
        .map(|spec| (spec.id.clone(), spec.centroid))
        .collect::<HashMap<_, _>>();
    place_top_level_clouds(specs, edges, layout_pull);
    translate_cloud_members(nodes, specs, previous_top_centers, 0);
    refresh_cloud_geometry(specs, nodes);

    compact_cloud_members(nodes, specs, 1);
    refresh_cloud_geometry(specs, nodes);
    separate_child_umap_clouds(nodes, edges, specs);
    refresh_cloud_geometry(specs, nodes);
}

fn compact_cloud_members(nodes: &mut [WorkingNode], specs: &[CloudSpec], level: usize) {
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for spec in specs.iter().filter(|spec| spec.level == level) {
        let center = spec.centroid;
        let target_radius = if spec.level == 0 {
            top_cloud_radius(spec.member_node_ids.len()) * 0.58
        } else {
            child_cloud_radius(spec.member_node_ids.len()) * 0.54
        }
        .max(34.0);
        let member_indices = spec
            .member_node_ids
            .iter()
            .filter_map(|id| node_index.get(id).copied())
            .collect::<Vec<_>>();
        let max_distance = member_indices
            .iter()
            .map(|index| distance([nodes[*index].x, nodes[*index].y], center))
            .fold(0.0_f32, f32::max);
        if max_distance <= target_radius || max_distance <= 1.0 {
            continue;
        }
        let scale = target_radius / max_distance;
        for index in member_indices {
            nodes[index].x = center[0] + (nodes[index].x - center[0]) * scale;
            nodes[index].y = center[1] + (nodes[index].y - center[1]) * scale;
        }
    }
}

fn translate_cloud_members(
    nodes: &mut [WorkingNode],
    specs: &[CloudSpec],
    previous_centers: HashMap<String, [f32; 2]>,
    level: usize,
) {
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for spec in specs.iter().filter(|spec| spec.level == level) {
        let Some(previous) = previous_centers.get(&spec.id).copied() else {
            continue;
        };
        let delta = [
            spec.centroid[0] - previous[0],
            spec.centroid[1] - previous[1],
        ];
        for member_id in &spec.member_node_ids {
            if let Some(index) = node_index.get(member_id).copied() {
                nodes[index].x += delta[0];
                nodes[index].y += delta[1];
            }
        }
    }
}

fn separate_child_umap_clouds(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
) {
    let top_ids = specs
        .iter()
        .filter(|spec| spec.level == 0)
        .map(|spec| spec.id.clone())
        .collect::<Vec<_>>();
    let spec_index = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| (spec.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for top_id in top_ids {
        let Some(&top_index) = spec_index.get(&top_id) else {
            continue;
        };
        let child_indices = specs[top_index]
            .child_cloud_ids
            .iter()
            .filter_map(|id| spec_index.get(id).copied())
            .collect::<Vec<_>>();
        if child_indices.len() < 2 {
            continue;
        }
        let previous_child_centers = child_indices
            .iter()
            .map(|index| (specs[*index].id.clone(), specs[*index].centroid))
            .collect::<HashMap<_, _>>();
        place_child_centers(top_index, &child_indices, specs, edges);
        translate_cloud_members(nodes, specs, previous_child_centers, 1);
    }
}

pub(super) fn place_cloud_first_layout(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
    layout_pull: f32,
) {
    place_top_level_clouds(specs, edges, layout_pull);
    place_child_clouds_and_notes(nodes, edges, specs);
}

fn place_top_level_clouds(specs: &mut [CloudSpec], edges: &[LayoutEdge], layout_pull: f32) {
    let adjacency = build_edge_adjacency(edges);
    let top_indices = specs
        .iter()
        .enumerate()
        .filter(|(_, spec)| spec.level == 0)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if top_indices.is_empty() {
        return;
    }
    let mut order = top_indices.clone();
    order.sort_by(|left, right| {
        specs[*right]
            .centrality
            .total_cmp(&specs[*left].centrality)
            .then_with(|| {
                specs[*right]
                    .member_node_ids
                    .len()
                    .cmp(&specs[*left].member_node_ids.len())
            })
            .then_with(|| specs[*left].id.cmp(&specs[*right].id))
    });

    let mut placed = Vec::<usize>::new();
    for &index in &order {
        if placed.is_empty() {
            specs[index].centroid = [0.0, 0.0];
            placed.push(index);
            continue;
        }
        let related_anchor = related_cloud_anchor(index, &placed, specs, edges, &adjacency);
        let anchor = related_anchor.unwrap_or([0.0, 0.0]);
        let placement_gap = if related_anchor.is_some() {
            TOP_LEVEL_CLOUD_GAP
        } else {
            TOP_LEVEL_CLOUD_GAP + specs[index].radius * 0.35 + 120.0
        };
        specs[index].centroid =
            find_non_overlapping_center(&specs[index], &placed, specs, anchor, placement_gap);
        placed.push(index);
    }

    relax_cloud_centers(
        &top_indices,
        specs,
        edges,
        &adjacency,
        TOP_LEVEL_CLOUD_GAP,
        layout_pull,
        150,
    );
    // Jacobi-style overlap resolve (parallel per iteration). Fewer passes than
    // the old 1200-step Gauss-Seidel loop, which pinned a single core for ages.
    enforce_cloud_non_overlap(&top_indices, specs, TOP_LEVEL_CLOUD_GAP, 360);
    let anchor = order[0];
    let offset = specs[anchor].centroid;
    for &index in &top_indices {
        specs[index].centroid[0] -= offset[0];
        specs[index].centroid[1] -= offset[1];
    }
}

fn related_cloud_anchor(
    index: usize,
    placed: &[usize],
    specs: &[CloudSpec],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> Option<[f32; 2]> {
    let mut total_weight = 0.0_f32;
    let mut anchor = [0.0_f32, 0.0_f32];
    for &placed_index in placed {
        let affinity = cloud_affinity(&specs[index], &specs[placed_index], edges, adjacency);
        if affinity <= 0.0 {
            continue;
        }
        total_weight += affinity;
        anchor[0] += specs[placed_index].centroid[0] * affinity;
        anchor[1] += specs[placed_index].centroid[1] * affinity;
    }
    if total_weight <= f32::EPSILON {
        None
    } else {
        Some([anchor[0] / total_weight, anchor[1] / total_weight])
    }
}

fn find_non_overlapping_center(
    spec: &CloudSpec,
    placed: &[usize],
    specs: &[CloudSpec],
    anchor: [f32; 2],
    gap: f32,
) -> [f32; 2] {
    let phase = stable_angle(&spec.id);
    let best = (0..320_u32)
        .into_par_iter()
        .filter_map(|step| {
            let ring = (step / 24) as f32;
            let angle = phase + step as f32 * 2.399_963_1;
            let distance = spec.radius + gap + 70.0 + ring * (spec.radius * 0.22 + 58.0);
            let candidate = [
                anchor[0] + angle.cos() * distance,
                anchor[1] + angle.sin() * distance,
            ];
            if !cloud_center_overlaps(candidate, spec.radius, placed, specs, gap) {
                let score = squared_distance(candidate, anchor)
                    + squared_distance(candidate, [0.0, 0.0]) * 0.08;
                Some((candidate, score))
            } else {
                None
            }
        })
        .min_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.0[0].total_cmp(&right.0[0]))
                .then_with(|| left.0[1].total_cmp(&right.0[1]))
        });
    best.map(|(candidate, _)| candidate).unwrap_or_else(|| {
        let fallback_distance =
            placed.iter().map(|index| specs[*index].radius).sum::<f32>() + spec.radius + gap;
        [
            anchor[0] + phase.cos() * fallback_distance,
            anchor[1] + phase.sin() * fallback_distance,
        ]
    })
}

fn find_non_overlapping_child_center(
    spec: &CloudSpec,
    placed: &[usize],
    specs: &[CloudSpec],
    anchor: [f32; 2],
    parent_center: [f32; 2],
    gap: f32,
) -> [f32; 2] {
    let phase = stable_angle(&spec.id);
    let mut best = None;
    let mut best_score = f32::MAX;
    for step in 0..420 {
        let ring = (step / 36) as f32;
        let angle = phase + step as f32 * 2.399_963_1;
        let distance = spec.radius + gap + 8.0 + ring * 22.0;
        let candidate = [
            anchor[0] + angle.cos() * distance,
            anchor[1] + angle.sin() * distance,
        ];
        if !cloud_center_overlaps(candidate, spec.radius, placed, specs, gap) {
            let score = squared_distance(candidate, anchor)
                + squared_distance(candidate, parent_center) * 0.22;
            if score < best_score {
                best = Some(candidate);
                best_score = score;
            }
        }
    }
    best.unwrap_or_else(|| {
        let fallback_distance =
            placed.iter().map(|index| specs[*index].radius).sum::<f32>() + spec.radius + gap;
        [
            parent_center[0] + phase.cos() * fallback_distance,
            parent_center[1] + phase.sin() * fallback_distance,
        ]
    })
}

fn cloud_center_overlaps(
    center: [f32; 2],
    radius: f32,
    placed: &[usize],
    specs: &[CloudSpec],
    gap: f32,
) -> bool {
    placed.iter().any(|index| {
        let other = &specs[*index];
        distance(center, other.centroid) < radius + other.radius + gap
    })
}

fn cloud_index_pairs(indices: &[usize]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::with_capacity(indices.len().saturating_mul(indices.len()) / 2);
    for left_offset in 0..indices.len() {
        for right_offset in (left_offset + 1)..indices.len() {
            pairs.push((indices[left_offset], indices[right_offset]));
        }
    }
    pairs
}

fn relax_cloud_centers(
    indices: &[usize],
    specs: &mut [CloudSpec],
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
    gap: f32,
    layout_pull: f32,
    iterations: usize,
) {
    let pairs = cloud_index_pairs(indices);
    for _ in 0..iterations {
        let pair_deltas = pairs
            .par_iter()
            .filter_map(|&(left, right)| {
                let dx = specs[left].centroid[0] - specs[right].centroid[0];
                let dy = specs[left].centroid[1] - specs[right].centroid[1];
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = specs[left].radius + specs[right].radius + gap;
                let mut left_delta = [0.0_f32, 0.0_f32];
                let mut right_delta = [0.0_f32, 0.0_f32];
                if dist < desired {
                    let force = ((desired - dist) / desired).min(1.0) * 16.0;
                    left_delta[0] += dx / dist * force;
                    left_delta[1] += dy / dist * force;
                    right_delta[0] -= dx / dist * force;
                    right_delta[1] -= dy / dist * force;
                }
                let affinity = cloud_affinity(&specs[left], &specs[right], edges, adjacency);
                if affinity > 0.0 && dist > desired + 80.0 {
                    let target = desired + (260.0 - affinity.min(8.0) * 18.0).max(64.0);
                    if dist > target {
                        let force =
                            ((dist - target) / dist) * affinity.min(8.0) * 0.24 * layout_pull;
                        left_delta[0] -= dx / dist * force;
                        left_delta[1] -= dy / dist * force;
                        right_delta[0] += dx / dist * force;
                        right_delta[1] += dy / dist * force;
                    }
                }
                if left_delta == [0.0, 0.0] && right_delta == [0.0, 0.0] {
                    None
                } else {
                    Some((left, left_delta, right, right_delta))
                }
            })
            .collect::<Vec<_>>();

        let mut deltas = HashMap::<usize, [f32; 2]>::new();
        for (left, left_delta, right, right_delta) in pair_deltas {
            add_delta(&mut deltas, left, left_delta);
            add_delta(&mut deltas, right, right_delta);
        }
        for &index in indices {
            let center = specs[index].centroid;
            add_delta(&mut deltas, index, [-center[0] * 0.002, -center[1] * 0.002]);
        }
        for (&index, delta) in &deltas {
            specs[index].centroid[0] += delta[0].clamp(-24.0, 24.0);
            specs[index].centroid[1] += delta[1].clamp(-24.0, 24.0);
        }
    }
}

fn enforce_cloud_non_overlap(
    indices: &[usize],
    specs: &mut [CloudSpec],
    gap: f32,
    iterations: usize,
) {
    let pairs = cloud_index_pairs(indices);
    for _ in 0..iterations {
        let pushes = pairs
            .par_iter()
            .filter_map(|&(left, right)| {
                let dx = specs[left].centroid[0] - specs[right].centroid[0];
                let dy = specs[left].centroid[1] - specs[right].centroid[1];
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = specs[left].radius + specs[right].radius + gap;
                if dist >= desired {
                    return None;
                }
                let push = (desired - dist) / 2.0 + 0.5;
                Some((
                    left,
                    [dx / dist * push, dy / dist * push],
                    right,
                    [-dx / dist * push, -dy / dist * push],
                ))
            })
            .collect::<Vec<_>>();
        if pushes.is_empty() {
            break;
        }
        let mut deltas = HashMap::<usize, [f32; 2]>::new();
        for (left, left_delta, right, right_delta) in pushes {
            add_delta(&mut deltas, left, left_delta);
            add_delta(&mut deltas, right, right_delta);
        }
        for (index, delta) in deltas {
            specs[index].centroid[0] += delta[0];
            specs[index].centroid[1] += delta[1];
        }
    }
}

fn place_child_clouds_and_notes(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
) {
    let top_ids = specs
        .iter()
        .filter(|spec| spec.level == 0)
        .map(|spec| spec.id.clone())
        .collect::<Vec<_>>();
    let spec_index = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| (spec.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for top_id in top_ids {
        let Some(&top_index) = spec_index.get(&top_id) else {
            continue;
        };
        let child_indices = specs[top_index]
            .child_cloud_ids
            .iter()
            .filter_map(|id| spec_index.get(id).copied())
            .collect::<Vec<_>>();
        if child_indices.is_empty() {
            layout_notes_in_disc(
                nodes,
                &specs[top_index].member_node_ids,
                specs[top_index].centroid,
                specs[top_index].radius * 0.72,
                edges,
            );
            continue;
        }

        place_child_centers(top_index, &child_indices, specs, edges);
        for &child_index in &child_indices {
            layout_notes_in_disc(
                nodes,
                &specs[child_index].member_node_ids,
                specs[child_index].centroid,
                specs[child_index].radius * 0.62,
                edges,
            );
        }

        let child_members = child_indices
            .iter()
            .flat_map(|index| specs[*index].member_node_ids.iter().cloned())
            .collect::<HashSet<_>>();
        let loose_members = specs[top_index]
            .member_node_ids
            .iter()
            .filter(|id| !child_members.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        if !loose_members.is_empty() {
            layout_notes_in_disc(
                nodes,
                &loose_members,
                specs[top_index].centroid,
                specs[top_index].radius * 0.78,
                edges,
            );
        }
    }
}

fn place_child_centers(
    parent_index: usize,
    child_indices: &[usize],
    specs: &mut [CloudSpec],
    edges: &[LayoutEdge],
) {
    let adjacency = build_edge_adjacency(edges);
    let parent_center = specs[parent_index].centroid;
    let parent_radius = specs[parent_index].radius;
    let mut order = child_indices.to_vec();
    order.sort_by(|left, right| {
        specs[*right]
            .centrality
            .total_cmp(&specs[*left].centrality)
            .then_with(|| {
                specs[*right]
                    .member_node_ids
                    .len()
                    .cmp(&specs[*left].member_node_ids.len())
            })
            .then_with(|| specs[*left].id.cmp(&specs[*right].id))
    });
    let mut placed = Vec::<usize>::new();
    for &index in &order {
        if placed.is_empty() {
            specs[index].centroid = parent_center;
            placed.push(index);
            continue;
        }
        let anchor =
            related_cloud_anchor(index, &placed, specs, edges, &adjacency).unwrap_or(parent_center);
        let mut center = find_non_overlapping_child_center(
            &specs[index],
            &placed,
            specs,
            anchor,
            parent_center,
            CHILD_CLOUD_GAP,
        );
        let max_dist =
            (parent_radius - specs[index].radius - CHILD_CLOUD_GAP).max(specs[index].radius);
        let from_parent = [center[0] - parent_center[0], center[1] - parent_center[1]];
        let dist = (from_parent[0] * from_parent[0] + from_parent[1] * from_parent[1]).sqrt();
        if dist > max_dist && dist > 1.0 {
            center = [
                parent_center[0] + from_parent[0] / dist * max_dist,
                parent_center[1] + from_parent[1] / dist * max_dist,
            ];
        }
        specs[index].centroid = center;
        placed.push(index);
    }
    relax_cloud_centers(
        child_indices,
        specs,
        edges,
        &adjacency,
        CHILD_CLOUD_GAP,
        0.72,
        90,
    );
    compact_child_centers(parent_index, child_indices, specs);
    enforce_cloud_non_overlap(child_indices, specs, CHILD_CLOUD_GAP, 90);
}

fn compact_child_centers(parent_index: usize, child_indices: &[usize], specs: &mut [CloudSpec]) {
    let parent_center = specs[parent_index].centroid;
    let parent_radius = specs[parent_index].radius;
    let max_extent = child_indices
        .iter()
        .map(|index| distance(specs[*index].centroid, parent_center) + specs[*index].radius)
        .fold(0.0_f32, f32::max);
    let target_extent = parent_radius * 0.68;
    if max_extent <= target_extent || max_extent <= 1.0 {
        return;
    }
    let scale = (target_extent / max_extent).clamp(0.72, 1.0);
    for &index in child_indices {
        specs[index].centroid = [
            parent_center[0] + (specs[index].centroid[0] - parent_center[0]) * scale,
            parent_center[1] + (specs[index].centroid[1] - parent_center[1]) * scale,
        ];
    }
}

fn layout_notes_in_disc(
    nodes: &mut [WorkingNode],
    member_ids: &[String],
    center: [f32; 2],
    radius: f32,
    edges: &[LayoutEdge],
) {
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut members = member_ids
        .iter()
        .filter_map(|id| node_index.get(id).copied())
        .collect::<Vec<_>>();
    members.sort_by(|left, right| nodes[*left].id.cmp(&nodes[*right].id));
    if members.is_empty() {
        return;
    }
    let inner_radius = radius.max(36.0);
    let count = members.len().max(1) as f32;
    for (ordinal, &index) in members.iter().enumerate() {
        let phase = stable_angle(&nodes[index].id);
        let angle = phase + ordinal as f32 * 2.399_963_1;
        let normalized = ((ordinal + 1) as f32 / (count + 1.0)).sqrt();
        let jitter = 0.72 + ((stable_hash(&nodes[index].id) >> 16) % 1000) as f32 / 1000.0 * 0.22;
        let distance = inner_radius * normalized * jitter;
        nodes[index].x = center[0] + angle.cos() * distance;
        nodes[index].y = center[1] + angle.sin() * distance;
    }

    let member_set = member_ids.iter().cloned().collect::<HashSet<_>>();
    let local_edges = edges
        .iter()
        .filter(|edge| member_set.contains(&edge.source_id) && member_set.contains(&edge.target_id))
        .collect::<Vec<_>>();
    for _ in 0..54 {
        let mut deltas = HashMap::<usize, [f32; 2]>::new();
        apply_disc_repulsion(nodes, &members, &mut deltas);
        for edge in &local_edges {
            let (Some(&source), Some(&target)) = (
                node_index.get(&edge.source_id),
                node_index.get(&edge.target_id),
            ) else {
                continue;
            };
            let dx = nodes[target].x - nodes[source].x;
            let dy = nodes[target].y - nodes[source].y;
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            let desired = 34.0 + (1.0 - edge.weight) * 58.0;
            let force = (dist - desired) * 0.018 * edge.weight;
            add_delta(&mut deltas, source, [dx / dist * force, dy / dist * force]);
            add_delta(
                &mut deltas,
                target,
                [-dx / dist * force, -dy / dist * force],
            );
        }
        for &index in &members {
            let dx = nodes[index].x - center[0];
            let dy = nodes[index].y - center[1];
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            if dist > inner_radius {
                let force = (dist - inner_radius) * 0.22;
                add_delta(&mut deltas, index, [-dx / dist * force, -dy / dist * force]);
            }
        }
        for (&index, delta) in &deltas {
            nodes[index].x += delta[0].clamp(-8.0, 8.0);
            nodes[index].y += delta[1].clamp(-8.0, 8.0);
        }
    }
}

fn apply_disc_repulsion(
    nodes: &[WorkingNode],
    members: &[usize],
    deltas: &mut HashMap<usize, [f32; 2]>,
) {
    if members.len() <= DISC_LAYOUT_FULL_PAIR_MAX {
        let pairs = (0..members.len())
            .flat_map(|left_offset| {
                ((left_offset + 1)..members.len())
                    .map(move |right_offset| (members[left_offset], members[right_offset]))
            })
            .collect::<Vec<_>>();
        let pair_deltas = pairs
            .par_iter()
            .filter_map(|&(left, right)| {
                let dx = nodes[left].x - nodes[right].x;
                let dy = nodes[left].y - nodes[right].y;
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = nodes[left].centrality.max(nodes[right].centrality) * 3.0 + 18.0;
                if dist >= desired {
                    return None;
                }
                let force = (desired - dist) * 0.18;
                Some((
                    left,
                    [dx / dist * force, dy / dist * force],
                    right,
                    [-dx / dist * force, -dy / dist * force],
                ))
            })
            .collect::<Vec<_>>();
        for (left, left_delta, right, right_delta) in pair_deltas {
            add_delta(deltas, left, left_delta);
            add_delta(deltas, right, right_delta);
        }
        return;
    }

    // Large clouds: only repel against nearest spatial neighbors instead of all pairs.
    let nearest_deltas = members
        .par_iter()
        .enumerate()
        .map(|(left_offset, &left)| {
            let mut nearest = members
                .iter()
                .enumerate()
                .filter(|(right_offset, _)| *right_offset != left_offset)
                .map(|(_, &right)| {
                    let dx = nodes[left].x - nodes[right].x;
                    let dy = nodes[left].y - nodes[right].y;
                    (right, dx * dx + dy * dy)
                })
                .collect::<Vec<_>>();
            nearest.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
            nearest.truncate(DISC_LAYOUT_REPULSION_NEIGHBORS);
            let mut local = Vec::new();
            for (right, _) in nearest {
                // Only emit each unordered pair once to avoid double-counting.
                if left >= right {
                    continue;
                }
                let dx = nodes[left].x - nodes[right].x;
                let dy = nodes[left].y - nodes[right].y;
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let desired = nodes[left].centrality.max(nodes[right].centrality) * 3.0 + 18.0;
                if dist < desired {
                    let force = (desired - dist) * 0.18;
                    local.push((
                        left,
                        [dx / dist * force, dy / dist * force],
                        right,
                        [-dx / dist * force, -dy / dist * force],
                    ));
                }
            }
            local
        })
        .flatten()
        .collect::<Vec<_>>();
    for (left, left_delta, right, right_delta) in nearest_deltas {
        add_delta(deltas, left, left_delta);
        add_delta(deltas, right, right_delta);
    }
}

pub(super) fn finalize_cloud_cores(
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
    specs: &mut [CloudSpec],
) {
    let adjacency = build_edge_adjacency(edges);
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let cores = specs
        .par_iter()
        .map(|spec| {
            let members = spec
                .member_node_ids
                .iter()
                .filter_map(|id| node_by_id.get(id.as_str()).copied())
                .collect::<Vec<_>>();
            if members.is_empty() {
                return (Vec::new(), Vec::new());
            }
            let mut distances = members
                .iter()
                .map(|node| {
                    let dx = node.x - spec.centroid[0];
                    let dy = node.y - spec.centroid[1];
                    (node.id.clone(), (dx * dx + dy * dy).sqrt())
                })
                .collect::<Vec<_>>();
            distances.sort_by(|left, right| {
                left.1
                    .total_cmp(&right.1)
                    .then_with(|| left.0.cmp(&right.0))
            });
            let threshold = robust_distance_threshold(&distances);
            let mut core = Vec::new();
            let mut outliers = Vec::new();
            for (id, dist) in distances {
                let affinity =
                    node_internal_affinity(&id, &spec.member_node_ids, edges, &adjacency);
                if spec.member_node_ids.len().saturating_sub(outliers.len()) > CLOUD_MIN_NOTES
                    && dist > threshold
                    && affinity < 0.55
                {
                    outliers.push(id);
                } else {
                    core.push(id);
                }
            }
            if core.len() < CLOUD_MIN_NOTES {
                (spec.member_node_ids.clone(), Vec::new())
            } else {
                (core, outliers)
            }
        })
        .collect::<Vec<_>>();
    for (spec, (core, outliers)) in specs.iter_mut().zip(cores) {
        spec.core_node_ids = core;
        spec.outlier_node_ids = outliers;
    }
}

fn robust_distance_threshold(distances: &[(String, f32)]) -> f32 {
    if distances.len() < 5 {
        return f32::MAX;
    }
    let q1 = distances[distances.len() / 4].1;
    let q3 = distances[(distances.len() * 3) / 4].1;
    let iqr = (q3 - q1).max(24.0);
    q3 + iqr * 1.35
}

/// Assemble semantic metadata; accepted-layout contour construction supplies the hull.
pub(super) fn cloud_metadata(
    spec: &CloudSpec,
    nodes: &[WorkingNode],
    links: &[WorkingLink],
) -> AtlasCloud {
    let member_set = spec.member_node_ids.iter().cloned().collect::<HashSet<_>>();
    let core_set = if spec.core_node_ids.is_empty() {
        member_set.clone()
    } else {
        spec.core_node_ids.iter().cloned().collect::<HashSet<_>>()
    };
    let members = nodes
        .iter()
        .filter(|node| member_set.contains(&node.id))
        .collect::<Vec<_>>();
    let core_members = nodes
        .iter()
        .filter(|node| core_set.contains(&node.id))
        .collect::<Vec<_>>();
    let note_count = members.len();
    let density = cloud_density(links, &member_set, note_count);
    let label_members = if core_members.is_empty() {
        members.clone()
    } else {
        core_members.clone()
    };
    let label_notes = label_members
        .iter()
        .map(|node| AtlasLabelNote {
            id: node.id.clone(),
            title: node.title.clone(),
            tags: node.tags.clone(),
            embedding: node.embedding.clone(),
        })
        .collect::<Vec<_>>();
    let label_refs = label_notes.iter().collect::<Vec<_>>();
    let label = medoid_placeholder(&label_refs);
    let representative_node_ids = {
        let mut ranked = members.to_vec();
        ranked.sort_by(|left, right| {
            right
                .centrality
                .total_cmp(&left.centrality)
                .then_with(|| left.title.cmp(&right.title))
        });
        ranked
            .into_iter()
            .take(5)
            .map(|node| node.id.clone())
            .collect::<Vec<_>>()
    };

    AtlasCloud {
        user_name: None,
        family_id: None,
        family_name: None,
        id: spec.id.clone(),
        parent_id: spec.parent_id.clone(),
        level: spec.level,
        label,
        label_source: "pending".to_string(),
        note_count,
        density,
        color: cloud_color(&spec.id, spec.level),
        centroid: spec.centroid,
        radius: spec.radius,
        hull: Vec::new(),
        member_node_ids: spec.member_node_ids.clone(),
        core_node_ids: spec.core_node_ids.clone(),
        outlier_node_ids: spec.outlier_node_ids.clone(),
        child_cloud_ids: spec.child_cloud_ids.clone(),
        representative_node_ids,
    }
}

fn cloud_color(id: &str, level: usize) -> [u8; 4] {
    const PALETTE: [[u8; 3]; 8] = [
        [255, 198, 58],
        [72, 202, 86],
        [43, 169, 255],
        [176, 103, 255],
        [0, 205, 225],
        [255, 92, 105],
        [255, 145, 49],
        [140, 220, 255],
    ];
    let color = PALETTE[(stable_hash(id) as usize) % PALETTE.len()];
    let alpha = if level == 0 { 118 } else { 72 };
    [color[0], color[1], color[2], alpha]
}

fn cloud_affinity(
    left: &CloudSpec,
    right: &CloudSpec,
    edges: &[LayoutEdge],
    adjacency: &EdgeAdjacency,
) -> f32 {
    let left_members = left.member_node_ids.iter().cloned().collect::<HashSet<_>>();
    let right_members = right
        .member_node_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let (scan_ids, other_set) = if left.member_node_ids.len() <= right.member_node_ids.len() {
        (&left.member_node_ids, &right_members)
    } else {
        (&right.member_node_ids, &left_members)
    };
    let mut total = 0.0_f32;
    for id in scan_ids {
        let Some(edge_indices) = adjacency.get(id) else {
            continue;
        };
        for &edge_index in edge_indices {
            let edge = &edges[edge_index];
            let neighbor = if edge.source_id == *id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if other_set.contains(neighbor) {
                total += edge.weight;
            }
        }
    }
    total
}

fn add_delta(deltas: &mut HashMap<usize, [f32; 2]>, index: usize, delta: [f32; 2]) {
    let entry = deltas.entry(index).or_insert([0.0, 0.0]);
    entry[0] += delta[0];
    entry[1] += delta[1];
}

pub(super) fn normalized_embedding(mut embedding: Vec<f32>) -> Vec<f32> {
    let norm = embedding
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    if norm <= f32::EPSILON {
        return embedding;
    }
    for value in &mut embedding {
        *value /= norm;
    }
    embedding
}

fn stable_angle(value: &str) -> f32 {
    (stable_hash(value) % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU
}

fn distance(left: [f32; 2], right: [f32; 2]) -> f32 {
    squared_distance(left, right).sqrt()
}

fn squared_distance(left: [f32; 2], right: [f32; 2]) -> f32 {
    let dx = left[0] - right[0];
    let dy = left[1] - right[1];
    dx * dx + dy * dy
}

struct DisjointSet {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl DisjointSet {
    fn new(size: usize) -> Self {
        Self {
            parent: (0..size).collect(),
            rank: vec![0; size],
        }
    }

    fn find(&mut self, value: usize) -> usize {
        if self.parent[value] != value {
            self.parent[value] = self.find(self.parent[value]);
        }
        self.parent[value]
    }

    fn union(&mut self, left: usize, right: usize) -> bool {
        let mut left_root = self.find(left);
        let mut right_root = self.find(right);
        if left_root == right_root {
            return false;
        }
        if self.rank[left_root] < self.rank[right_root] {
            std::mem::swap(&mut left_root, &mut right_root);
        }
        self.parent[right_root] = left_root;
        if self.rank[left_root] == self.rank[right_root] {
            self.rank[left_root] += 1;
        }
        true
    }
}

fn centroid(nodes: &[&WorkingNode]) -> [f32; 2] {
    if nodes.is_empty() {
        return [0.0, 0.0];
    }
    let (x, y) = nodes.iter().fold((0.0, 0.0), |(sum_x, sum_y), node| {
        (sum_x + node.x, sum_y + node.y)
    });
    [x / nodes.len() as f32, y / nodes.len() as f32]
}

fn cloud_density(links: &[WorkingLink], member_ids: &HashSet<String>, note_count: usize) -> f32 {
    if note_count < 2 {
        return 0.0;
    }
    let internal = links
        .iter()
        .filter(|link| member_ids.contains(&link.source_id) && member_ids.contains(&link.target_id))
        .count() as f32;
    let possible = (note_count * (note_count - 1) / 2).max(1) as f32;
    (internal / possible).clamp(0.0, 1.0)
}

fn normalize_edge_strength(score: f32) -> f32 {
    ((score - SEMANTIC_MIN_SCORE) / (1.0 - SEMANTIC_MIN_SCORE)).clamp(0.0, 1.0)
}

#[cfg(test)]
#[path = "geometry_tests.rs"]
mod tests;
