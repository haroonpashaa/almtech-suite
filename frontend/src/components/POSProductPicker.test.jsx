// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import POSProductPicker from './POSProductPicker.jsx';
import { addPosCartItem, emptyPosProductFilters } from '../lib/posProductSelection.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const models = ['ThinkPad X1', 'ThinkPad X1 Carbon'];
const product = {
  _id: 'p-1', name: 'ThinkPad X1', sku: 'POS-X1', model: 'ThinkPad X1', brand: 'Lenovo',
  ram: '16GB', processor: 'i7', storage: '512GB SSD', condition: 'used', stock: 2, sellingPrice: 100,
  tracksSerials: true, serials: [{ serial: 'SN-1', status: 'in_stock' }, { serial: 'SN-2', status: 'in_stock' }],
};

function Harness() {
  const [filters, setFilters] = useState(emptyPosProductFilters);
  const [cart, setCart] = useState([]);
  const [selectedSerials, setSelectedSerials] = useState({});
  return (
    <>
      <POSProductPicker
        filters={filters}
        models={models}
        onFiltersChange={setFilters}
        products={[product, { ...product, _id: 'out-of-stock', name: 'Out of stock laptop', model: 'Out of stock laptop', sku: 'POS-OUT', stock: 0, tracksSerials: false }]}
        loading={false}
        error={false}
        total={1}
        page={1}
        limit={30}
        onPageChange={() => {}}
        cart={cart}
        selectedSerials={selectedSerials}
        onSerialChange={(id, serial) => setSelectedSerials((current) => ({ ...current, [id]: serial }))}
        onAdd={(selectedProduct, serial) => {
          setCart((current) => addPosCartItem(current, selectedProduct, serial).cart);
          if (serial) setSelectedSerials((current) => ({ ...current, [selectedProduct._id]: '' }));
        }}
        currency="PKR"
        formatMoney={(value) => `PKR ${value}`}
      />
      <output aria-label="Cart state">{JSON.stringify(cart.map(({ quantity, serials }) => ({ quantity, serials })))}</output>
    </>
  );
}

let container;
let root;

async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
}

async function click(element) {
  await act(async () => element.click());
}

async function setInput(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function setSelect(select, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  document.body.innerHTML = '';
});

describe('POS product picker', () => {
  it('renders populated processor, storage, and in-stock serial values from the POS product response', async () => {
    await mount();
    const row = container.querySelector('tbody tr');

    expect(row.cells[2].textContent).toContain('SN-1');
    expect(row.cells[2].textContent).toContain('SN-2');
    expect(row.cells[4].textContent).toBe('i7');
    expect(row.cells[5].textContent).toBe('512GB SSD');
    expect(row.querySelector('select[aria-label="Serial number for ThinkPad X1"]')).toBeTruthy();
  });

  it('selects one or multiple models and Clear filters resets search and attribute filters', async () => {
    await mount();
    const modelButton = container.querySelector('button[aria-haspopup="dialog"]');
    await click(modelButton);
    await click(container.querySelector('input[aria-label="ThinkPad X1"]'));
    expect(modelButton.textContent).toBe('Model (1)');
    await click(container.querySelector('input[aria-label="ThinkPad X1 Carbon"]'));
    expect(modelButton.textContent).toBe('Model (2)');

    await setInput(container.querySelector('input[aria-label="Search products"]'), 'Lenovo');
    await click(container.querySelector('summary'));
    await setInput(container.querySelector('input[aria-label="Filter by Brand"]'), 'Lenovo');
    await setInput(container.querySelector('input[aria-label="Filter by RAM"]'), '16GB');
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear filters'));

    expect(container.querySelector('input[aria-label="Search products"]').value).toBe('');
    expect(modelButton.textContent).toBe('Model');
    expect(container.querySelector('input[aria-label="Filter by Brand"]').value).toBe('');
    expect(container.querySelector('input[aria-label="Filter by RAM"]').value).toBe('');
  });

  it('adds the selected individual serial unit once and prevents quantity beyond stock', async () => {
    await mount();
    const serialSelect = container.querySelector('select[aria-label="Serial number for ThinkPad X1"]');
    const addButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Add');

    await setSelect(serialSelect, 'SN-1');
    expect(serialSelect.value).toBe('SN-1');
    expect(addButton.disabled).toBe(false);
    await click(addButton);
    expect(container.querySelector('[aria-label="Cart state"]').textContent).toBe('[{"quantity":1,"serials":["SN-1"]}]');

    await setSelect(serialSelect, 'SN-2');
    await click(addButton);
    expect(container.querySelector('[aria-label="Cart state"]').textContent).toBe('[{"quantity":2,"serials":["SN-1","SN-2"]}]');
    expect(addButton.disabled).toBe(true);
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Out of stock').disabled).toBe(true);
  });
});
