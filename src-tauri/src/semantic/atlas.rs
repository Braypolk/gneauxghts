use super::{
    db::{
        load_atlas_layout_signature, load_atlas_note_embeddings, load_atlas_positions,
        load_semantic_edges, open_database, save_atlas_layout_signature, save_atlas_positions,
        StoredAtlasNoteEmbedding, StoredAtlasPosition,
    },
    ActiveSemanticState,
};
use crate::time::current_time_millis;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

const CLOUD_MIN_NOTES: usize = 3;
const CHILD_CLOUD_MIN_NOTES: usize = 9;
const CLOUD_TARGET_MAX_NOTES: usize = 22;
const SEMANTIC_EDGE_LIMIT: usize = 12_000;
const SEMANTIC_MIN_SCORE: f32 = 0.24;
const COMPONENT_MIN_STRENGTH: f32 = 0.30;
const WIKILINK_STRENGTH: f32 = 0.82;
const FOLDER_BOOST: f32 = 0.035;
const RECENT_ACTIVITY_BOOST: f32 = 0.025;
const NOTE_RADIUS_MIN: f32 = 4.0;
const NOTE_RADIUS_MAX: f32 = 9.0;
const STALE_DRIFT_DISTANCE: f32 = 420.0;
const CLOUD_GAP: f32 = 115.0;
const DEFAULT_LAYOUT_PULL: f32 = 1.4;
const MIN_LINK_DISTANCE: f32 = 76.0;
const ATLAS_LAYOUT_ALGORITHM_VERSION: u32 = 4;

#[derive(Clone, Debug)]
pub(crate) struct AtlasNoteMetadata {
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: String,
    pub(crate) file_name: String,
    pub(crate) title: String,
}

