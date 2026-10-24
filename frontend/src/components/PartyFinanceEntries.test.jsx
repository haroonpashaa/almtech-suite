// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PartyFinanceEntries from './PartyFinanceEntries.jsx';
import ReceivableDetail from '../pages/ReceivableDetail.jsx';
import PayableDetail from '../pages/PayableDetail.jsx';
import { api } from '../api/client.js';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ has: (...roles) => roles.includes(auth.role) }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, client;
const entry = { _id: 'entry-1', total: 100, paid: 0, balance: 100, version: 3, currency: 'PKR', date: '2026-10-20T00:00:00Z', description: 'Statement balance', reference: 'REF-1', status: 'active', payments: [] };
const accounts = [{ _id: 'cash', name: 'Cash', currency: 'PKR', active: true }, { _id: 'gbp', name: 'GBP account', currency: 'GBP' }, { _id: 'inactive', name: 'Inactive', currency: 'PKR', active: false }];
async function mount(element, data) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['settings'], { currency: 'PKR' }); client.setQueryData(['accounts'], accounts);
  if (data) { client.setQueryData(['receivable', 'party-1'], data); client.setQueryData(['payable', 'party-1', 'PKR'], data); }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/finance/party-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/finance/:id" element={element} /></Routes></MemoryRouter></QueryClientProvider>));
}
async function change(selector, value) {
  const element = container.querySelector(selector);
  await act(async () => {
    const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true })); element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent === text);
async function click(text) { await act(async () => button(text).click()); }
async function mountEntries(category, entries = []) { await mount(<PartyFinanceEntries category={category} partyId="party-1" entries={entries} accounts={accounts} />); }
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); root = undefined; auth.role = 'admin'; vi.restoreAllMocks(); });

