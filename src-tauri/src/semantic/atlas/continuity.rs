//! Stateful community reconciliation. Current evidence chooses themes; old places break close ties.
use super::map_store::{identity, opaque_id, MapCloud, MapNote, MapState};
use super::*;
use std::collections::BTreeMap;

const RETENTION_MARGIN: f32 = 0.08;
const THEME_MIN: f32 = 0.30;
pub(super) const BRANCH_PRESENTATION_MILLIS: u64 = 30_000;

pub(super) fn note_identity(node: &WorkingNode) -> String {
    identity(node.note_id.as_deref(), &node.note_path)
}

pub(super) fn prototype(ids: &[String], nodes: &[WorkingNode]) -> Vec<f32> {
    let ids: HashSet<_> = ids.iter().collect();
    let members = nodes
        .iter()
        .filter(|n| n.has_semantic_content && ids.contains(&n.id))
        .collect::<Vec<_>>();
    let mut mean = vec![0.0; members.first().map_or(0, |n| n.embedding.len())];
    for node in &members {
        for (sum, v) in mean.iter_mut().zip(&node.embedding) {
            *sum += v;
        }
    }
    normalized_embedding(mean)
}

fn similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return -1.0;
    }
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}

fn overlap(a: &[String], b: &[String]) -> f32 {
    let b: HashSet<_> = b.iter().collect();
    let common = a.iter().filter(|id| b.contains(id)).count();
    common as f32 / (a.len() + b.len() - common).max(1) as f32
}

fn evidence(ids: &[String], nodes: &[WorkingNode]) -> String {
    let mut members = nodes
        .iter()
        .filter(|n| n.has_semantic_content && ids.contains(&n.id))
        .collect::<Vec<_>>();
    members.sort_by_key(|n| note_identity(n));
    let mut hash = blake3::Hasher::new();
    for n in members {
        hash.update(note_identity(n).as_bytes());
        for value in &n.embedding {
            hash.update(&value.to_le_bytes());
        }
    }
    hash.finalize().to_hex().to_string()
}

fn record(spec: &CloudSpec, nodes: &[WorkingNode], prior: Option<&MapCloud>, now: u64) -> MapCloud {
    let members = spec
        .member_node_ids
        .iter()
        .filter_map(|id| nodes.iter().find(|n| &n.id == id))
        .map(note_identity)
        .collect();
    let next_evidence = evidence(&spec.member_node_ids, nodes);
    MapCloud {
        id: spec.id.clone(),
        parent: spec.parent_id.clone(),
        family: prior.and_then(|c| c.family.clone()),
        members,
        theme_prototype: prior.filter(|c| !c.theme_prototype.is_empty()).map_or_else(
            || prototype(&spec.member_node_ids, nodes),
            |c| c.theme_prototype.clone(),
        ),
        prototype: prototype(&spec.member_node_ids, nodes),
        position: prior.map_or(spec.centroid, |c| c.position),
        color: prior.map_or([0, 0, 0, 0], |c| c.color),
        hull: prior.map_or_else(Vec::new, |c| c.hull.clone()),
        radius: prior.map_or(spec.radius, |c| c.radius),
        user_name: prior.and_then(|c| c.user_name.clone()),
        auto_name: prior.and_then(|c| c.auto_name.clone()),
        name_prototype: prior.map_or_else(Vec::new, |c| c.name_prototype.clone()),
        active: true,
        observations: prior.map_or(1, |c| {
            c.observations + u32::from(c.evidence != next_evidence)
        }),
        evidence: next_evidence,
        visible_since: prior.map_or(now, |c| c.visible_since),
        promoted_at: prior.and_then(|c| c.promoted_at),
        promotion_ready: false,
        merge_target: prior.and_then(|c| c.merge_target.clone()),
        merge_observations: prior.map_or(0, |c| c.merge_observations),
        merge_evidence: prior.map_or_else(String::new, |c| c.merge_evidence.clone()),
    }
}

/// Provider changes retain identities and geography, but require fresh branching evidence.
pub(super) fn reset_model_evidence(previous: &mut MapState, model: &str, now: u64) {
    if previous.model == model {
        return;
    }
    for cloud in &mut previous.clouds {
        cloud.observations = 0;
        cloud.evidence.clear();
        cloud.visible_since = now;
        cloud.promotion_ready = false;
        cloud.merge_target = None;
        cloud.merge_observations = 0;
        cloud.merge_evidence.clear();
        cloud.name_prototype.clear();
        cloud.theme_prototype.clear();
    }
}

