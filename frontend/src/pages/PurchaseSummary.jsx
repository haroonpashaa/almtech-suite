import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { date, money, moneyPlain } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge } from '../components/ui.jsx';

const CURRENCIES = ['PKR', 'GBP'];
const statusTone = { draft: 'neutral', ordered: 'info', partial: 'warning', received: 'success', cancelled: 'neutral' };

function byCurrency(rows, key) {
  const lookup = Object.fromEntries((rows || []).map((row) => [row.currency, row[key]]));
  return CURRENCIES.map((currency) => money(lookup[currency] || 0, currency)).join(' · ');
}

function CurrencyBreakdown({ rows, valueKey }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1">{CURRENCIES.map((currency) => {
    const value = rows?.find((row) => row.currency === currency)?.[valueKey] || 0;
    return <span key={currency}><span className="text-ink-400">{currency}</span> <span className="num font-medium">{moneyPlain(value)}</span></span>;
  })}</div>;
}

export default function PurchaseSummary() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [page, setPage] = useState(1);
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', 'purchase-summary'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });
  const summary = useQuery({
    queryKey: ['purchase-summary', from, to, supplier, page],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get('/purchase-orders/summary', {
      params: { from: from || undefined, to: to || undefined, supplier: supplier || undefined, page, limit: 50 },
    })).data,
  });
  const data = summary.data;
  const totals = data?.totalsByCurrency || [];
  const currentBalances = data?.currentSupplierBalancesByCurrency || [];
  const filtered = !!(from || to || supplier);

  function updateFilter(setter, value) {
    setter(value);
    setPage(1);
  }

  return <div>
    <PageHeader title="Purchase Summary" subtitle="Purchase orders, supplier payments and current balances" icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-6" /></svg>} />
    <div className="page page-w space-y-4">
      <section className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <label className="text-xs text-ink-500">From<input aria-label="From date" type="date" className="input mt-1" value={from} onChange={(event) => updateFilter(setFrom, event.target.value)} /></label>
        <label className="text-xs text-ink-500">To<input aria-label="To date" type="date" className="input mt-1" value={to} onChange={(event) => updateFilter(setTo, event.target.value)} /></label>
        <label className="text-xs text-ink-500">Supplier<select aria-label="Supplier" className="select mt-1" value={supplier} onChange={(event) => updateFilter(setSupplier, event.target.value)}><option value="">All suppliers</option>{(suppliersQuery.data || []).map((row) => <option value={row._id} key={row._id}>{row.name}</option>)}</select></label>
        {filtered && <button type="button" className="btn-secondary justify-self-start" onClick={() => { setFrom(''); setTo(''); setSupplier(''); setPage(1); }}>Clear filters</button>}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Counted purchase orders" value={totals.reduce((sum, row) => sum + row.purchaseCount, 0)} hint="Excludes draft and cancelled orders" accent="brand" loading={summary.isLoading} />
        <StatCard label="Purchase value" value={byCurrency(totals, 'purchaseValue')} hint="Ordered, partial and received · by currency" loading={summary.isLoading} />
        <StatCard label="Amount paid" value={byCurrency(totals, 'paid')} hint="Posted PO payments · by currency" loading={summary.isLoading} />
        <StatCard label="Open PO balance" value={byCurrency(totals, 'outstanding')} hint="Filtered orders · by currency" loading={summary.isLoading} />
      </div>

      <section className="card p-4 space-y-2">
        <div className="text-sm font-semibold text-ink-900">Current supplier outstanding balance</div>
        <CurrencyBreakdown rows={currentBalances} valueKey="outstanding" />
        <p className="text-xs text-ink-500">As of now, based on supplier balances. This is not limited by the date range and may include opening balances and earlier purchase orders.</p>
      </section>

      <section className="card overflow-hidden">
        <div className="p-4 font-semibold text-ink-900">Purchase orders by status</div>
        <Table rows={data?.statusBreakdown || []} loading={summary.isLoading} empty="No purchase orders match these filters" columns={[
          { key: 'status', label: 'Status', render: (row) => <Badge tone={statusTone[row.status]} dot>{row.status}</Badge> },
          { key: 'count', label: 'Orders (PKR · GBP)', render: (row) => CURRENCIES.map((currency) => `${currency} ${row.currencies.find((item) => item.currency === currency)?.count || 0}`).join(' · ') },
          { key: 'value', label: 'Order value by currency', render: (row) => <CurrencyBreakdown rows={row.currencies} valueKey="value" /> },
        ]} />
      </section>

      <section className="card overflow-hidden">
        <div className="p-4 font-semibold text-ink-900">Purchase breakdown by supplier</div>
        <Table rows={data?.suppliers || []} loading={summary.isLoading} empty="No supplier purchases match these filters" columns={[
          { key: 'supplier', label: 'Supplier', priority: 'primary', render: (row) => row.supplierName || 'Supplier record unavailable' },
          { key: 'currency', label: 'Currency', render: (row) => row.currency },
          { key: 'count', label: 'Orders', className: 'text-right num', render: (row) => row.purchaseCount },
          { key: 'purchaseValue', label: 'Purchase value', className: 'text-right num', render: (row) => <Money value={row.purchaseValue} currency={row.currency} showCurrency /> },
          { key: 'paid', label: 'Paid', className: 'text-right num', render: (row) => <Money value={row.paid} currency={row.currency} showCurrency /> },
          { key: 'outstanding', label: 'Open PO balance', className: 'text-right num', render: (row) => <Money value={row.outstanding} currency={row.currency} showCurrency tone="due" /> },
        ]} />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-ink-900">Purchase history</h2>
        <Table
          rows={data?.purchases || []}
          loading={summary.isLoading}
          error={summary.isError ? 'The purchase summary could not be loaded.' : null}
          onRetry={() => summary.refetch()}
          empty="No purchase orders match these filters"
          page={data?.pagination?.page}
          limit={data?.pagination?.limit}
          total={data?.pagination?.total}
          onPageChange={setPage}
          columns={[
            { key: 'number', label: 'Purchase order', priority: 'primary', render: (row) => <Link className="font-mono text-brand-700 hover:underline font-medium" to={`/purchase-orders/${row._id}`}>{row.number}</Link> },
            { key: 'orderedAt', label: 'Purchase date', render: (row) => date(row.orderedAt) },
            { key: 'supplier', label: 'Supplier', render: (row) => row.supplier?.name || '—' },
            { key: 'status', label: 'Status', render: (row) => <Badge tone={statusTone[row.status]} dot>{row.status}</Badge> },
            { key: 'total', label: 'Total', className: 'text-right num', render: (row) => <Money value={row.total} currency={row.currency || 'PKR'} showCurrency /> },
            { key: 'paid', label: 'Paid', className: 'text-right num', render: (row) => <Money value={row.paid} currency={row.currency || 'PKR'} showCurrency /> },
            { key: 'balance', label: 'Outstanding', className: 'text-right num', render: (row) => <Money value={row.balance} currency={row.currency || 'PKR'} showCurrency tone="due" /> },
          ]}
        />
      </section>
      <p className="text-xs text-ink-400">Purchase date means the order date recorded by the existing system. Draft and cancelled orders appear in status and history views but are excluded from purchase value, payments and open PO balance. Amounts are never combined across GBP and PKR.</p>
    </div>
  </div>;
}
