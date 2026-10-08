//! Accepted world geometry includes readable note spacing. Camera and viewport never enter here.
use super::map_store::{MapCloud, MapState};
use super::*;

const SPACING: f32 = 42.0;
const TEXT_SIZE: f32 = 6.5;
const GAP: f32 = 28.0;

fn visible_title(node: &WorkingNode) -> String {
    let title = node
        .file_name
        .strip_suffix(".md")
        .unwrap_or(&node.file_name);
    if title.chars().count() > 60 {
        format!("{}…", title.chars().take(59).collect::<String>().trim_end())
    } else {
        title.into()
    }
}
fn half_width(node: &WorkingNode) -> f32 {
    visible_title(node)
        .chars()
        .map(|c| {
            if "ilI.,:;!| ".contains(c) {
                0.3
            } else if "MW@%".contains(c) {
                0.85
            } else {
                0.56
            }
        })
        .sum::<f32>()
        * TEXT_SIZE
        * 1.12
        / 2.0
        + 3.0
}
fn collides(a: [f32; 2], aw: f32, b: [f32; 2], bw: f32) -> bool {
    let dx = (a[0] - b[0]).abs();
    let dy = (a[1] - b[1]).abs();
    dx * dx + dy * dy < SPACING * SPACING || (dx < aw + bw && dy < 18.0)
}
struct Group {
    id: String,
    members: Vec<usize>,
    center: [f32; 2],
    radius: f32,
    changed: bool,
    retained: bool,
}