pub(super) fn reconcile(
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    previous: &MapState,
    now: u64,
) -> Result<(Vec<CloudSpec>, Vec<MapCloud>), String> {
    let mut semantic_nodes = nodes
        .iter()
        .filter(|n| n.has_semantic_content)
        .cloned()
        .collect::<Vec<_>>();
    let semantic_ids = semantic_nodes
        .iter()
        .map(|n| n.id.as_str())
        .collect::<HashSet<_>>();
    let semantic_edges = edges
        .iter()
        .filter(|e| {
            semantic_ids.contains(e.source_id.as_str())
                && semantic_ids.contains(e.target_id.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();
    let candidates = geometry::candidate_clouds(&mut semantic_nodes, &semantic_edges);
    let roots = candidates
        .iter()
        .filter(|c| c.parent_id.is_none())
        .collect::<Vec<_>>();
    let paths: HashMap<_, _> = nodes
        .iter()
        .map(|n| (note_identity(n), n.id.clone()))
        .collect();
    let old = previous
        .clouds
        .iter()
        .filter(|c| c.active && c.parent.is_none())
        .filter(|c| {
            let ids = c
                .members
                .iter()
                .filter_map(|id| paths.get(id).cloned())
                .collect::<Vec<_>>();
            c.theme_prototype.is_empty()
                || similarity(&prototype(&ids, nodes), &c.theme_prototype) >= THEME_MIN
        })
        .collect::<Vec<_>>();
    // Refresh prototypes with current bytes. Stored model vectors are never mixed across providers.
    let old_prototypes = old
        .iter()
        .map(|c| {
            let ids = c
                .members
                .iter()
                .filter_map(|id| paths.get(id).cloned())
                .collect::<Vec<_>>();
            prototype(&ids, nodes)
        })
        .collect::<Vec<_>>();
    let mut candidate_ids = Vec::new();
    let mut candidate_vectors = Vec::new();
    for root in &roots {
        let members = root
            .member_node_ids
            .iter()
            .filter_map(|id| nodes.iter().find(|n| &n.id == id))
            .map(note_identity)
            .collect::<Vec<_>>();
        let best = old
            .iter()
            .enumerate()
            .map(|(i, c)| (i, overlap(&members, &c.members)))
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)));
        candidate_ids.push(match best {
            Some((i, score))
                if score >= 0.25
                    || members
                        .iter()
                        .filter(|id| old[i].members.contains(id))
                        .count()
                        * 2
                        >= members.len() =>
            {
                old[i].id.clone()
            }
            _ => format!("cloud-{}", opaque_id()?),
        });
        candidate_vectors.push(prototype(&root.member_node_ids, nodes));
    }
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for node in nodes.iter().filter(|n| n.has_semantic_content) {
        let proposed = roots
            .iter()
            .position(|c| c.member_node_ids.contains(&node.id));
        let prior = previous
            .nodes
            .iter()
            .find(|n| n.identity == note_identity(node))
            .and_then(|n| n.cloud.as_ref());
        let best_old = old_prototypes
            .iter()
            .enumerate()
            .map(|(i, p)| (i, similarity(&node.embedding, p)))
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)));
        let mut target = proposed.map(|i| candidate_ids[i].clone());
        let candidate_score =
            proposed.map_or(-1.0, |i| similarity(&node.embedding, &candidate_vectors[i]));
        if node.has_semantic_content && candidate_score < THEME_MIN {
            target = None;
        }
        if let Some((i, score)) = best_old.filter(|_| node.has_semantic_content) {
            if score >= THEME_MIN && score + RETENTION_MARGIN >= candidate_score {
                target = Some(old[i].id.clone());
            }
            if let Some(prior_index) = prior.and_then(|id| old.iter().position(|c| &c.id == id)) {
                let prior_score = similarity(&node.embedding, &old_prototypes[prior_index]);
                if prior_score >= THEME_MIN
                    && prior_score + RETENTION_MARGIN >= score.max(candidate_score)
                {
                    target = Some(old[prior_index].id.clone());
                }
            }
        }
        // Candidate isolation remains authoritative for genuinely unrelated notes.
        if let Some(id) = target {
            groups.entry(id).or_default().push(node.id.clone());
        }
    }
    groups.retain(|id, members| {
        members.len() >= CLOUD_MIN_NOTES || (members.len() >= 2 && old.iter().any(|c| &c.id == id))
    });
    let root_ids = groups.keys().cloned().collect::<Vec<_>>();
    let mut specs = geometry::cloud_specs_for_groups(nodes, edges, groups.into_values().collect());
    let mut replacements = HashMap::new();
    let mut used = HashSet::new();
    for (spec, id) in specs.iter().filter(|s| s.parent_id.is_none()).zip(root_ids) {
        replacements.insert(spec.id.clone(), id.clone());
        used.insert(id);
    }
    for spec in specs.iter().filter(|s| s.parent_id.is_some()) {
        let parent = replacements.get(spec.parent_id.as_ref().unwrap()).unwrap();
        let members = spec
            .member_node_ids
            .iter()
            .filter_map(|id| nodes.iter().find(|n| &n.id == id))
            .map(note_identity)
            .collect::<Vec<_>>();
        let best = previous
            .clouds
            .iter()
            .filter(|c| c.active && c.parent.as_ref() == Some(parent) && !used.contains(&c.id))
            .map(|c| (c, overlap(&members, &c.members)))
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.id.cmp(&a.0.id)));
        let id = match best {
            Some((c, score)) if score >= 0.30 => c.id.clone(),
            _ => format!("cloud-{}", opaque_id()?),
        };
        used.insert(id.clone());
        replacements.insert(spec.id.clone(), id);
    }
    for spec in &mut specs {
        spec.id = replacements[&spec.id].clone();
        spec.parent_id = spec.parent_id.as_ref().map(|id| replacements[id].clone());
        spec.child_cloud_ids = spec
            .child_cloud_ids
            .iter()
            .map(|id| replacements[id].clone())
            .collect();
    }
    let mut memory = specs
        .iter()
        .map(|s| record(s, nodes, previous.clouds.iter().find(|c| c.id == s.id), now))
        .collect::<Vec<_>>();
    // A genuinely replaced theme gets a fresh identity, but stays near its predecessor.
    for cloud in memory.iter_mut().filter(|c| c.parent.is_none()) {
        if previous.clouds.iter().any(|c| c.id == cloud.id) {
            continue;
        }
        let predecessor = previous
            .clouds
            .iter()
            .filter(|c| {
                c.active && c.parent.is_none() && !old.iter().any(|retained| retained.id == c.id)
            })
            .map(|c| (c, overlap(&cloud.members, &c.members)))
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((prior, score)) = predecessor.filter(|(_, score)| *score >= 0.25) {
            let _ = score;
            cloud.family = Some(prior.id.clone());
            cloud.position = prior.position;
            cloud.hull = prior.hull.clone();
            cloud.radius = prior.radius;
        }
    }
    let candidate_members = roots
        .iter()
        .map(|candidate| {
            candidate
                .member_node_ids
                .iter()
                .filter_map(|id| nodes.iter().find(|n| &n.id == id))
                .map(note_identity)
                .collect::<HashSet<_>>()
        })
        .collect::<Vec<_>>();
    // Merging requires a shared current community and several distinct corroborating updates.
    let root_indices = memory
        .iter()
        .enumerate()
        .filter(|(_, c)| c.parent.is_none())
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    let mut consumed = HashSet::new();
    let mut merge_supported = HashSet::new();
    for &a in &root_indices {
        for &b in &root_indices {
            if a >= b || consumed.contains(&a) || consumed.contains(&b) {
                continue;
            }
            if similarity(&memory[a].prototype, &memory[b].prototype) < 0.96 {
                continue;
            }
            let shared = candidate_members.iter().any(|members| {
                [&memory[a], &memory[b]].iter().all(|c| {
                    c.members.iter().filter(|id| members.contains(*id)).count() * 2
                        >= c.members.len()
                })
            });
            if !shared {
                continue;
            }
            let (keep, lose) = if memory[a].members.len() >= memory[b].members.len() {
                (a, b)
            } else {
                (b, a)
            };
            merge_supported.insert(keep);
            let fingerprint = format!("{}:{}", memory[keep].evidence, memory[lose].evidence);
            let target = memory[lose].id.clone();
            if memory[keep].merge_target.as_ref() != Some(&target) {
                memory[keep].merge_observations = 0;
            }
            if memory[keep].merge_evidence != fingerprint {
                memory[keep].merge_observations += 1;
            }
            memory[keep].merge_target = Some(target.clone());
            memory[keep].merge_evidence = fingerprint;
            let required =
                if memory[keep].promoted_at.is_some() || memory[lose].promoted_at.is_some() {
                    4
                } else {
                    3
                };
            if memory[keep].merge_observations < required {
                continue;
            }
            let keep_id = memory[keep].id.clone();
            let victim = specs.iter().find(|s| s.id == target).cloned().unwrap();
            let survivor = specs.iter_mut().find(|s| s.id == keep_id).unwrap();
            survivor.member_node_ids.extend(victim.member_node_ids);
            survivor.child_cloud_ids.extend(victim.child_cloud_ids);
            for s in &mut specs {
                if s.parent_id.as_ref() == Some(&target) {
                    s.parent_id = Some(keep_id.clone());
                }
            }
            specs.retain(|s| s.id != target);
            memory[lose].active = false;
            memory[lose].promotion_ready = false;
            for c in &mut memory {
                if c.parent.as_ref() == Some(&target) {
                    c.parent = Some(keep_id.clone());
                }
            }
            consumed.insert(keep);
            consumed.insert(lose);
        }
    }
    for index in root_indices {
        if !merge_supported.contains(&index) {
            memory[index].merge_target = None;
            memory[index].merge_observations = 0;
            memory[index].merge_evidence.clear();
        }
    }
    // Promote the branch while retaining the parent as the best original continuation.
    let parents = specs
        .iter()
        .filter(|s| s.parent_id.is_none())
        .map(|s| s.id.clone())
        .collect::<Vec<_>>();
    for parent in parents {
        let children = specs
            .iter()
            .filter(|s| {
                s.parent_id.as_ref() == Some(&parent)
                    && s.member_node_ids.len() >= SUBCLOUD_PROMOTE_MIN
            })
            .map(|s| s.id.clone())
            .collect::<Vec<_>>();
        if children.len() < 2 {
            continue;
        }
        let parent_index = specs.iter().position(|s| s.id == parent).unwrap();
        let parent_size = specs[parent_index].member_node_ids.len();
        let parent_prototype = memory
            .iter()
            .find(|c| c.id == parent)
            .map(|c| c.theme_prototype.clone())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| prototype(&specs[parent_index].member_node_ids, nodes));
        let continuation = children
            .iter()
            .max_by(|a, b| {
                let ca = memory.iter().find(|c| &c.id == *a).unwrap();
                let cb = memory.iter().find(|c| &c.id == *b).unwrap();
                similarity(&ca.prototype, &parent_prototype)
                    .total_cmp(&similarity(&cb.prototype, &parent_prototype))
                    .then_with(|| b.cmp(a))
            })
            .unwrap()
            .clone();
        let mut ranked = children
            .iter()
            .map(|id| {
                let c = memory.iter().find(|c| &c.id == id).unwrap();
                (similarity(&c.prototype, &parent_prototype), c.members.len())
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
        let covered = specs
            .iter()
            .filter(|s| s.parent_id.as_ref() == Some(&parent))
            .map(|s| s.member_node_ids.len())
            .sum::<usize>();
        let balanced = ranked.len() >= 2
            && (ranked[0].0 - ranked[1].0).abs() < 0.05
            && ranked.iter().map(|(_, n)| *n).max().unwrap_or(0) * 5
                <= specs[parent_index].member_node_ids.len() * 3
            && covered == specs[parent_index].member_node_ids.len();
        let all_supported = children.iter().all(|id| {
            let c = memory.iter().find(|c| &c.id == id).unwrap();
            let separation = children
                .iter()
                .filter(|other| *other != id)
                .map(|other| {
                    1.0 - similarity(
                        &c.prototype,
                        &memory.iter().find(|c| &c.id == other).unwrap().prototype,
                    )
                })
                .fold(1.0_f32, f32::min);
            separation >= CHILD_PARTITION_SEPARATION_MIN
                && (parent_size >= TOP_CLOUD_SOFT_MAX || separation >= 0.35)
                && (c.observations >= 2 || separation >= 0.35)
        });
        let all_ready = all_supported
            && children.iter().all(|id| {
                now.saturating_sub(memory.iter().find(|c| &c.id == id).unwrap().visible_since)
                    >= BRANCH_PRESENTATION_MILLIS
            });
        for child in children
            .iter()
            .filter(|id| **id != continuation || balanced)
        {
            let ci = memory.iter().position(|c| &c.id == child).unwrap();
            let separation = children
                .iter()
                .filter(|id| *id != child)
                .map(|id| {
                    1.0 - similarity(
                        &memory[ci].prototype,
                        &memory.iter().find(|c| &c.id == id).unwrap().prototype,
                    )
                })
                .fold(1.0_f32, f32::min);
            let eligible = separation >= CHILD_PARTITION_SEPARATION_MIN
                && (parent_size >= TOP_CLOUD_SOFT_MAX || separation >= 0.35);
            memory[ci].promotion_ready = eligible && (!balanced || all_supported);
            if !eligible
                || now.saturating_sub(memory[ci].visible_since) < BRANCH_PRESENTATION_MILLIS
                || (balanced && !all_ready)
            {
                continue;
            }
            if memory[ci].observations < 2 && separation < 0.35 {
                continue;
            }
            let si = specs.iter().position(|s| &s.id == child).unwrap();
            let departed: HashSet<_> = specs[si].member_node_ids.iter().cloned().collect();
            specs[parent_index]
                .member_node_ids
                .retain(|id| !departed.contains(id));
            specs[parent_index].child_cloud_ids.retain(|id| id != child);
            specs[si].parent_id = None;
            specs[si].level = 0;
            memory[ci].parent = None;
            memory[ci].family = Some(parent.clone());
            memory[ci].promoted_at = Some(now);
            memory[ci].promotion_ready = false;
        }
    }
    let empty = specs
        .iter()
        .filter(|s| s.member_node_ids.is_empty())
        .map(|s| s.id.clone())
        .collect::<HashSet<_>>();
    specs.retain(|s| !empty.contains(&s.id));
    for cloud in &mut memory {
        if empty.contains(&cloud.id) {
            cloud.active = false;
            cloud.promotion_ready = false;
        }
    }
    // Parent records reflect departures. Retire obsolete child identities without recycling names.
    for cloud in &mut memory {
        if let Some(spec) = specs.iter().find(|s| s.id == cloud.id) {
            cloud.members = spec
                .member_node_ids
                .iter()
                .filter_map(|id| nodes.iter().find(|n| &n.id == id))
                .map(note_identity)
                .collect();
            cloud.prototype = prototype(&spec.member_node_ids, nodes);
        }
    }
    for prior in &previous.clouds {
        if !memory.iter().any(|c| c.id == prior.id) {
            let mut retired = prior.clone();
            retired.active = false;
            retired.promotion_ready = false;
            memory.push(retired);
        }
    }
    apply_membership(nodes, &specs);
    Ok((specs, memory))
}

