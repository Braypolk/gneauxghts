use super::*;

/// One-time recovery for the old subgroup repulsion feedback loop. Normal
/// geography is untouched. Only groups many times larger than readable packing
/// would require are compacted, preserving their internal direction/order and
/// locating them just outside the nearest unaffected region.
pub(super) fn repair(
    groups: &mut [Group],
    nodes: &mut [WorkingNode],
    previous: &MapState,
) -> HashSet<usize> {
    let mut repaired = HashSet::new();
    let geometry = groups
        .iter()
        .map(|g| {
            let center = mean(&g.members, nodes);
            let extent = g
                .members
                .iter()
                .map(|i| (nodes[*i].x - center[0]).hypot(nodes[*i].y - center[1]))
                .fold(0.0_f32, f32::max);
            let widest = g
                .members
                .iter()
                .map(|i| half_width(&nodes[*i]))
                .fold(0.0_f32, f32::max);
            let comfortable = (g.members.len() as f32).sqrt() * (SPACING + widest) + 64.0;
            (center, extent, comfortable)
        })
        .collect::<Vec<_>>();
    let damaged = geometry
        .iter()
        .zip(groups.iter())
        .map(|((center, extent, comfortable), group)| {
            previous.clouds.iter().any(|c| c.active && c.id == group.id)
                && group.members.len() > 1
                && (*extent > comfortable * 8.0
                    || (center[0] - group.center[0]).hypot(center[1] - group.center[1])
                        > comfortable * 8.0)
        })
        .collect::<Vec<_>>();
    for index in 0..groups.len() {
        if !damaged[index] {
            continue;
        }
        let (center, extent, comfortable) = geometry[index];
        let neighbor = (0..groups.len()).filter(|i| !damaged[*i]).min_by(|a, b| {
            let distance =
                |i: usize| (geometry[i].0[0] - center[0]).hypot(geometry[i].0[1] - center[1]);
            distance(*a).total_cmp(&distance(*b))
        });
        let target = neighbor.map_or([0.0, 0.0], |i| {
            let other = geometry[i].0;
            let dx = center[0] - other[0];
            let dy = center[1] - other[1];
            let distance = dx.hypot(dy);
            let direction = if distance > 0.001 {
                [dx / distance, dy / distance]
            } else {
                [1.0, 0.0]
            };
            let spacing = geometry[i].1 + geometry[i].2 + comfortable + GAP;
            [
                other[0] + direction[0] * spacing,
                other[1] + direction[1] * spacing,
            ]
        });
        let scale = (comfortable / extent.max(1.0)).min(1.0);
        for &i in &groups[index].members {
            nodes[i].x = target[0] + (nodes[i].x - center[0]) * scale;
            nodes[i].y = target[1] + (nodes[i].y - center[1]) * scale;
        }
        groups[index].center = target;
        repaired.extend(groups[index].members.iter().copied());
    }
    repaired
}

/// Revision-zero artifacts predate backend filename packing. Preserve the
/// deterministic first placement and release only actual overlapping imports.
pub(super) fn release_legacy_collisions(fixed: &mut HashSet<usize>, nodes: &[WorkingNode]) {
    let mut order = fixed.iter().copied().collect::<Vec<_>>();
    order.sort_by_key(|i| continuity::note_identity(&nodes[*i]));
    let mut occupied = Occupied::default();
    for i in order {
        let point = [nodes[i].x, nodes[i].y];
        let width = half_width(&nodes[i]);
        if occupied.overlaps(point, width) {
            fixed.remove(&i);
        } else {
            occupied.insert(point, width);
        }
    }
}