#[derive(Clone, Debug)]
pub(crate) struct AtlasHardLink {
    pub(crate) source_note_path: String,
    pub(crate) target_note_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultAtlasStats {
    pub(crate) note_count: usize,
    pub(crate) cloud_count: usize,
    pub(crate) link_count: usize,
    pub(crate) isolated_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultAtlasResponse {
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
    pub(crate) revision: u64,
    pub(crate) generated_at_millis: u64,
    pub(crate) stats: VaultAtlasStats,
    pub(crate) nodes: Vec<AtlasNode>,
    pub(crate) links: Vec<AtlasLink>,
    pub(crate) clouds: Vec<AtlasCloud>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasNode {
    pub(crate) id: String,
    pub(crate) note_id: Option<String>,
    pub(crate) note_path: String,
    pub(crate) title: String,
    pub(crate) file_name: String,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) drift_x: f32,
    pub(crate) drift_y: f32,
    pub(crate) radius: f32,
    pub(crate) cloud_id: Option<String>,
    pub(crate) parent_cloud_id: Option<String>,
    pub(crate) centrality: f32,
    pub(crate) modified_at_millis: u64,
    pub(crate) last_viewed_at_millis: Option<u64>,
    pub(crate) stale_score: f32,
    pub(crate) isolated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasLink {
    pub(crate) id: String,
    pub(crate) source_id: String,
    pub(crate) target_id: String,
    pub(crate) kind: String,
    pub(crate) score: f32,
    pub(crate) strength: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AtlasCloud {
    pub(crate) id: String,
    pub(crate) parent_id: Option<String>,
    pub(crate) label: Option<String>,
    pub(crate) label_confidence: f32,
    pub(crate) note_count: usize,
    pub(crate) density: f32,
    pub(crate) centroid: [f32; 2],
    pub(crate) hull: Vec<[f32; 2]>,
    pub(crate) member_node_ids: Vec<String>,
    pub(crate) representative_node_ids: Vec<String>,
}

#[derive(Clone)]
struct WorkingNode {
    id: String,
    note_id: Option<String>,
    note_path: String,
    title: String,
    file_name: String,
    modified_at_millis: u64,
    last_viewed_at_millis: Option<u64>,
    stale_score: f32,
    centrality: f32,
    x: f32,
    y: f32,
    cloud_id: Option<String>,
    parent_cloud_id: Option<String>,
    isolated: bool,
}

#[derive(Clone)]
struct WorkingLink {
    source_id: String,
    target_id: String,
    kind: String,
    score: f32,
    strength: f32,
}

impl ActiveSemanticState {
    pub(super) fn vault_atlas(
        &self,
        metadata: HashMap<String, AtlasNoteMetadata>,
        hard_links: Vec<AtlasHardLink>,
        last_viewed_by_note_id: HashMap<String, u64>,
        revision: u64,
    ) -> Result<VaultAtlasResponse, String> {
        let mut connection = open_database(&self.db_path)?;
        super::ensure_schema(&connection)?;
        let indexed_notes = load_atlas_note_embeddings(&connection)?;
        if indexed_notes.is_empty() {
            return Ok(empty_atlas(
                "empty",
                "No indexed notes are available yet.",
                revision,
            )?);
        }

        let layout_pull = DEFAULT_LAYOUT_PULL;
        let layout_signature = atlas_layout_signature(&indexed_notes, revision, layout_pull);
        let positions = load_atlas_positions(&connection)?
            .into_iter()
            .map(|position| (position.note_path, (position.x, position.y)))
            .collect::<HashMap<_, _>>();
        let has_all_cached_positions = indexed_notes
            .iter()
            .all(|note| positions.contains_key(&note.note_path));
        let cached_layout_signature = load_atlas_layout_signature(&connection)?;
        let should_relayout = cached_layout_signature.as_deref() != Some(layout_signature.as_str())
            || !has_all_cached_positions;
        let max_modified = indexed_notes
            .iter()
            .map(|note| note.modified_millis)
            .max()
            .unwrap_or(0);

        let mut nodes = indexed_notes
            .into_iter()
            .enumerate()
            .map(|(index, note)| {
                let meta = metadata.get(&note.note_path);
                let note_id = meta.and_then(|item| item.note_id.clone());
                let last_viewed = note_id
                    .as_ref()
                    .and_then(|id| last_viewed_by_note_id.get(id).copied());
                let (x, y) = if should_relayout {
                    seeded_position(&note.note_path, index)
                } else {
                    positions
                        .get(&note.note_path)
                        .copied()
                        .unwrap_or_else(|| seeded_position(&note.note_path, index))
                };
                WorkingNode {
                    id: note.note_path.clone(),
                    note_id,
                    note_path: note.note_path.clone(),
                    title: meta
                        .map(|item| item.title.clone())
                        .filter(|title| !title.trim().is_empty())
                        .unwrap_or(note.note_title),
                    file_name: meta
                        .map(|item| item.file_name.clone())
                        .unwrap_or_else(|| file_name_for_path(&note.note_path)),
                    modified_at_millis: note.modified_millis,
                    last_viewed_at_millis: last_viewed,
                    stale_score: stale_score(
                        last_viewed.unwrap_or(note.modified_millis),
                        max_modified,
                    ),
                    centrality: 0.0,
                    x,
                    y,
                    cloud_id: None,
                    parent_cloud_id: None,
                    isolated: true,
                }
            })
            .collect::<Vec<_>>();

        let node_ids = nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<HashSet<_>>();
        let mut links = collect_links(&mut connection, &node_ids, hard_links)?;
        boost_links(&mut links, &nodes);
        apply_centrality(&mut nodes, &links);
        if should_relayout {
            layout_nodes(&mut nodes, &links, layout_pull);
        }

        let components = connected_components(&nodes, &links);
        let mut clouds = assign_clouds(&mut nodes, &links, components);
        clouds.sort_by(|left, right| {
            right
                .note_count
                .cmp(&left.note_count)
                .then_with(|| left.id.cmp(&right.id))
        });

        if should_relayout {
            save_atlas_positions(
                &mut connection,
                &nodes
                    .iter()
                    .map(|node| StoredAtlasPosition {
                        note_path: node.note_path.clone(),
                        x: node.x,
                        y: node.y,
                    })
                    .collect::<Vec<_>>(),
            )?;
            save_atlas_layout_signature(&connection, &layout_signature)?;
        }

        let response_nodes = nodes
            .into_iter()
            .map(|node| {
                let drift = drift_position(node.x, node.y, node.stale_score);
                AtlasNode {
                    id: node.id,
                    note_id: node.note_id,
                    note_path: node.note_path,
                    title: node.title,
                    file_name: node.file_name,
                    x: node.x,
                    y: node.y,
                    drift_x: drift.0,
                    drift_y: drift.1,
                    radius: NOTE_RADIUS_MIN
                        + (NOTE_RADIUS_MAX - NOTE_RADIUS_MIN) * node.centrality.clamp(0.0, 1.0),
                    cloud_id: node.cloud_id,
                    parent_cloud_id: node.parent_cloud_id,
                    centrality: node.centrality,
                    modified_at_millis: node.modified_at_millis,
                    last_viewed_at_millis: node.last_viewed_at_millis,
                    stale_score: node.stale_score,
                    isolated: node.isolated,
                }
            })
            .collect::<Vec<_>>();
        let response_links = links
            .into_iter()
            .enumerate()
            .map(|(index, link)| AtlasLink {
                id: format!("{}:{}:{index}", link.source_id, link.target_id),
                source_id: link.source_id,
                target_id: link.target_id,
                kind: link.kind,
                score: link.score,
                strength: link.strength,
            })
            .collect::<Vec<_>>();

        Ok(VaultAtlasResponse {
            status: "ready".to_string(),
            reason: None,
            revision,
            generated_at_millis: current_time_millis()?,
            stats: VaultAtlasStats {
                note_count: response_nodes.len(),
                cloud_count: clouds.len(),
                link_count: response_links.len(),
                isolated_count: response_nodes.iter().filter(|node| node.isolated).count(),
            },
            nodes: response_nodes,
            links: response_links,
            clouds,
        })
    }
}

fn empty_atlas(status: &str, reason: &str, revision: u64) -> Result<VaultAtlasResponse, String> {
    Ok(VaultAtlasResponse {
        status: status.to_string(),
        reason: Some(reason.to_string()),
        revision,
        generated_at_millis: current_time_millis()?,
        stats: VaultAtlasStats {
            note_count: 0,
            cloud_count: 0,
            link_count: 0,
            isolated_count: 0,
        },
        nodes: Vec::new(),
        links: Vec::new(),
        clouds: Vec::new(),
    })
}

fn atlas_layout_signature(
    notes: &[StoredAtlasNoteEmbedding],
    revision: u64,
    layout_pull: f32,
) -> String {
    let mut parts = notes
        .iter()
        .map(|note| format!("{}:{}", note.note_path, note.modified_millis))
        .collect::<Vec<_>>();
    parts.sort();
    format!(
        "v{ATLAS_LAYOUT_ALGORITHM_VERSION}|{revision}|pull:{layout_pull:.2}|{}",
        parts.join("|")
    )
}

fn collect_links(
    connection: &mut rusqlite::Connection,
    node_ids: &HashSet<String>,
    hard_links: Vec<AtlasHardLink>,
) -> Result<Vec<WorkingLink>, String> {
    let mut merged: HashMap<(String, String, String), WorkingLink> = HashMap::new();
    for edge in load_semantic_edges(connection, SEMANTIC_EDGE_LIMIT)? {
        if edge.score < SEMANTIC_MIN_SCORE
            || !node_ids.contains(&edge.source_note_path)
            || !node_ids.contains(&edge.target_note_path)
        {
            continue;
        }
        let (source_id, target_id) = ordered_pair(edge.source_note_path, edge.target_note_path);
        let link = WorkingLink {
            source_id: source_id.clone(),
            target_id: target_id.clone(),
            kind: "semantic".to_string(),
            score: edge.score,
            strength: normalize_edge_strength(edge.score),
        };
        merged.insert((source_id, target_id, "semantic".to_string()), link);
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

    Ok(merged.into_values().collect())
}

fn boost_links(links: &mut [WorkingLink], nodes: &[WorkingNode]) {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    for link in links {
        let Some(source) = node_by_id.get(link.source_id.as_str()) else {
            continue;
        };
        let Some(target) = node_by_id.get(link.target_id.as_str()) else {
            continue;
        };
        if parent_folder(&source.note_path) == parent_folder(&target.note_path) {
            link.strength += FOLDER_BOOST;
        }
        if source.stale_score < 0.35 && target.stale_score < 0.35 {
            link.strength += RECENT_ACTIVITY_BOOST;
        }
        link.strength = link.strength.clamp(0.0, 1.0);
    }
}

fn apply_centrality(nodes: &mut [WorkingNode], links: &[WorkingLink]) {
    let mut totals = HashMap::<String, f32>::new();
    for link in links {
        *totals.entry(link.source_id.clone()).or_default() += link.strength;
        *totals.entry(link.target_id.clone()).or_default() += link.strength;
    }
    let max_total = totals.values().copied().fold(0.0_f32, f32::max).max(1.0);
    for node in nodes {
        node.centrality = totals.get(&node.id).copied().unwrap_or(0.0) / max_total;
    }
}

fn layout_nodes(nodes: &mut [WorkingNode], links: &[WorkingLink], layout_pull: f32) {
    let index_by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for _ in 0..72 {
        let mut deltas = vec![(0.0_f32, 0.0_f32); nodes.len()];
        for left_index in 0..nodes.len() {
            for right_index in (left_index + 1)..nodes.len() {
                let dx = nodes[left_index].x - nodes[right_index].x;
                let dy = nodes[left_index].y - nodes[right_index].y;
                let dist_sq = (dx * dx + dy * dy).max(16.0);
                let dist = dist_sq.sqrt();
                let force = 1500.0 / dist_sq;
                let fx = dx / dist * force;
                let fy = dy / dist * force;
                deltas[left_index].0 += fx;
                deltas[left_index].1 += fy;
                deltas[right_index].0 -= fx;
                deltas[right_index].1 -= fy;
            }
        }
        for link in links {
            let (Some(&source_index), Some(&target_index)) = (
                index_by_id.get(&link.source_id),
                index_by_id.get(&link.target_id),
            ) else {
                continue;
            };
            let dx = nodes[target_index].x - nodes[source_index].x;
            let dy = nodes[target_index].y - nodes[source_index].y;
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            let desired = (92.0 + (1.0 - link.strength) * 185.0) / layout_pull;
            let desired = desired.max(MIN_LINK_DISTANCE);
            let force = (dist - desired) * 0.0054 * link.strength * layout_pull;
            let fx = dx / dist * force;
            let fy = dy / dist * force;
            deltas[source_index].0 += fx;
            deltas[source_index].1 += fy;
            deltas[target_index].0 -= fx;
            deltas[target_index].1 -= fy;
        }
        for (node, (dx, dy)) in nodes.iter_mut().zip(deltas) {
            node.x += dx.clamp(-12.0, 12.0);
            node.y += dy.clamp(-12.0, 12.0);
        }
    }
}

fn connected_components(nodes: &[WorkingNode], links: &[WorkingLink]) -> Vec<Vec<String>> {
    let mut adjacency = HashMap::<String, Vec<String>>::new();
    for node in nodes {
        adjacency.entry(node.id.clone()).or_default();
    }
    for link in links {
        if link.strength < COMPONENT_MIN_STRENGTH {
            continue;
        }
        adjacency
            .entry(link.source_id.clone())
            .or_default()
            .push(link.target_id.clone());
        adjacency
            .entry(link.target_id.clone())
            .or_default()
            .push(link.source_id.clone());
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
        components.push(component);
    }
    components
}

fn assign_clouds(
    nodes: &mut [WorkingNode],
    links: &[WorkingLink],
    components: Vec<Vec<String>>,
) -> Vec<AtlasCloud> {
    let mut node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut cloud_specs = Vec::<(String, Option<String>, Vec<String>)>::new();
    let mut cloud_ordinal = 0usize;
    for component in components {
        if component.len() < CLOUD_MIN_NOTES {
            continue;
        }
        for community in split_component_into_parent_clouds(&component, nodes, links) {
            if community.len() < CLOUD_MIN_NOTES {
                continue;
            }
            cloud_ordinal += 1;
            let cloud_id = format!("cloud-{cloud_ordinal}");
            for id in &community {
                if let Some(index) = node_index.get(id).copied() {
                    nodes[index].cloud_id = Some(cloud_id.clone());
                    nodes[index].isolated = false;
                }
            }
            cloud_specs.push((cloud_id.clone(), None, community.clone()));

            if community.len() >= CHILD_CLOUD_MIN_NOTES {
                let mut sorted = community.clone();
                sorted.sort_by(|left, right| {
                    let left_node = &nodes[node_index[left]];
                    let right_node = &nodes[node_index[right]];
                    left_node
                        .y
                        .atan2(left_node.x)
                        .total_cmp(&right_node.y.atan2(right_node.x))
                });
                let child_size = (sorted.len() / 2).max(CLOUD_MIN_NOTES);
                for (child_index, child_nodes) in sorted.chunks(child_size).enumerate() {
                    if child_nodes.len() < CLOUD_MIN_NOTES {
                        continue;
                    }
                    let child_id = format!("{cloud_id}-child-{}", child_index + 1);
                    for id in child_nodes {
                        if let Some(index) = node_index.get(id).copied() {
                            nodes[index].parent_cloud_id = Some(cloud_id.clone());
                        }
                    }
                    cloud_specs.push((child_id, Some(cloud_id.clone()), child_nodes.to_vec()));
                }
            }
        }
    }
    node_index.clear();
    compact_parent_clouds(nodes, &cloud_specs);
    separate_parent_clouds(nodes, links, &cloud_specs);
    let preview_clouds = cloud_specs
        .iter()
        .map(|(id, parent_id, member_ids)| {
            build_cloud(id, parent_id.clone(), nodes, links, member_ids)
        })
        .collect::<Vec<_>>();
    separate_parent_cloud_hulls(nodes, links, &preview_clouds);
    cloud_specs
        .into_iter()
        .map(|(id, parent_id, member_ids)| build_cloud(&id, parent_id, nodes, links, &member_ids))
        .collect()
}

fn compact_parent_clouds(
    nodes: &mut [WorkingNode],
    cloud_specs: &[(String, Option<String>, Vec<String>)],
) {
    let node_by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for (_, parent_id, members) in cloud_specs {
        if parent_id.is_some() || members.len() < CLOUD_MIN_NOTES {
            continue;
        }
        let member_refs = members
            .iter()
            .filter_map(|id| node_by_id.get(id).map(|index| &nodes[*index]))
            .collect::<Vec<_>>();
        let center = centroid(&member_refs);
        let max_radius = (95.0 + (members.len() as f32).sqrt() * 24.0).clamp(145.0, 225.0);
        for member_id in members {
            let Some(index) = node_by_id.get(member_id).copied() else {
                continue;
            };
            let dx = nodes[index].x - center[0];
            let dy = nodes[index].y - center[1];
            let dist = (dx * dx + dy * dy).sqrt();
            if dist <= max_radius || dist <= 1.0 {
                continue;
            }
            let target_x = center[0] + dx / dist * max_radius;
            let target_y = center[1] + dy / dist * max_radius;
            nodes[index].x = nodes[index].x * 0.35 + target_x * 0.65;
            nodes[index].y = nodes[index].y * 0.35 + target_y * 0.65;
        }
    }
}

fn split_component_into_parent_clouds(
    component: &[String],
    nodes: &[WorkingNode],
    links: &[WorkingLink],
) -> Vec<Vec<String>> {
    if component.len() <= CLOUD_TARGET_MAX_NOTES {
        return vec![component.to_vec()];
    }

    let member_set = component.iter().cloned().collect::<HashSet<_>>();
    let mut labels = component
        .iter()
        .map(|id| (id.clone(), id.clone()))
        .collect::<HashMap<_, _>>();
    let mut adjacency = HashMap::<String, Vec<(String, f32)>>::new();
    for id in component {
        adjacency.entry(id.clone()).or_default();
    }
    for link in links {
        if !member_set.contains(&link.source_id) || !member_set.contains(&link.target_id) {
            continue;
        }
        let weight = if link.kind == "wikilink" {
            link.strength + 0.35
        } else {
            link.strength
        };
        if weight < 0.42 {
            continue;
        }
        adjacency
            .entry(link.source_id.clone())
            .or_default()
            .push((link.target_id.clone(), weight));
        adjacency
            .entry(link.target_id.clone())
            .or_default()
            .push((link.source_id.clone(), weight));
    }

    let mut ordered = component.to_vec();
    ordered.sort();
    for _ in 0..18 {
        let mut changed = false;
        for id in &ordered {
            let mut scores = HashMap::<String, f32>::new();
            if let Some(current) = labels.get(id) {
                *scores.entry(current.clone()).or_default() += 0.16;
            }
            for (neighbor, weight) in adjacency.get(id).into_iter().flatten() {
                if let Some(label) = labels.get(neighbor) {
                    *scores.entry(label.clone()).or_default() += weight;
                }
            }
            let Some((best_label, _)) = scores.into_iter().max_by(|left, right| {
                left.1
                    .total_cmp(&right.1)
                    .then_with(|| right.0.cmp(&left.0))
            }) else {
                continue;
            };
            if labels.get(id) != Some(&best_label) {
                labels.insert(id.clone(), best_label);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    let mut communities = HashMap::<String, Vec<String>>::new();
    for id in component {
        let label = labels.get(id).cloned().unwrap_or_else(|| id.clone());
        communities.entry(label).or_default().push(id.clone());
    }
    let mut groups = communities
        .into_values()
        .flat_map(|group| split_oversized_cloud(group, nodes))
        .collect::<Vec<_>>();
    let mut small = Vec::new();
    groups.retain(|group| {
        if group.len() < CLOUD_MIN_NOTES {
            small.extend(group.iter().cloned());
            false
        } else {
            true
        }
    });
    if small.len() >= CLOUD_MIN_NOTES {
        groups.push(small);
    }
    if groups.is_empty() {
        return split_oversized_cloud(component.to_vec(), nodes);
    }
    groups.sort_by(|left, right| {
        right
            .len()
            .cmp(&left.len())
            .then_with(|| left[0].cmp(&right[0]))
    });
    groups
}

fn split_oversized_cloud(group: Vec<String>, nodes: &[WorkingNode]) -> Vec<Vec<String>> {
    if group.len() <= CLOUD_TARGET_MAX_NOTES {
        return vec![group];
    }
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let refs = group
        .iter()
        .filter_map(|id| node_by_id.get(id.as_str()).copied())
        .collect::<Vec<_>>();
    let center = centroid(&refs);
    let mut sorted = group;
    sorted.sort_by(|left, right| {
        let left_node = node_by_id.get(left.as_str());
        let right_node = node_by_id.get(right.as_str());
        let left_angle = left_node
            .map(|node| (node.y - center[1]).atan2(node.x - center[0]))
            .unwrap_or(0.0);
        let right_angle = right_node
            .map(|node| (node.y - center[1]).atan2(node.x - center[0]))
            .unwrap_or(0.0);
        left_angle
            .total_cmp(&right_angle)
            .then_with(|| left.cmp(right))
    });
    sorted
        .chunks(CLOUD_TARGET_MAX_NOTES)
        .map(|chunk| chunk.to_vec())
        .collect()
}

fn separate_parent_clouds(
    nodes: &mut [WorkingNode],
    links: &[WorkingLink],
    cloud_specs: &[(String, Option<String>, Vec<String>)],
) {
    let parent_specs = cloud_specs
        .iter()
        .filter(|(_, parent_id, _)| parent_id.is_none())
        .collect::<Vec<_>>();
    if parent_specs.len() < 2 {
        return;
    }

    let node_by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    let cloud_by_node = parent_specs
        .iter()
        .enumerate()
        .flat_map(|(cloud_index, (_, _, members))| {
            members
                .iter()
                .map(move |member_id| (member_id.clone(), cloud_index))
        })
        .collect::<HashMap<_, _>>();
    let mut centers = parent_specs
        .iter()
        .map(|(_, _, members)| {
            let member_refs = members
                .iter()
                .filter_map(|id| node_by_id.get(id).map(|index| &nodes[*index]))
                .collect::<Vec<_>>();
            centroid(&member_refs)
        })
        .collect::<Vec<_>>();
    let radii = parent_specs
        .iter()
        .zip(centers.iter())
        .map(|((_, _, members), center)| {
            members
                .iter()
                .filter_map(|id| node_by_id.get(id).map(|index| &nodes[*index]))
                .map(|node| {
                    let dx = node.x - center[0];
                    let dy = node.y - center[1];
                    (dx * dx + dy * dy).sqrt()
                })
                .fold(95.0_f32, f32::max)
                + 70.0
        })
        .collect::<Vec<_>>();
    let original_centers = centers.clone();
    let mut affinities = HashMap::<(usize, usize), f32>::new();
    for link in links {
        let (Some(&source_cloud), Some(&target_cloud)) = (
            cloud_by_node.get(&link.source_id),
            cloud_by_node.get(&link.target_id),
        ) else {
            continue;
        };
        if source_cloud == target_cloud {
            continue;
        }
        let key = if source_cloud < target_cloud {
            (source_cloud, target_cloud)
        } else {
            (target_cloud, source_cloud)
        };
        *affinities.entry(key).or_default() += link.strength;
    }

    for _ in 0..56 {
        let mut deltas = vec![[0.0_f32, 0.0_f32]; centers.len()];
        for left in 0..centers.len() {
            for right in (left + 1)..centers.len() {
                let dx = centers[left][0] - centers[right][0];
                let dy = centers[left][1] - centers[right][1];
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let affinity = affinities.get(&(left, right)).copied().unwrap_or(0.0);
                let linked_closeness = affinity.min(6.0) * 16.0;
                let desired = radii[left] + radii[right] + CLOUD_GAP - linked_closeness;
                if dist < desired {
                    let force = ((desired - dist) / desired).min(1.0) * 8.5;
                    let fx = dx / dist * force;
                    let fy = dy / dist * force;
                    deltas[left][0] += fx;
                    deltas[left][1] += fy;
                    deltas[right][0] -= fx;
                    deltas[right][1] -= fy;
                } else if affinity > 0.0 {
                    let desired_link_distance = (desired + 120.0).min(560.0);
                    if dist > desired_link_distance {
                        let force =
                            ((dist - desired_link_distance) / dist) * affinity.min(4.0) * 0.35;
                        let fx = dx / dist * force;
                        let fy = dy / dist * force;
                        deltas[left][0] -= fx;
                        deltas[left][1] -= fy;
                        deltas[right][0] += fx;
                        deltas[right][1] += fy;
                    }
                }
            }
        }
        for (center, delta) in centers.iter_mut().zip(deltas) {
            center[0] += delta[0].clamp(-12.0, 12.0);
            center[1] += delta[1].clamp(-12.0, 12.0);
        }
    }

    for (center, original) in centers.iter_mut().zip(original_centers.iter()) {
        let dx = center[0] - original[0];
        let dy = center[1] - original[1];
        let dist = (dx * dx + dy * dy).sqrt();
        let max_shift = 210.0;
        if dist > max_shift {
            center[0] = original[0] + dx / dist * max_shift;
            center[1] = original[1] + dy / dist * max_shift;
        }
    }

    for (cloud_index, (_, _, members)) in parent_specs.iter().enumerate() {
        let dx = centers[cloud_index][0] - original_centers[cloud_index][0];
        let dy = centers[cloud_index][1] - original_centers[cloud_index][1];
        for member_id in members {
            if let Some(index) = node_by_id.get(member_id).copied() {
                nodes[index].x += dx;
                nodes[index].y += dy;
            }
        }
    }
}

fn separate_parent_cloud_hulls(
    nodes: &mut [WorkingNode],
    links: &[WorkingLink],
    clouds: &[AtlasCloud],
) {
    let parents = clouds
        .iter()
        .filter(|cloud| cloud.parent_id.is_none())
        .collect::<Vec<_>>();
    if parents.len() < 2 {
        return;
    }

    let cloud_by_node = parents
        .iter()
        .enumerate()
        .flat_map(|(cloud_index, cloud)| {
            cloud
                .member_node_ids
                .iter()
                .map(move |member_id| (member_id.clone(), cloud_index))
        })
        .collect::<HashMap<_, _>>();
    let mut affinities = HashMap::<(usize, usize), f32>::new();
    for link in links {
        let (Some(&source_cloud), Some(&target_cloud)) = (
            cloud_by_node.get(&link.source_id),
            cloud_by_node.get(&link.target_id),
        ) else {
            continue;
        };
        if source_cloud == target_cloud {
            continue;
        }
        let key = if source_cloud < target_cloud {
            (source_cloud, target_cloud)
        } else {
            (target_cloud, source_cloud)
        };
        *affinities.entry(key).or_default() += link.strength;
    }

    let original_centers = parents
        .iter()
        .map(|cloud| cloud.centroid)
        .collect::<Vec<_>>();
    let mut centers = original_centers.clone();
    let radii = parents
        .iter()
        .map(|cloud| cloud_hull_radius(cloud).max(72.0))
        .collect::<Vec<_>>();

    for _ in 0..72 {
        let mut deltas = vec![[0.0_f32, 0.0_f32]; centers.len()];
        for left in 0..centers.len() {
            for right in (left + 1)..centers.len() {
                let dx = centers[left][0] - centers[right][0];
                let dy = centers[left][1] - centers[right][1];
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let affinity = affinities.get(&(left, right)).copied().unwrap_or(0.0);
                let intentional_overlap = (affinity.min(8.0) / 8.0) * 0.22;
                let desired = (radii[left] + radii[right] + 26.0) * (1.0 - intentional_overlap);
                if dist >= desired {
                    continue;
                }
                let force = ((desired - dist) / desired).min(1.0) * 10.0;
                let fx = dx / dist * force;
                let fy = dy / dist * force;
                deltas[left][0] += fx;
                deltas[left][1] += fy;
                deltas[right][0] -= fx;
                deltas[right][1] -= fy;
            }
        }
        for (center, delta) in centers.iter_mut().zip(deltas) {
            center[0] += delta[0].clamp(-14.0, 14.0);
            center[1] += delta[1].clamp(-14.0, 14.0);
        }
    }

    let node_by_id = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect::<HashMap<_, _>>();
    for (cloud_index, cloud) in parents.iter().enumerate() {
        let mut dx = centers[cloud_index][0] - original_centers[cloud_index][0];
        let mut dy = centers[cloud_index][1] - original_centers[cloud_index][1];
        let dist = (dx * dx + dy * dy).sqrt();
        let max_shift = 260.0;
        if dist > max_shift {
            dx = dx / dist * max_shift;
            dy = dy / dist * max_shift;
        }
        for member_id in &cloud.member_node_ids {
            if let Some(index) = node_by_id.get(member_id).copied() {
                nodes[index].x += dx;
                nodes[index].y += dy;
            }
        }
    }
}

fn cloud_hull_radius(cloud: &AtlasCloud) -> f32 {
    cloud
        .hull
        .iter()
        .map(|point| {
            let dx = point[0] - cloud.centroid[0];
            let dy = point[1] - cloud.centroid[1];
            (dx * dx + dy * dy).sqrt()
        })
        .fold(0.0_f32, f32::max)
}

fn build_cloud(
    id: &str,
    parent_id: Option<String>,
    nodes: &[WorkingNode],
    links: &[WorkingLink],
    member_ids: &[String],
) -> AtlasCloud {
    let member_set = member_ids.iter().cloned().collect::<HashSet<_>>();
    let members = nodes
        .iter()
        .filter(|node| member_set.contains(&node.id))
        .collect::<Vec<_>>();
    let note_count = members.len();
    let centroid = centroid(&members);
    let density = cloud_density(links, &member_set, note_count);
    let (label, confidence) = label_for_cloud(&members, density);
    let representative_node_ids = {
        let mut ranked = members.iter().copied().collect::<Vec<_>>();
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
        id: id.to_string(),
        parent_id,
        label,
        label_confidence: confidence,
        note_count,
        density,
        centroid,
        hull: blob_hull(id, &members, centroid),
        member_node_ids: member_ids.to_vec(),
        representative_node_ids,
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

fn blob_hull(seed: &str, nodes: &[&WorkingNode], centroid: [f32; 2]) -> Vec<[f32; 2]> {
    const POINTS: usize = 48;
    let base_radius = nodes
        .iter()
        .map(|node| {
            let dx = node.x - centroid[0];
            let dy = node.y - centroid[1];
            (dx * dx + dy * dy).sqrt()
        })
        .fold(76.0_f32, f32::max);
    let padding = 52.0 + (nodes.len() as f32).sqrt() * 4.0;
    let seed_phase = (stable_hash(seed) % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU;

    (0..POINTS)
        .map(|index| {
            let angle = index as f32 / POINTS as f32 * std::f32::consts::TAU;
            let directional_extent = nodes
                .iter()
                .map(|node| {
                    let dx = node.x - centroid[0];
                    let dy = node.y - centroid[1];
                    let projection = dx * angle.cos() + dy * angle.sin();
                    projection.max(0.0)
                })
                .fold(base_radius * 0.58, f32::max);
            let wobble = 1.0
                + 0.1 * (angle * 2.0 + seed_phase).sin()
                + 0.07 * (angle * 3.0 + seed_phase * 0.7).cos()
                + 0.04 * (angle * 5.0 + seed_phase * 1.3).sin();
            let radius = (directional_extent + padding) * wobble.clamp(0.86, 1.18);
            [
                centroid[0] + angle.cos() * radius,
                centroid[1] + angle.sin() * radius,
            ]
        })
        .collect()
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

fn label_for_cloud(nodes: &[&WorkingNode], density: f32) -> (Option<String>, f32) {
    let mut counts = HashMap::<String, usize>::new();
    for node in nodes {
        for word in node
            .title
            .split(|character: char| !character.is_alphanumeric())
            .map(|word| word.trim().to_lowercase())
            .filter(|word| word.len() >= 4 && !is_stop_word(word))
        {
            *counts.entry(word).or_default() += 1;
        }
    }
    let Some((word, count)) = counts
        .into_iter()
        .max_by(|left, right| left.1.cmp(&right.1).then_with(|| right.0.cmp(&left.0)))
    else {
        return fallback_cloud_label(nodes, density);
    };
    let confidence =
        ((count as f32 / nodes.len().max(1) as f32) * 0.7 + density * 0.3).clamp(0.0, 1.0);
    if confidence < 0.38 {
        let fallback = fallback_label_from_word(&word, nodes, density, confidence);
        return (Some(fallback), confidence);
    }
    (Some(title_case(&word)), confidence)
}

fn fallback_cloud_label(nodes: &[&WorkingNode], density: f32) -> (Option<String>, f32) {
    let fallback = nodes
        .iter()
        .max_by(|left, right| {
            left.centrality
                .total_cmp(&right.centrality)
                .then_with(|| right.title.cmp(&left.title))
        })
        .and_then(|node| {
            node.title
                .split(|character: char| !character.is_alphanumeric())
                .map(|word| word.trim().to_lowercase())
                .find(|word| word.len() >= 3 && !is_stop_word(word))
        })
        .unwrap_or_else(|| "Cluster".to_string());
    (
        Some(title_case(&fallback)),
        (0.18 + density * 0.2).clamp(0.12, 0.36),
    )
}

fn fallback_label_from_word(
    word: &str,
    nodes: &[&WorkingNode],
    density: f32,
    _confidence: f32,
) -> String {
    if word.len() >= 3 {
        return title_case(word);
    }
    fallback_cloud_label(nodes, density)
        .0
        .unwrap_or_else(|| "Cluster".to_string())
}

fn stale_score(last_activity: u64, max_modified: u64) -> f32 {
    if max_modified == 0 || last_activity >= max_modified {
        return 0.0;
    }
    let month = 1000.0 * 60.0 * 60.0 * 24.0 * 30.0;
    ((max_modified - last_activity) as f32 / month).clamp(0.0, 1.0)
}

fn drift_position(x: f32, y: f32, stale_score: f32) -> (f32, f32) {
    let length = (x * x + y * y).sqrt().max(1.0);
    let drift = STALE_DRIFT_DISTANCE * stale_score * stale_score;
    (x + x / length * drift, y + y / length * drift)
}

fn normalize_edge_strength(score: f32) -> f32 {
    ((score - SEMANTIC_MIN_SCORE) / (0.82 - SEMANTIC_MIN_SCORE)).clamp(0.15, 0.9)
}

fn seeded_position(value: &str, index: usize) -> (f32, f32) {
    let hash = stable_hash(value);
    let angle = (hash % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU;
    let radius = 150.0 + ((index as f32).sqrt() * 48.0);
    (angle.cos() * radius, angle.sin() * radius)
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 1469598103934665603u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

fn ordered_pair(left: String, right: String) -> (String, String) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn file_name_for_path(note_path: &str) -> String {
    Path::new(note_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn parent_folder(note_path: &str) -> String {
    Path::new(note_path)
        .parent()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn is_stop_word(word: &str) -> bool {
    matches!(
        word,
        "about"
            | "after"
            | "also"
            | "from"
            | "have"
            | "into"
            | "note"
            | "notes"
            | "plan"
            | "that"
            | "this"
            | "with"
            | "your"
            | "project"
            | "meeting"
    )
}

fn title_case(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_node(id: &str, title: &str, x: f32, y: f32) -> WorkingNode {
        WorkingNode {
            id: id.to_string(),
            note_id: Some(id.to_string()),
            note_path: format!("/vault/{id}.md"),
            title: title.to_string(),
            file_name: format!("{id}.md"),
            modified_at_millis: 100,
            last_viewed_at_millis: None,
            stale_score: 0.0,
            centrality: 0.5,
            x,
            y,
            cloud_id: None,
            parent_cloud_id: None,
            isolated: true,
        }
    }

    #[test]
    fn label_for_cloud_falls_back_for_low_confidence_labels() {
        let nodes = [
            test_node("a", "Alpha", 0.0, 0.0),
            test_node("b", "Beta", 1.0, 0.0),
            test_node("c", "Gamma", 0.0, 1.0),
        ];
        let refs = nodes.iter().collect::<Vec<_>>();

        let (label, confidence) = label_for_cloud(&refs, 0.1);

        assert!(label.is_some());
        assert!(confidence < 0.38);
    }

    #[test]
    fn label_for_cloud_uses_repeated_title_terms() {
        let nodes = [
            test_node("a", "Garden Plan", 0.0, 0.0),
            test_node("b", "Garden Ideas", 1.0, 0.0),
            test_node("c", "Garden Notes", 0.0, 1.0),
        ];
        let refs = nodes.iter().collect::<Vec<_>>();

        let (label, confidence) = label_for_cloud(&refs, 0.8);

        assert_eq!(label.as_deref(), Some("Garden"));
        assert!(confidence > 0.8);
    }

    #[test]
    fn stale_score_uses_recent_activity_as_zero_and_old_activity_as_outer_pull() {
        assert_eq!(stale_score(100, 100), 0.0);
        assert!(stale_score(0, 1000 * 60 * 60 * 24 * 45) > 0.9);
    }

    #[test]
    fn connected_components_respects_minimum_link_strength() {
        let nodes = [
            test_node("a", "A", 0.0, 0.0),
            test_node("b", "B", 1.0, 0.0),
            test_node("c", "C", 100.0, 0.0),
        ];
        let links = [
            WorkingLink {
                source_id: "a".to_string(),
                target_id: "b".to_string(),
                kind: "semantic".to_string(),
                score: 0.5,
                strength: COMPONENT_MIN_STRENGTH,
            },
            WorkingLink {
                source_id: "b".to_string(),
                target_id: "c".to_string(),
                kind: "semantic".to_string(),
                score: 0.2,
                strength: COMPONENT_MIN_STRENGTH - 0.01,
            },
        ];

        let mut components = connected_components(&nodes, &links);
        components.sort_by_key(|component| component.len());

        assert_eq!(components.len(), 2);
        assert_eq!(components[0], vec!["c".to_string()]);
        assert_eq!(components[1].len(), 2);
    }
}
