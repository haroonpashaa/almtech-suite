// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import PurchaseSummary from './PurchaseSummary.jsx';
import Accounts from './Accounts.jsx';
import InvoiceDetail from './InvoiceDetail.jsx';
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ has: () => true }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container, client;
async function mount(element, records = []) {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['settings'], { currency: 'PKR' });
  client.setQueryData(['accounts'], []);
  for (const [key, value] of records) client.setQueryData(key, value);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/test/id1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/test/:id" element={element} /></Routes></MemoryRouter></QueryClientProvider>));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; container?.remove(); client?.clear(); });
it('shows PKR reports by default and retains real historical GBP amounts separately', async () => {
  const data = { totalsByCurrency: [{ currency: 'PKR', purchaseCount: 1, purchaseValue: 100, paid: 0, outstanding: 100 }, { currency: 'GBP', purchaseCount: 0, purchaseValue: 0, paid: 0, outstanding: 0 }], currentSupplierBalancesByCurrency: [], purchases: [], suppliers: [], statusBreakdown: [] };
  await mount(<PurchaseSummary />, [[['suppliers', 'purchase-summary'], []], [['purchase-summary', '', '', '', 1], data]]);
  expect(container.textContent).not.toContain('GBP');
  expect(container.textContent).toContain('PKR 100.00');
  await act(async () => {
    client.setQueryData(['purchase-summary', '', '', '', 1], { ...data, totalsByCurrency: [data.totalsByCurrency[0], { currency: 'GBP', purchaseCount: 1, purchaseValue: 25, paid: 5, outstanding: 20 }] });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(container.textContent).toContain('GBP 25.00'); expect(container.textContent).toContain('GBP 20.00');
  expect(container.textContent).toContain('PKR 100.00'); expect(container.textContent).not.toContain('PKR 125.00');
});
it('offers only PKR for new accounts while retaining historical GBP balances in the account list', async () => {
  await mount(<Accounts />, [[['accounts-summary'], { accounts: [{ _id: 'old', name: 'Historical bank', type: 'bank', currency: 'GBP', openingBalance: 25, currentBalance: 25, active: true }], totalsByCurrency: { PKR: 0, GBP: 25 } }]]);
  expect(container.textContent).toContain('GBP 25.00');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('New Account')).click());
  expect([...container.querySelector('#accounts-currency-5a').options].map(option => option.value)).toEqual(['PKR']);
});
it('labels historical invoice totals in their saved currency and blocks new foreign-currency payments', async () => {
  await mount(<InvoiceDetail />, [[['invoice', 'id1'], { _id: 'id1', number: 'INV-HISTORY', customer: { name: 'Customer' }, currency: 'GBP', status: 'issued', items: [], payments: [], subtotal: 25, total: 25, balance: 25, paid: 0, discount: 0 }]]);
  expect(container.textContent).toContain('GBP 25.00'); expect(container.textContent).not.toContain('PKR 25.00');
  expect(container.querySelector('#invoicedetail-amount-24')).toBeNull();
});
