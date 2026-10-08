/** Presentation only: input drafts, focus, panes and persistence remain with their owners. */
export type WorkspaceDockState = 'editor-search' | 'chat-search' | 'chat-input';
export type DockMotionEasing = 'pinch' | 'editor';
export type WorkspaceDockPhase = 'settled' | 'compress' | 'exchange' | 'settle';
export interface DockPose { presence: number; input: number }
export interface DockTransition {
  id: number;
  from: WorkspaceDockState;
  to: WorkspaceDockState;
  origin: DockPose;
  startedAt: number;
  duration: number;
  progress: number;
  easing: DockMotionEasing;
}
export interface WorkspaceDockMotion {
  target: WorkspaceDockState;
  pose: DockPose;
  transition: DockTransition | null;
  revision: number;
}
export type WorkspaceDockEvent =
  | { type: 'request'; target: WorkspaceDockState; now: number; immediate?: boolean }
  | { type: 'frame'; id: number; now: number }
  | { type: 'finish' };

const poses: Record<WorkspaceDockState, DockPose> = {
  'editor-search': { presence: 0, input: 0 },
  'chat-search': { presence: 1, input: 0 },
  'chat-input': { presence: 1, input: 1 }
};
const dockTravelDuration = 300;
const dockPinchExtraDuration = 80;
export const dockMorphDuration = dockTravelDuration + dockPinchExtraDuration;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function dockRamp(start: number, end: number, value: number) {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}
export function dockClockProgress(elapsed: number, easing: DockMotionEasing = 'pinch') {
  if (easing === 'editor') {
    // cubic-bezier(0.65, 0, 0.35, 1): a gentle departure and arrival,
    // with one clear acceleration through the middle. Solve x for time,
    // then sample y; pane keyframes use this exact clock too.
    if (elapsed <= 0) return 0;
    if (elapsed >= 1) return 1;
    let low = 0, high = 1;
    for (let i = 0; i < 20; i++) {
      const t = (low + high) / 2, inverse = 1 - t;
      const x = 3 * inverse * inverse * t * 0.65 + 3 * inverse * t * t * 0.35 + t * t * t;
      if (x < elapsed) low = t;
      else high = t;
    }
    return dockRamp(0, 1, (low + high) / 2);
  }
  // Spend the extra time only around the joined neck. The smooth ramp keeps
  // speed continuous as we enter and leave it, preserving the outer pacing.
  const extra = dockPinchExtraDuration / dockTravelDuration;
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const time = (low + high) / 2;
    const clock = (time + extra * dockRamp(0.32, 0.68, time)) / (1 + extra);
    if (clock < elapsed) low = time;
    else high = time;
  }
  return dockRamp(0, 1, (low + high) / 2);
}
export function createWorkspaceDockMotion(target: WorkspaceDockState): WorkspaceDockMotion {
  return { target, pose: poses[target], transition: null, revision: 0 };
}
function sample(state: WorkspaceDockMotion, now: number): WorkspaceDockMotion {
  const transition = state.transition;
  if (!transition) return state;
  const elapsed = clamp((now - transition.startedAt) / transition.duration);
  if (elapsed === 1) return { ...state, pose: poses[state.target], transition: null };
  // Geometry and glyphs share this clock. The text reveal is admitted only
  // near settling; the mounted surfaces animate opacity through completion.
  const progress = dockClockProgress(elapsed, transition.easing);
  const destination = poses[transition.to];
  return { ...state, transition: { ...transition, progress }, pose: {
    presence: mix(transition.origin.presence, destination.presence, progress),
    input: mix(transition.origin.input, destination.input, progress)
  } };
}
export function transitionWorkspaceDock(state: WorkspaceDockMotion, event: WorkspaceDockEvent): WorkspaceDockMotion {
  if (event.type === 'finish') return { ...state, pose: poses[state.target], transition: null };
  if (event.type === 'frame') {
    return state.transition?.id === event.id ? sample(state, event.now) : state;
  }
  const current = sample(state, event.now);
  if (event.immediate) return { ...createWorkspaceDockMotion(event.target), revision: state.revision + 1 };
  if (event.target === current.target) return current;
  const destination = poses[event.target];
  const distance = Math.max(Math.abs(current.pose.presence - destination.presence), Math.abs(current.pose.input - destination.input));
  const id = state.revision + 1;
  return { target: event.target, pose: current.pose, revision: id, transition: {
    id, from: current.target, to: event.target, origin: current.pose,
    startedAt: event.now, duration: dockMorphDuration * Math.max(0.25, distance), progress: 0,
    easing: current.target === 'editor-search' || event.target === 'editor-search' ? 'editor' : 'pinch'
  } };
}
export function workspaceDockPhase(state: WorkspaceDockMotion): WorkspaceDockPhase {
  const transition = state.transition;
  if (!transition) return 'settled';
  const departingInput = transition.origin.input > poses[transition.to].input;
  if (departingInput && state.pose.input > 0.6) return 'compress';
  if (state.pose.input > 0.82 && transition.to === 'chat-input') return 'settle';
  if (transition.to === 'editor-search' && state.pose.presence < 0.15) return 'settle';
  return 'exchange';
}

