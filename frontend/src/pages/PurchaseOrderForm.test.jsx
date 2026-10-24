// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PurchaseOrderForm from './PurchaseOrderForm.jsx';
import PurchaseOrderDetail from './PurchaseOrderDetail.jsx';
import { api } from '../api/client.js';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: auth.role }, has: (...roles) => roles.includes(auth.role) }) }));
vi.mock('../components/Combobox.jsx', () => ({ default: ({ value, onChange, label }) => <label>{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)}><option value="">Select</option><option value="s1">Supplier A</option></select></label> }));
vi.mock('../components/DealSelector.jsx', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, client;
const products = [{ _id: 'a', name: 'Laptop A', sku: 'A', purchasePrice: 100 }, { _id: 'b', name: 'Laptop B', sku: 'B', purchasePrice: 250 }];
const po = {
  _id: 'po1', __v: 0, number: 'PO-1', supplier: { _id: 's1', name: 'Supplier A' }, currency: 'PKR',
  items: [{ product: 'a', name: 'Laptop A', sku: 'A', quantity: 2, unitCost: 100, received: 0, bulkAllocatedTotal: 60 }, { product: 'b', name: 'Laptop B', sku: 'B', quantity: 1, unitCost: 250, received: 0, bulkAllocatedTotal: 30 }],
  bulkPurchaseTotal: 90, paid: 0, status: 'ordered', updatedAt: '2026-10-24T00:00:00.000Z', taxRate: 0,
};
async function mount(order, view = 'form') {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['products-po', ''], { items: products, total: 2 });
  if (order) client.setQueryData(['po', 'po1'], order);
  client.setQueryData(['accounts'], []);
  client.setQueryData(['settings'], { currency: 'PKR' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[view === 'detail' ? '/purchase-orders/po1' : order ? '/purchase-orders/po1/edit' : '/purchase-orders/new']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/purchase-orders/new" element={<PurchaseOrderForm />} /><Route path="/purchase-orders/:id/edit" element={<PurchaseOrderForm />} /><Route path="/purchase-orders/:id" element={view === 'detail' ? <PurchaseOrderDetail /> : <div>Saved</div>} /></Routes></MemoryRouter></QueryClientProvider>));
}
async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
async function click(text) { await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === text).click()); }
const bulkToggle = () => container.querySelector('input[type="checkbox"]');
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); root = undefined; auth.role = 'admin'; vi.restoreAllMocks(); });

