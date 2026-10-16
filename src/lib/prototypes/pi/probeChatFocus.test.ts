import { describe, expect, it, vi } from 'vitest';
import { focusProbeChat, visibleProbeControl } from './probeChatFocus';

const until = async <T>(read: () => T | Promise<T>): Promise<NonNullable<T>> => {
  for (let poll = 0; poll < 5; poll++) { const value = await read(); if (value) return value as NonNullable<T>; }
  throw new Error('Chat never became visible and non-inert');
};

describe('normal probe chat focus', () => {
  it('expands the retained mobile chat rail instead of replacing the review editor', async () => {
    let ready = false;
    const rail = { click: vi.fn(() => { ready = true; }) }, header = { click: vi.fn() };
    await focusProbeChat({ until, ready: () => ready, expandRail: () => rail, openHeader: () => header });
    expect(rail.click).toHaveBeenCalledOnce(); expect(header.click).not.toHaveBeenCalled();
  });
  it('uses the visible normal header when no retained chat exists', async () => {
    let ready = false;
    const header = { click: vi.fn(() => { ready = true; }) };
    await focusProbeChat({ until, ready: () => ready, expandRail: () => undefined, openHeader: () => header });
    expect(header.click).toHaveBeenCalledOnce();
  });
  it('does not click or infer anything when the chat is already usable', async () => {
    const expandRail = vi.fn(), openHeader = vi.fn();
    await focusProbeChat({ until, ready: () => true, expandRail, openHeader });
    expect(expandRail).not.toHaveBeenCalled(); expect(openHeader).not.toHaveBeenCalled();
  });
  it('rejects a retained but inert or hidden control before reading its geometry', () => {
    const node = { closest: vi.fn(() => ({})), getClientRects: vi.fn() } as unknown as HTMLElement;
    expect(visibleProbeControl(node)).toBe(false);
    expect(node.closest).toHaveBeenCalledWith('[inert],[aria-hidden="true"]');
    expect(node.getClientRects).not.toHaveBeenCalled();
  });
  it('cannot report success when normal expansion fails to reveal the chat', async () => {
    const rail = { click: vi.fn() };
    await expect(focusProbeChat({ until, ready: () => false, expandRail: () => rail, openHeader: () => undefined })).rejects.toThrow('visible and non-inert');
    expect(rail.click).toHaveBeenCalledOnce();
  });
});
