import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date as fmtDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

const todayISO = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

// Simple horizontal bar so category weight is readable at a glance, using the
// existing brand tokens rather than a new chart dependency.
function CategoryRows({ rows, currency, total }) {
  if (!rows?.length) return <div className="text-sm text-ink-400 py-6 text-center">No expenses in this period</div>;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.category}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink-700">{r.category}</span>
            <span className="num font-medium text-ink-900 whitespace-nowrap">{money(r.total, currency)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(r.total / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="flex items-baseline justify-between pt-3 mt-1 border-t border-ink-100">
        <span className="text-sm font-medium text-ink-900">Total</span>
        <span className="text-lg font-semibold num text-ink-900">{money(total, currency)}</span>
      </div>
    </div>
  );
}

export default function ExpenseReports() {
  const [tab, setTab] = useState('daily');
  const [day, setDay] = useState(todayISO());
  const [month, setMonth] = useState(thisMonth());

  const daily = useQuery({
    enabled: tab === 'daily',
    queryKey: ['expenses-daily', day],
    queryFn: async () => (await api.get('/expenses/daily', { params: { date: day } })).data,
  });
  const monthly = useQuery({
    enabled: tab === 'monthly',
    queryKey: ['expenses-monthly', month],
    queryFn: async () => (await api.get('/expenses/monthly', { params: { month } })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  return (
    <div>
      <PageHeader
        title="Expense Reports"
        subtitle="Daily and monthly totals, calculated from expense records"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 17v-7m5 7v-11m5 11v-5m5 5v-9" /></svg>}
      />
      <div className="p-6 sm:p-8 space-y-5 max-w-[1200px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="segment">
            <button onClick={() => setTab('daily')} className={`segment-item ${tab === 'daily' ? 'segment-item-active' : ''}`}>Daily</button>
            <button onClick={() => setTab('monthly')} className={`segment-item ${tab === 'monthly' ? 'segment-item-active' : ''}`}>Monthly</button>
          </div>
          <div className="ml-auto">
            {tab === 'daily' ? (
              <input className="input input-sm w-auto" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            ) : (
              <input className="input input-sm w-auto" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            )}
          </div>
        </div>

        {tab === 'daily' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink-900 mb-4">
                {daily.data ? fmtDate(daily.data.date) : '—'}
              </h3>
              {daily.isLoading ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-6 rounded" />)}</div>
              ) : (
                <CategoryRows rows={daily.data?.byCategory} currency={currency} total={daily.data?.total || 0} />
              )}
            </div>
            <Table
              loading={daily.isLoading}
              empty="No expenses on this date"
              columns={[
                { key: 'category', label: 'Category', render: (e) => <span className="font-medium text-ink-900">{e.category}</span> },
                { key: 'description', label: 'Description', render: (e) => e.description || <span className="text-ink-300">—</span> },
                { key: 'account', label: 'Account', render: (e) => e.account?.name || <span className="text-ink-300">—</span> },
                { key: 'amount', label: 'Amount', className: 'text-right num font-medium text-red-600', render: (e) => money(e.amount, currency) },
              ]}
              rows={daily.data?.items || []}
            />
          </div>
        )}

        {tab === 'monthly' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink-900 mb-4">By category</h3>
              {monthly.isLoading ? (
                <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-6 rounded" />)}</div>
              ) : (
                <CategoryRows rows={monthly.data?.byCategory} currency={currency} total={monthly.data?.total || 0} />
              )}
            </div>
            <div className="space-y-4">
              <Table
                loading={monthly.isLoading}
                empty="No expenses this month"
                columns={[
                  { key: 'date', label: 'Day', render: (d) => <span className="text-ink-600">{fmtDate(d.date)}</span> },
                  { key: 'count', label: 'Entries', className: 'text-right num text-ink-500', render: (d) => d.count },
                  { key: 'total', label: 'Total', className: 'text-right num font-medium text-red-600', render: (d) => money(d.total, currency) },
                ]}
                rows={monthly.data?.byDay || []}
              />
              {(monthly.data?.byAccount?.length || 0) > 0 && (
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-ink-900 mb-3">By account</h3>
                  <div className="space-y-2">
                    {monthly.data.byAccount.map((a) => (
                      <div key={a.account} className="flex items-baseline justify-between text-sm border-b border-ink-100 pb-1.5 last:border-0">
                        <span className="text-ink-600">{a.account}</span>
                        <span className="num font-medium text-ink-900">{money(a.total, currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
