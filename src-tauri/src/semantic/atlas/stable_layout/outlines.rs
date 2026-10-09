use super::*;

/// Collision radii reserve space; visible outlines follow the accepted member footprints.
/// Deterministic samples keep identical input geometry stationary.
pub(super) fn finish(
    clouds: &mut [AtlasCloud],
    memory: &[MapCloud],
    nodes: &[WorkingNode],
    changed: Option<&HashSet<String>>,
) {
    let mut order = (0..clouds.len())
        .filter(|&i| changed.is_none_or(|ids| ids.contains(&clouds[i].id)))
        .collect::<Vec<_>>();
    order.sort_by_key(|&i| std::cmp::Reverse(clouds[i].level));
    for index in order {
        let cloud = &clouds[index];
        let members = cloud.member_node_ids.iter().collect::<HashSet<_>>();
        let mut boundaries = Vec::new();
        for node in nodes.iter().filter(|n| members.contains(&n.id)) {
            let width = half_width(node) + 6.0;
            // Keep a small readable margin around dots and their filenames.
            boundaries.push(vec![
                [node.x - width, node.y - 10.0],
                [node.x + width, node.y - 10.0],
                [node.x + width, node.y + 22.0],
                [node.x - width, node.y + 22.0],
            ]);
        }
        // Children are finished first. Their actual contours need only a small
        // fixed parent margin, rather than another distance-proportional expansion.
        let mut has_children = false;
        for child in clouds
            .iter()
            .filter(|c| c.parent_id.as_ref() == Some(&cloud.id))
        {
            has_children = true;
            boundaries.push(child.hull.clone());
        }
        let cloud = &mut clouds[index];
        if let Some(saved) = memory.iter().find(|c| c.id == cloud.id) {
            if saved.color[3] != 0 {
                cloud.color = saved.color;
            }
            cloud.family_id = saved.family.clone();
        }
        cloud.hull = organic_outline(&cloud.id, cloud.centroid, &boundaries, has_children);
    }
}

/// Restore the original cloud's broad, overlapping waves, seeded by identity.
/// Bend inward where there is empty space and outward by a small fixed amount.
/// Distance to member/child footprints limits each inward bend, so filenames
/// stay enclosed and large parents keep a narrow border.
fn organic_outline(
    seed: &str,
    center: [f32; 2],
    boundaries: &[Vec<[f32; 2]>],
    has_children: bool,
) -> Vec<[f32; 2]> {
    let outline = tight_outline(center, boundaries);
    let outline = if has_children {
        lobed_parent_outline(&outline, boundaries)
    } else {
        outline
    };
    let perimeter = (0..outline.len())
        .map(|i| {
            let next = outline[(i + 1) % outline.len()];
            (next[0] - outline[i][0]).hypot(next[1] - outline[i][1])
        })
        .sum::<f32>();
    let outward_amplitude = (perimeter * 0.04).min(if has_children { 8.0 } else { 18.0 });
    let inward_amplitude = (perimeter * 0.06).min(36.0);
    let phase = (stable_hash(seed) % 10_000) as f32 / 10_000.0 * std::f32::consts::TAU;
    let organic = outline
        .iter()
        .enumerate()
        .map(|(i, point)| {
            let previous = outline[(i + outline.len() - 1) % outline.len()];
            let next = outline[(i + 1) % outline.len()];
            let tangent = [next[0] - previous[0], next[1] - previous[1]];
            let length = tangent[0].hypot(tangent[1]).max(0.001);
            let angle = i as f32 / outline.len() as f32 * std::f32::consts::TAU;
            let wave = 0.5 * (angle * 2.0 + phase).sin()
                + 0.34 * (angle * 3.0 + phase * 0.7).cos()
                + 0.16 * (angle * 5.0 + phase * 1.3).sin();
            let offset = if wave >= 0.0 {
                outward_amplitude * wave
            } else {
                let clearance = (boundary_distance(*point, boundaries) - 2.0).max(0.0);
                let desired = -wave * inward_amplitude;
                // Smoothly approach the available clearance without a hard
                // clamp that would introduce corners beside individual notes.
                -desired * clearance / (desired + clearance)
            };
            [
                point[0] + tangent[1] / length * offset,
                point[1] - tangent[0] / length * offset,
            ]
        })
        .collect::<Vec<_>>();
    soften_outline(&organic, 12.0)
}

