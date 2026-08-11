import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date as fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import StatCard from '../components/StatCard.jsx';
import { DealStatusBadge, SettlementBadge } from '../components/DealStatus.jsx';

const SORTS = [
  { key: 'date', label: 'Date' },
  { key: 'number', label: 'Deal #' },
  { key: 'total', label: 'Total' },
  { key: 'paid', label: 'Paid' },
  { key: 'outstanding', label: 'Outstanding' },
];

export default function Deals() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') === 'purchases' ? 'purchases' : 'sales';
  const isSale = kind === 'sales';

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [settlement, setSettlement] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);

  function setKind(k) {
    setParams({ kind: k });
    setPage(1);
  }

  // Everything is filtered, sorted and paginated on the server — the browser never
  // receives more than one page of rows.
  const { data, isLoading } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['deals', kind, q, from, to, status, settlement, minAmount, maxAmount, sort, order, page],
    queryFn: async () =>
      (await api.get(`/deals/${kind}`, {
        params: {
          q: q || undefined,
          from: from || undefined,
          to: to || undefined,
          status: status || undefined,
          settlement: settlement || undefined,
          minAmount: minAmount || undefined,
          maxAmount: maxAmount || undefined,
          sort,
          order,
          page,
          limit: 50,
        },
      })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  const s = data?.summary;
  const filtered = q || from || to || status || settlement || minAmount || maxAmount;
  const totalPages = Math.max(1, Math.ceil((data?.totalRows || 0) / 50));

  function toggleSort(key) {
    if (sort === key) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setOrder('desc');
    }
    setPage(1);
  }

  function clearAll() {
    setQ(''); setFrom(''); setTo(''); setStatus(''); setSettlement(''); setMinAmount(''); setMaxAmount(''); setPage(1);
  }

  const SortHeader = ({ k, label, className = '' }) => (
    <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-ink-700 ${className}`}>
      {label}
      {sort === k && (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          {order === 'asc' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
        </svg>
      )}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="Every sale and purchase, with payments and outstanding balances"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h12M17 15l3 3-3 3" /></svg>}
      />
      <div className="p-6 sm:p-8 space-y-4 max-w-[1500px]">
        <div className="segment w-fit">
          <button onClick={() => setKind('sales')} className={`segment-item ${isSale ? 'segment-item-active' : ''}`}>Sales</button>
          <button onClick={() => setKind('purchases')} className={`segment-item ${!isSale ? 'segment-item-active' : ''}`}>Purchases</button>
        </div>

        {/* Summary — derived from the filtered set, not stored anywhere */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={isSale ? 'Total Sales' : 'Total Purchases'} value={money(s?.total || 0, currency)} hint={`${s?.deals ?? 0} deal${s?.deals === 1 ? '' : 's'}`} accent="brand" loading={isLoading && !data} />
          <StatCard label="Paid" value={money(s?.paid || 0, currency)} hint={`${s?.paidDeals ?? 0} settled`} accent="success" loading={isLoading && !data} />
          <StatCard label="Outstanding" value={money(s?.outstanding || 0, currency)} accent={(s?.outstanding || 0) > 0 ? 'warning' : undefined} loading={isLoading && !data} />
          <StatCard label={isSale ? 'Credit Deals' : 'Credit Purchases'} value={String(s?.creditDeals ?? 0)} hint="Money still owed" loading={isLoading && !data} />
        </div>
        <p className="text-xs text-ink-400">{data?.summaryNote}</p>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="field-search max-w-xs w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input className="input" placeholder={isSale ? 'Deal # or customer…' : 'PO # or supplier…'} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div><label className="label">From</label><input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></div>
          <div><label className="label">To</label><input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></div>
          <div>
            <label className="label">Status</label>
            <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partial</option>
              <option value="CREDIT">Credit</option>
              {isSale && <option value="RETURNED">Returned</option>}
              <option value="CANCELLED">Cancelled</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>
          <div>
            <label className="label">Settlement</label>
            <select className="select" value={settlement} onChange={(e) => { setSettlement(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="cash">Cash / settled</option>
              <option value="credit">Credit</option>
            </select>
          </div>
          <div><label className="label">Min</label><input className="input num w-28" type="number" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(1); }} /></div>
          <div><label className="label">Max</label><input className="input num w-28" type="number" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(1); }} /></div>
          {filtered && <button className="btn-secondary" onClick={clearAll}>Clear</button>}
        </div>

        <Table
          loading={isLoading && !data}
          empty={isSale ? 'No sales match these filters' : 'No purchases match these filters'}
          columns={[
            { key: 'date', label: <SortHeader k="date" label="Date" />, render: (r) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(r.date)}</span> },
            {
              key: 'number',
              label: <SortHeader k="number" label="Deal #" />,
              render: (r) => (
                <Link to={`/deals/${kind}/${r._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{r.number}</Link>
              ),
            },
            {
              key: 'party',
              label: isSale ? 'Customer' : 'Supplier',
              render: (r) => (
                <span className="text-ink-900">
                  {r.partyName || <span className="text-ink-300">—</span>}
                  {r.partyCompany && <span className="text-ink-400"> · {r.partyCompany}</span>}
                </span>
              ),
            },
            { key: 'total', label: <SortHeader k="total" label="Total" />, className: 'text-right num text-ink-700', render: (r) => money(r.total, currency) },
            { key: 'paid', label: <SortHeader k="paid" label="Paid" />, className: 'text-right num text-emerald-600', render: (r) => money(r.paid, currency) },
            {
              key: 'outstanding',
              label: <SortHeader k="outstanding" label="Outstanding" />,
              className: 'text-right num font-medium',
              render: (r) => <span className={r.outstanding > 0 ? 'text-amber-600' : 'text-ink-300'}>{money(r.outstanding, currency)}</span>,
            },
            { key: 'dealStatus', label: 'Status', render: (r) => <DealStatusBadge status={r.dealStatus} /> },
            { key: 'settlement', label: 'Type', render: (r) => <SettlementBadge settlement={r.settlement} /> },
            { key: 'paymentCount', label: 'Payments', className: 'text-right num text-ink-500', render: (r) => r.paymentCount },
          ]}
          rows={data?.rows || []}
        />

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-400">
              Page {data?.page} of {totalPages} · {data?.totalRows} record{data?.totalRows === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