describe('bulk purchase form', () => {
  it('selects all, enters a batch payable for bulk quantities and submits original unit costs', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { _id: 'po1', number: 'PO-1' } });
    await mount();
    await change(container.querySelector('[aria-label="Supplier"]'), 's1');
    await click('Select All matching products');
    await change(container.querySelector('#po-line-qty-0'), '449');
    await act(async () => bulkToggle().click());
    await change(container.querySelector('#po-bulk-amount'), '900');
    await change(container.querySelector('#purchaseorderform-tax-208'), '10');
    expect(container.querySelector('#po-line-cost-0').value).toBe('100');
    expect(container.querySelector('#po-line-cost-1').value).toBe('250');
    expect(container.textContent).toContain('PKR 990.00');
    expect(container.textContent).toContain('PKR 898.00');
    expect(container.textContent).toContain('PKR 2.00');
    await click('Save Purchase Order');
    expect(post).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({ bulkPurchaseTotal: 900, taxRate: 10, items: [{ product: 'a', quantity: 449, unitCost: 100 }, { product: 'b', quantity: 1, unitCost: 250 }] }));
    expect(post.mock.calls[0][1].items.every(item => !('bulkAllocatedTotal' in item))).toBe(true);
  });
  it('restores ordinary totals when bulk mode is unchecked and supports deselect all', async () => {
    await mount(); await click('Select All matching products');
    await act(async () => bulkToggle().click());
    await change(container.querySelector('#po-bulk-amount'), '90');
    expect(container.textContent).toContain('PKR 90.00');
    await act(async () => bulkToggle().click());
    expect(container.querySelector('#po-bulk-amount')).toBeNull();
    expect(container.textContent).toContain('PKR 350.00');
    expect(container.querySelector('#po-line-cost-0').value).toBe('100');
    await click('Deselect All matching products');
    expect(container.textContent).toContain('No items yet');
  });
  it('blocks an invalid bulk amount from submitting', async () => {
    const post = vi.spyOn(api, 'post');
    await mount(); await change(container.querySelector('[aria-label="Supplier"]'), 's1');
    await click('Select All matching products'); await act(async () => bulkToggle().click());
    await change(container.querySelector('#po-bulk-amount'), '0.001');
    await click('Save Purchase Order');
    expect(post).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain('two decimal');
  });
  it('hydrates and saves an existing bulk PO with unchanged original costs', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: po });
    await mount(po);
    expect(bulkToggle().checked).toBe(true);
    expect(container.querySelector('#po-bulk-amount').value).toBe('90');
    await change(container.querySelector('#po-bulk-amount'), '100');
    await click('Save Changes');
    expect(patch).toHaveBeenCalledWith('/purchase-orders/po1', expect.objectContaining({ bulkPurchaseTotal: 100, expectedUpdatedAt: po.updatedAt, items: [{ product: 'a', quantity: 2, unitCost: 100 }, { product: 'b', quantity: 1, unitCost: 250 }] }));
  });
  it.each(['received', 'paid', 'stock'])('locks bulk financial fields for %s while saving metadata only', async mode => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: po });
    if (mode === 'stock') auth.role = 'stock';
    await mount({ ...po, paid: mode === 'paid' ? 10 : 0, items: po.items.map((line, index) => ({ ...line, received: mode === 'received' && index === 0 ? 1 : 0 })) });
    expect(bulkToggle().disabled).toBe(true);
    expect(container.querySelector('#po-bulk-amount').disabled).toBe(true);
    await click('Save Changes');
    expect(patch.mock.calls[0][1]).toEqual({ expectedUpdatedAt: po.updatedAt, notes: '', expectedAt: undefined });
  });
  it('does not offer new bulk pricing permissions to Stock', async () => {
    auth.role = 'stock'; await mount(); expect(bulkToggle()).toBeNull();
  });
});


describe('bulk purchase detail', () => {
  it('shows original unit costs and separate allocations in both desktop and phone views', async () => {
    await mount({ ...po, subtotal: 90, total: 90, balance: 90, orderedAt: po.updatedAt, payments: [] }, 'detail');
    const table = container.querySelector('table');
    expect(table.textContent).toContain('Bulk allocation');
    const cells = [...table.querySelectorAll('tbody tr:first-child td')];
    expect(cells[3].querySelector('p')).toBeNull(); // Receive Now stays dedicated to receiving.
    expect(cells[4].textContent).toContain('PKR 100.00');
    expect(cells[5].textContent).toContain('PKR 60.00');
    const phone = container.querySelector('ul.sm\\:hidden');
    expect(phone.textContent).toContain('Unit cost: PKR 100.00 · Bulk allocation: PKR 60.00');
    expect(container.textContent).toContain('Bulk payable before tax');
  });
});


describe('PO cart model filter', () => {
  it('shows every matching serial separately, edits the original row and submits the entire cart', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { _id: 'po1', number: 'PO-1' } });
    await mount();
    await act(async () => client.setQueryData(['products-po', ''], { items: [
      { _id: 'x', name: 'Other laptop', model: 'EliteBook', sku: 'SN-X', purchasePrice: 50 },
      { _id: 'a', name: 'Laptop A', model: 'ThinkPad T14', sku: 'SN-A', serials: [{ serial: 'SN-A' }], purchasePrice: 100 },
      { _id: 'b', name: 'Laptop B', model: 'ThinkPad T14', sku: 'SN-B', serials: [{ serial: 'SN-B' }], purchasePrice: 250 },
    ], total: 3 }));
    await change(container.querySelector('[aria-label="Supplier"]'), 's1');
    await click('Select All matching products');
    await change(container.querySelector('#po-cart-model-filter'), 'thinkpad');
    expect(container.querySelector('tbody').textContent).not.toContain('SN-X');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.querySelector('tbody').textContent).toContain('SN-A');
    expect(container.querySelector('tbody').textContent).toContain('SN-B');
    await change(container.querySelector('#po-line-cost-1'), '120');
    expect(container.textContent).toContain('PKR 420.00');
    await change(container.querySelector('#po-cart-model-filter'), 'missing');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.textContent).toContain('No cart items match');
    await click('Clear cart filter');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    await change(container.querySelector('#po-cart-model-filter'), 'thinkpad');
    await click('Save Purchase Order');
    expect(post).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({ items: [
      { product: 'x', quantity: 1, unitCost: 50 }, { product: 'a', quantity: 1, unitCost: 120 }, { product: 'b', quantity: 1, unitCost: 250 },
    ] }));
  });
  it('removes only the intended filtered row and preserves received lines', async () => {
    await mount({ ...po, bulkPurchaseTotal: undefined, items: po.items.map((line, i) => ({ ...line, model: i === 0 ? 'EliteBook' : 'ThinkPad', received: i === 0 ? 1 : 0 })) });
    await change(container.querySelector('#po-cart-model-filter'), 'ThinkPad');
    await act(async () => container.querySelector('tbody button[aria-label="Remove"]').click());
    await click('Clear cart filter');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody').textContent).toContain('Laptop A');
    expect(container.querySelector('tbody button[aria-label="Remove"]')).toBeNull();
  });
});


