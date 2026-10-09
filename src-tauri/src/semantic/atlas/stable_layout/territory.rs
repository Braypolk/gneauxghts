//! Conservative support envelopes of visible clouds, including their empty spans.
//! Fixed directions keep clearance checks cheap without circle-sized padding.
use super::*;

const AXES: usize = 16;

#[derive(Clone)]
pub(super) struct Territory {
    intervals: [[f32; 2]; AXES],
}

fn direction(i: usize) -> [f32; 2] {
    static DIRECTIONS: std::sync::LazyLock<[[f32; 2]; AXES]> = std::sync::LazyLock::new(|| {
        std::array::from_fn(|i| {
            let angle = i as f32 * std::f32::consts::PI / AXES as f32;
            [angle.cos(), angle.sin()]
        })
    });
    DIRECTIONS[i]
}
fn project(point: [f32; 2], axis: [f32; 2]) -> f32 {
    point[0] * axis[0] + point[1] * axis[1]
}

impl Territory {
    pub(super) fn for_group(group: &Group, nodes: &[WorkingNode], clouds: &[AtlasCloud]) -> Self {
        let mut points = Vec::new();
        for &i in &group.members {
            let n = &nodes[i];
            let width = half_width(n).max(SPACING / 2.0);
            for x in [-width, width] {
                for y in [-SPACING / 2.0, SPACING / 2.0] {
                    points.push([n.x + x, n.y + y]);
                }
            }
        }
        // Descendants are included explicitly; parent smoothing must never
        // trim a child's territory out of the collision constraint.
        for cloud in clouds {
            if cloud.id == group.id
                || (!cloud.member_node_ids.is_empty()
                    && cloud
                        .member_node_ids
                        .iter()
                        .all(|id| group.members.iter().any(|i| &nodes[*i].id == id)))
            {
                points.extend_from_slice(&cloud.hull);
            }
        }
        Self {
            intervals: std::array::from_fn(|i| {
                let axis = direction(i);
                points
                    .iter()
                    .fold([f32::INFINITY, f32::NEG_INFINITY], |range, p| {
                        let value = project(*p, axis);
                        [range[0].min(value), range[1].max(value)]
                    })
            }),
        }
    }

    /// A separating support line guarantees clearance of the entire envelope.
    pub(super) fn gap(&self, other: &Self, delta: [f32; 2]) -> f32 {
        (0..AXES)
            .map(|i| {
                let shift = project(delta, direction(i));
                (other.intervals[i][0] - self.intervals[i][1] - shift)
                    .max(self.intervals[i][0] + shift - other.intervals[i][1])
            })
            .fold(0.0, f32::max)
    }

    pub(super) fn shift(&mut self, delta: [f32; 2]) {
        for (i, range) in self.intervals.iter_mut().enumerate() {
            let shift = project(delta, direction(i));
            range[0] += shift;
            range[1] += shift;
        }
    }

    /// Distance interval along a ray where these padded envelopes overlap.
    fn blocked_interval(&self, other: &Self, ray: [f32; 2]) -> Option<[f32; 2]> {
        let mut interval = [f32::NEG_INFINITY, f32::INFINITY];
        for i in 0..AXES {
            let speed = project(ray, direction(i));
            let low = other.intervals[i][0] - GAP - self.intervals[i][1];
            let high = other.intervals[i][1] + GAP - self.intervals[i][0];
            if speed.abs() < 1e-6 {
                if low >= 0.0 || high <= 0.0 {
                    return None;
                }
            } else {
                let (a, b) = (low / speed, high / speed);
                interval[0] = interval[0].max(a.min(b));
                interval[1] = interval[1].min(a.max(b));
                if interval[0] > interval[1] {
                    return None;
                }
            }
        }
        Some(interval)
    }
}

/// Preserve isolated notes and anchor larger regions first. Place each remaining
/// root at the nearest clear point along a fixed set of rays. Unlike iterative
/// repulsion, this terminates without pushing already accepted obstacles again.
pub(super) fn separate(
    groups: &[Group],
    territories: &mut [Territory],
    stationary: &HashSet<usize>,
) -> Vec<[f32; 2]> {
    let mut order = (0..groups.len()).collect::<Vec<_>>();
    order.sort_by_key(|&i| {
        (
            !stationary.contains(&i),
            std::cmp::Reverse(groups[i].members.len()),
            &groups[i].id,
        )
    });
    let mut placed = Vec::<usize>::new();
    let mut offsets = vec![[0.0, 0.0]; groups.len()];
    for i in order {
        if !stationary.contains(&i)
            && placed
                .iter()
                .any(|&j| territories[i].gap(&territories[j], [0.0, 0.0]) < GAP)
        {
            let mut best = ([0.0, 0.0], f32::INFINITY);
            for axis in 0..AXES {
                for sign in [-1.0, 1.0] {
                    let ray = direction(axis).map(|v| v * sign);
                    let mut intervals = placed
                        .iter()
                        .filter_map(|&j| territories[i].blocked_interval(&territories[j], ray))
                        .collect::<Vec<_>>();
                    intervals.sort_by(|a, b| a[0].total_cmp(&b[0]));
                    let mut distance = 0.0_f32;
                    for [start, end] in intervals {
                        if start > distance {
                            break;
                        }
                        if end >= distance {
                            distance = end + 0.1;
                        }
                    }
                    if distance < best.1 {
                        best = (ray.map(|v| v * distance), distance);
                    }
                }
            }
            offsets[i] = best.0;
            territories[i].shift(best.0);
        }
        placed.push(i);
    }
    offsets
}