pub(super) fn place(
    nodes: &mut [WorkingNode],
    specs: &mut [CloudSpec],
    memory: &[MapCloud],
    previous: &MapState,
) {
    let saved: HashMap<_, _> = previous
        .nodes
        .iter()
        .map(|n| (n.identity.as_str(), n))
        .collect();
    let mut existing = HashSet::new();
    for n in nodes.iter_mut() {
        if let Some(old) = saved.get(continuity::note_identity(n).as_str()) {
            let promoted = n.cloud_id.as_ref().is_some_and(|id| {
                previous.clouds.iter().any(|c| {
                    &c.id == id
                        && c.parent == old.cloud
                        && c.members.contains(&continuity::note_identity(n))
                })
            });
            let successor = n.cloud_id.as_ref().is_some_and(|id| {
                memory
                    .iter()
                    .any(|c| &c.id == id && c.family.is_some() && c.family == old.cloud)
            });
            if old.cloud == n.cloud_id || promoted || successor {
                n.x = old.position[0];
                n.y = old.position[1];
                existing.insert(n.id.clone());
            }
        }
    }
    // New notes start by their nearest current thematic neighbors, never by a global redraw.
    let targets = nodes
        .iter()
        .filter(|n| !existing.contains(&n.id))
        .map(|n| {
            let nearest = nodes
                .iter()
                .filter(|other| {
                    existing.contains(&other.id)
                        && other.cloud_id == n.cloud_id
                        && n.cloud_id.is_some()
                })
                .max_by(|a, b| {
                    dot(&n.embedding, &a.embedding)
                        .total_cmp(&dot(&n.embedding, &b.embedding))
                        .then_with(|| b.id.cmp(&a.id))
                });
            (n.id.clone(), nearest.map(|p| [p.x, p.y]))
        })
        .collect::<HashMap<_, _>>();
    for n in nodes.iter_mut() {
        if let Some(Some(p)) = targets.get(&n.id) {
            n.x = p[0];
            n.y = p[1];
        }
    }
    let mut groups = Vec::new();
    for spec in specs.iter().filter(|s| s.parent_id.is_none()) {
        let members = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.cloud_id.as_ref() == Some(&spec.id))
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        if members.is_empty() {
            continue;
        }
        let prior = previous.clouds.iter().find(|c| c.active && c.id == spec.id);
        let remembered = memory.iter().find(|c| c.id == spec.id);
        let center = prior
            .or(remembered.filter(|c| !c.hull.is_empty()))
            .map_or_else(|| mean(&members, nodes), |c| c.position);
        let identities = members
            .iter()
            .map(|i| continuity::note_identity(&nodes[*i]))
            .collect::<HashSet<_>>();
        let changed = prior
            .is_none_or(|c| c.members.iter().cloned().collect::<HashSet<_>>() != identities)
            || members.iter().any(|i| {
                saved
                    .get(continuity::note_identity(&nodes[*i]).as_str())
                    .is_none_or(|n| n.title != nodes[*i].file_name)
            });
        groups.push(Group {
            id: spec.id.clone(),
            members,
            center,
            radius: 0.0,
            changed,
            retained: prior.is_some(),
        });
    }
    for (i, node) in nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.cloud_id.is_none())
    {
        groups.push(Group {
            id: node.id.clone(),
            members: vec![i],
            center: [node.x, node.y],
            radius: 0.0,
            changed: !existing.contains(&node.id),
            retained: existing.contains(&node.id),
        });
    }
    groups.sort_by(|a, b| a.id.cmp(&b.id));
    for group in &mut groups {
        let mut order = group.members.clone();
        order.sort_by_key(|i| {
            let n = &nodes[*i];
            let old = saved.get(continuity::note_identity(n).as_str()).copied();
            (
                old.is_none_or(|o| o.cloud != n.cloud_id || o.title != n.file_name),
                continuity::note_identity(n),
            )
        });
        let mut placed: Vec<([f32; 2], f32)> = Vec::new();
        // Spatial buckets keep dense label packing local.
        let mut cells: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for index in order {
            let preferred = [nodes[index].x, nodes[index].y];
            let width = half_width(&nodes[index]);
            let overlaps = |p: [f32; 2],
                            placed: &[([f32; 2], f32)],
                            cells: &HashMap<(i32, i32), Vec<usize>>| {
                let reach = width.max(SPACING);
                for x in ((p[0] - reach) / SPACING).floor() as i32
                    ..=((p[0] + reach) / SPACING).floor() as i32
                {
                    for y in ((p[1] - SPACING) / SPACING).floor() as i32
                        ..=((p[1] + SPACING) / SPACING).floor() as i32
                    {
                        if let Some(bucket) = cells.get(&(x, y)) {
                            for &i in bucket {
                                if collides(p, width, placed[i].0, placed[i].1) {
                                    return true;
                                }
                            }
                        }
                    }
                }
                false
            };
            let mut point = preferred;
            if overlaps(point, &placed, &cells) {
                'rings: for ring in 1..10_000 {
                    let radius = ring as f32 * 6.0;
                    let attempts = (radius / 3.0).ceil().max(16.0) as usize;
                    for step in 0..attempts {
                        let angle = step as f32 / attempts as f32 * std::f32::consts::TAU;
                        let p = [
                            preferred[0] + radius * angle.cos(),
                            preferred[1] + radius * angle.sin(),
                        ];
                        if !overlaps(p, &placed, &cells) {
                            point = p;
                            break 'rings;
                        }
                    }
                }
            }
            let item = placed.len();
            placed.push((point, width));
            for x in ((point[0] - width) / SPACING).floor() as i32
                ..=((point[0] + width) / SPACING).floor() as i32
            {
                for y in ((point[1] - 18.0) / SPACING).floor() as i32
                    ..=((point[1] + 18.0) / SPACING).floor() as i32
                {
                    cells.entry((x, y)).or_default().push(item);
                }
            }
            nodes[index].x = point[0];
            nodes[index].y = point[1];
        }
        group.radius = group
            .members
            .iter()
            .map(|i| {
                let n = &nodes[*i];
                let dx = (n.x - group.center[0]).abs() + half_width(n) + 24.0;
                let dy = (n.y - group.center[1]).abs() + 42.0;
                (dx * dx + dy * dy).sqrt()
            })
            .fold(64.0, f32::max);
    }
    // Visible children need their own local space inside the parent's envelope.
    for group in &mut groups {
        let children = specs
            .iter()
            .filter(|s| s.parent_id.as_ref() == Some(&group.id))
            .collect::<Vec<_>>();
        if children.is_empty() {
            continue;
        }
        let mut assigned = HashSet::new();
        let mut subgroups = Vec::new();
        for child in children {
            let members = group
                .members
                .iter()
                .copied()
                .filter(|i| child.member_node_ids.contains(&nodes[*i].id))
                .collect::<Vec<_>>();
            if members.is_empty() {
                continue;
            }
            assigned.extend(members.iter().copied());
            let center = mean(&members, nodes);
            let prior = previous
                .clouds
                .iter()
                .find(|c| c.active && c.id == child.id);
            let radius = members
                .iter()
                .map(|i| {
                    let n = &nodes[*i];
                    (n.x - center[0]).hypot(n.y - center[1]) + half_width(n) + 28.0
                })
                .fold(40.0, f32::max);
            subgroups.push(Group {
                id: child.id.clone(),
                members,
                center,
                radius,
                changed: group.changed,
                retained: prior.is_some(),
            });
        }
        for i in group
            .members
            .iter()
            .copied()
            .filter(|i| !assigned.contains(i))
        {
            subgroups.push(Group {
                id: nodes[i].id.clone(),
                members: vec![i],
                center: [nodes[i].x, nodes[i].y],
                radius: half_width(&nodes[i]) + 28.0,
                changed: group.changed,
                retained: existing.contains(&nodes[i].id),
            });
        }
        separate(&mut subgroups, nodes);
        group.radius = subgroups
            .iter()
            .map(|child| {
                (child.center[0] - group.center[0]).hypot(child.center[1] - group.center[1])
                    + child.radius * 1.05
                    + 24.0
            })
            .fold(group.radius, f32::max);
    }
    separate(&mut groups, nodes);
    for spec in specs {
        if spec.parent_id.is_none() {
            if let Some(g) = groups.iter().find(|g| g.id == spec.id) {
                spec.centroid = g.center;
                spec.radius = g.radius;
            }
        } else {
            let members = nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| spec.member_node_ids.contains(&n.id))
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            spec.centroid = mean(&members, nodes);
            spec.radius = members
                .iter()
                .map(|i| {
                    let n = &nodes[*i];
                    (n.x - spec.centroid[0]).hypot(n.y - spec.centroid[1]) + half_width(n) + 28.0
                })
                .fold(40.0, f32::max);
        }
    }
}
fn separate(groups: &mut [Group], nodes: &mut [WorkingNode]) {
    // A changed/new region yields to established neighbors. There is no attraction to the origin.
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
                let weight = |g: &Group| {
                    if !g.retained {
                        1.0
                    } else if g.changed {
                        8.0
                    } else {
                        1000.0
                    }
                };
                let wa = weight(&groups[a]);
                let wb = weight(&groups[b]);
                let a_share = wb / (wa + wb);
                let b_share = wa / (wa + wb);
                for (index, amount) in [
                    (a, -(overlap + 0.1) * a_share),
                    (b, (overlap + 0.1) * b_share),
                ] {
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
fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn mean(ids: &[usize], nodes: &[WorkingNode]) -> [f32; 2] {
    let count = ids.len().max(1) as f32;
    [
        ids.iter().map(|i| nodes[*i].x).sum::<f32>() / count,
        ids.iter().map(|i| nodes[*i].y).sum::<f32>() / count,
    ]
}

pub(super) fn finish(clouds: &mut [AtlasCloud], memory: &[MapCloud]) {
    for cloud in clouds {
        if let Some(saved) = memory.iter().find(|c| c.id == cloud.id) {
            if saved.color[3] != 0 {
                cloud.color = saved.color;
            }
            cloud.family_id = saved.family.clone();
        }
        let phase = (stable_hash(&cloud.id) % 1000) as f32 / 1000.0 * std::f32::consts::TAU;
        cloud.hull = (0..48)
            .map(|i| {
                let a = i as f32 / 48.0 * std::f32::consts::TAU;
                let r = cloud.radius * (1.025 + 0.015 * (a * 3.0 + phase).sin());
                [
                    cloud.centroid[0] + r * a.cos(),
                    cloud.centroid[1] + r * a.sin(),
                ]
            })
            .collect();
    }
}
