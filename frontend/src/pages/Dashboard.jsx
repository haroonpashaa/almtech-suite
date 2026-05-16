import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

function Stat({ label, value, hint, accent }) {
  return (
    <div className="card p-5 flex flex-col relative overflow-hidden h-full">
      {accent && (
        <span
          className={`absolute left-0 top-0 bottom-0 w-1 ${
            accent === 'warning' ? 'bg-amber-500' : accent === 'danger' ? 'bg-red-500' : 'bg-brand-gradient'
          }`}
        />
      )}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink-900 num tracking-tight">{value}</div>
      <div className="mt-auto pt-2 text-xs text-ink-400 min-h-[1rem]">{hint || ' '}</div>
    </div>
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
  return <li className="text-sm text-ink-400 italic">{text}</li>;
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

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live revenue, receivables, payables, and stock health"
        actions={
          <>
            <Link to="/pos" className="btn-primary-gradient">New Sale</Link>
            <Link to="/products/new" className="btn-secondary">Add Product</Link>
          </>
        }
      />

      <div className="p-8 space-y-6 max-w-[1400px]">
        {isLoading ? (
          <div className="text-ink-400">Loading…</div>
        ) : (
          <>
            {/* Stat cards: 1 / 2 / 3 / 5 across breakpoints, all equal height */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-stretch">
              <Stat
                label="Sales Today"
                value={money(data.salesToday.total, currency)}
                hint={`${data.salesToday.count} invoice${data.salesToday.count === 1 ? '' : 's'}`}
                accent="brand"
              />
              <Stat label="Sales · 7 Days" value={money(data.salesWeek, currency)} />
              <Stat label="Sales · This Month" value={money(data.salesMonth, currency)} />
              <Stat
                label="Receivables"
                value={money(data.receivables, currency)}
                hint="Owed by customers"
                accent={data.receivables > 0 ? 'warning' : undefined}
              />
              <Stat
                label="Payables"
                value={money(data.payables, currency)}
                hint="Owed to suppliers"
                accent={data.payables > 0 ? 'warning' : undefined}
              />
            </div>

            {/* Chart + side panel, equal heights */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
              <SectionCard
                title="Revenue · last 30 days"
                subtitle="Daily totals"
                className="lg:col-span-2"
              >
                <div className="w-full h-[280px]">
                  <ResponsiveContainer>
                    <BarChart data={data.dailySeries} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="brandBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0086cd" />
                          <stop offset="100%" stopColor="#163e93" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="_id"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v) => v?.slice(5)}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip
                        formatter={(v) => money(v, currency)}
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          fontSize: 12,
                        }}
                        cursor={{ fill: '#0086cd10' }}
                      />
                      <Bar dataKey="total" fill="url(#brandBar)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Top Products" subtitle="This week, by revenue">
                <ul className="space-y-3 text-sm">
                  {data.topProducts.length === 0 && <EmptyRow text="No sales yet" />}
                  {data.topProducts.map((p, i) => (
                    <li key={p._id} className="flex items-baseline gap-3">
                      <span className="text-[11px] text-ink-300 font-mono w-4 flex-shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-ink-700 truncate flex-1">{p.name}</span>
                      <span className="text-ink-500 num text-xs whitespace-nowrap">
                        {money(p.revenue, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>

            {/* Low stock + recent invoices */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
              <SectionCard
                title="Low Stock"
                subtitle="At or below reorder threshold"
                action={
                  <Link to="/products?low=1" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                    View all →
                  </Link>
                }
              >
                <ul className="space-y-2.5 text-sm">
                  {data.lowStock.length === 0 && <EmptyRow text="All items above threshold" />}
                  {data.lowStock.map((p) => (
                    <li key={p._id} className="flex items-baseline justify-between gap-3">
                      <Link
                        to={`/products/${p._id}/edit`}
                        className="text-ink-700 hover:text-brand-700 hover:underline truncate flex-1"
                      >
                        {p.name}
                      </Link>
                      <span
                        className={`text-xs num font-medium whitespace-nowrap ${
                          p.stock === 0 ? 'text-red-600' : 'text-amber-600'
                        }`}
                      >
                        {p.stock} left
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title="Recent Invoices"
                subtitle="Last 8 sales"
                action={
                  <Link to="/invoices" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                    View all →
                  </Link>
                }
              >
                <ul className="divide-y divide-ink-100">
                  {data.recentInvoices.length === 0 && <EmptyRow text="No invoices yet" />}
                  {data.recentInvoices.map((inv) => (
                    <li key={inv._id} className="py-2.5 first:pt-0 last:pb-0 flex items-baseline gap-3">
                      <Link
                        to={`/invoices/${inv._id}`}
                        className="text-sm text-ink-700 hover:text-brand-700 hover:underline truncate flex-1"
                      >
                        <span className="font-mono text-[11px] text-ink-400 mr-2">{inv.number}</span>
                        {inv.customer?.name}
                      </Link>
                      <span className="text-sm text-ink-900 num font-medium whitespace-nowrap">
                        {money(inv.total, currency)}
                      </span>
                      <span className="text-xs text-ink-400 whitespace-nowrap">
                        {date(inv.issuedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
