import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';

const icons = {
  today: <path d="M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />,
  week: 'M3 21h18M6 17v-7m5 7v-11m5 11v-5m5 5v-9',
  month: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  receivable: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  payable: 'M3 7h18M3 12h18M3 17h18',
  cash: 'M3 6h18v12H3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 9h.01M18 15h.01',
  bank: 'M3 10h18M5 10V21M19 10v11M9 10v11M15 10v11M2 21h20M12 3l9 5H3z',
  funds: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h3v-4z',
  receipt: 'M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h4',
};

function Ic({ d }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {typeof d === 'string' ? <path d={d} /> : d}
    </svg>
  );
}

function SectionCard({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`card p-5 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          {subtitle && <p className="text-xs text-ink-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function EmptyRow({ text }) {
  return <li className="text-sm text-ink-400 italic py-1">{text}</li>;
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/reports/dashboard')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  const maxRev = data?.topProducts?.[0]?.revenue || 1;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live revenue, receivables, payables, and stock health"
        icon={<Ic d="M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" />}
        actions={
          <>
            <Link to="/pos" className="btn-primary-gradient">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              New Sale
            </Link>
            <Link to="/products/new" className="btn-secondary">Add Product</Link>
          </>
        }
      />

      <div className="p-6 sm:p-8 space-y-6 max-w-[1400px]">
        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-stretch">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <StatCard key={i} loading />)
          ) : (
            <>
              <StatCard
                label="Sales Today"
                value={money(data.salesToday.total, currency)}
                hint={`${data.salesToday.count} invoice${data.salesToday.count === 1 ? '' : 's'}`}
                accent="brand"
                icon={<Ic d={icons.today} />}
              />
              <StatCard label="Sales · 7 Days" value={money(data.salesWeek, currency)} icon={<Ic d={icons.week} />} />
              <StatCard label="Sales · This Month" value={money(data.salesMonth, currency)} icon={<Ic d={icons.month} />} />
              <Link to="/receivables" className="block">
                <StatCard
                  label="Receivables"
                  value={money(data.receivables, currency)}
                  hint="Owed by customers"
                  accent={data.receivables > 0 ? 'warning' : undefined}
                  icon={<Ic d={icons.receivable} />}
                />
              </Link>
              <Link to="/payables" className="block">
                <StatCard
                  label="Payables"
                  value={money(data.payables, currency)}
                  hint="Owed to suppliers"
                  accent={data.payables > 0 ? 'warning' : undefined}
                  icon={<Ic d={icons.payable} />}
                />
              </Link>
            </>
          )}
        </div>

        {/* Financial accounts — admin only; the key is absent from the payload for
            other roles, so their dashboard is unchanged. */}
        {data?.accounts?.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
            {data.accounts.map((a) => (
              <Link key={a._id} to={`/accounts/${a._id}`} className="block">
                <StatCard
                  label={a.name}
                  value={money(a.currentBalance, currency)}
                  hint={a.type === 'cash' ? 'Cash in hand' : 'Bank balance'}
                  accent={a.currentBalance < 0 ? 'danger' : 'success'}
                  icon={<Ic d={a.type === 'cash' ? icons.cash : icons.bank} />}
                />
              </Link>
            ))}
            <Link to="/accounts" className="block">
              <StatCard
                label="Total Funds"
                value={money(data.accountsTotal, currency)}
                hint="All active accounts"
                accent="brand"
                icon={<Ic d={icons.funds} />}
              />
            </Link>
            <Link to="/expense-reports" className="block">
              <StatCard
                label="Expenses Today"
                value={money(data.expensesToday || 0, currency)}
                hint="Posted today"
                accent={data.expensesToday > 0 ? 'warning' : undefined}
                icon={<Ic d={icons.receipt} />}
              />
            </Link>
            <Link to="/receivables" className="block">
              <StatCard
                label="Net Receivable Position"
                value={money(data.netPosition || 0, currency)}
                hint="Receivables − Payables"
                accent={(data.netPosition || 0) < 0 ? 'danger' : 'success'}
                icon={<Ic d={icons.receivable} />}
              />
            </Link>
            <Link to="/expense-reports" className="block">
              <StatCard
                label="Expenses This Month"
                value={money(data.expensesMonth || 0, currency)}
                hint="Month to date"
                accent={data.expensesMonth > 0 ? 'warning' : undefined}
                icon={<Ic d={icons.receipt} />}
              />
            </Link>
          </div>
        )}

        {/* Chart + top products */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          <SectionCard title="Revenue" subtitle="Daily totals · last 30 days" className="lg:col-span-2">
            {isLoading ? (
              <div className="skeleton w-full h-[280px] rounded-lg" />
            ) : (
              <div className="w-full h-[280px]">
                <ResponsiveContainer>
                  <AreaChart data={data.dailySeries} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0950b9" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#0950b9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis
                      dataKey="_id"
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(v) => v?.slice(5)}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} />
                    <Tooltip
                      formatter={(v) => [money(v, currency), 'Revenue']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 14px -2px rgba(16,24,40,0.10)' }}
                      labelStyle={{ color: '#64748b', fontWeight: 500 }}
                      cursor={{ stroke: '#0950b9', strokeWidth: 1, strokeDasharray: '3 3' }}
                    />
                    <Area type="monotone" dataKey="total" stroke="#0950b9" strokeWidth={2} fill="url(#revFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Top Products" subtitle="This week, by revenue">
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-5" />)}</div>
            ) : (
              <ul className="space-y-3.5 text-sm">
                {data.topProducts.length === 0 && <EmptyRow text="No sales yet" />}
                {data.topProducts.map((p, i) => (
                  <li key={p._id} className="flex items-center gap-3">
                    <span className="text-[11px] text-ink-300 font-mono w-4 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-ink-700 truncate">{p.name}</span>
                        <span className="text-ink-500 num text-xs whitespace-nowrap">{money(p.revenue, currency)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-ink-100 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${Math.max(6, (p.revenue / maxRev) * 100)}%` }} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Low stock + recent invoices */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <SectionCard
            title="Low Stock"
            subtitle="At or below reorder threshold"
            action={<Link to="/products?low=1" className="text-xs text-brand-600 hover:text-brand-700 font-medium">View all →</Link>}
          >
            {isLoading ? (
              <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-5" />)}</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.lowStock.length === 0 && <EmptyRow text="All items above threshold" />}
                {data.lowStock.map((p) => (
                  <li key={p._id} className="flex items-center justify-between gap-3 py-1.5 hover:bg-ink-25 -mx-2 px-2 rounded-md transition">
                    <Link to={`/products/${p._id}/edit`} className="text-ink-700 hover:text-brand-700 truncate flex-1">{p.name}</Link>
                    <span className={`badge ${p.stock === 0 ? 'badge-danger' : 'badge-warning'}`}>
                      <span className={`dot ${p.stock === 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
                      {p.stock} left
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Recent Invoices"
            subtitle="Last 8 sales"
            action={<Link to="/invoices" className="text-xs text-brand-600 hover:text-brand-700 font-medium">View all →</Link>}
          >
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-5" />)}</div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.recentInvoices.length === 0 && <EmptyRow text="No invoices yet" />}
                {data.recentInvoices.map((inv) => (
                  <li key={inv._id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                    <Link to={`/invoices/${inv._id}`} className="text-sm text-ink-700 hover:text-brand-700 truncate flex-1">
                      <span className="font-mono text-[11px] text-ink-400 mr-2">{inv.number}</span>
                      {inv.customer?.name}
                    </Link>
                    <span className="text-sm text-ink-900 num font-medium whitespace-nowrap">{money(inv.total, currency)}</span>
                    <span className="text-xs text-ink-400 whitespace-nowrap">{date(inv.issuedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
