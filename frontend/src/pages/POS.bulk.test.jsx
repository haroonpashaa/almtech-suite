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
vi.mock('../hooks/useSaleDraft.jsx', () => ({ useSaleDraft: () => ({ loading: false, flush: async () => ({ id: 'test-draft', revision: 1 }), complete: () => {}, pause: () => {}, resume: () => {} }), SaleDraftPanel: () => null }));
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
async function mount(view = 'desktop', selectedProducts = products, addFirst = true, total = selectedProducts.length) {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const filters = emptyPosProductFilters();
  client.setQueryData(['products-pos', filters, 1, 30, buildPosProductParams(filters)], { rows: selectedProducts, total });
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
  if (addFirst) await addProduct(0);
  return () => view === 'desktop' ? container.querySelectorAll('table')[1].querySelectorAll('tbody tr') : container.querySelectorAll('ul.sm\\:hidden li');
}
async function addProduct(index) {
  const row = container.querySelector('[aria-label="Product selection"] tbody').querySelectorAll('tr')[index];
  await act(async () => [...row.querySelectorAll('button')].find(button => button.textContent === 'Add').click());
}
async function enableBulk(amount) {
  await act(async () => container.querySelector('#pos-bulk-mode').click());
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
    await act(async () => container.querySelector('#pos-bulk-mode').click());
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
  expect(container.querySelector('[aria-label="Batch stock selection"]')).toBeNull();
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

async function clickButton(text) {
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text).click());
}
const selectedCheckbox = product => container.querySelector(`input[aria-label="Select ${product.name} (${product.sku})"]`);
const selectionQuantity = product => container.querySelector(`input[aria-label="Quantity to add for ${product.name} (${product.sku})"]`);

