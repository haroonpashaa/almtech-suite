import { describe, expect, it } from 'vitest';
import { filterModelOptions, inventoryListParams, MAX_SELECTED_MODELS, toggleModelSelection } from './inventoryModels.js';

describe('Inventory model filters', () => {
  const models = ['ThinkPad X1', 'ThinkPad X1 Carbon', 'EliteBook 840'];

  it('searches model choices without merging similar model names', () => {
    expect(filterModelOptions(models, 'x1')).toEqual(['ThinkPad X1', 'ThinkPad X1 Carbon']);
    expect(filterModelOptions(models, 'x1 carbon')).toEqual(['ThinkPad X1 Carbon']);
  });

  it('toggles only the chosen model and supports multiple selections', () => {
    const selected = toggleModelSelection([], 'ThinkPad X1');
    const multiple = toggleModelSelection(selected, 'ThinkPad X1 Carbon');
    expect(multiple).toEqual(['ThinkPad X1', 'ThinkPad X1 Carbon']);
    expect(toggleModelSelection(multiple, 'ThinkPad X1')).toEqual(['ThinkPad X1 Carbon']);
  });

  it('preserves the existing search and low-stock filters and omits model filtering after clear', () => {
    expect(inventoryListParams({ q: 'Lenovo', lowStock: true, models: ['ThinkPad X1'] })).toEqual({
      q: 'Lenovo', lowStock: true, models: '["ThinkPad X1"]',
    });
    expect(inventoryListParams({ q: '', lowStock: false, models: [] })).toEqual({
      q: undefined, lowStock: undefined, models: undefined,
    });
  });

  it('enforces the same 100-model limit as the backend while allowing deselection', () => {
    expect(MAX_SELECTED_MODELS).toBe(100);
    const selected = Array.from({ length: MAX_SELECTED_MODELS }, (_, index) => `Model ${index + 1}`);
    expect(toggleModelSelection(selected, 'Model 101')).toBe(selected);
    expect(toggleModelSelection(selected, 'Model 1')).toHaveLength(99);
  });
});
