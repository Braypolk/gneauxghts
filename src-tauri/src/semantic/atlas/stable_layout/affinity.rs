//! A bounded, one-time improvement of region proximity. Never an edit-time force.
use super::*;
use std::collections::BTreeMap;

/// Shared by migration and arrival seeding: aggregate the same strong graph.
pub(super) fn relationships(
    groups: &[Group],
    nodes: &[WorkingNode],
    edges: &[LayoutEdge],
) -> Vec<Vec<(usize, f32)>> {
    let node_indices = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect::<HashMap<_, _>>();
    let mut owner = vec![None; nodes.len()];
    for (group, region) in groups.iter().enumerate() {
        for &i in &region.members {
            owner[i] = Some(group);
        }
    }
    let mut strong = edges
        .iter()
        .filter(|e| e.weight >= 0.7)
        .filter_map(|e| {
            Some((
                *node_indices.get(e.source_id.as_str())?,
                *node_indices.get(e.target_id.as_str())?,
                e.weight,
            ))
        })
        .collect::<Vec<_>>();
    strong.sort_by(|a, b| {
        nodes[a.0]
            .id
            .cmp(&nodes[b.0].id)
            .then_with(|| nodes[a.1].id.cmp(&nodes[b.1].id))
    });
    let mut degree = vec![0.0_f32; nodes.len()];
    for &(a, b, weight) in &strong {
        degree[a] += weight;
        degree[b] += weight;
    }
    let mut affinities = BTreeMap::<(usize, usize), f32>::new();
    for (a, b, weight) in strong {
        let (Some(left), Some(right)) = (owner[a], owner[b]) else {
            continue;
        };
        // Isolated notes remain obstacles; they don't pull regions around.
        if left == right || nodes[a].cloud_id.is_none() || nodes[b].cloud_id.is_none() {
            continue;
        }
        let pair = (left.min(right), left.max(right));
        // Bound a hub's contribution and normalize for cloud size, so many
        // generic links cannot overwhelm a smaller, coherent relationship.
        *affinities.entry(pair).or_default() += weight
            / (degree[a] * degree[b]).sqrt()
            / ((groups[left].members.len() * groups[right].members.len()) as f32).sqrt();
    }
    let mut neighbors = vec![Vec::new(); groups.len()];
    for ((a, b), weight) in affinities {
        neighbors[a].push((b, weight));
        neighbors[b].push((a, weight));
    }
    neighbors
}

/// Children share a parent fill but need distinct sibling territories. Work
/// bottom-up, retaining each child's internal layout and ungrouped parent notes.
pub(super) fn separate_children(
    nodes: &mut [WorkingNode],
    clouds: &mut [AtlasCloud],
    memory: &[MapCloud],
    affected: &HashSet<String>,
) -> bool {
    let mut parents = (0..clouds.len())
        .filter(|&i| {
            clouds
                .iter()
                .any(|c| c.parent_id.as_ref() == Some(&clouds[i].id))
        })
        .collect::<Vec<_>>();
    parents.sort_by_key(|&i| (std::cmp::Reverse(clouds[i].level), clouds[i].id.clone()));
    let mut changed = false;
    for parent in parents {
        if !affected.contains(&clouds[parent].id) {
            continue;
        }
        let mut groups = clouds
            .iter()
            .filter(|c| c.parent_id.as_ref() == Some(&clouds[parent].id))
            .map(|c| Group {
                id: c.id.clone(),
                members: nodes
                    .iter()
                    .enumerate()
                    .filter(|(_, n)| c.member_node_ids.contains(&n.id))
                    .map(|(i, _)| i)
                    .collect(),
                center: c.centroid,
                radius: c.radius,
            })
            .filter(|g| !g.members.is_empty())
            .collect::<Vec<_>>();
        groups.sort_by(|a, b| a.id.cmp(&b.id));
        let assigned = groups
            .iter()
            .flat_map(|g| g.members.iter().copied())
            .collect::<HashSet<_>>();
        let mut stationary = groups
            .iter()
            .enumerate()
            .filter(|(_, g)| !affected.contains(&g.id))
            .map(|(i, _)| i)
            .collect::<HashSet<_>>();
        for (i, n) in nodes.iter().enumerate().filter(|(i, n)| {
            clouds[parent].member_node_ids.contains(&n.id) && !assigned.contains(i)
        }) {
            stationary.insert(groups.len());
            groups.push(Group {
                id: n.id.clone(),
                members: vec![i],
                center: [n.x, n.y],
                radius: 0.0,
            });
        }
        let mut territories = groups
            .iter()
            .map(|g| territory::Territory::for_group(g, nodes, clouds))
            .collect::<Vec<_>>();
        let offsets = territory::separate(&groups, &mut territories, &stationary);
        let mut dirty = HashSet::new();
        for (group, delta) in groups.iter().zip(offsets) {
            if delta == [0.0, 0.0] {
                continue;
            }
            let ids = group
                .members
                .iter()
                .map(|&i| nodes[i].id.clone())
                .collect::<HashSet<_>>();
            for &i in &group.members {
                nodes[i].x += delta[0];
                nodes[i].y += delta[1];
            }
            for cloud in clouds
                .iter()
                .filter(|c| c.member_node_ids.iter().any(|id| ids.contains(id)))
            {
                dirty.insert(cloud.id.clone());
            }
            for cloud in clouds.iter_mut().filter(|c| {
                !c.member_node_ids.is_empty() && c.member_node_ids.iter().all(|id| ids.contains(id))
            }) {
                cloud.centroid[0] += delta[0];
                cloud.centroid[1] += delta[1];
            }
        }
        if !dirty.is_empty() {
            changed = true;
            // The parent's silhouette changes when children separate; subsequent
            // ancestors and root placement must see that updated visible shape.
            outlines::finish(clouds, memory, nodes, Some(&dirty));
        }
    }
    changed
}