describe('Admin selecting stock for the cart', () => {
  it('selects quantities across products and submits the selected batch at one selling amount', async () => {
    const rows = await mount('desktop', products, false);
    for (const product of products) await act(async () => selectedCheckbox(product).click());
    expect(selectionQuantity(products[0]).value).toBe('500');
    expect(selectionQuantity(products[1]).value).toBe('200');
    await change(selectionQuantity(products[0]), '450');
    await change(selectionQuantity(products[1]), '80');
    await clickButton('Add selected to cart');
    expect(rows()).toHaveLength(2);
    expect(rows()[0].querySelector('input[type="number"]').value).toBe('450');
    expect(rows()[1].querySelector('input[type="number"]').value).toBe('80');
    expect(selectedCheckbox(products[0]).checked).toBe(false);
    await enableBulk('1000000.01');
    await chooseCustomer();
    await save();
    expect(api.post).toHaveBeenCalledWith('/invoices', expect.objectContaining({ bulkSellingTotal: 1000000.01,
      items: [expect.objectContaining({ product: 'p1', quantity: 450 }), expect.objectContaining({ product: 'p2', quantity: 80 })] }));
  });

  it('can add one unit and merge another selection without losing an individually edited price', async () => {
    const rows = await mount('desktop', products, false);
    await act(async () => selectedCheckbox(products[0]).click());
    await change(selectionQuantity(products[0]), '1');
    await clickButton('Add selected to cart');
    await change(rows()[0].querySelector('[aria-label="Selling price per unit"]'), '2500');
    await act(async () => selectedCheckbox(products[0]).click());
    expect(selectionQuantity(products[0]).value).toBe('499');
    await change(selectionQuantity(products[0]), '4');
    await clickButton('Add selected to cart');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('input[type="number"]').value).toBe('5');
    expect(rows()[0].querySelector('[aria-label="Selling price per unit"]').value).toBe('2500');
  });

  it('selects all filtered pages, skips unavailable stock, and deselects everything', async () => {
    await mount('desktop', products, false, 501);
    await change(container.querySelector('[aria-label="Search products"]'), 'Laptop');
    const matching = [...products, ...Array.from({ length: 499 }, (_, i) => ({ ...products[0], _id: `remote-${i}`, stock: i === 498 ? 0 : 1, active: i !== 497 }))];
    api.get.mockImplementation(async (path, options) => {
      if (path === '/products/pos') {
        const { page, limit } = options.params;
        return { data: { page, limit, total: 501, items: matching.slice((page - 1) * limit, page * limit) }, headers: { 'x-total-count': '501' } };
      }
      return { data: [] };
    });
    await clickButton('Select all matching products');
    expect(container.textContent).toContain('499 products selected');
    const bulkCalls = api.get.mock.calls.filter(([path, options]) => path === '/products/pos' && options.params.limit === 500);
    expect(bulkCalls.map(([, options]) => options.params)).toEqual([
      expect.objectContaining({ q: 'Laptop', page: 1, limit: 500 }), expect.objectContaining({ q: 'Laptop', page: 2, limit: 500 }),
    ]);
    await clickButton('Deselect all');
    expect(container.textContent).toContain('0 products selected');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Add selected to cart').disabled).toBe(true);
  });

  it('preserves chosen quantities across pages and filters without selecting hidden products accidentally', async () => {
    await mount('desktop', products, false, 60);
    const filters = emptyPosProductFilters();
    const third = { ...products[0], _id: 'p3', sku: 'SKU-3', name: 'Third laptop', stock: 10 };
    client.setQueryData(['products-pos', filters, 2, 30, buildPosProductParams(filters)], { rows: [third], total: 60 });
    await act(async () => selectedCheckbox(products[0]).click());
    await change(selectionQuantity(products[0]), '400');
    await clickButton('Next');
    await act(async () => selectedCheckbox(third).click());
    expect(container.textContent).toContain('2 products selected');
    await clickButton('Previous');
    expect(selectedCheckbox(products[0]).checked).toBe(true);
    expect(selectedCheckbox(products[1]).checked).toBe(false);
    expect(selectionQuantity(products[0]).value).toBe('400');
    await change(container.querySelector('[aria-label="Search products"]'), 'unmatched');
    expect(container.textContent).toContain('2 products selected');
    await clickButton('Deselect all');
    expect(container.textContent).toContain('0 products selected');
  });

  it('preserves existing selections if Select All fails, and does not apply a cancelled request', async () => {
    await mount('desktop', products, false);
    await act(async () => selectedCheckbox(products[0]).click());
    api.get.mockRejectedValueOnce(new Error('Network error'));
    await clickButton('Select all matching products');
    expect(container.textContent).toContain('1 product selected');
    let resolve;
    api.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await clickButton('Select all matching products');
    expect(container.textContent).toContain('Selecting products…');
    await clickButton('Deselect all');
    await act(async () => resolve({ data: { items: products, page: 1, limit: 500, total: 2 } }));
    expect(container.textContent).toContain('0 products selected');
  });

  it('assigns distinct in-stock serials for selected units', async () => {
    const tracked = { ...products[0], stock: 3, tracksSerials: true, serials: ['SN-1', 'SN-2', 'SN-3'].map(serial => ({ serial, status: 'in_stock' })) };
    const rows = await mount('desktop', [tracked], false);
    await act(async () => selectedCheckbox(tracked).click());
    await change(selectionQuantity(tracked), '2');
    await clickButton('Add selected to cart');
    expect([...rows()[0].querySelectorAll('select')].map(select => select.value)).toEqual(['SN-1', 'SN-2']);
    await chooseCustomer();
    await save();
    expect(api.post.mock.calls[0][1].items[0].serials).toEqual(['SN-1', 'SN-2']);
  });

  it('blocks adding a batch with insufficient serial records until the quantity is corrected', async () => {
    const tracked = { ...products[0], stock: 3, tracksSerials: true, serials: [{ serial: 'SN-1', status: 'in_stock' }] };
    await mount('desktop', [tracked], false);
    await act(async () => selectedCheckbox(tracked).click());
    expect(container.textContent).toContain('Only 1 available serial');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Add selected to cart').disabled).toBe(true);
    await change(selectionQuantity(tracked), '1');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Add selected to cart').disabled).toBe(false);
  });

  it('cannot save a partial batch while checked stock has not yet been added to the cart', async () => {
    await mount();
    await act(async () => selectedCheckbox(products[1]).click());
    const saves = () => [...container.querySelectorAll('button')].filter(button => button.textContent.startsWith('Save Invoice'));
    expect(saves().every(button => button.disabled)).toBe(true);
    expect(container.textContent).toContain('Add the selected stock to the cart or deselect it before saving');
    await clickButton('Deselect all');
    expect(saves().every(button => !button.disabled)).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});


it('marks cached inventory and financial summaries stale after a successful sale', async () => {
  await mount(); await chooseCustomer();
  const cached = ['products', 'products-po', 'product-models', 'dashboard', 'invoices', 'receivables', 'finance-position', 'accounts-summary'];
  for (const key of cached) client.setQueryData([key, 'cached'], { stock: 500 });
  await save();
  for (const key of cached) expect(client.getQueryState([key, 'cached']).isInvalidated, key).toBe(true);
});


it('refreshes uncertain save state without automatically resubmitting the sale', async () => {
  await mount(); await chooseCustomer();
  client.setQueryData(['products', 'cached'], { stock: 500 });
  api.post.mockRejectedValueOnce(new Error('Connection lost after submission'));
  await save();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(['products', 'cached']).isInvalidated).toBe(true);
  expect([...container.querySelectorAll('button')].find(button => button.textContent.startsWith('Save Invoice ·')).disabled).toBe(false);
});