/// Pull the empty spans of a parent's envelope inward to reveal its subgroups.
/// Nearby member/child footprints preserve the lobes. The opposite side of the
/// envelope limits contraction, leaving a connected waist even across large gaps.
fn lobed_parent_outline(outline: &[[f32; 2]], boundaries: &[Vec<[f32; 2]>]) -> Vec<[f32; 2]> {
    let lobes = outline
        .iter()
        .enumerate()
        .map(|(i, point)| {
            let previous = outline[(i + outline.len() - 1) % outline.len()];
            let next = outline[(i + 1) % outline.len()];
            let tangent = [next[0] - previous[0], next[1] - previous[1]];
            let length = tangent[0].hypot(tangent[1]).max(0.001);
            let inward = [-tangent[1] / length, tangent[0] / length];
            let available = (boundary_distance(*point, boundaries) - 10.0).max(0.0);
            let width = inward_width(*point, inward, outline);
            let limit = width * 0.32;
            let inset = if limit > 0.001 {
                limit * (available * 0.85 / limit).tanh()
            } else {
                0.0
            };
            [point[0] + inward[0] * inset, point[1] + inward[1] * inset]
        })
        .collect::<Vec<_>>();
    lobes
}

fn inward_width(point: [f32; 2], inward: [f32; 2], outline: &[[f32; 2]]) -> f32 {
    let cross = |a: [f32; 2], b: [f32; 2]| a[0] * b[1] - a[1] * b[0];
    (0..outline.len())
        .filter_map(|i| {
            let a = outline[i];
            let b = outline[(i + 1) % outline.len()];
            let edge = [b[0] - a[0], b[1] - a[1]];
            let relative = [a[0] - point[0], a[1] - point[1]];
            let denominator = cross(inward, edge);
            if denominator.abs() < 0.0001 {
                return None;
            }
            let distance = cross(relative, edge) / denominator;
            let along = cross(relative, inward) / denominator;
            (distance > 0.01 && (0.0..=1.0).contains(&along)).then_some(distance)
        })
        .reduce(f32::min)
        .unwrap_or(0.0)
}

fn boundary_distance(point: [f32; 2], boundaries: &[Vec<[f32; 2]>]) -> f32 {
    boundaries
        .iter()
        .flat_map(|boundary| {
            (0..boundary.len()).map(move |i| {
                let a = boundary[i];
                let b = boundary[(i + 1) % boundary.len()];
                let delta = [b[0] - a[0], b[1] - a[1]];
                let length_squared = delta[0] * delta[0] + delta[1] * delta[1];
                let t = (((point[0] - a[0]) * delta[0] + (point[1] - a[1]) * delta[1])
                    / length_squared.max(0.0001))
                .clamp(0.0, 1.0);
                (point[0] - a[0] - t * delta[0]).hypot(point[1] - a[1] - t * delta[1])
            })
        })
        .reduce(f32::min)
        .unwrap_or(0.0)
}

/// Intersect neighboring support lines to form a tight rounded envelope.
/// Treating a support distance as a radial distance spreads distant members
/// sideways; using it as a boundary line keeps the padding constant instead.
fn tight_outline(center: [f32; 2], boundaries: &[Vec<[f32; 2]>]) -> Vec<[f32; 2]> {
    const POINTS: usize = 96;
    const PADDING: f32 = 6.0;
    let step = std::f32::consts::TAU / POINTS as f32;
    let directions = (0..POINTS)
        .map(|i| {
            let (sin, cos) = (i as f32 * step).sin_cos();
            [cos, sin]
        })
        .collect::<Vec<_>>();
    let supports = directions
        .iter()
        .map(|d| {
            let extent = boundaries
                .iter()
                .flatten()
                .map(|p| (p[0] - center[0]) * d[0] + (p[1] - center[1]) * d[1])
                .reduce(f32::max)
                .unwrap_or(0.0);
            extent + PADDING
        })
        .collect::<Vec<_>>();
    let outline = (0..POINTS)
        .map(|i| {
            let j = (i + 1) % POINTS;
            let a = directions[i];
            let b = directions[j];
            let determinant = a[0] * b[1] - a[1] * b[0];
            [
                center[0] + (supports[i] * b[1] - supports[j] * a[1]) / determinant,
                center[1] + (a[0] * supports[j] - b[0] * supports[i]) / determinant,
            ]
        })
        .collect::<Vec<_>>();
    soften_outline(&outline, 24.0)
}

