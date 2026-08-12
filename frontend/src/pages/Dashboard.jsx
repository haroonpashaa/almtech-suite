import { Suspense, lazy, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCurrency } from '../hooks/useSettings.js';
import { money, moneyPlain, dateShort, relativeTime } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Money from '../components/Money.jsx';
import { EmptyState } from '../components/ui.jsx';
import ChartFrame from '../components/charts/ChartFrame.jsx';
import ActivityHeatmap from '../components/charts/ActivityHeatmap.jsx';
import { CATEGORY_COLOURS, delta, rangeFor, previousRange } from '../components/charts/chartTheme.js';

/* ---------------------------------------------------------------------------
   The executive control centre.

   Every figure comes from an endpoint that already exists; nothing is recomputed
   beyond arithmetic on values the API returned, so the dashboard can never
   disagree with the screens it links to. No metric here is invented, and no chart
   is drawn from data the application does not hold.

   Recharts is loaded lazily. The KPI row renders from /reports/dashboard while the
   422 kB chart bundle is still arriving, so the first meaningful paint does not
   wait on it.
   --------------------------------------------------------------------------- */

const Charts = {
  Trend: lazy(() => import('../components/charts/ChartBodies.jsx').then((m) => ({ default: m.TrendChart }))),
  SalesPurchases: lazy(() => import('../components/charts/ChartBodies.jsx').then((m) => ({ default: m.SalesPurchasesChart }))),
  Donut: lazy(() => import('../components/charts/ChartBodies.jsx').then((m) => ({ default: m.ExpenseDonut }))),
  Position: lazy(() => import('../components/charts/ChartBodies.jsx').then((m) => ({ default: m.PositionChart }))),
};
const ChartFallback = ({ height = 250 }) => <div className="skeleton rounded-md w-full" style={{ height }} aria-hidden />;

const PERIODS = [
  { key: '7d', label: '7 days', days: 7, granularity: 'day' },
  { key: '30d', label: '30 days', days: 30, granularity: 'day' },
  { key: '90d', label: '90 days', days: 90, granularity: 'day' },
  { key: '6m', label: '6 months', months: 6, granularity: 'month' },
  { key: '12m', label: '12 months', months: 12, granularity: 'month' },
];

/* ---- KPI ------------------------------------------------------------------ */

