import { describe, expect, it } from 'vitest';
import { toggleVisibleSelection } from './selection.js';

describe('filtered list selection', () => {
  it('selects only visible filtered rows and safely deselects them', () => {
    expect(toggleVisibleSelection([], ['po-a', 'po-b'])).toEqual(['po-a', 'po-b']);
    expect(toggleVisibleSelection(['po-a', 'po-b'], ['po-a', 'po-b'])).toEqual([]);
  });

  it('does not select unrelated rows when filters produce an empty result', () => {
    expect(toggleVisibleSelection([], [])).toEqual([]);
  });

  it('replaces stale hidden selections with the visible filtered page', () => {
    expect(toggleVisibleSelection(['unfiltered-po'], ['filtered-po'])).toEqual(['filtered-po']);
  });
});
