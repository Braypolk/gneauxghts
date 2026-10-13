import { describe, expect, it } from 'vitest';
import {
  createWorkspaceDockMotion, transitionWorkspaceDock, workspaceDockGeometry,
  workspaceDockPhase, workspaceDockPresentation, dockMorphDuration, type WorkspaceDockState
} from './workspaceDockMachine';

const states: WorkspaceDockState[] = ['editor-search', 'chat-search', 'chat-input'];
const measure = { width: 832, editorWidth: 384, searchHeight: 40, chatHeight: 84, gap: 12, sendSize: 30, sendInset: 8 };
describe('workspace dock motion', () => {
  for (const from of states) for (const to of states.filter(state => state !== from)) {
    it(`settles ${from} → ${to}`, () => {
      let state = transitionWorkspaceDock(createWorkspaceDockMotion(from), { type: 'request', target: to, now: 100 });
      const id = state.transition!.id;
      for (const now of [0.01, 0.2, 0.4, 0.6, 0.8].map(progress => 100 + progress * dockMorphDuration)) {
        state = transitionWorkspaceDock(state, { type: 'frame', id, now });
        const geometry = workspaceDockGeometry(state.pose, measure);
        expect(geometry.bodyWidth).toBeGreaterThan(0);
        expect(geometry.bodyX).toBeGreaterThanOrEqual(0);
        expect(geometry.bodyX + geometry.bodyWidth).toBeLessThanOrEqual(measure.width + 1);
      }
      state = transitionWorkspaceDock(state, { type: 'frame', id, now: 100 + dockMorphDuration });
      expect(state.target).toBe(to);
      expect(state.transition).toBeNull();
      expect(workspaceDockPhase(state)).toBe('settled');
      expect(state.pose).toEqual(createWorkspaceDockMotion(to).pose);
    });
  }
  it('keeps the main bar width constant while exchanging chat and search', () => {
    const widths = Array.from({ length: 101 }, (_, i) => workspaceDockGeometry({ presence: 1, input: i / 100 }, measure).bodyWidth);
    expect(new Set(widths).size).toBe(1);
    const compact = workspaceDockGeometry({ presence: 1, input: 0.45 }, measure);
    expect(compact.bodyHeight).toBe(measure.searchHeight);
    expect(compact.chatControls).toBe(0);
    expect(compact.rightNeck).toBeGreaterThan(0);
    expect(compact.textShift).toBeGreaterThan(0);
  });
  it('fits a two-row search without resizing the detached circles or their travel', () => {
    const twoRows = { ...measure, searchBodyHeight: 88 };
    const search = workspaceDockGeometry({ presence: 1, input: 0 }, twoRows);
    expect(search.bodyHeight).toBe(88);
    for (const input of [0, 0.3, 0.5, 0.7, 1]) {
      const actual = workspaceDockGeometry({ presence: 1, input }, twoRows);
      const singleRow = workspaceDockGeometry({ presence: 1, input }, measure);
      expect(actual.searchSize).toBe(40);
      expect(actual.bodyX).toBe(singleRow.bodyX);
      expect(actual.rightShellX).toBe(singleRow.rightShellX);
      if (input >= 0.3 && input <= 0.7) expect(actual.bodyHeight).toBe(40);
    }
  });
  it('anchors opaque circle shells and moves the send glyph in one direction through the exchange', () => {
    const frames = Array.from({ length: 101 }, (_, i) => workspaceDockGeometry({ presence: 1, input: i / 100 }, measure));
    expect(new Set(frames.map(frame => frame.searchCircleX)).size).toBe(1);
    expect(new Set(frames.map(frame => frame.rightShellX)).size).toBe(1);
    expect(frames.every(frame => frame.searchSize === measure.searchHeight && frame.searchVisibility === 1)).toBe(true);
    const centers = frames.map(frame => frame.chatCircleX + frame.rightSize / 2);
    const direction = Math.sign(centers.at(-1)! - centers[0]);
    expect(centers.slice(1).every((center, i) => (center - centers[i]) * direction >= -0.00001)).toBe(true);
  });
  it('keeps text hidden through exchange, admits its reveal near settling, and sequences glyphs', () => {
    for (const from of states) for (const to of states.filter(state => state !== from)) {
      const moving = transitionWorkspaceDock(createWorkspaceDockMotion(from), { type: 'request', target: to, now: 0 });
      for (let time = 0; time <= dockMorphDuration; time += 20) {
        const state = transitionWorkspaceDock(moving, { type: 'frame', id: moving.transition!.id, now: time });
        const view = workspaceDockPresentation(state);
        if (state.transition && state.transition.progress < 0.9) {
          expect(view.searchText).toBe(0);
          expect(view.chatText).toBe(0);
        } else {
          expect(view.chatText).toBe(to === 'chat-input' ? 1 : 0);
          expect(view.searchText).toBe(to === 'chat-input' ? 0 : 1);
        }
        expect(Math.min(view.chatGlyph, view.sendGlyph)).toBe(0);
        if (from !== 'chat-search' && to !== 'chat-search') expect(view.chatGlyph).toBe(0);
      }
    }
  });
  it('keeps the composer compact through the pinch', () => {
    for (const input of [0.3, 0.5, 0.7]) {
      expect(workspaceDockGeometry({ presence: 1, input }, measure).bodyHeight).toBe(measure.searchHeight);
    }
  });
  it('gives editor/chat edges a gentle departure and arrival with a faster middle', () => {
    for (const [from, to] of [
      ['editor-search', 'chat-input'], ['chat-input', 'editor-search'],
      ['editor-search', 'chat-search'], ['chat-search', 'editor-search']
    ] as const) {
      const moving = transitionWorkspaceDock(createWorkspaceDockMotion(from), { type: 'request', target: to, now: 0 });
      const at = (fraction: number) => transitionWorkspaceDock(moving, {
        type: 'frame', id: moving.transition!.id, now: dockMorphDuration * fraction
      }).transition!.progress;
      expect(at(0.1)).toBeLessThan(0.02);
      expect(at(0.25)).toBeLessThan(0.1);
      expect(at(0.5)).toBeCloseTo(0.5, 5);
      expect(at(0.75)).toBeGreaterThan(0.9);
      expect(at(0.9)).toBeGreaterThan(0.98);
      const positions = Array.from({ length: 100 }, (_, i) => at(i / 100));
      expect(positions.slice(1).every((position, i) => position >= positions[i])).toBe(true);
    }
  });
  it('keeps the outer pacing while giving the connected pinch more time', () => {
    const moving = transitionWorkspaceDock(createWorkspaceDockMotion('chat-search'), { type: 'request', target: 'chat-input', now: 0 });
    const at = (now: number) => transitionWorkspaceDock(moving, { type: 'frame', id: moving.transition!.id, now });
    // Entry and settling retain their 300ms travel pacing.
    const outerTime = 60;
    expect(at(outerTime).pose.input).toBeCloseTo(0.104, 5);
    expect(at(dockMorphDuration - outerTime).pose.input).toBeCloseTo(0.896, 5);
    // The material remains strongly connected either side of the pinch midpoint.
    const midpoint = dockMorphDuration / 2;
    const pinchTime = 20;
    expect(at(midpoint - pinchTime).pose.input).toBeLessThan(0.5);
    expect(at(midpoint + pinchTime).pose.input).toBeGreaterThan(0.5);
    for (const now of [midpoint - pinchTime, midpoint + pinchTime]) {
      expect(workspaceDockGeometry(at(now).pose, measure).leftNeck).toBeGreaterThan(0.9);
    }
    expect(at(dockMorphDuration).transition).toBeNull();
  });
  it('reverses from the current position and ignores an old completion', () => {
    let state = transitionWorkspaceDock(createWorkspaceDockMotion('chat-input'), { type: 'request', target: 'chat-search', now: 0 });
    const oldId = state.transition!.id;
    state = transitionWorkspaceDock(state, { type: 'frame', id: oldId, now: 180 });
    const before = state.pose;
    state = transitionWorkspaceDock(state, { type: 'request', target: 'editor-search', now: 180 });
    expect(state.pose).toEqual(before);
    const reversed = state;
    expect(transitionWorkspaceDock(state, { type: 'frame', id: oldId, now: 10000 })).toBe(reversed);
    state = transitionWorkspaceDock(state, { type: 'request', target: 'chat-input', now: 200 });
    state = transitionWorkspaceDock(state, { type: 'frame', id: state.transition!.id, now: 10000 });
    expect(state.pose).toEqual({ presence: 1, input: 1 });
    expect(state.transition).toBeNull();
  });
  it('finishes immediately for reduced motion and disposal/resize', () => {
    let state = transitionWorkspaceDock(createWorkspaceDockMotion('editor-search'), { type: 'request', target: 'chat-input', now: 0 });
    state = transitionWorkspaceDock(state, { type: 'request', target: 'chat-search', now: 50, immediate: true });
    expect(state.transition).toBeNull();
    expect(state.pose).toEqual({ presence: 1, input: 0 });
    state = transitionWorkspaceDock(state, { type: 'request', target: 'editor-search', now: 60 });
    state = transitionWorkspaceDock(state, { type: 'finish' });
    expect(state.transition).toBeNull();
    expect(state.pose).toEqual({ presence: 0, input: 0 });
  });
});
