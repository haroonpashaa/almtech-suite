import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration } from './bytes.js';

describe('formatBytes', () => {
  it('formats zero and small byte counts without a decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales to KB, MB, GB appropriately', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('returns a placeholder for null/undefined/NaN rather than throwing', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats seconds under a minute', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats minutes, hours and days', () => {
    expect(formatDuration(125)).toBe('2m');
    expect(formatDuration(3725)).toBe('1h 2m');
    expect(formatDuration(90125)).toBe('1d 1h 2m');
  });

  it('returns a placeholder for invalid input rather than throwing', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });
});
