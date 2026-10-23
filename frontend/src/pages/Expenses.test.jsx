// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Expenses from './Expenses.jsx';
import { api } from '../api/client.js';

const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ has: (...roles) => roles.includes(auth.role) }) }));
vi.mock('../api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, client;

async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
async function click(text, scope = container) {
  const button = [...scope.querySelectorAll('button')].find(button => button.textContent === text);
  await act(async () => button.click());
}
async function mount(items = []) {
  auth.role ||= 'admin';
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const data = { items, total: 250, count: items.length, totalsByCurrency: { PKR: { total: 250 } } };
  client.setQueryData(['expenses', '', '', '', '', 'posted'], data);
  client.setQueryData(['accounts'], [{ _id: 'cash-1', name: 'Cash', currency: 'PKR' }]);
  client.setQueryData(['expense-categories'], ['Fuel']);
  client.setQueryData(['settings'], { currency: 'PKR' });
  client.setQueryData(['deal-options'], []);
  api.get.mockResolvedValue({ data });
  api.post.mockResolvedValue({ data: {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Expenses /></MemoryRouter></QueryClientProvider>));
}
async function fillExpense(account) {
  await click('Add Expense');
  await change(container.querySelector('#expenses-amount-17'), '250');
  await change(container.querySelector('#expenses-category-18'), 'Fuel');
  await change(container.querySelector('#expenses-payment-account-19'), account);
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
  auth.role = 'admin';
});

describe('Other expense payment source', () => {
  it('requires the Admin reference and submits Other without an account', async () => {
    await mount();
    await fillExpense('other');
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('No account balance will change');
    expect(dialog.textContent).toContain('Amount (PKR)');
    expect([...dialog.querySelectorAll('button')].find(button => button.textContent === 'Record expense').disabled).toBe(true);
    const reference = container.querySelector('#expenses-reference-21');
    expect(reference.required).toBe(true);
    await change(reference, '  ');
    expect([...dialog.querySelectorAll('button')].find(button => button.textContent === 'Record expense').disabled).toBe(true);
    await change(reference, 'Paid through personal wallet');
    await click('Record expense', dialog);
    expect(api.post).toHaveBeenCalledWith('/expenses', expect.objectContaining({ amount: 250, category: 'Fuel', paymentSource: 'other', account: undefined, reference: 'Paid through personal wallet' }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('preserves normal account posting and its optional reference when switching back', async () => {
    await mount();
    await fillExpense('other');
    await change(container.querySelector('#expenses-payment-account-19'), 'cash-1');
    expect(container.querySelector('#expenses-reference-21').required).toBe(false);
    await click('Record expense', container.querySelector('[role="dialog"]'));
    expect(api.post).toHaveBeenCalledWith('/expenses', expect.objectContaining({ account: 'cash-1', amount: 250, reference: '' }));
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('paymentSource');
  });

  it('keeps the new payment option unavailable to Sales', async () => {
    auth.role = 'sales';
    await mount();
    await click('Add Expense');
    expect([...container.querySelector('#expenses-payment-account-19').options].map(option => option.value)).not.toContain('other');
  });

  it('shows Other and the reference in existing expense details and uses accurate void wording', async () => {
    await mount([{ _id: 'external-1', category: 'Fuel', amount: 250, paymentSource: 'other', reference: 'Paid by Admin', status: 'posted', date: '2026-10-24' }]);
    const referenceCell = [...container.querySelectorAll('td')].find(cell => cell.textContent === 'Paid by Admin');
    await act(async () => referenceCell.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Other');
    expect(dialog.textContent).toContain('Paid by Admin');
    expect(dialog.textContent).toContain('Void this expense');
    expect(dialog.textContent).not.toContain('money has already left');
    await click('Void this expense', dialog);
    expect(container.textContent).toContain('No listed account balance changes');
    expect(container.textContent).not.toContain('Both the original and the reversing entry');
  });
});
