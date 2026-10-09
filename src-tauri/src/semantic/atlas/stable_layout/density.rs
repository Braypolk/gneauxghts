//! Local readability constraints for a changed cloud. Accepted geography is the
//! preferred layout; only excessive empty space warrants internal contraction.
use super::*;

/// Return clouds whose geometry can need repair, including their ancestors.
/// Content-only edits, deletion, and same-footprint renames do not repack notes.
pub(super) fn affected(
    nodes: &[WorkingNode],
    specs: &[CloudSpec],
    previous: &MapState,
) -> HashSet<String> {
    if previous.nodes.is_empty() || previous.placement_version < PLACEMENT_VERSION {
        return specs.iter().map(|s| s.id.clone()).collect();
    }
    let saved = previous
        .nodes
        .iter()
        .map(|n| (n.identity.as_str(), n))
        .collect::<HashMap<_, _>>();
    let mut changed = HashSet::new();
    for spec in specs {
        let old = previous.clouds.iter().find(|c| c.active && c.id == spec.id);
        let needs_space = old.is_none_or(|c| c.parent != spec.parent_id)
            || nodes
                .iter()
                .filter(|n| spec.member_node_ids.contains(&n.id))
                .any(|n| {
                    let identity = continuity::note_identity(n);
                    !old.is_some_and(|c| c.members.contains(&identity))
                        || saved.get(identity.as_str()).is_none_or(|s| {
                            s.position != [n.x, n.y] || half_width(n) > title_half_width(&s.title)
                        })
                });
        if needs_space {
            changed.insert(spec.id.clone());
        }
    }
    // A child can expand its parent's silhouette without changing root membership.
    loop {
        let parents = specs
            .iter()
            .filter(|s| changed.contains(&s.id))
            .filter_map(|s| s.parent_id.clone())
            .collect::<Vec<_>>();
        let mut added = false;
        for parent in parents {
            added |= changed.insert(parent);
        }
        if !added {
            break;
        }
    }
    changed
}

pub(super) fn compact(
    nodes: &mut [WorkingNode],
    specs: &[CloudSpec],
    affected: &HashSet<String>,
) -> bool {
    let mut moved = false;
    for spec in specs.iter().filter(|s| {
        affected.contains(&s.id)
            && !specs
                .iter()
                .any(|child| child.parent_id.as_ref() == Some(&s.id))
    }) {
        let mut members = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| spec.member_node_ids.contains(&n.id))
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        if members.len() < 2 {
            continue;
        }
        members.sort_by_key(|&i| continuity::note_identity(&nodes[i]));
        let mut footprints = members
            .iter()
            .map(|&i| {
                let n = &nodes[i];
                let width = half_width(n).max(SPACING / 2.0);
                [
                    [n.x - width, n.y - SPACING / 2.0],
                    [n.x + width, n.y + SPACING / 2.0],
                ]
            })
            .collect::<Vec<_>>();
        // A long title needs horizontal room; it must not hide a vertical gap.
        // Keep near notes together, then close only gaps between neighborhoods.
        let offsets = region_spacing::close_gaps(
            &mut footprints,
            &vec![(0, 1); members.len()],
            SPACING * 3.0,
            SPACING * 1.5,
        );
        for (&i, delta) in members.iter().zip(offsets) {
            nodes[i].x += delta[0];
            nodes[i].y += delta[1];
            moved |= delta != [0.0, 0.0];
        }
        let center = mean(&members, nodes);
        let extent = members
            .iter()
            .map(|&i| (nodes[i].x - center[0]).hypot(nodes[i].y - center[1]))
            .fold(0.0_f32, f32::max);
        // Space for the actual filename footprints plus comfortable breathing
        // room. The slack avoids reflow when a compact cloud grows a little.
        let area = members
            .iter()
            .map(|&i| (2.0 * half_width(&nodes[i])).max(SPACING) * SPACING)
            .sum::<f32>();
        let target = (area / std::f32::consts::PI).sqrt() * 1.5;
        if extent <= target * 1.8 {
            continue;
        }
        let scale = target / extent;
        let mut occupied = Occupied::default();
        for i in members {
            let preferred = [
                center[0] + (nodes[i].x - center[0]) * scale,
                center[1] + (nodes[i].y - center[1]) * scale,
            ];
            let point = occupied.place(preferred, half_width(&nodes[i]));
            nodes[i].x = point[0];
            nodes[i].y = point[1];
        }
        moved = true;
    }
    moved
}
