import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export default function Reports() {
  const { has } = useAuth();
  const [from, setFrom] = useState(isoDate(Date.now() - 30 * 86400000));
  const [to, setTo] = useState(isoDate(Date.now()));
  const [tab, setTab] = useState('summary');

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
    enabled: tab === 'receivables',
    queryKey: ['report-receivables'],
    queryFn: async () => (await api.get('/reports/receivables')).data,
  });
  const payables = useQuery({
    enabled: tab === 'payables',
    queryKey: ['report-payables'],
    queryFn: async () => (await api.get('/reports/payables')).data,
  });
  const monthly = useQuery({
    enabled: tab === 'monthly' && has('admin'),
    queryKey: ['report-monthly'],
    queryFn: async () => (await api.get('/reports/monthly-summary')).data,
  });

  const tabs = [
    { key: 'summary', label: 'P&L Summary', admin: true },
    { key: 'products', label: 'Sales by Product' },
    { key: 'customers', label: 'Sales by Customer' },
    { key: 'receivables', label: 'Receivables' },
    { key: 'payables', label: 'Payables' },
    { key: 'monthly', label: 'Monthly Trends', admin: true },
  ].filter((t) => !t.admin || has('admin'));

  return (
    <div>
      <PageHeader title="Reports" subtitle="Financial analytics and outstanding balances" />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 items-center">
            <label className="text-xs text-slate-500">From</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label className="text-xs text-slate-500 ml-2">To</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="ml-auto flex gap-1 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${tab === t.key ? 'bg-brand-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:bg-ink-50 hover:text-ink-900'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'summary' && has('admin') && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="card p-5"><div className="text-xs text-slate-500">Revenue</div><div className="text-2xl font-bold">{money(summary.data?.revenue || 0, currency)}</div></div>
            <div className="card p-5"><div className="text-xs text-slate-500">Cost</div><div className="text-2xl font-bold">{money(summary.data?.cost || 0, currency)}</div></div>
            <div className="card p-5"><div className="text-xs text-slate-500">Gross Profit</div><div className="text-2xl font-bold text-emerald-600">{money(summary.data?.grossProfit || 0, currency)}</div></div>
            <div className="card p-5"><div className="text-xs text-slate-500">Margin</div><div className="text-2xl font-bold">{summary.data?.margin || 0}%</div></div>
          </div>
        )}

        {tab === 'products' && (
          <Table
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'sku', label: 'SKU' },
              { key: 'quantity', label: 'Qty', className: 'text-right' },
              { key: 'revenue', label: 'Revenue', className: 'text-right', render: (r) => money(r.revenue, currency) },
            ]}
            rows={byProduct.data || []}
            empty="No sales in this range"
          />
        )}

        {tab === 'customers' && (
          <Table
            columns={[
              { key: 'name', label: 'Customer' },
              { key: 'company', label: 'Company' },
              { key: 'invoices', label: 'Invoices', className: 'text-right' },
              { key: 'revenue', label: 'Revenue', className: 'text-right', render: (r) => money(r.revenue, currency) },
            ]}
            rows={byCustomer.data || []}
          />
        )}

        {tab === 'receivables' && (
          <Table
            columns={[
              { key: 'name', label: 'Customer' },
              { key: 'company', label: 'Company' },
              { key: 'phone', label: 'Phone' },
              { key: 'balance', label: 'Balance', className: 'text-right', render: (r) => money(r.balance, currency) },
            ]}
            rows={receivables.data || []}
          />
        )}

        {tab === 'payables' && (
          <Table
            columns={[
              { key: 'name', label: 'Supplier' },
              { key: 'contactPerson', label: 'Contact' },
              { key: 'phone', label: 'Phone' },
              { key: 'payable', label: 'Payable', className: 'text-right', render: (r) => money(r.payable, currency) },
            ]}
            rows={payables.data || []}
          />
        )}

        {tab === 'monthly' && has('admin') && (
          <div className="card p-5">
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer>
                <LineChart data={monthly.data || []}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(v) => money(v, currency)} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#0950b9" strokeWidth={2.5} name="Revenue" />
                  <Line type="monotone" dataKey="cost" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" name="Cost" />
                  <Line type="monotone" dataKey="grossProfit" stroke="#0086cd" strokeWidth={2.5} name="Gross Profit" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
