import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// The spinner-suppression behaviour for every monetary input in the app is a
// single shared CSS class (.input-money) rather than per-field overrides — this
// guards that the class keeps existing with the rules that actually hide the
// browser's up/down arrows in both engines, so a future edit to index.css can't
// silently regress every price/amount field at once.
const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.css');
const css = readFileSync(cssPath, 'utf8');

describe('.input-money (shared monetary-input spinner suppression)', () => {
  it('is defined in the global stylesheet', () => {
    expect(css).toMatch(/\.input-money\s*\{/);
  });

  it('disables the Firefox number spinner', () => {
    const block = css.match(/\.input-money\s*\{[^}]*\}/);
    expect(block?.[0]).toMatch(/-moz-appearance:\s*textfield/);
  });

  it('disables the WebKit spin button on both pseudo-elements', () => {
    const block = css.match(/\.input-money::-webkit-outer-spin-button,\s*\.input-money::-webkit-inner-spin-button\s*\{[^}]*\}/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/-webkit-appearance:\s*none/);
  });

  it('is a modifier meant to sit alongside .input, not a standalone replacement (no width/border/padding of its own)', () => {
    const block = css.match(/\.input-money\s*\{([^}]*)\}/)[1];
    expect(block).not.toMatch(/\bwidth\b|\bborder\b|\bpadding\b/);
  });
});
