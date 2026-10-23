// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import POS from './POS.jsx';
import { api } from '../api/client.js';
import { buildPosProductParams, emptyPosProductFilters } from '../lib/posProductSelection.js';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ has: (...roles) => roles.includes(auth.role) }) }));
vi.mock('../api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, client;
const products = [
  { _id: 'p1', name: 'Laptop', sku: 'SKU-1', model: 'X1', stock: 500, sellingPrice: 2000, tracksSerials: false, serials: [] },
  { _id: 'p2', name: 'Second laptop', sku: 'SKU-2', model: 'X2', stock: 200, sellingPrice: 1000, tracksSerials: false, serials: [] },
];
const customer = { _id: 'customer-1', name: 'Wholesale buyer' };
async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
async function mount(view = 'desktop', selectedProducts = products) {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const filters = emptyPosProductFilters();
  client.setQueryData(['products-pos', filters, 1, 30, buildPosProductParams(filters)], { rows: selectedProducts, total: selectedProducts.length });
  client.setQueryData(['products-pos-models'], ['X1', 'X2']);
  client.setQueryData(['accounts'], [{ _id: 'cash-1', name: 'Cash' }]);
  client.setQueryData(['settings'], { currency: 'PKR' });
  client.setQueryData(['deal-options'], []);
  client.setQueryData(['combobox', '/customers', '', 20, {}], [customer]);
  api.get.mockResolvedValue({ data: customer });
  api.post.mockResolvedValue({ data: { _id: 'invoice-1', number: 'INV-1' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><POS /></MemoryRouter></QueryClientProvider>));
  await addProduct(0);
  return () => view === 'desktop' ? container.querySelectorAll('table')[1].querySelectorAll('tbody tr') : container.querySelectorAll('ul.sm\\:hidden li');
}
async function addProduct(index) {
  const row = container.querySelector('[aria-label="Product selection"] tbody').querySelectorAll('tr')[index];
  await act(async () => [...row.querySelectorAll('button')].find(button => button.textContent === 'Add').click());
}
async function enableBulk(amount) {
  await act(async () => container.querySelector('input[type="checkbox"]').click());
  await change(container.querySelector('#pos-bulk-selling-total'), amount);
}
async function chooseCustomer() {
  await act(async () => container.querySelector('#pos-customer-26').focus());
  await act(async () => [...container.querySelectorAll('[role="option"] button')].find(button => button.textContent.includes('Wholesale buyer')).click());
}
async function save() {
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.startsWith('Save Invoice ·')).click());
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
  auth.role = 'admin';
});

describe.each(['desktop', 'phone'])('POS batch selling (%s)', view => {
  it('submits 450 units at one total, with independent line controls read-only', async () => {
    const rows = await mount(view);
    await change(rows()[0].querySelector('input[type="number"]'), '450');
    await enableBulk('900000.01');
    expect(container.textContent).toContain('For all 450 selected items');
    expect(container.textContent).toContain('Save Invoice · PKR 900,000.01');
    expect(rows()[0].querySelector('[aria-label="Selling price per unit"]').readOnly).toBe(true);
    expect(rows()[0].querySelector('[aria-label="Line discount"]').readOnly).toBe(true);
    await chooseCustomer();
    await save();
    const payload = api.post.mock.calls[0][1];
    expect(payload.bulkSellingTotal).toBe(900000.01);
    expect(payload.items[0]).toMatchObject({ product: 'p1', name: 'Laptop', model: 'X1', quantity: 450, serials: [] });
    expect(payload.items[0]).not.toHaveProperty('unitCost');
  });

  it('reallocates after quantity edits and removal, and restores ordinary prices on toggle-off', async () => {
    const rows = await mount(view);
    await addProduct(1);
    await enableBulk('100');
    await change(rows()[0].querySelector('input[type="number"]'), '2');
    expect(rows()[0].textContent).toContain('66.66');
    expect(rows()[1].textContent).toContain('33.34');
    await act(async () => rows()[0].querySelector('button[aria-label^="Remove"]').click());
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('100.00');
    expect(rows()[0].querySelector('[aria-label="Item name"]').value).toBe('Second laptop');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    expect(rows()[0].querySelector('[aria-label="Selling price per unit"]').value).toBe('1000');
    expect(rows()[0].querySelector('[aria-label="Selling price per unit"]').readOnly).toBe(false);
    expect(container.textContent).toContain('Save Invoice · PKR 1,000.00');
  });
});

it('preserves invoice discount, tax, initial payment and account selection with batch pricing', async () => {
  await mount();
  await enableBulk('1000');
  await change(container.querySelector('#pos-discount-27'), '100');
  await change(container.querySelector('#pos-tax-28'), '10');
  await change(container.querySelector('#pos-initial-payment-30'), '200');
  await act(async () => {
    const account = container.querySelector('#pos-deposit-to-32');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(account, 'cash-1');
    account.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('Save Invoice · PKR 990.00');
  await chooseCustomer();
  await save();
  expect(api.post).toHaveBeenCalledWith('/invoices', expect.objectContaining({ bulkSellingTotal: 1000, discount: 100, taxRate: 10, initialPayment: expect.objectContaining({ amount: 200, account: 'cash-1', method: 'cash' }) }));
});

it('blocks saving a blank, negative or overprecise batch amount', async () => {
  await mount();
  await enableBulk('');
  for (const amount of ['', '-1', '1.234']) {
    await change(container.querySelector('#pos-bulk-selling-total'), amount);
    const saves = [...container.querySelectorAll('button')].filter(button => button.textContent.startsWith('Save Invoice'));
    expect(saves.every(button => button.disabled)).toBe(true);
  }
  expect(api.post).not.toHaveBeenCalled();
});

it('does not expose batch-price controls to Sales', async () => {
  auth.role = 'sales';
  await mount();
  expect(container.textContent).not.toContain('Bulk sale');
  expect(container.querySelector('#pos-bulk-selling-total')).toBeNull();
});

it('retains chosen serials through blank quantity editing and submits the selected units with the batch amount', async () => {
  const rows = await mount('desktop', [{ ...products[0], stock: 3, tracksSerials: true,
    serials: ['SN-1', 'SN-2', 'SN-3'].map(serial => ({ serial, status: 'in_stock' })) }]);
  await change(rows()[0].querySelector('select'), 'SN-1');
  await enableBulk('100.01');
  const quantity = rows()[0].querySelector('input[type="number"]');
  await change(quantity, '');
  expect(rows()[0].querySelector('select').value).toBe('SN-1');
  await change(quantity, '2');
  await change(rows()[0].querySelectorAll('select')[1], 'SN-2');
  await chooseCustomer();
  await save();
  expect(api.post).toHaveBeenCalledWith('/invoices', expect.objectContaining({ bulkSellingTotal: 100.01,
    items: [expect.objectContaining({ product: 'p1', quantity: 2, serials: ['SN-1', 'SN-2'] })] }));
});
