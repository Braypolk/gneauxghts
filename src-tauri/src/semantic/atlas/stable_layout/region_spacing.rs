//! Close empty gaps by translating connected neighborhoods as rigid units.
//! Root migration and changed-leaf cleanup share the same bounded calculation.
use super::*;

const MAX_GAP: f32 = SPACING * 10.0;
const TARGET_GAP: f32 = SPACING * 5.0;

pub(super) type Bounds = [[f32; 2]; 2];

pub(super) fn bounds(group: &Group, nodes: &[WorkingNode]) -> Bounds {
    let mut result = [[f32::INFINITY; 2], [f32::NEG_INFINITY; 2]];
    for &i in &group.members {
        let n = &nodes[i];
        let padding = [half_width(n) + 24.0, 42.0];
        for axis in 0..2 {
            let value = if axis == 0 { n.x } else { n.y };
            result[0][axis] = result[0][axis].min(value - padding[axis]);
            result[1][axis] = result[1][axis].max(value + padding[axis]);
        }
    }
    result
}

/// Shortest vector from one footprint envelope to another; overlapping axes
/// contribute zero. This measures empty space rather than enclosing-circle size.
pub(super) fn gap(a: Bounds, b: Bounds) -> [f32; 2] {
    std::array::from_fn(|axis| {
        if a[1][axis] < b[0][axis] {
            b[0][axis] - a[1][axis]
        } else if b[1][axis] < a[0][axis] {
            b[1][axis] - a[0][axis]
        } else {
            0.0
        }
    })
}

fn join(components: &mut [usize], from: usize, to: usize) {
    for component in components {
        if *component == from {
            *component = to;
        }
    }
}

pub(super) fn compact(groups: &mut [Group], nodes: &mut [WorkingNode], fixed: &HashSet<usize>) {
    if groups
        .iter()
        .filter(|g| nodes[g.members[0]].cloud_id.is_some())
        .count()
        < 2
    {
        return;
    }
    let mut envelopes = groups.iter().map(|g| bounds(g, nodes)).collect::<Vec<_>>();
    let priorities = groups
        .iter()
        .map(|g| {
            (
                g.members.iter().filter(|i| fixed.contains(i)).count(),
                g.members.len(),
            )
        })
        .collect::<Vec<_>>();
    let offsets = close_gaps(&mut envelopes, &priorities, MAX_GAP, TARGET_GAP);
    for (group, delta) in groups.iter_mut().zip(offsets) {
        group.center[0] += delta[0];
        group.center[1] += delta[1];
        for &i in &group.members {
            nodes[i].x += delta[0];
            nodes[i].y += delta[1];
        }
    }
}

/// Priorities are (retained note count, total note count) per footprint.
/// Return rigid displacements, anchoring the strongest connected neighborhood.
pub(super) fn close_gaps(
    envelopes: &mut [Bounds],
    priorities: &[(usize, usize)],
    max_gap: f32,
    target_gap: f32,
) -> Vec<[f32; 2]> {
    let mut offsets = vec![[0.0; 2]; envelopes.len()];
    if envelopes.is_empty() {
        return offsets;
    }
    let mut components = (0..envelopes.len()).collect::<Vec<_>>();
    // Keep already-near neighbors together, including nearby isolated notes.
    for a in 0..envelopes.len() {
        for b in a + 1..envelopes.len() {
            let v = gap(envelopes[a], envelopes[b]);
            if v[0].hypot(v[1]) <= max_gap {
                let from = components[b];
                let to = components[a];
                if from != to {
                    join(&mut components, from, to);
                }
            }
        }
    }
    let score = |component: usize| {
        let mut retained = 0;
        let mut total = 0;
        for (i, &(saved, count)) in priorities.iter().enumerate() {
            if components[i] == component {
                retained += saved;
                total += count;
            }
        }
        (retained, total)
    };
    let anchor = *components
        .iter()
        .max_by_key(|c| (score(**c), std::cmp::Reverse(**c)))
        .unwrap();
    // Join the closest disconnected neighborhoods first. The translation is
    // shorter than the smallest gap to any other component, so it cannot cross
    // another component. Preserve the largest accepted neighborhood as anchor.
    loop {
        let mut nearest: Option<(usize, usize, [f32; 2], f32)> = None;
        for a in 0..envelopes.len() {
            for b in a + 1..envelopes.len() {
                if components[a] == components[b] {
                    continue;
                }
                let v = gap(envelopes[a], envelopes[b]);
                let distance = v[0].hypot(v[1]);
                if nearest.as_ref().is_none_or(|p| distance < p.3) {
                    nearest = Some((a, b, v, distance));
                }
            }
        }
        let Some((a, b, vector, distance)) = nearest else {
            break;
        };
        let (moving, staying, sign) = if components[a] == anchor {
            (components[b], components[a], -1.0)
        } else {
            (components[a], components[b], 1.0)
        };
        if distance > max_gap {
            let scale = (distance - target_gap) / distance * sign;
            let delta = [vector[0] * scale, vector[1] * scale];
            for i in (0..envelopes.len()).filter(|&i| components[i] == moving) {
                for axis in 0..2 {
                    offsets[i][axis] += delta[axis];
                    envelopes[i][0][axis] += delta[axis];
                    envelopes[i][1][axis] += delta[axis];
                }
            }
        }
        join(&mut components, moving, staying);
    }
    offsets
}