describe.each(['receivables', 'payables'])('Admin %s entry controls', category => {
  const noun = category === 'receivables' ? 'receivable' : 'payable';
  it('adds an entry with one total and reason; invalidates the dependent finance views', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
    await mountEntries(category);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await click(`Add ${noun}`);
    expect(button('Save financial change').disabled).toBe(true);
    await change('#party-entry-total', '125.01'); await change('#party-entry-description', 'Supplier/customer statement'); await change('#party-entry-reference', 'R-2'); await change('#party-entry-reason', 'Verified opening obligation');
    await click('Save financial change');
    expect(post).toHaveBeenCalledWith(`/finance/${category}/party-1/entries`, expect.objectContaining({ total: 125.01, description: 'Supplier/customer statement', reference: 'R-2', reason: 'Verified opening obligation', currency: 'PKR', idempotencyKey: expect.any(String) }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    for (const key of ['receivable','payable','finance-position','dashboard','accounts-summary','account-ledger','customer-ledger','supplier-ledger','payment-history','report-receivables','report-payables']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
  });
  it('edits the total with a version token and never exposes a competing paid or balance input', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: {} });
    await mountEntries(category, [entry]); await click('Edit entry');
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
    await change('#party-entry-total', '150'); await change('#party-entry-reason', 'Correct statement amount'); await click('Save financial change');
    expect(patch).toHaveBeenCalledWith(`/finance/${category}/party-1/entries/entry-1`, expect.objectContaining({ total: 150, expectedVersion: 3 }));
    expect(patch.mock.calls[0][1]).not.toHaveProperty('paid'); expect(patch.mock.calls[0][1]).not.toHaveProperty('balance');
  });
  it('requires a matching active account, caps entry amount by validation, and sends actual payment data', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
    await mountEntries(category, [entry]); await click('Record payment');
    expect(button('Save financial change').disabled).toBe(true);
    expect([...container.querySelectorAll('#party-entry-account option')].map(o => o.value)).toEqual(['', 'cash']);
    await change('#party-entry-account', 'cash'); await change('#party-entry-amount', '100.01'); await change('#party-entry-reason', 'Payment received or sent');
    expect(button('Save financial change').disabled).toBe(true);
    await change('#party-entry-amount', '40'); await change('#party-entry-reference', 'TX-40'); await click('Save financial change');
    expect(post).toHaveBeenCalledWith(`/finance/${category}/party-1/entries/entry-1/payments`, expect.objectContaining({ amount: 40, account: 'cash', reference: 'TX-40', expectedVersion: 3 }));
  });
  it('keeps paid entries auditable and offers reversal instead of voiding away payments', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
    await mountEntries(category, [{ ...entry, paid: 40, balance: 60, payments: [{ transaction: 'tx-1', amount: 40, date: entry.date, account: { name: 'Cash' } }] }]);
    expect(button('Void entry').disabled).toBe(true);
    await click('Reverse payment'); await change('#party-entry-reason', 'Wrong payment amount'); await click('Save financial change');
    expect(post).toHaveBeenCalledWith(`/finance/${category}/party-1/entries/entry-1/payments/tx-1/reverse`, expect.objectContaining({ reason: 'Wrong payment amount', expectedVersion: 3 }));
  });
  it('voids an unpaid entry with a reason', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} });
    await mountEntries(category, [entry]); await click('Void entry'); await change('#party-entry-reason', 'Duplicate obligation'); await click('Save financial change');
    expect(post).toHaveBeenCalledWith(`/finance/${category}/party-1/entries/entry-1/void`, expect.objectContaining({ reason: 'Duplicate obligation', expectedVersion: 3 }));
  });
  it('preserves the idempotency key after a failed request and prevents double submits', async () => {
    let reject;
    const post = vi.spyOn(api, 'post').mockImplementationOnce(() => new Promise((resolve, no) => { reject = no; })).mockResolvedValue({ data: {} });
    await mountEntries(category, [entry]); await click('Void entry'); await change('#party-entry-reason', 'Confirmed duplicate');
    await act(async () => { button('Save financial change').click(); button('Save financial change')?.click(); });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Connection interrupted')));
    await click('Save financial change');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1].idempotencyKey).toBe(post.mock.calls[1][1].idempotencyKey);
  });
  it('rejects excess precision and corrections below recorded payments', async () => {
    const patch = vi.spyOn(api, 'patch');
    await mountEntries(category, [{ ...entry, paid: 40, balance: 60 }]); await click('Edit entry'); await change('#party-entry-reason', 'Amount correction');
    await change('#party-entry-total', '50.001'); expect(button('Save financial change').disabled).toBe(true);
    await change('#party-entry-total', '30'); expect(button('Save financial change').disabled).toBe(true);
    expect(patch).not.toHaveBeenCalled();
  });
});
const detail = { customer: { name: 'Customer' }, supplier: { _id: 'party-1', name: 'Supplier' }, outstanding: 100, documentOutstanding: 0, total: 100, paid: 0, storedBalance: 100, storedPayable: 100, reconciled: true, aging: { current: 100 }, invoices: [], purchaseOrders: [], manualEntries: [entry], entryTotals: { openCount: 1, outstanding: 100 }, entryHistory: [] };
it('shows Admin editing and separate open-entry counts on the customer and supplier detail pages', async () => {
  await mount(<ReceivableDetail />, detail);
  expect(container.querySelector('[aria-label="Manage receivable entries"]')).not.toBeNull();
  expect(container.textContent).toContain('Plus 1 open standalone entry');
  await act(async () => root.unmount()); root = undefined; container.remove(); client.clear();
  await mount(<PayableDetail />, detail);
  expect(container.querySelector('[aria-label="Manage payable entries"]')).not.toBeNull();
  expect(container.textContent).toContain('Plus 1 open standalone entry');
});
it('keeps Admin editing and non-cash correction controls out of the Sales customer view', async () => {
  auth.role = 'sales'; await mount(<ReceivableDetail />, detail);
  expect(container.querySelector('[aria-label="Manage receivable entries"]')).toBeNull();
  expect(button('Correct balance (non-cash)')).toBeUndefined();
});


it('keeps historical GBP entries labelled and disables new amounts and payments', async () => {
  const post = vi.spyOn(api, 'post');
  await mount(<PartyFinanceEntries category="payables" partyId="party-1" currency="GBP" entries={[{ ...entry, currency: 'GBP' }]} accounts={accounts} />);
  expect(container.textContent).toContain('GBP 100.00');
  for (const text of ['Add payable', 'Edit entry', 'Record payment']) expect(button(text).disabled).toBe(true);
  expect(button('Void entry').disabled).toBe(false);
  expect(post).not.toHaveBeenCalled();
});
