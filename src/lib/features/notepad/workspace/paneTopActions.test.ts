import { describe, expect, it } from 'vitest';
import { getPaneTopActions } from './paneTopActions';

describe('pane top action state', () => {
  it('shows note actions in a solo pane', () => {
    expect(getPaneTopActions('editor', 'solo')).toEqual([
      'open-chat',
      'open-previous',
      'split-pane'
    ]);
    expect(getPaneTopActions('editor', 'solo', 'expanded')).toEqual([
      'split-with-chat',
      'split-with-previous',
      'split-with-current',
      'split-pane'
    ]);
  });

  it('does not offer chat from a solo chat pane', () => {
    expect(getPaneTopActions('chat', 'solo')).toEqual([
      'open-previous',
      'split-pane'
    ]);
    expect(getPaneTopActions('chat', 'solo', 'expanded')).toEqual([
      'split-with-previous',
      'split-with-current',
      'split-pane'
    ]);
  });

  it('shows direct navigation and close actions in split panes', () => {
    expect(getPaneTopActions('editor', 'split')).toEqual([
      'open-chat',
      'open-previous',
      'close'
    ]);
    expect(getPaneTopActions('chat', 'split')).toEqual([
      'open-previous',
      'close'
    ]);
  });
});
