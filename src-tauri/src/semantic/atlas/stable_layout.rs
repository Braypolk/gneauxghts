//! Calculates accepted world geometry. No persistence, camera, or viewport effects.
use super::map_store::{MapCloud, MapState};
use super::*;
use rayon::prelude::*;

mod affinity;
mod density;
mod initial;
mod outlines;
mod recovery;
mod region_spacing;
mod territory;

const SPACING: f32 = 42.0;
const TEXT_SIZE: f32 = 6.5;
const GAP: f32 = 28.0;
pub(super) const PLACEMENT_VERSION: u32 = 6;

/// The production and sequence-test seam: initialization, placement, core
/// selection, and contours run in the same order against the same prior state.
pub(super) fn calculate(
    nodes: &mut [WorkingNode],
    specs: &mut [CloudSpec],
    memory: &[MapCloud],
    previous: &MapState,
    edges: &[LayoutEdge],
    links: &[WorkingLink],
    knn: &[Vec<KnnNeighbor>],
) -> Vec<AtlasCloud> {
    if previous.nodes.is_empty() {
        if apply_umap_layout(nodes, knn) {
            separate_umap_clouds(nodes, edges, specs, DEFAULT_LAYOUT_PULL);
        } else {
            place_cloud_first_layout(nodes, edges, specs, DEFAULT_LAYOUT_PULL);
        }
    }
    let mut groups = place(nodes, specs, memory, previous, edges);
    let affected = density::affected(nodes, specs, previous);
    let compacted = density::compact(nodes, specs, &affected);
    if compacted {
        refresh_specs(specs, nodes, &groups);
    }
    finalize_cloud_cores(nodes, edges, specs);
    let mut clouds = render(nodes, specs, memory, links);
    if !affected.is_empty() {
        let mut moved = affinity::separate_children(nodes, &mut clouds, memory, &affected);
        moved |= affinity::arrange(
            &mut groups,
            nodes,
            edges,
            &clouds,
            previous.nodes.is_empty() || previous.placement_version < 3,
            &affected,
        );
        if moved {
            refresh_specs(specs, nodes, &groups);
            // Canonicalize once from final coordinates, matching the next
            // generation's arithmetic and preventing tiny contour changes.
            finalize_cloud_cores(nodes, edges, specs);
            clouds = render(nodes, specs, memory, links);
        }
    }
    clouds
}

fn render(
    nodes: &[WorkingNode],
    specs: &[CloudSpec],
    memory: &[MapCloud],
    links: &[WorkingLink],
) -> Vec<AtlasCloud> {
    let mut clouds = specs
        .par_iter()
        .map(|s| cloud_metadata(s, nodes, links))
        .collect::<Vec<_>>();
    clouds.sort_by(|a, b| {
        a.level
            .cmp(&b.level)
            .then_with(|| b.note_count.cmp(&a.note_count))
            .then_with(|| a.id.cmp(&b.id))
    });
    outlines::finish(&mut clouds, memory, nodes, None);
    clouds
}

fn visible_title(file_name: &str) -> String {
    let title = file_name.strip_suffix(".md").unwrap_or(file_name);
    if title.chars().count() > 60 {
        format!("{}…", title.chars().take(59).collect::<String>().trim_end())
    } else {
        title.into()
    }
}
fn half_width(node: &WorkingNode) -> f32 {
    title_half_width(&node.file_name)
}
fn title_half_width(file_name: &str) -> f32 {
    visible_title(file_name)
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
}

