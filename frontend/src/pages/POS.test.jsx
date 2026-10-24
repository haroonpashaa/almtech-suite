// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import POS from './POS.jsx';
import { buildPosProductParams, emptyPosProductFilters } from '../lib/posProductSelection.js';

vi.mock('../hooks/useSaleDraft.jsx', () => ({ useSaleDraft: () => ({ loading: false, flush: async () => ({ id: 'test-draft', revision: 1 }), complete: () => {}, pause: () => {}, resume: () => {} }), SaleDraftPanel: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const product = {
  _id: 'p-1', name: 'Laptop', sku: 'LAPTOP-1', model: 'X1', ram: '16GB',
  processor: 'i7', storage: '512GB SSD', stock: 3, sellingPrice: 100,
  tracksSerials: true,
  serials: [
    { serial: 'SN-1', status: 'in_stock' },
    { serial: 'SN-2', status: 'in_stock' },
    { serial: 'SN-3', status: 'in_stock' },
    { serial: 'SN-SOLD', status: 'sold' },
  ],
};

let container;
let root;
let client;

async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function mountCart(view) {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const filters = emptyPosProductFilters();
  client.setQueryData(['products-pos', filters, 1, 30, buildPosProductParams(filters)], { rows: [product], total: 1 });
  client.setQueryData(['products-pos-models'], ['X1']);
  client.setQueryData(['accounts'], []);
  client.setQueryData(['settings'], { currency: 'PKR' });
  client.setQueryData(['deal-options'], []);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><POS /></MemoryRouter>
    </QueryClientProvider>
  ));
  const picker = container.querySelector('[aria-label="Product selection"]');
  await change(picker.querySelector('select'), 'SN-1');
  await act(async () => [...picker.querySelectorAll('button')].find(button => button.textContent === 'Add').click());
  const row = view === 'desktop' ? container.querySelectorAll('table')[1].querySelector('tbody tr') : container.querySelector('ul.sm\\:hidden li');
  return {
    row,
    quantity: row.querySelector('input[type="number"]'),
    serials: () => [...row.querySelectorAll('select')].map(select => select.value),
  };
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  root = undefined;
});

describe.each(['desktop', 'phone'])('POS quantity editing (%s)', (view) => {
  it('preserves SN-1 when quantity 1 is cleared and retyped as 1', async () => {
    const cart = await mountCart(view);
    expect(cart.serials()).toEqual(['SN-1']);
    await change(cart.quantity, '');
    expect(cart.quantity.value).toBe('');
    expect(cart.serials()).toEqual(['SN-1']);
    await change(cart.quantity, '1');
    expect(cart.serials()).toEqual(['SN-1']);
    expect(cart.row.querySelector('[aria-label="Item name"]').value).toBe('Laptop');
    expect(cart.row.querySelector('[aria-label="RAM"]').value).toBe('16GB');
    expect(container.textContent).toContain('Save Invoice · PKR 100.00');
  });

  it('grows serial slots without duplicates or unavailable options and respects stock', async () => {
    const cart = await mountCart(view);
    await change(cart.quantity, '2');
    expect(cart.serials()).toEqual(['SN-1', '']);
    const second = cart.row.querySelectorAll('select')[1];
    expect([...second.options].map(option => option.value)).toEqual(['', 'SN-2', 'SN-3']);
    await change(second, 'SN-2');
    await change(cart.quantity, '');
    await change(cart.quantity, '99');
    expect(cart.quantity.value).toBe('3');
    expect(cart.serials()).toEqual(['SN-1', 'SN-2', '']);
    expect(container.textContent).toContain('Save Invoice · PKR 300.00');
  });

  it('drops excess selections on decrease and does not restore them on increase', async () => {
    const cart = await mountCart(view);
    await change(cart.quantity, '2');
    await change(cart.row.querySelectorAll('select')[1], 'SN-2');
    await change(cart.quantity, '');
    await change(cart.quantity, '1');
    expect(cart.serials()).toEqual(['SN-1']);
    await change(cart.quantity, '2');
    expect(cart.serials()).toEqual(['SN-1', '']);
  });

  it('resizes to the existing quantity fallback when a blank input loses focus', async () => {
    const cart = await mountCart(view);
    await change(cart.quantity, '2');
    await change(cart.row.querySelectorAll('select')[1], 'SN-2');
    await change(cart.quantity, '');
    await act(async () => cart.quantity.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })));
    expect(cart.quantity.value).toBe('1');
    expect(cart.serials()).toEqual(['SN-1']);
  });
});