/// Average positions over a short, fixed-length boundary window. This rounds
/// tight turns inward without adding padding or moving the cloud's anchor.
/// Uniform arc-length samples avoid the long-edge/tiny-corner spacing of the
/// support-line intersections; drawing the same contour as a polygon stays smooth.
fn soften_outline(outline: &[[f32; 2]], half_window: f32) -> Vec<[f32; 2]> {
    const SAMPLES: usize = 384;
    let mut lengths = vec![0.0];
    for i in 0..outline.len() {
        let next = outline[(i + 1) % outline.len()];
        lengths.push(lengths[i] + (next[0] - outline[i][0]).hypot(next[1] - outline[i][1]));
    }
    let perimeter = *lengths.last().unwrap();
    if perimeter < 0.001 {
        return outline.to_vec();
    }
    let half_window = half_window.min(perimeter / 8.0);
    (0..SAMPLES)
        .map(|sample| {
            let distance = sample as f32 * perimeter / SAMPLES as f32;
            let start = distance - half_window;
            let end = distance + half_window;
            let mut integral = [0.0, 0.0];
            for lap in [-1.0, 0.0, 1.0] {
                // Arc lengths are ordered. Visit only segments intersecting
                // this window, retaining the original integration order and math.
                let offset = lap * perimeter;
                let first = lengths
                    .partition_point(|&v| v + offset <= start)
                    .saturating_sub(1);
                let last = lengths
                    .partition_point(|&v| v + offset < end)
                    .min(outline.len());
                for i in first..last {
                    let segment_start = lengths[i] + lap * perimeter;
                    let segment_end = lengths[i + 1] + lap * perimeter;
                    let left = start.max(segment_start);
                    let right = end.min(segment_end);
                    if right <= left {
                        continue;
                    }
                    // A straight segment's exact average is its midpoint.
                    let t = ((left + right) * 0.5 - segment_start) / (segment_end - segment_start);
                    let next = outline[(i + 1) % outline.len()];
                    for axis in 0..2 {
                        integral[axis] += (outline[i][axis] + (next[axis] - outline[i][axis]) * t)
                            * (right - left);
                    }
                }
            }
            [
                integral[0] / (2.0 * half_window),
                integral[1] / (2.0 * half_window),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_has_a_connected_waist_and_encloses_its_lobes() {
        let circle = |x: f32| {
            (0..64)
                .map(|i| {
                    let angle = i as f32 / 64.0 * std::f32::consts::TAU;
                    [x + 50.0 * angle.cos(), 50.0 * angle.sin()]
                })
                .collect::<Vec<_>>()
        };
        let children = vec![circle(-160.0), circle(160.0)];
        let parent = organic_outline("parent", [0.0, 0.0], &children, true);
        let waist = parent
            .iter()
            .filter(|p| p[0].abs() < 15.0)
            .map(|p| p[1].abs())
            .fold(0.0_f32, f32::max);
        assert!(
            waist > 5.0 && waist < 35.0,
            "expected a narrow connected waist, got {waist}"
        );
        assert_eq!(
            parent,
            organic_outline("parent", [0.0, 0.0], &children, true)
        );
        assert!(children.iter().flatten().all(|p| inside(*p, &parent)));

        // Wrapping an already organic, elongated child must not trim its corners.
        let members = vec![
            vec![
                [-195.0, -24.0],
                [-105.0, -24.0],
                [-105.0, 24.0],
                [-195.0, 24.0],
            ],
            vec![[105.0, -24.0], [195.0, -24.0], [195.0, 24.0], [105.0, 24.0]],
        ];
        let child = organic_outline("leaf-0", [0.0, 0.0], &members, false);
        let parent = organic_outline("parent-0", [0.0, 0.0], &[child.clone()], true);
        assert!(child.iter().all(|p| inside(*p, &parent)));
    }

    fn inside(point: [f32; 2], hull: &[[f32; 2]]) -> bool {
        let mut inside = false;
        for i in 0..hull.len() {
            let a = hull[i];
            let b = hull[(i + 1) % hull.len()];
            if (a[1] > point[1]) != (b[1] > point[1])
                && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
            {
                inside = !inside;
            }
        }
        inside
    }

    #[test]
    fn filename_corners_turn_gradually_without_expanding_the_border() {
        let outline = tight_outline(
            [0.0, 0.0],
            &[vec![
                [-100.0, -40.0],
                [100.0, -40.0],
                [100.0, 40.0],
                [-100.0, 40.0],
            ]],
        );
        for i in 0..outline.len() {
            let a = outline[(i + outline.len() - 1) % outline.len()];
            let b = outline[i];
            let c = outline[(i + 1) % outline.len()];
            let incoming = [b[0] - a[0], b[1] - a[1]];
            let outgoing = [c[0] - b[0], c[1] - b[1]];
            let turn = (incoming[0] * outgoing[1] - incoming[1] * outgoing[0])
                .atan2(incoming[0] * outgoing[0] + incoming[1] * outgoing[1])
                .abs();
            let distance = (incoming[0].hypot(incoming[1]) + outgoing[0].hypot(outgoing[1])) / 2.0;
            // Corners should bend over at least a 12-unit radius, rather than
            // concentrating the turn in the small six-unit outline border.
            assert!(turn / distance < 1.0 / 12.0, "corner bends too sharply");
            assert!(b[0].abs() <= 106.01 && b[1].abs() <= 46.01);
        }
    }

    #[test]
    fn sparse_members_and_parent_outlines_do_not_gain_sideways_padding() {
        let rectangle = |x: f32| {
            vec![
                [x - 45.0, -24.0],
                [x + 45.0, -24.0],
                [x + 45.0, 24.0],
                [x - 45.0, 24.0],
            ]
        };
        let members = vec![rectangle(-150.0), rectangle(150.0)];
        let leaf = tight_outline([0.0, 0.0], &members);
        let max_y = |points: &[[f32; 2]]| points.iter().map(|p| p[1].abs()).fold(0.0_f32, f32::max);
        assert!(
            max_y(&leaf) < 45.0,
            "leaf should hug the 48-unit-high members, got {}",
            max_y(&leaf) * 2.0
        );
        let parent = tight_outline([0.0, 0.0], &[leaf.clone()]);
        assert!(
            max_y(&parent) - max_y(&leaf) < 16.0,
            "parent added too much empty border"
        );
        assert_eq!(parent, tight_outline([0.0, 0.0], &[leaf]));
    }
}

#[cfg(test)]
mod smoothing_compatibility {
    use super::*;
    #[test]
    fn local_segment_windows_preserve_exact_contour_integration() {
        for count in [4, 96, 384] {
            let outline = (0..count)
                .map(|i| {
                    let angle = i as f32 / count as f32 * std::f32::consts::TAU;
                    [150.0 * angle.cos() + 1732.0, 40.0 * angle.sin() - 582.0]
                })
                .collect::<Vec<_>>();
            for window in [0.01, 12.0, 24.0, 1000.0] {
                assert_eq!(
                    soften_outline(&outline, window),
                    reference_soften_outline(&outline, window)
                );
            }
        }
        let degenerate = vec![[10.0, 10.0]; 4];
        assert_eq!(
            soften_outline(&degenerate, 12.0),
            reference_soften_outline(&degenerate, 12.0)
        );
    }
    fn reference_soften_outline(outline: &[[f32; 2]], half_window: f32) -> Vec<[f32; 2]> {
        const SAMPLES: usize = 384;
        let mut lengths = vec![0.0];
        for i in 0..outline.len() {
            let next = outline[(i + 1) % outline.len()];
            lengths.push(lengths[i] + (next[0] - outline[i][0]).hypot(next[1] - outline[i][1]));
        }
        let perimeter = *lengths.last().unwrap();
        if perimeter < 0.001 {
            return outline.to_vec();
        }
        let half_window = half_window.min(perimeter / 8.0);
        (0..SAMPLES)
            .map(|sample| {
                let distance = sample as f32 * perimeter / SAMPLES as f32;
                let start = distance - half_window;
                let end = distance + half_window;
                let mut integral = [0.0, 0.0];
                for lap in [-1.0, 0.0, 1.0] {
                    for i in 0..outline.len() {
                        let segment_start = lengths[i] + lap * perimeter;
                        let segment_end = lengths[i + 1] + lap * perimeter;
                        let left = start.max(segment_start);
                        let right = end.min(segment_end);
                        if right <= left {
                            continue;
                        }
                        // A straight segment's exact average is its midpoint.
                        let t =
                            ((left + right) * 0.5 - segment_start) / (segment_end - segment_start);
                        let next = outline[(i + 1) % outline.len()];
                        for axis in 0..2 {
                            integral[axis] += (outline[i][axis]
                                + (next[axis] - outline[i][axis]) * t)
                                * (right - left);
                        }
                    }
                }
                [
                    integral[0] / (2.0 * half_window),
                    integral[1] / (2.0 * half_window),
                ]
            })
            .collect()
    }
}