pub(super) fn apply_membership(nodes: &mut [WorkingNode], specs: &[CloudSpec]) {
    for n in nodes {
        n.cloud_id = None;
        n.parent_cloud_id = None;
        n.child_cloud_id = None;
        n.isolated = true;
        for s in specs.iter().filter(|s| s.member_node_ids.contains(&n.id)) {
            if let Some(parent) = &s.parent_id {
                n.parent_cloud_id = Some(parent.clone());
                n.child_cloud_id = Some(s.id.clone());
            } else {
                n.cloud_id = Some(s.id.clone());
                n.isolated = false;
            }
        }
    }
}

pub(super) fn capture(state: &mut MapState, nodes: &[WorkingNode], clouds: &[AtlasCloud]) {
    state.placement_version = stable_layout::PLACEMENT_VERSION;
    state.nodes = nodes
        .iter()
        .map(|n| MapNote {
            identity: note_identity(n),
            path: n.note_path.clone(),
            position: [n.x, n.y],
            cloud: n.cloud_id.clone(),
            title: n.file_name.clone(),
        })
        .collect();
    for saved in state.clouds.iter_mut().filter(|c| c.active) {
        if let Some(cloud) = clouds.iter().find(|c| c.id == saved.id) {
            saved.position = cloud.centroid;
            saved.radius = cloud.radius;
            saved.hull = cloud.hull.clone();
            if saved.color[3] == 0 {
                saved.color = cloud.color;
            }
        }
    }
}

pub(super) fn promotion_pending(state: &MapState) -> bool {
    state.clouds.iter().any(|c| {
        c.active
            && c.parent.is_some()
            && c.promotion_ready
            && (c.observations >= 2 || {
                let others = state
                    .clouds
                    .iter()
                    .filter(|o| o.active && o.parent == c.parent && o.id != c.id);
                others
                    .map(|o| 1.0 - similarity(&c.prototype, &o.prototype))
                    .fold(1.0_f32, f32::min)
                    >= 0.35
            })
    })
}

pub(super) fn promotion_due(state: &MapState, now: u64) -> bool {
    promotion_pending(state)
        && state.clouds.iter().any(|c| {
            c.active
                && c.promotion_ready
                && now.saturating_sub(c.visible_since) >= BRANCH_PRESENTATION_MILLIS
        })
}

#[cfg(test)]
#[path = "continuity_tests.rs"]
mod tests;