it('keeps bulk allocation indexed to the full cart when model filtering', async () => {
  await mount({ ...po, items: po.items.map((line, i) => ({ ...line, model: i === 0 ? 'EliteBook' : 'ThinkPad' })) });
  await change(container.querySelector('#po-cart-model-filter'), 'ThinkPad');
  const row = container.querySelector('tbody tr');
  expect(row.children[5].textContent).toBe('PKR 30.00');
  expect(container.querySelector('#po-bulk-amount').value).toBe('90');
  expect([...container.querySelectorAll('option')].some(option => option.value === 'GBP')).toBe(false);
});
it('preserves historical GBP PO amounts and allows only metadata editing', async () => {
  const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: po });
  await mount({ ...po, currency: 'GBP' });
  expect(container.textContent).toContain('GBP 90.00');
  expect(container.textContent).toContain('Historical foreign-currency financial details are read-only');
  expect(container.querySelector('#po-line-cost-0')).toBeNull();
  await click('Save Changes');
  const payload = patch.mock.calls[0][1];
  for (const field of ['currency', 'items', 'supplier', 'taxRate', 'bulkPurchaseTotal']) expect(payload).not.toHaveProperty(field);
});


it('shows the saved FX amount as historical, without recalculating against the current PO total', async () => {
  await mount({ ...po, total: 90, subtotal: 90, balance: 90, fxSnapshots: [{ originalAmount: 350, fromCurrency: 'PKR', toCurrency: 'GBP', equivalentAmount: 0.97, rate: 1 / 360, effectiveAt: '2026-10-23T00:00:00Z', source: 'Historical' }] }, 'detail');
  expect(container.textContent).toContain('Historical snapshot: PKR 350.00 = GBP 0.97');
  expect(container.textContent).not.toContain('Refresh displayed equivalent');
});


it('refreshes cached inventory when receiving a PO without changing the ordered item costs', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({ data: po });
  vi.spyOn(api, 'get').mockResolvedValue({ data: po });
  await mount({ ...po, total: 90, balance: 90 }, 'detail');
  for (const key of ['products', 'products-pos', 'products-po', 'product', 'dashboard']) client.setQueryData([key, 'cached'], { stock: 0 });
  await change(container.querySelector('#recv-0'), '1');
  await click('Receive Selected');
  for (const key of ['products', 'products-pos', 'products-po', 'product', 'dashboard']) expect(client.getQueryState([key, 'cached']).isInvalidated, key).toBe(true);
  expect(api.post).toHaveBeenCalledWith('/purchase-orders/po1/receive', { receipts: [{ product: 'a', quantity: 1 }], expectedUpdatedAt: po.updatedAt, expectedVersion: po.__v });
});


it('refreshes stock after an uncertain receipt error without posting the receipt twice', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('Lost receipt response'));
  vi.spyOn(api, 'get').mockResolvedValue({ data: po });
  await mount({ ...po, total: 90, balance: 90 }, 'detail');
  client.setQueryData(['products', 'cached'], { stock: 0 });
  await change(container.querySelector('#recv-0'), '1');
  await click('Receive Selected');
  expect(post).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(['products', 'cached']).isInvalidated).toBe(true);
});
