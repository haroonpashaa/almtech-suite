import { describe, it, expect } from 'vitest';
import { resizeSerials, compactSerials, serialsAreSubmittable } from './cartSerials.js';

describe('resizeSerials', () => {
  it('pads an empty array up to the quantity with blank slots', () => {
    expect(resizeSerials([], 3)).toEqual(['', '', '']);
  });

  it('keeps existing selections when growing', () => {
    expect(resizeSerials(['SN1'], 3)).toEqual(['SN1', '', '']);
  });

  it('drops selections from the end when shrinking', () => {
    expect(resizeSerials(['SN1', 'SN2', 'SN3'], 1)).toEqual(['SN1']);
  });

  it('resizes to zero for a zero or negative quantity', () => {
    expect(resizeSerials(['SN1', 'SN2'], 0)).toEqual([]);
    expect(resizeSerials(['SN1', 'SN2'], -3)).toEqual([]);
  });

  it('treats a non-numeric quantity as zero', () => {
    expect(resizeSerials(['SN1'], 'abc')).toEqual([]);
  });
});

describe('compactSerials', () => {
  it('drops unfilled slots', () => {
    expect(compactSerials(['SN1', '', 'SN2', ''])).toEqual(['SN1', 'SN2']);
  });

  it('returns an empty array for no selections', () => {
    expect(compactSerials(['', ''])).toEqual([]);
    expect(compactSerials(undefined)).toEqual([]);
  });
});

describe('serialsAreSubmittable', () => {
  it('allows no selection at all — serial capture stays optional', () => {
    expect(serialsAreSubmittable(['', ''], 2)).toBe(true);
    expect(serialsAreSubmittable([], 2)).toBe(true);
  });

  it('allows a full, distinct selection matching quantity', () => {
    expect(serialsAreSubmittable(['SN1', 'SN2'], 2)).toBe(true);
  });

  it('rejects a partial selection', () => {
    expect(serialsAreSubmittable(['SN1', ''], 2)).toBe(false);
  });

  it('rejects the same serial chosen twice', () => {
    expect(serialsAreSubmittable(['SN1', 'SN1'], 2)).toBe(false);
  });
});