export interface DockMeasure {
  width: number;
  editorWidth: number;
  searchHeight: number;
  chatHeight: number;
  gap: number;
  sendSize: number;
  sendInset: number;
  searchIconInset?: number;
  textPush?: number;
}
export interface DockSearchPresentation {
  active?: boolean;
  expanded?: boolean;
}
export interface DockActionPresentation { running: boolean; progress: number }

/** Glyph handoffs depend on the edge, not just on the interpolated pose.
 * Editor transitions never visit the chat-search circle as an intermediate state. */
export function workspaceDockPresentation(state: WorkspaceDockMotion) {
  const input = state.pose.input;
  const textRevealing = !state.transition || state.transition.progress >= 0.9;
  const chatEdge = state.transition
    ? state.transition.from === 'chat-search' || state.transition.to === 'chat-search'
    : state.target === 'chat-search';
  return {
    textRevealing,
    searchText: textRevealing && state.target !== 'chat-input' ? 1 : 0,
    chatText: textRevealing && state.target === 'chat-input' ? 1 : 0,
    chatGlyph: chatEdge ? 1 - dockRamp(0.3, 0.48, input) : 0,
    sendGlyph: dockRamp(0.52, 0.7, input),
    rightVisibility: chatEdge ? state.pose.presence : dockRamp(0.2, 0.65, input)
  };
}
/** One main bar and two circles. Search/chat exchange translates the bar;
 * its width is constant while the circles split and are absorbed. */
export function workspaceDockGeometry(pose: DockPose, measure: DockMeasure) {
  const { width, searchHeight: circle, gap, sendSize, sendInset } = measure;
  const present = pose.presence;
  const input = pose.input;
  const chatWidth = Math.max(circle, width - circle - gap);
  const editorWidth = Math.min(width, measure.editorWidth);
  const bodyWidth = mix(editorWidth, chatWidth, present);
  const bodyX = mix((width - editorWidth) / 2, (circle + gap) * input, present);
  // Finish the circle exchange at compact height, then unfold the composer.
  const expanded = dockRamp(0.75, 1, input);
  const bodyHeight = mix(circle, Math.max(circle, measure.chatHeight), expanded);
  const searchX = mix((width - editorWidth) / 2, 0, present);
  // The magnifier's shell stays anchored while the bar slides past it. Growing
  // a translucent circle from the moving bar creates a reversing leading edge
  // and a second contour near the bar's top border.
  const searchSize = circle;
  const rightSize = mix(circle, sendSize, dockRamp(0.4, 0.86, input));
  const searchCircleX = searchX;
  const searchGlyphShift = ((measure.searchIconInset ?? 28) - circle / 2) * (1 - dockRamp(0.1, 0.75, input));
  // Both end positions come from settled poses, never from the moving body.
  const sendX = mix((width - editorWidth) / 2, circle + gap, present) + bodyWidth - sendInset - sendSize / 2;
  const rightX = mix((width - editorWidth) / 2 + bodyWidth - circle / 2, bodyWidth + gap + circle / 2, present);
  const rightShellX = rightX - circle / 2;
  const chatCircleX = mix(rightX, sendX, dockRamp(0.4, 0.86, input)) - rightSize / 2;
  return { bodyX, bodyWidth, bodyHeight, searchCircleX, searchSize, searchGlyphShift, chatCircleX, rightSize, rightShellX,
    searchVisibility: 1,
    chatVisibility: present,
    sendAppearance: dockRamp(0.52, 0.85, input),
    searchControls: 1 - dockRamp(0.05, 0.5, input),
    chatControls: dockRamp(0.8, 0.98, input),
    textShift: measure.chatHeight - bodyHeight,
    textPush: (measure.textPush ?? 34) * (1 - dockRamp(0.15, 0.7, input)),
    leftNeck: Math.sin(Math.PI * dockRamp(0, 1, input)) * present,
    rightNeck: Math.max(Math.sin(Math.PI * dockRamp(0, 1, input)) * present,
      Math.sin(Math.PI * present) * (1 - expanded))
  };
}