fn place(
    nodes: &mut [WorkingNode],
    specs: &mut [CloudSpec],
    memory: &[MapCloud],
    previous: &MapState,
    edges: &[LayoutEdge],
) -> Vec<Group> {
    let saved = previous
        .nodes
        .iter()
        .map(|n| (n.identity.as_str(), n))
        .collect::<HashMap<_, _>>();
    let mut continuing = HashSet::new();
    let mut fixed = HashSet::new();
    for (i, node) in nodes.iter_mut().enumerate() {
        let identity = continuity::note_identity(node);
        if let Some(old) = saved.get(identity.as_str()) {
            node.x = old.position[0];
            node.y = old.position[1];
            let promoted = node.cloud_id.as_ref().is_some_and(|id| {
                previous
                    .clouds
                    .iter()
                    .any(|c| &c.id == id && c.parent == old.cloud && c.members.contains(&identity))
            });
            let successor = node.cloud_id.as_ref().is_some_and(|id| {
                memory
                    .iter()
                    .any(|c| &c.id == id && c.family.is_some() && c.family == old.cloud)
            });
            if old.cloud == node.cloud_id || promoted || successor {
                continuing.insert(i);
                // Shrinking or same-footprint renames cannot create a collision.
                if half_width(node) <= title_half_width(&old.title) {
                    fixed.insert(i);
                }
            }
        }
    }
    // Only new or deliberately reassigned notes get a thematic placement seed.
    let targets = nodes
        .iter()
        .enumerate()
        .filter(|(i, _)| !continuing.contains(i))
        .filter_map(|(i, n)| {
            nodes
                .iter()
                .enumerate()
                .filter(|(j, other)| {
                    continuing.contains(j) && n.cloud_id.is_some() && other.cloud_id == n.cloud_id
                })
                .max_by(|(_, a), (_, b)| {
                    dot(&n.embedding, &a.embedding)
                        .total_cmp(&dot(&n.embedding, &b.embedding))
                        .then_with(|| b.id.cmp(&a.id))
                })
                .map(|(_, near)| (i, [near.x, near.y]))
        })
        .collect::<Vec<_>>();
    for (i, point) in targets {
        nodes[i].x = point[0];
        nodes[i].y = point[1];
    }

    let mut groups = specs
        .iter()
        .filter(|s| s.parent_id.is_none())
        .filter_map(|spec| {
            let members = nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.cloud_id.as_ref() == Some(&spec.id))
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            if members.is_empty() {
                return None;
            }
            let center = previous
                .clouds
                .iter()
                .find(|c| c.active && c.id == spec.id)
                .map_or_else(|| mean(&members, nodes), |c| c.position);
            Some(Group {
                id: spec.id.clone(),
                members,
                center,
                radius: 0.0,
            })
        })
        .collect::<Vec<_>>();
    for (i, n) in nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.cloud_id.is_none())
    {
        groups.push(Group {
            id: n.id.clone(),
            members: vec![i],
            center: [n.x, n.y],
            radius: 0.0,
        });
    }
    groups.sort_by(|a, b| a.id.cmp(&b.id));
    if previous.placement_version < 1 && !previous.nodes.is_empty() {
        let repaired = recovery::repair(&mut groups, nodes, previous);
        fixed.retain(|i| !repaired.contains(i));
        recovery::release_legacy_collisions(&mut fixed, nodes);
    }

    if !previous.nodes.is_empty() {
        initial::seed_arrivals(nodes, &continuing, edges);
        for group in &mut groups {
            if !previous.clouds.iter().any(|c| c.active && c.id == group.id) {
                group.center = mean(&group.members, nodes);
            }
        }
    }

    // One map-wide index makes root, child, and isolated notes obey the same
    // footprint rules. Fixed placements are obstacles, never solver variables.
    let mut occupied = Occupied::default();
    for &i in &fixed {
        occupied.insert([nodes[i].x, nodes[i].y], half_width(&nodes[i]));
    }
    let mut moving = (0..nodes.len())
        .filter(|i| !fixed.contains(i))
        .collect::<Vec<_>>();
    moving.sort_by_key(|i| {
        (
            !saved.contains_key(continuity::note_identity(&nodes[*i]).as_str()),
            continuity::note_identity(&nodes[*i]),
        )
    });
    for i in moving {
        let width = half_width(&nodes[i]);
        let point = occupied.place([nodes[i].x, nodes[i].y], width);
        nodes[i].x = point[0];
        nodes[i].y = point[1];
    }
    if previous.nodes.is_empty() {
        initial::separate_regions(&mut groups, nodes, specs);
    }
    if previous.nodes.is_empty() || previous.placement_version < 2 {
        region_spacing::compact(&mut groups, nodes, &fixed);
    }
    refresh_specs(specs, nodes, &groups);
    groups
}

/// One canonical derivation after any accepted coordinate change. Root anchors
/// belong to placement; child centers and all radii follow final member positions.
fn refresh_specs(specs: &mut [CloudSpec], nodes: &[WorkingNode], groups: &[Group]) {
    for spec in specs {
        let members = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| spec.member_node_ids.contains(&n.id))
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        spec.centroid = if spec.parent_id.is_none() {
            groups
                .iter()
                .find(|g| g.id == spec.id)
                .map_or_else(|| mean(&members, nodes), |g| g.center)
        } else {
            mean(&members, nodes)
        };
        spec.radius = radius(&members, spec.centroid, nodes);
    }
}

#[derive(Default)]
struct Occupied {
    placed: Vec<([f32; 2], f32)>,
    cells: HashMap<(i32, i32), Vec<usize>>,
}
impl Occupied {
    fn overlaps(&self, point: [f32; 2], width: f32) -> bool {
        let reach = width.max(SPACING);
        for x in ((point[0] - reach) / SPACING).floor() as i32
            ..=((point[0] + reach) / SPACING).floor() as i32
        {
            for y in ((point[1] - SPACING) / SPACING).floor() as i32
                ..=((point[1] + SPACING) / SPACING).floor() as i32
            {
                if let Some(bucket) = self.cells.get(&(x, y)) {
                    if bucket
                        .iter()
                        .any(|i| collides(point, width, self.placed[*i].0, self.placed[*i].1))
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
    fn insert(&mut self, point: [f32; 2], width: f32) {
        let item = self.placed.len();
        self.placed.push((point, width));
        for x in ((point[0] - width) / SPACING).floor() as i32
            ..=((point[0] + width) / SPACING).floor() as i32
        {
            for y in ((point[1] - 18.0) / SPACING).floor() as i32
                ..=((point[1] + 18.0) / SPACING).floor() as i32
            {
                self.cells.entry((x, y)).or_default().push(item);
            }
        }
    }
    fn place(&mut self, preferred: [f32; 2], width: f32) -> [f32; 2] {
        let mut point = preferred;
        if self.overlaps(point, width) {
            'rings: for ring in 1..10_000 {
                let radius = ring as f32 * 6.0;
                let attempts = (radius / 3.0).ceil().max(16.0) as usize;
                for step in 0..attempts {
                    let angle = step as f32 / attempts as f32 * std::f32::consts::TAU;
                    let candidate = [
                        preferred[0] + radius * angle.cos(),
                        preferred[1] + radius * angle.sin(),
                    ];
                    if !self.overlaps(candidate, width) {
                        point = candidate;
                        break 'rings;
                    }
                }
            }
        }
        self.insert(point, width);
        point
    }
}
fn radius(members: &[usize], center: [f32; 2], nodes: &[WorkingNode]) -> f32 {
    members
        .iter()
        .map(|i| {
            let n = &nodes[*i];
            ((n.x - center[0]).abs() + half_width(n) + 24.0).hypot((n.y - center[1]).abs() + 42.0)
        })
        .fold(64.0, f32::max)
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