pub(super) fn arrange(
    groups: &mut [Group],
    nodes: &mut [WorkingNode],
    edges: &[LayoutEdge],
    clouds: &[AtlasCloud],
    optimize: bool,
    affected: &HashSet<String>,
) -> bool {
    let mut territories = groups
        .iter()
        .map(|g| territory::Territory::for_group(g, nodes, clouds))
        .collect::<Vec<_>>();
    let stationary = groups
        .iter()
        .enumerate()
        .filter(|(_, g)| nodes[g.members[0]].cloud_id.is_none() || !affected.contains(&g.id))
        .map(|(i, _)| i)
        .collect();
    let mut offsets = territory::separate(groups, &mut territories, &stationary);
    if optimize {
        let neighbors = relationships(groups, nodes, edges);
        let repaired = offsets.clone();
        // Attraction is subordinate to whole-region clearance. Strictly
        // improving moves and fixed budgets preserve the bounded migration.
        for step in [256.0_f32, 128.0, 64.0, 32.0, 16.0] {
            for _ in 0..16 {
                let mut changed = false;
                for a in 0..groups.len() {
                    if neighbors[a].is_empty() {
                        continue;
                    }
                    let score = |delta: [f32; 2]| {
                        let total = neighbors[a].iter().map(|(_, w)| w).sum::<f32>();
                        let travel = (offsets[a][0] + delta[0] - repaired[a][0]).powi(2)
                            + (offsets[a][1] + delta[1] - repaired[a][1]).powi(2);
                        neighbors[a]
                            .iter()
                            .map(|&(b, weight)| {
                                weight
                                    * (territories[a].gap(&territories[b], delta) - SPACING * 4.0)
                                        .max(0.0)
                                        .powi(2)
                            })
                            .sum::<f32>()
                            + total * 0.15 * travel
                    };
                    let mut best = ([0.0, 0.0], score([0.0, 0.0]));
                    for (x, y) in [
                        (1.0, 0.0),
                        (-1.0, 0.0),
                        (0.0, 1.0),
                        (0.0, -1.0),
                        (1.0, 1.0),
                        (1.0, -1.0),
                        (-1.0, 1.0),
                        (-1.0, -1.0),
                    ] {
                        let delta = [step * x, step * y];
                        let value = score(delta);
                        if value < best.1 - 0.01
                            && territories
                                .iter()
                                .enumerate()
                                .all(|(b, other)| a == b || territories[a].gap(other, delta) >= GAP)
                        {
                            best = (delta, value);
                        }
                    }
                    if best.0 == [0.0, 0.0] {
                        continue;
                    }
                    changed = true;
                    territories[a].shift(best.0);
                    for axis in 0..2 {
                        offsets[a][axis] += best.0[axis];
                    }
                }
                if !changed {
                    break;
                }
            }
        }
    }
    let moved = offsets.iter().any(|d| *d != [0.0, 0.0]);
    for (group, delta) in groups.iter_mut().zip(offsets) {
        group.center[0] += delta[0];
        group.center[1] += delta[1];
        for &i in &group.members {
            nodes[i].x += delta[0];
            nodes[i].y += delta[1];
        }
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_does_not_turn_padding_proximity_into_filename_overlap() {
        let mut nodes = [
            ("a", 0.0, Some("a")),
            ("b", 332.0, Some("b")),
            ("isolated", 80.0, None),
        ]
        .into_iter()
        .map(|(id, x, cloud)| WorkingNode {
            id: id.into(),
            note_id: Some(id.into()),
            note_path: format!("/vault/{id}.md"),
            title: id.into(),
            file_name: "aaaaaaaaaaaaa.md".into(),
            preview: String::new(),
            tags: Vec::new(),
            created_at_millis: 100,
            updated_at_millis: 100,
            last_viewed_at_millis: None,
            centrality: 0.5,
            importance: 0.0,
            embedding: vec![1.0, 0.0],
            x,
            y: 0.0,
            cloud_id: cloud.map(String::from),
            parent_cloud_id: None,
            child_cloud_id: None,
            isolated: cloud.is_none(),
        })
        .collect::<Vec<_>>();
        let mut groups = nodes
            .iter()
            .enumerate()
            .map(|(i, node)| Group {
                id: node.id.clone(),
                members: vec![i],
                center: [node.x, node.y],
                radius: 64.0,
            })
            .collect::<Vec<_>>();
        let width = half_width(&nodes[0]);
        assert!(!collides([0.0, 0.0], width, [80.0, 0.0], width));
        assert!(collides(
            [0.0, 0.0],
            width + GAP / 2.0,
            [80.0, 0.0],
            width + GAP / 2.0
        ));

        arrange(
            &mut groups,
            &mut nodes,
            &[LayoutEdge {
                source_id: "a".into(),
                target_id: "b".into(),
                weight: 0.95,
            }],
            &[],
            true,
            &HashSet::from(["a".into(), "b".into()]),
        );

        assert_eq!([nodes[2].x, nodes[2].y], [80.0, 0.0]);
        assert!((nodes[0].x - nodes[1].x).hypot(nodes[0].y - nodes[1].y) < 332.0);
        for a in 0..nodes.len() {
            for b in a + 1..nodes.len() {
                assert!(
                    !collides(
                        [nodes[a].x, nodes[a].y],
                        half_width(&nodes[a]),
                        [nodes[b].x, nodes[b].y],
                        half_width(&nodes[b])
                    ),
                    "migration introduced a collision between {} and {}",
                    nodes[a].id,
                    nodes[b].id
                );
            }
        }
    }
}
