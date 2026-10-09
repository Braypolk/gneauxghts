use super::*;
use std::collections::BTreeMap;

/// Bulk separation is permitted only before there is accepted geography.
pub(super) fn separate_regions(
    groups: &mut [Group],
    nodes: &mut [WorkingNode],
    specs: &[CloudSpec],
) {
    for group in groups.iter_mut() {
        let mut assigned = HashSet::new();
        let mut children = Vec::new();
        for spec in specs
            .iter()
            .filter(|s| s.parent_id.as_ref() == Some(&group.id))
        {
            let members = group
                .members
                .iter()
                .copied()
                .filter(|i| spec.member_node_ids.contains(&nodes[*i].id))
                .collect::<Vec<_>>();
            if members.is_empty() {
                continue;
            }
            assigned.extend(members.iter().copied());
            let center = mean(&members, nodes);
            let radius = radius(&members, center, nodes);
            children.push(Group {
                id: spec.id.clone(),
                members,
                center,
                radius,
            });
        }
        if !children.is_empty() {
            for i in group
                .members
                .iter()
                .copied()
                .filter(|i| !assigned.contains(i))
            {
                children.push(Group {
                    id: nodes[i].id.clone(),
                    members: vec![i],
                    center: [nodes[i].x, nodes[i].y],
                    radius: half_width(&nodes[i]) + GAP,
                });
            }
            separate(&mut children, nodes);
        }
        group.radius = radius(&group.members, group.center, nodes);
    }
    separate(groups, nodes);
}

fn separate(groups: &mut [Group], nodes: &mut [WorkingNode]) {
    for _ in 0..360 {
        let mut collision = false;
        for a in 0..groups.len() {
            for b in a + 1..groups.len() {
                let dx = groups[b].center[0] - groups[a].center[0];
                let dy = groups[b].center[1] - groups[a].center[1];
                let d = dx.hypot(dy);
                let overlap = (groups[a].radius + groups[b].radius) * 1.05 + GAP - d;
                if overlap <= 0.01 {
                    continue;
                }
                collision = true;
                let phase = (stable_hash(&format!("{}:{}", groups[a].id, groups[b].id)) % 1000)
                    as f32
                    / 1000.0
                    * std::f32::consts::TAU;
                let unit = if d > 0.01 {
                    [dx / d, dy / d]
                } else {
                    [phase.cos(), phase.sin()]
                };
                for (index, amount) in [(a, -(overlap + 0.1) * 0.5), (b, (overlap + 0.1) * 0.5)] {
                    let delta = [unit[0] * amount, unit[1] * amount];
                    groups[index].center[0] += delta[0];
                    groups[index].center[1] += delta[1];
                    for &i in &groups[index].members {
                        nodes[i].x += delta[0];
                        nodes[i].y += delta[1];
                    }
                }
            }
        }
        if !collision {
            break;
        }
    }
}

/// Births have no accepted anchor. Give an entire new region one deterministic
/// seed beside related accepted geography, independent of migration/cache hints.
/// A transition to isolation uses the same free-space search as a singleton.
pub(super) fn seed_arrivals(
    nodes: &mut [WorkingNode],
    continuing: &HashSet<usize>,
    edges: &[LayoutEdge],
) {
    let mut regions = Vec::<Group>::new();
    let mut by_cloud = BTreeMap::<String, Vec<usize>>::new();
    for (i, node) in nodes.iter().enumerate() {
        if let Some(id) = &node.cloud_id {
            by_cloud.entry(id.clone()).or_default().push(i);
        }
    }
    let mut arrivals = Vec::new();
    for (id, members) in by_cloud {
        if members.iter().any(|i| continuing.contains(i)) {
            let accepted = members
                .iter()
                .copied()
                .filter(|i| continuing.contains(i))
                .collect::<Vec<_>>();
            let center = mean(&accepted, nodes);
            regions.push(Group {
                id,
                radius: radius(&accepted, center, nodes),
                members: accepted,
                center,
            });
        } else {
            arrivals.push(members);
        }
    }
    for (i, node) in nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.cloud_id.is_none())
    {
        if continuing.contains(&i) {
            regions.push(Group {
                id: node.id.clone(),
                members: vec![i],
                center: [node.x, node.y],
                radius: half_width(node) + GAP,
            });
        } else {
            arrivals.push(vec![i]);
        }
    }
    for members in &mut arrivals {
        members.sort_by_key(|i| continuity::note_identity(&nodes[*i]));
    }
    arrivals.sort_by_key(|members| continuity::note_identity(&nodes[members[0]]));
    for members in arrivals {
        let key = continuity::note_identity(&nodes[members[0]]);
        let extent = (members.len() as f32).sqrt()
            * (SPACING
                + members
                    .iter()
                    .map(|i| half_width(&nodes[*i]))
                    .fold(0.0_f32, f32::max));
        // Include the arriving group only while measuring its relationships.
        regions.push(Group {
            id: key.clone(),
            members: members.clone(),
            center: [0.0, 0.0],
            radius: extent,
        });
        let relationships = affinity::relationships(&regions, nodes, edges);
        let preferred = relationships
            .last()
            .unwrap()
            .iter()
            .max_by(|(a, aw), (b, bw)| {
                aw.total_cmp(bw)
                    .then_with(|| regions[*b].id.cmp(&regions[*a].id))
            })
            .map(|(index, _)| *index);
        regions.pop();
        let nearest = preferred.map(|i| &regions[i]).or_else(|| {
            regions.iter().max_by(|a, b| {
                let similarity = |g: &Group| {
                    members
                        .iter()
                        .map(|i| {
                            g.members
                                .iter()
                                .map(|j| dot(&nodes[*i].embedding, &nodes[*j].embedding))
                                .fold(f32::NEG_INFINITY, f32::max)
                        })
                        .sum::<f32>()
                        / members.len() as f32
                };
                similarity(a)
                    .total_cmp(&similarity(b))
                    .then_with(|| b.id.cmp(&a.id))
            })
        });
        let origin = nearest.map_or([0.0, 0.0], |g| g.center);
        let start = nearest.map_or(0.0, |g| g.radius + extent + GAP);
        let phase = (stable_hash(&key) % 10000) as f32 / 10000.0 * std::f32::consts::TAU;
        let mut center = origin;
        'rings: for ring in 0..10_000 {
            let distance = start + ring as f32 * SPACING;
            for step in 0..32 {
                let angle = phase + step as f32 / 32.0 * std::f32::consts::TAU;
                let candidate = [
                    origin[0] + distance * angle.cos(),
                    origin[1] + distance * angle.sin(),
                ];
                if regions.iter().all(|g| {
                    (candidate[0] - g.center[0]).hypot(candidate[1] - g.center[1])
                        >= g.radius + extent + GAP
                }) {
                    center = candidate;
                    break 'rings;
                }
            }
        }
        for &i in &members {
            nodes[i].x = center[0];
            nodes[i].y = center[1];
        }
        regions.push(Group {
            id: key,
            members,
            center,
            radius: extent,
        });
    }
}
