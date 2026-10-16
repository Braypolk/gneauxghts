import { afterEach, describe, expect, it, vi } from 'vitest';
import { probePaneTitle } from './probePaneTitle';

afterEach(() => vi.unstubAllGlobals());

describe('exact pane title across the normal mobile header relocation', () => {
  it.each(['chat', 'editor'] as const)('keeps the %s title tied to its sole owner through relocation and return', kind => {
    const localTitle = { value: 'Retained pane' }, movedTitle = { value: 'Active pane' };
    let portaled = true;
    const retained = { querySelector: () => localTitle } as unknown as HTMLElement;
    const active = { querySelector: () => portaled ? null : movedTitle } as unknown as HTMLElement;
    vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector.startsWith('.mobile-workspace-title-slot') ? portaled ? [movedTitle] : [] : [retained, active] });
    expect(probePaneTitle(active, kind)).toBe(movedTitle);
    expect(probePaneTitle(retained, kind)).toBe(localTitle);
    portaled = false;
    // Readback still belongs to this pane after another pane becomes active,
    // even though its local compact title may now be hidden.
    expect(probePaneTitle(active, kind)).toBe(movedTitle);
  });

  it('does not match a foreign mobile note title by equal title text or borrow it for an unmounted shell', () => {
    const title = { value: 'Same title' };
    const requested = { querySelector: () => null } as unknown as HTMLElement;
    const foreign = { querySelector: () => null } as unknown as HTMLElement;
    vi.stubGlobal('document', { querySelectorAll: (selector: string) => selector.startsWith('.mobile-workspace-title-slot') ? [title] : [requested, foreign] });
    expect(probePaneTitle(requested, 'editor')).toBeUndefined();
    expect(probePaneTitle(foreign, 'editor')).toBeUndefined();
    expect(probePaneTitle(null, 'editor')).toBeUndefined();
  });
});