function Kpi({ label, value, currency, hint, tone, to, lead = false, loading, change, className = '' }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="t-label">{label}</span>
        {to && (
          <svg className="w-3.5 h-3.5 text-ink-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        )}
      </div>
      {loading ? (
        <div className={`skeleton mt-2 ${lead ? 'h-8 w-36' : 'h-6 w-28'}`} />
      ) : (
        <div className="mt-1.5">
          {/* The fig scale shrinks with the viewport and wraps rather than clipping;
              a fixed 26px could not fit a billions figure into a half-width card. */}
          <Money value={value} currency={currency} showCurrency tone={tone} wrap
                 className={`kpi-value font-semibold ${lead ? 'fig-lg' : 'fig-md'}`} />
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2 min-h-[1.15rem]">
        {change != null && <Trend value={change} />}
        {hint && <span className="t-meta truncate">{hint}</span>}
      </div>
    </>
  );
  const cls = `kpi ${lead ? 'kpi-lead' : ''} ${to ? 'card-link' : ''} ${className}`.trim();
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Direction is carried by an arrow and a sign, never by colour alone. */
function Trend({ value }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11.5px] font-medium num ${up ? 'text-emerald-700' : 'text-red-600'}`}>
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {up ? <path d="M5 15l7-7 7 7" /> : <path d="M5 9l7 7 7-7" />}
      </svg>
      {up ? '+' : ''}{value.toFixed(1)}%
      <span className="sr-only">{up ? 'increase' : 'decrease'} on the previous period</span>
    </span>
  );
}

/* ---- page ----------------------------------------------------------------- */

export default function Dashboard() {
  const { has } = useAuth();
  const currency = useCurrency();
  const isAdmin = has('admin');
  const [periodKey, setPeriodKey] = useState('30d');
  const period = PERIODS.find((p) => p.key === periodKey);
  const range = useMemo(() => rangeFor(period), [periodKey]);
  const prior = useMemo(() => previousRange(range), [range]);

  const dash = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/reports/dashboard')).data,
  });

  const series = useQuery({
    enabled: isAdmin,
    queryKey: ['report-series', range.from, range.to, period.granularity],
    queryFn: async () => (await api.get('/reports/series', { params: { ...range, granularity: period.granularity } })).data,
  });
  // The same endpoint over the preceding window — this is what turns every KPI into
  // a comparison rather than an isolated number. No new API was required for it.
  const seriesPrev = useQuery({
    enabled: isAdmin,
    queryKey: ['report-series-prev', prior.from, prior.to, period.granularity],
    queryFn: async () => (await api.get('/reports/series', { params: { ...prior, granularity: period.granularity } })).data,
  });
  // Daily grain drives the heatmap regardless of the selected granularity.
  const daily = useQuery({
    enabled: isAdmin,
    queryKey: ['report-series-daily', range.from, range.to],
    queryFn: async () => (await api.get('/reports/series', { params: { ...range, granularity: 'day' } })).data,
  });
  const pl = useQuery({
    enabled: isAdmin,
    queryKey: ['dash-pl', range.from, range.to],
    queryFn: async () => (await api.get('/reports/profit-loss', { params: range })).data,
  });
  const payments = useQuery({
    enabled: isAdmin,
    queryKey: ['dash-payments'],
    queryFn: async () => (await api.get('/payments', { params: { limit: 10 } })).data,
  });
  const receivables = useQuery({
    enabled: isAdmin, queryKey: ['dash-receivables'],
    queryFn: async () => (await api.get('/finance/receivables')).data,
  });
  const payables = useQuery({
    enabled: isAdmin, queryKey: ['dash-payables'],
    queryFn: async () => (await api.get('/finance/payables')).data,
  });
  const pendingPOs = useQuery({
    enabled: isAdmin, queryKey: ['dash-pending-pos'],
    queryFn: async () => (await api.get('/purchase-orders', { params: { status: 'ordered', limit: 1 } })).data,
  });
  const reversals = useQuery({
    enabled: isAdmin, queryKey: ['dash-reversals'],
    queryFn: async () => (await api.get('/payments', { params: { type: 'payment_reversal', limit: 5 } })).data,
  });

  const d = dash.data;
  const points = (series.data?.points || []).map((p) => ({
    ...p, label: period.granularity === 'month' ? p.period : dateShort(p.period),
  }));
  const totals = series.data?.totals;
  const prevTotals = seriesPrev.data?.totals;
  const categories = pl.data?.expensesByCategory || [];
  const categoryTotal = categories.reduce((t, c) => t + c.total, 0) || 1;
  const topCategories = categories.slice(0, 6);

  const refreshing = [dash, series, pl].some((q) => q.isFetching);

  /* Attention: every entry is a real condition derived from data already fetched. */
  const attention = useMemo(() => {
    const out = [];
    const ar = receivables.data?.aging;
    const ap = payables.data?.aging;
    const overdueAR = ar ? (ar.d31_60 || 0) + (ar.d61_90 || 0) + (ar.d90_plus || 0) : 0;
    const overdueAP = ap ? (ap.d31_60 || 0) + (ap.d61_90 || 0) + (ap.d90_plus || 0) : 0;
    const critical = ar?.d90_plus || 0;

    if (critical > 0) out.push({ tone: 'danger', label: 'Receivables over 90 days old', value: money(critical, currency), to: '/receivables' });
    if (overdueAR - critical > 0) out.push({ tone: 'warning', label: 'Receivables 31–90 days old', value: money(overdueAR - critical, currency), to: '/receivables' });
    if (overdueAP > 0) out.push({ tone: 'warning', label: 'Payables over 30 days old', value: money(overdueAP, currency), to: '/payables' });
    if (d?.lowStock?.length) out.push({ tone: 'warning', label: 'Products at or below reorder level', value: String(d.lowStock.length), to: '/products' });
    if (pendingPOs.data?.length) out.push({ tone: 'info', label: 'Purchase orders awaiting delivery', value: 'View', to: '/purchase-orders' });
    const unpaid = (d?.recentInvoices || []).filter((i) => i.balance > 0 && i.paid === 0).length;
    if (unpaid) out.push({ tone: 'info', label: 'Recent invoices with no payment', value: String(unpaid), to: '/invoices' });
    if (reversals.data?.length) out.push({ tone: 'neutral', label: 'Recent payment reversals', value: String(reversals.data.length), to: '/reports' });
    return out;
  }, [d, receivables.data, payables.data, pendingPOs.data, reversals.data, currency]);

  const toneDot = { danger: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-sky-500', neutral: 'bg-ink-400' };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          <span className="flex items-center gap-2">
            Business position · {period.label.toLowerCase()}
            {refreshing && (
              <span className="t-meta inline-flex items-center gap-1" role="status">
                <span className="dot bg-brand-500 animate-pulse" aria-hidden />updating
              </span>
            )}
          </span>
        }
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" /></svg>}
        actions={
          <>
            {isAdmin && (
              <div className="segment scroll-x max-w-[min(100%,22rem)]" role="tablist" aria-label="Reporting period">
                {PERIODS.map((p) => (
                  <button key={p.key} role="tab" aria-selected={p.key === periodKey}
                          onClick={() => setPeriodKey(p.key)}
                          className={`segment-item whitespace-nowrap ${p.key === periodKey ? 'segment-item-active' : ''}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <Link to="/pos" className="btn-primary">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              New Sale
            </Link>
          </>
        }
      />

      <div className="page page-wide stack">
        {/* ---------- Primary KPIs: two promoted, the rest supporting ---------- */}
        <section aria-label="Key figures">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Kpi lead loading={dash.isLoading} label="Revenue · period" value={totals?.revenue ?? d?.salesMonth}
                 currency={currency} to="/invoices" change={delta(totals?.revenue, prevTotals?.revenue)}
                 hint={`${d?.salesToday?.count ?? 0} invoice${d?.salesToday?.count === 1 ? '' : 's'} today`} />
            <Kpi lead loading={dash.isLoading} label="Net profit · period" value={pl.data?.netProfit}
                 currency={currency} tone="auto" to="/reports"
                 hint={pl.data ? `${(pl.data.netMargin ?? 0).toFixed(1)}% margin` : ''} />
            <Kpi loading={dash.isLoading} label="Expenses · period" value={totals?.expenses} currency={currency}
                 tone="negative" to="/expenses" change={delta(totals?.expenses, prevTotals?.expenses)} />
            <Kpi loading={dash.isLoading} label="Cash & bank" value={d?.accountsTotal} currency={currency}
                 tone="auto" to="/accounts" hint={`${d?.accounts?.length ?? 0} accounts`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
            <Kpi loading={dash.isLoading} label="Receivables" value={d?.receivables} currency={currency}
                 tone="due" to="/receivables" hint="Owed to ALMTech" />
            <Kpi loading={dash.isLoading} label="Payables" value={d?.payables} currency={currency}
                 tone="due" to="/payables" hint="ALMTech owes" />
            <Kpi loading={dash.isLoading} label="Net position" value={d?.netPosition} currency={currency}
                 tone="auto" to="/receivables" hint="Receivables − payables"
                 className="sm:col-span-2 xl:col-span-1" />
          </div>
        </section>

        {isAdmin && (
          <>
            {/* ---------- Main trend ---------- */}
            <ChartFrame
              title="Revenue against expenses"
              subtitle={`${range.from} to ${range.to} · compared with the preceding ${period.label.toLowerCase()}`}
              loading={series.isLoading}
              error={series.isError ? 'The trend could not be loaded.' : null}
              onRetry={series.refetch}
              isEmpty={points.length === 0}
              emptyDescription="Choose a longer period, or record a sale to see the trend build."
              height={264}
              table={{
                caption: 'Revenue and expenses by period',
                columns: ['Period', `Revenue (${currency})`, `Expenses (${currency})`, `Net (${currency})`],
                rows: points.map((p) => [p.label, moneyPlain(p.revenue), moneyPlain(p.expenses), moneyPlain(p.revenue - p.expenses)]),
              }}
            >
              <Suspense fallback={<ChartFallback height={264} />}>
                <Charts.Trend points={points} currency={currency} />
              </Suspense>
            </ChartFrame>

            {/* ---------- Position ---------- */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ChartFrame
                title="Financial position"
                subtitle="What ALMTech is owed against what it owes"
                className="lg:col-span-2"
                loading={receivables.isLoading || payables.isLoading}
                isEmpty={!d}
                height={172}
                table={{
                  caption: 'Receivables and payables',
                  columns: ['Measure', `Amount (${currency})`],
                  rows: [
                    ['Owed to ALMTech', moneyPlain(d?.receivables)],
                    ['ALMTech owes', moneyPlain(d?.payables)],
                    ['Net position', moneyPlain(d?.netPosition)],
                  ],
                }}
              >
                <Suspense fallback={<ChartFallback height={172} />}>
                  <Charts.Position receivables={d?.receivables || 0} payables={d?.payables || 0} currency={currency} />
                </Suspense>
              </ChartFrame>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 content-start">
                <Link to="/receivables" className="card-link p-4">
                  <div className="t-label">Owed to ALMTech</div>
                  <Money value={d?.receivables} currency={currency} showCurrency tone="due" wrap className="kpi-value fig-md font-semibold mt-1.5 block" />
                  <div className="t-meta mt-1">{receivables.data?.customerCount ?? 0} customers →</div>
                </Link>
                <Link to="/payables" className="card-link p-4">
                  <div className="t-label">ALMTech owes</div>
                  <Money value={d?.payables} currency={currency} showCurrency tone="due" wrap className="kpi-value fig-md font-semibold mt-1.5 block" />
                  <div className="t-meta mt-1">{payables.data?.supplierCount ?? 0} suppliers →</div>
                </Link>
              </div>
            </div>

            {/* ---------- Sales vs purchases + expense categories ---------- */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ChartFrame
                title="Sales against purchases"
                subtitle="What was sold measured against what was bought"
                className="lg:col-span-2"
                loading={series.isLoading}
                isEmpty={points.length === 0}
                height={236}
                table={{
                  caption: 'Sales and purchases by period',
                  columns: ['Period', `Sales (${currency})`, `Purchases (${currency})`],
                  rows: points.map((p) => [p.label, moneyPlain(p.revenue), moneyPlain(p.purchases)]),
                }}
              >
                <Suspense fallback={<ChartFallback height={236} />}>
                  <Charts.SalesPurchases points={points} currency={currency} />
                </Suspense>
              </ChartFrame>

              <ChartFrame
                title="Expenses by category"
                subtitle={period.label}
                loading={pl.isLoading}
                isEmpty={topCategories.length === 0}
                emptyTitle="No expenses in this period"
                height={150}
                table={{
                  caption: 'Expenses by category',
                  columns: ['Category', `Amount (${currency})`, 'Share'],
                  rows: topCategories.map((c) => [c.category, moneyPlain(c.total), `${((c.total / categoryTotal) * 100).toFixed(1)}%`]),
                }}
              >
                <Suspense fallback={<ChartFallback height={150} />}>
                  <Charts.Donut categories={topCategories} currency={currency} />
                </Suspense>
                <ul className="mt-3 space-y-1.5">
                  {topCategories.map((c, i) => (
                    <li key={c.category} className="flex items-center gap-2 text-[13px]">
                      <span className="dot shrink-0" style={{ background: CATEGORY_COLOURS[i % CATEGORY_COLOURS.length] }} aria-hidden />
                      <span className="text-ink-600 truncate">{c.category}</span>
                      <span className="t-meta shrink-0 num">{((c.total / categoryTotal) * 100).toFixed(0)}%</span>
                      <Money value={c.total} currency={currency} className="ml-auto text-ink-900 shrink-0" />
                    </li>
                  ))}
                </ul>
              </ChartFrame>
            </div>

            {/* ---------- Trading intensity ---------- */}
            <section className="card">
              <div className="card-head">
                <div>
                  <h2 className="t-section">Trading intensity</h2>
                  <p className="t-meta mt-0.5">Daily revenue across the selected period — when this business actually trades</p>
                </div>
              </div>
              <div className="p-4">
                <ActivityHeatmap points={daily.data?.points || []} currency={currency} loading={daily.isLoading} />
              </div>
            </section>

            {/* ---------- Attention + activity ---------- */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="card">
                <div className="card-head">
                  <h2 className="t-section">Needs attention</h2>
                  <span className="t-meta">{attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : 'All clear'}</span>
                </div>
                <div className="p-2">
                  {attention.length === 0 ? (
                    <EmptyState
                      icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                      title="Nothing needs attention"
                      description="No overdue balances, low stock or unpaid invoices right now."
                    />
                  ) : (
                    <ul>
                      {attention.map((a, i) => (
                        <li key={i}>
                          <Link to={a.to} className="flex items-center gap-2.5 py-2.5 px-2 rounded-md hover:bg-ink-50 transition-colors">
                            <span className={`dot ${toneDot[a.tone]}`} aria-hidden />
                            <span className="text-[13px] text-ink-700 min-w-0 flex-1">{a.label}</span>
                            <span className="text-[13px] font-medium text-ink-900 num shrink-0">{a.value}</span>
                            <svg className="w-3.5 h-3.5 text-ink-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <h2 className="t-section">Recent activity</h2>
                  <Link to="/reports" className="t-meta hover:text-brand-700">All movements →</Link>
                </div>
                <div className="p-4">
                  {!payments.data?.length ? (
                    <EmptyState title="No recorded movements yet" description="Payments and receipts will appear here." />
                  ) : (
                    <ul className="space-y-3">
                      {payments.data.slice(0, 8).map((t, i) => (
                        <li key={t._id || i} className="flex items-start gap-2.5">
                          <span className={`mt-1.5 dot shrink-0 ${t.direction === 'in' ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] text-ink-800 truncate">{t.customer || t.supplier || t.description || 'Transaction'}</div>
                            <div className="t-meta truncate">{t.invoice || t.po || t.account || '—'} · {relativeTime(t.date)}</div>
                          </div>
                          <Money value={t.direction === 'in' ? t.amount : -t.amount} currency={currency} tone="auto" className="text-[13px] shrink-0" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {/* ---------- Low stock: visible to every role ---------- */}
        <section className="card">
          <div className="card-head">
            <h2 className="t-section">Low stock</h2>
            <Link to="/products" className="t-meta hover:text-brand-700">All products →</Link>
          </div>
          {dash.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-4" />)}</div>
          ) : !d?.lowStock?.length ? (
            <EmptyState title="Stock levels are healthy" description="No product has reached its reorder level." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {d.lowStock.slice(0, 6).map((p) => (
                <li key={p._id}>
                  <Link to="/products" className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-50 transition-colors">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink-800 truncate">{p.name}</span>
                      <span className="block t-meta font-mono">{p.sku}</span>
                    </span>
                    <span className={p.stock === 0 ? 'badge-danger' : 'badge-warning'}>
                      {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
