import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date as fmtDate } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge } from '../components/ui.jsx';
import { AgingBuckets, AgingNote, OverdueBadge } from '../components/Aging.jsx';

export default function Receivables() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bucket, setBucket] = useState('');
  const [status, setStatus] = useState('');

  // Every filter is applied server-side so a large ledger is never shipped to the browser.
  const { data, isLoading } = useQuery({
    queryKey: ['receivables', q, from, to, bucket, status],
    queryFn: async () =>
      (await api.get('/finance/receivables', {
        params: { q: q || undefined, from: from || undefined, to: to || undefined, bucket: bucket || undefined, status: status || undefined },
      })).data,
  });
  const { data: position } = useQuery({
    queryKey: ['finance-position'],
    queryFn: async () => (await api.get('/finance/position')).data,
  });
  const currency = useCurrency();
  const filtered = q || from || to || bucket || status;

  return (
    <div>
      <PageHeader
        title="Receivables"
        subtitle="Money customers owe the business"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
      />
      <div className="page page-w space-y-4">
        {/* Position summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Receivables</div>
            <div className="mt-2 fig-lg font-semibold num text-ink-900 tracking-tight">{money(position?.receivables || 0, currency)}</div>
            <div className="text-xs text-ink-400 mt-1">Owed to us</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Payables</div>
            <div className="mt-2 fig-lg font-semibold num text-ink-900 tracking-tight">{money(position?.payables || 0, currency)}</div>
            <div className="text-xs text-ink-400 mt-1">Owed by us</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Net Outstanding Position</div>
            <div className={`mt-2 fig-lg font-semibold num tracking-tight ${(position?.netPosition || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {money(position?.netPosition || 0, currency)}
            </div>
            <div className="text-xs text-ink-400 mt-1">Receivables − Payables · not profit</div>
          </div>
        </div>

        {data?.reconciled === false && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Outstanding derived from open invoices ({money(data.totalOutstanding, currency)}) does not match the stored
            customer balances ({money(data.storedTotal, currency)}). Investigate before relying on these figures.
          </div>
        )}

        {/* Aging — click a bucket to filter */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="section-title">Aging</div>
            <AgingNote />
          </div>
          <AgingBuckets aging={data?.aging} currency={currency} active={bucket} onSelect={setBucket} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="field-search max-w-xs w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input className="input" placeholder="Search customer, company, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label htmlFor="receivables-from-59" className="label">From</label>
            <input id="receivables-from-59" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="receivables-to-60" className="label">To</label>
            <input id="receivables-to-60" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="receivables-status-61" className="label">Status</label>
            <select id="receivables-status-61" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All open</option>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
            </select>
          </div>
          {filtered && (
            <button className="btn-secondary" onClick={() => { setQ(''); setFrom(''); setTo(''); setBucket(''); setStatus(''); }}>Clear</button>
          )}
          <div className="ml-auto text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Filtered Outstanding</div>
            <div className="text-xl font-semibold num text-ink-900">{money(data?.totalOutstanding || 0, currency)}</div>
            <div className="text-xs text-ink-400">{data?.customerCount ?? 0} customer{data?.customerCount === 1 ? '' : 's'}</div>
          </div>
        </div>

        <Table
          loading={isLoading}
          empty="No customers owe anything — nothing outstanding"
          columns={[
            {
              key: 'name',
              label: 'Customer',
              render: (r) => (
                <Link to={`/receivables/${r.customerId}`} className="text-ink-900 hover:text-brand-700 font-medium">
                  {r.name}
                  {r.company && <span className="text-ink-400 font-normal"> · {r.company}</span>}
                </Link>
              ),
            },
            { key: 'invoiceCount', label: 'Invoices', className: 'text-right num text-ink-500', render: (r) => r.invoiceCount },
            { key: 'oldestDate', label: 'Oldest', render: (r) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(r.oldestDate)}</span> },
            { key: 'oldestAgeDays', label: 'Overdue', render: (r) => <OverdueBadge days={r.oldestAgeDays} /> },
            { key: 'total', label: `Total Deal (${currency})`, className: 'text-right num text-ink-600', render: (r) => <Money value={r.total} /> },
            { key: 'paid', label: `Paid (${currency})`, className: 'text-right num text-emerald-600', render: (r) => <Money value={r.paid} /> },
            {
              key: 'outstanding',
              label: `Outstanding (${currency})`,
              className: 'text-right num font-semibold',
              render: (r) => (
                <span className="text-amber-600">{money(r.outstanding, currency)}</span>
              ),
            },
            {
              key: 'drift',
              label: '',
              render: (r) =>
                Math.abs(r.outstanding - r.storedBalance) < 0.005 ? null : (
                  <Badge tone="warning" dot>drift</Badge>
                ),
            },
          ]}
          rows={data?.rows || []}
        />

        {(data?.rows?.length || 0) > 0 && (
          <div className="card p-4 flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink-900">Totals</span>
            <div className="flex gap-8 text-sm">
              <span className="text-ink-500">Invoiced <span className="num text-ink-900 font-medium">{money(data.totalInvoiced, currency)}</span></span>
              <span className="text-ink-500">Paid <span className="num text-emerald-600 font-medium">{money(data.totalPaid, currency)}</span></span>
              <span className="text-ink-500">Outstanding <span className="num text-amber-600 font-semibold">{money(data.totalOutstanding, currency)}</span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
