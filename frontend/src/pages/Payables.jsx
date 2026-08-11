import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date as fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge } from '../components/ui.jsx';
import { AgingBuckets, AgingNote, OverdueBadge } from '../components/Aging.jsx';

// Read-only payables view over the Supplier records preserved in Change 1. It does not
// restore supplier management: there is no create, edit or delete anywhere here.
export default function Payables() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bucket, setBucket] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payables', q, from, to, bucket, status],
    queryFn: async () =>
      (await api.get('/finance/payables', {
        params: { q: q || undefined, from: from || undefined, to: to || undefined, bucket: bucket || undefined, status: status || undefined },
      })).data,
  });
  const { data: position } = useQuery({
    queryKey: ['finance-position'],
    queryFn: async () => (await api.get('/finance/position')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';
  const filtered = q || from || to || bucket || status;

  return (
    <div>
      <PageHeader
        title="Payables"
        subtitle="Money the business owes suppliers"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>}
      />
      <div className="p-6 sm:p-8 space-y-4 max-w-[1400px]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Payables</div>
            <div className="mt-2 text-2xl font-semibold num text-ink-900 tracking-tight">{money(position?.payables || 0, currency)}</div>
            <div className="text-xs text-ink-400 mt-1">Owed by us</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Receivables</div>
            <div className="mt-2 text-2xl font-semibold num text-ink-900 tracking-tight">{money(position?.receivables || 0, currency)}</div>
            <div className="text-xs text-ink-400 mt-1">Owed to us</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Net Outstanding Position</div>
            <div className={`mt-2 text-2xl font-semibold num tracking-tight ${(position?.netPosition || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {money(position?.netPosition || 0, currency)}
            </div>
            <div className="text-xs text-ink-400 mt-1">Receivables − Payables · not profit</div>
          </div>
        </div>

        {data?.reconciled === false && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Outstanding derived from open purchase orders ({money(data.totalOutstanding, currency)}) does not match the
            stored supplier payables ({money(data.storedTotal, currency)}). Investigate before relying on these figures.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="section-title">Aging</div>
            <AgingNote />
          </div>
          <AgingBuckets aging={data?.aging} currency={currency} active={bucket} onSelect={setBucket} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="field-search max-w-xs w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input className="input" placeholder="Search supplier, contact, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="label">From</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All open</option>
              <option value="ordered">Ordered</option>
              <option value="partial">Partial</option>
              <option value="received">Received</option>
            </select>
          </div>
          {filtered && (
            <button className="btn-secondary" onClick={() => { setQ(''); setFrom(''); setTo(''); setBucket(''); setStatus(''); }}>Clear</button>
          )}
          <div className="ml-auto text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Filtered Outstanding</div>
            <div className="text-xl font-semibold num text-ink-900">{money(data?.totalOutstanding || 0, currency)}</div>
            <div className="text-xs text-ink-400">{data?.supplierCount ?? 0} supplier{data?.supplierCount === 1 ? '' : 's'}</div>
          </div>
        </div>

        <Table
          loading={isLoading}
          empty="Nothing owed to suppliers"
          columns={[
            {
              key: 'name',
              label: 'Supplier',
              render: (r) => (
                <Link to={`/payables/${r.supplierId}`} className="text-ink-900 hover:text-brand-700 font-medium">
                  {r.name}
                  {r.contactPerson && <span className="text-ink-400 font-normal"> · {r.contactPerson}</span>}
                </Link>
              ),
            },
            { key: 'poCount', label: 'POs', className: 'text-right num text-ink-500', render: (r) => r.poCount },
            { key: 'oldestDate', label: 'Oldest', render: (r) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(r.oldestDate)}</span> },
            { key: 'oldestAgeDays', label: 'Age', render: (r) => <OverdueBadge days={r.oldestAgeDays} /> },
            { key: 'total', label: 'Purchase Total', className: 'text-right num text-ink-600', render: (r) => money(r.total, currency) },
            { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (r) => money(r.paid, currency) },
            { key: 'outstanding', label: 'Outstanding', className: 'text-right num font-semibold', render: (r) => <span className="text-amber-600">{money(r.outstanding, currency)}</span> },
            {
              key: 'drift',
              label: '',
              render: (r) => (Math.abs(r.outstanding - r.storedPayable) < 0.005 ? null : <Badge tone="warning" dot>drift</Badge>),
            },
          ]}
          rows={data?.rows || []}
        />

        {(data?.rows?.length || 0) > 0 && (
          <div className="card p-4 flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink-900">Totals</span>
            <div className="flex gap-8 text-sm">
              <span className="text-ink-500">Ordered <span className="num text-ink-900 font-medium">{money(data.totalOrdered, currency)}</span></span>
              <span className="text-ink-500">Paid <span className="num text-emerald-600 font-medium">{money(data.totalPaid, currency)}</span></span>
              <span className="text-ink-500">Outstanding <span className="num text-amber-600 font-semibold">{money(data.totalOutstanding, currency)}</span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
