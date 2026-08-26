import { describe, it, expect } from 'vitest';
import { resolveLineComments } from './invoice.controller.js';

describe('resolveLineComments', () => {
  it('falls back to the product comments when the sale sends none', () => {
    expect(resolveLineComments(undefined, { comments: 'Screen scratch' })).toBe('Screen scratch');
  });

  it('lets the salesperson override the product comments for this sale', () => {
    expect(resolveLineComments('Sold as-is, buyer aware of the scratch', { comments: 'Screen scratch' })).toBe(
      'Sold as-is, buyer aware of the scratch'
    );
  });

  it('lets the salesperson explicitly clear the comment with an empty string', () => {
    expect(resolveLineComments('', { comments: 'Screen scratch' })).toBe('');
  });

  it('defaults to empty when neither the sale nor the product has a comment', () => {
    expect(resolveLineComments(undefined, {})).toBe('');
  });
});
