import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, datetime } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { AgingBuckets, AgingNote, OverdueBadge } from '../components/Aging.jsx';
import { Link } from 'react-router-dom';
import StatCard from '../components/StatCard.jsx';

const PAYMENT_TYPES = {
  customer_payment: 'Customer payment',
  sale_payment: 'Sale payment',
  other_income: 'Other income',
  transfer_in: 'Transfer in',
  expense_reversal: 'Expense reversal',
  payment_reversal: 'Payment reversal',
  expense: 'Expense',
  supplier_payment: 'Supplier payment',
  purchase_payment: 'Purchase payment',
  other_payment: 'Other payment',
  transfer_out: 'Transfer out',
};

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export default function Reports() {
  const { has } = useAuth();
  const [from, setFrom] = useState(isoDate(Date.now() - 30 * 86400000));
  const [to, setTo] = useState(isoDate(Date.now()));
  const [tab, setTab] = useState('summary');
  const [payAccount, setPayAccount] = useState('');
  const [payType, setPayType] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  const params = { from, to };

  const summary = useQuery({
    enabled: tab === 'summary' && has('admin'),
    queryKey: ['report-pl', from, to],
    queryFn: async () => (await api.get('/reports/profit-loss', { params })).data,
  });
  const byProduct = useQuery({
    enabled: tab === 'products',
    queryKey: ['report-by-product', from, to],
    queryFn: async () => (await api.get('/reports/sales-by-product', { params })).data,
  });
  const byCustomer = useQuery({
    enabled: tab === 'customers',
    queryKey: ['report-by-customer', from, to],
    queryFn: async () => (await api.get('/reports/sales-by-customer', { params })).data,
  });
  const receivables = useQuery({
    enabled: tab === 'receivables' && has('admin'),
    queryKey: ['report-receivables'],
    queryFn: async () => (await api.get('/finance/receivables')).data,
  });
  const payables = useQuery({
    enabled: tab === 'payables' && has('admin'),
    queryKey: ['report-payables'],
    queryFn: async () => (await api.get('/finance/payables')).data,
  });
  const monthly = useQuery({
    enabled: tab === 'monthly' && has('admin'),
    queryKey: ['report-monthly'],
    queryFn: async () => (await api.get('/reports/monthly-summary')).data,
  });

  const payments = useQuery({
    enabled: tab === 'payments',
    queryKey: ['payment-history', from, to, payAccount, payType],
    queryFn: async () =>
      (await api.get('/payments', {
        params: { from, to, account: payAccount || undefined, type: payType || undefined },
      })).data,
  });
  const accountsQ = useQuery({
    enabled: tab === 'payments',
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });

  const tabs = [
    { key: 'summary', label: 'P&L Summary', admin: true },
    { key: 'products', label: 'By Product' },
    { key: 'customers', label: 'By Customer' },
    { key: 'receivables', label: 'Receivables', admin: true },
    { key: 'payables', label: 'Payables', admin: true },
    { key: 'payments', label: 'Payment History', admin: true },
    { key: 'monthly', label: 'Monthly Trends', admin: true },
  ].filter((t) => !t.admin || has('admin'));

  const showRange = !['receivables', 'payables', 'monthly'].includes(tab);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Financial analytics and outstanding balances"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 17v-7m5 7v-11m5 11v-5m5 5v-9" /></svg>}
      />
      <div className="p-6 sm:p-8 space-y-5 max-w-[1300px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="segment">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`segment-item ${tab === t.key ? 'segment-item-active' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>
          {showRange && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-ink-400">From</span>
              <input className="input input-sm w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-xs text-ink-400">To</span>
              <input className="input input-sm w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
        </div>

        {tab === 'summary' && has('admin') && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Revenue" value={money(summary.data?.revenue || 0, currency)} accent="brand" loading={summary.isLoading} />
              <StatCard label="Cost of Goods" value={money(summary.data?.cost || 0, currency)} loading={summary.isLoading} />
              <StatCard label="Gross Profit" value={money(summary.data?.grossProfit || 0, currency)} accent="success" loading={summary.isLoading} />
              <StatCard label="Gross Margin" value={`${summary.data?.margin || 0}%`} loading={summary.isLoading} />
              <StatCard label="Operating Expenses" value={money(summary.data?.expenses || 0, currency)} accent={summary.data?.expenses > 0 ? 'warning' : undefined} hint="From expense records" loading={summary.isLoading} />
              <StatCard
                label="Net Profit"
                value={money(summary.data?.netProfit || 0, currency)}
                hint="Gross profit − expenses"
                accent={(summary.data?.netProfit || 0) < 0 ? 'danger' : 'success'}
                loading={summary.isLoading}
              />
              <StatCard label="Net Margin" value={`${summary.data?.netMargin || 0}%`} loading={summary.isLoading} />
            </div>
            {(summary.data?.expensesByCategory?.length || 0) > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-ink-900 mb-3">Expenses by category</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {summary.data.expensesByCategory.map((c) => (
                    <div key={c.category} className="flex items-baseline justify-between gap-2 border-b border-ink-100 pb-1.5">
                      <span className="text-sm text-ink-600 truncate">{c.category}</span>
                      <span className="num text-sm font-medium text-ink-900 whitespace-nowrap">{money(c.total, currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'products' && (
          <Table
            loading={byProduct.isLoading}
            columns={[
              { key: 'name', label: 'Product', render: (r) => <span className="font-medium text-ink-900">{r.name}</span> },
              { key: 'sku', label: 'SKU', render: (r) => <span className="font-mono text-[12px] text-ink-400">{r.sku}</span> },
              { key: 'quantity', label: 'Qty', className: 'text-right num' },
              { key: 'revenue', label: 'Revenue', className: 'text-right num font-medium text-ink-900', render: (r) => money(r.revenue, currency) },
            ]}
            rows={byProduct.data || []}
            empty="No sales in this range"
          />
        )}

        {tab === 'customers' && (
          <Table
            loading={byCustomer.isLoading}
            columns={[
              { key: 'name', label: 'Customer', render: (r) => <span className="font-medium text-ink-900">{r.name}</span> },
              { key: 'company', label: 'Company', render: (r) => r.company || <span className="text-ink-300">—</span> },
              { key: 'invoices', label: 'Invoices', className: 'text-right num' },
              { key: 'revenue', label: 'Revenue', className: 'text-right num font-medium text-ink-900', render: (r) => money(r.revenue, currency) },
            ]}
            rows={byCustomer.data || []}
            empty="No sales in this range"
          />
        )}

        {tab === 'receivables' && has('admin') && (
          <>
            <div className="flex items-baseline justify-between">
              <div className="section-title">Aging</div>
              <AgingNote />
            </div>
            <AgingBuckets aging={receivables.data?.aging} currency={currency} />
            <Table
              loading={receivables.isLoading}
              columns={[
                { key: 'name', label: 'Customer', render: (r) => <Link to={`/receivables/${r.customerId}`} className="font-medium text-ink-900 hover:text-brand-700">{r.name}</Link> },
                { key: 'company', label: 'Company', render: (r) => r.company || <span className="text-ink-300">\u2014</span> },
                { key: 'invoiceCount', label: 'Invoices', className: 'text-right num text-ink-500', render: (r) => r.invoiceCount },
                { key: 'oldestAgeDays', label: 'Overdue', render: (r) => <OverdueBadge days={r.oldestAgeDays} /> },
                { key: 'total', label: 'Total', className: 'text-right num text-ink-600', render: (r) => money(r.total, currency) },
                { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (r) => money(r.paid, currency) },
                { key: 'outstanding', label: 'Outstanding', className: 'text-right num font-medium text-amber-600', render: (r) => money(r.outstanding, currency) },
              ]}
              rows={receivables.data?.rows || []}
              empty="No receivables"
            />
            {(receivables.data?.rows?.length || 0) > 0 && (
              <div className="card p-4 flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink-900">Total Receivables</span>
                <span className="text-lg font-semibold num text-amber-600">{money(receivables.data.totalOutstanding, currency)}</span>
              </div>
            )}
          </>
        )}

        {tab === 'payables' && has('admin') && (
          <>
            <div className="flex items-baseline justify-between">
              <div className="section-title">Aging</div>
              <AgingNote />
            </div>
            <AgingBuckets aging={payables.data?.aging} currency={currency} />
            <Table
              loading={payables.isLoading}
              columns={[
                { key: 'name', label: 'Supplier', render: (r) => <Link to={`/payables/${r.supplierId}`} className="font-medium text-ink-900 hover:text-brand-700">{r.name}</Link> },
                { key: 'contactPerson', label: 'Contact', render: (r) => r.contactPerson || <span className="text-ink-300">\u2014</span> },
                { key: 'poCount', label: 'POs', className: 'text-right num text-ink-500', render: (r) => r.poCount },
                { key: 'oldestAgeDays', label: 'Age', render: (r) => <OverdueBadge days={r.oldestAgeDays} /> },
                { key: 'total', label: 'Total', className: 'text-right num text-ink-600', render: (r) => money(r.total, currency) },
                { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (r) => money(r.paid, currency) },
                { key: 'outstanding', label: 'Outstanding', className: 'text-right num font-medium text-amber-600', render: (r) => money(r.outstanding, currency) },
              ]}
              rows={payables.data?.rows || []}
              empty="No payables"
            />
            {(payables.data?.rows?.length || 0) > 0 && (
              <div className="card p-4 flex items-baseline justify-between">
                <span className="text-sm font-medium text-ink-900">Total Payables</span>
                <span className="text-lg font-semibold num text-amber-600">{money(payables.data.totalOutstanding, currency)}</span>
              </div>
            )}
          </>
        )}

        {tab === 'payments' && has('admin') && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Account</label>
                <select className="select" value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>
                  <option value="">All accounts</option>
                  {(accountsQ.data || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="select" value={payType} onChange={(e) => setPayType(e.target.value)}>
                  <option value="">All types</option>
                  {Object.entries(PAYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {(payAccount || payType) && (
                <button className="btn-secondary" onClick={() => { setPayAccount(''); setPayType(''); }}>Clear</button>
              )}
            </div>
            <Table
              loading={payments.isLoading}
              empty="No payments in this period"
              columns={[
                { key: 'date', label: 'Date', render: (r) => <span className="text-ink-500 whitespace-nowrap">{datetime(r.date)}</span> },
                { key: 'type', label: 'Type', render: (r) => <span className="text-ink-700">{PAYMENT_TYPES[r.type] || r.type}</span> },
                { key: 'account', label: 'Account', render: (r) => r.account || <span className="text-ink-300 italic">pre-ledger</span> },
                { key: 'party', label: 'Customer / Supplier', render: (r) => r.customer || r.supplier || <span className="text-ink-300">—</span> },
                { key: 'doc', label: 'Invoice / PO', render: (r) => <span className="font-mono text-[12px] text-ink-500">{r.invoice || r.po || '—'}</span> },
                { key: 'reference', label: 'Reference', render: (r) => r.reference || <span className="text-ink-300">—</span> },
                { key: 'user', label: 'By', render: (r) => <span className="text-ink-500">{r.user || '—'}</span> },
                {
                  key: 'amount',
                  label: 'Amount',
                  className: 'text-right num font-medium',
                  render: (r) => (
                    <span className={r.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}>
                      {r.direction === 'in' ? '+' : '\u2212'} {money(r.amount, currency)}
                    </span>
                  ),
                },
              ]}
              rows={payments.data || []}
            />
          </>
        )}

        {tab === 'monthly' && has('admin') && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-900 mb-4">Monthly Revenue, Cost & Profit</h3>
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer>
                <LineChart data={monthly.data || []} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => money(v, currency)} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 14px -2px rgba(16,24,40,0.10)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="revenue" stroke="#0950b9" strokeWidth={2.5} name="Revenue" dot={false} />
                  <Line type="monotone" dataKey="cost" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" name="Cost" dot={false} />
                  <Line type="monotone" dataKey="grossProfit" stroke="#0086cd" strokeWidth={2.5} name="Gross Profit" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
