// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import InventoryFilters from './InventoryFilters.jsx';
import { MAX_SELECTED_MODELS } from '../lib/inventoryModels.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const models = ['ThinkPad X1', 'ThinkPad X1 Carbon', 'EliteBook 840'];
let container;
let root;

function FilterHarness({ initial = { q: '', lowStock: false, selectedModels: [] }, options = models }) {
  const [filters, setFilters] = React.useState(initial);
  return (
    <InventoryFilters
      q={filters.q}
      lowStock={filters.lowStock}
      selectedModels={filters.selectedModels}
      models={options}
      onQueryChange={(q) => setFilters((current) => ({ ...current, q }))}
      onLowStockChange={() => setFilters((current) => ({ ...current, lowStock: !current.lowStock }))}
      onModelsChange={(selectedModels) => setFilters((current) => ({ ...current, selectedModels }))}
      onClearFilters={() => setFilters({ q: '', lowStock: false, selectedModels: [] })}
      total={12}
    />
  );
}

async function mount(props) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<FilterHarness {...props} />));
}

async function click(element) {
  await act(async () => element.click());
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  document.body.innerHTML = '';
});

describe('Inventory filters', () => {
  it('selects one and multiple models, updates the count, and clears all filter controls', async () => {
    await mount();
    await click(container.querySelector('button[aria-haspopup="dialog"]'));

    await click(container.querySelector('input[aria-label="ThinkPad X1"]'));
    expect(container.querySelector('button[aria-haspopup="dialog"]').textContent).toBe('Model (1)');

    await click(container.querySelector('input[aria-label="ThinkPad X1 Carbon"]'));
    expect(container.querySelector('button[aria-haspopup="dialog"]').textContent).toBe('Model (2)');
    expect(container.querySelector('input[aria-label="ThinkPad X1"]').checked).toBe(true);
    expect(container.querySelector('input[aria-label="ThinkPad X1 Carbon"]').checked).toBe(true);

    const search = container.querySelector('input[aria-label="Search inventory"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'Lenovo');
      search.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click(container.querySelector('button[aria-pressed="false"]'));
    expect(search.value).toBe('Lenovo');
    expect(container.querySelector('button[aria-pressed="true"]')).not.toBeNull();

    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear filters'));
    expect(search.value).toBe('');
    expect(container.querySelector('button[aria-pressed="false"]')).not.toBeNull();
    expect(container.querySelector('button[aria-haspopup="dialog"]').textContent).toBe('Model');

    expect(container.querySelector('input[aria-label="ThinkPad X1"]').checked).toBe(false);
    expect(container.querySelector('input[aria-label="ThinkPad X1 Carbon"]').checked).toBe(false);
  });

  it('prevents selecting more than 100 models and explains the limit', async () => {
    const options = Array.from({ length: MAX_SELECTED_MODELS + 1 }, (_, index) => `Model ${index + 1}`);
    await mount({ initial: { q: '', lowStock: false, selectedModels: options.slice(0, MAX_SELECTED_MODELS) }, options });
    await click(container.querySelector('button[aria-haspopup="dialog"]'));

    expect(container.querySelector('[role="status"]')?.textContent).toContain('Maximum of 100 models selected');
    expect(container.querySelector('input[aria-label="Model 101"]').disabled).toBe(true);
    expect(container.querySelector('input[aria-label="Model 1"]').disabled).toBe(false);
  });
});
