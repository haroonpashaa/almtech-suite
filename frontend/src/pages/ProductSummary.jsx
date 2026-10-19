import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { date, money } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Table from '../components/Table.jsx';
import { Badge, LoadingBlock } from '../components/ui.jsx';

export default function ProductSummary() {
  const { id } = useParams();
  const { has } = useAuth();
  const currency = useCurrency();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['product-summary', id],
    queryFn: async () => (await api.get(`/products/${id}/summary`)).data,
  });
  if (isLoading) return <LoadingBlock />;
  if (isError || !data) return <div className="p-8"><PageHeader title="Product summary" /><p className="text-sm text-red-600">Could not load this product. <button className="underline" onClick={() => refetch()}>Try again</button></p></div>;
  const p = data.product;
  const specs = [['Model', p.model], ['Processor', p.processor], ['Memory', p.ram], ['Storage', p.storage], ['Graphics', p.graphics], ['Screen', p.screen], ['Condition', p.condition], ['Warranty', p.warranty], ['Barcode', p.barcode]];
  return <div>
    <PageHeader title={p.name} subtitle={`${p.brand || 'Unbranded'} · ${p.sku}`} breadcrumb={[{ label: 'Inventory', to: '/products' }, { label: 'Product summary' }]} actions={has('admin', 'stock', 'sales') ? <Link className="btn-secondary" to={`/products/${id}/edit`}>Edit product</Link> : null} />
    <div className="page page-w space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="On hand" value={p.stock} hint={p.stock <= p.lowStockThreshold ? `Low stock · threshold ${p.lowStockThreshold}` : `Threshold ${p.lowStockThreshold}`} accent={p.stock <= p.lowStockThreshold ? 'warning' : undefined} />
        <StatCard label="Units sold" value={data.sales.quantitySold} hint={`${data.sales.invoiceCount} invoice lines`} />
        <StatCard label="Sales revenue" value={money(data.sales.revenue, currency)} hint={data.sales.lastSold ? `Last sold ${date(data.sales.lastSold)}` : 'No recorded sales'} />
        <StatCard label="Status" value={p.active ? 'Active' : 'Inactive'} hint={p.category || 'Uncategorised'} />
      </div>
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink-900 mb-3">Product details</h2>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          {specs.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="t-meta">{label}</dt><dd className="text-ink-800 mt-0.5">{value}</dd></div>)}
          {p.comments && !has('sales') && <div className="sm:col-span-2"><dt className="t-meta">Condition notes</dt><dd className="text-ink-800 mt-0.5">{p.comments}</dd></div>}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">{p.tracksSerials && <Badge tone="info">Serial tracking enabled</Badge>}{p.stock <= p.lowStockThreshold && <Badge tone="warning">Low stock</Badge>}{!p.active && <Badge tone="neutral">Inactive</Badge>}</div>
      </section>
      <section className="card">
        <div className="p-5 pb-2"><h2 className="text-sm font-semibold text-ink-900">Recent inventory movements</h2><p className="t-meta mt-1">Latest 20 receipts, sales, returns, and stock adjustments.</p></div>
        <Table rows={data.movements} empty="No inventory movements recorded" columns={[
          { key: 'createdAt', label: 'Date', render: (m) => date(m.createdAt) },
          { key: 'type', label: 'Movement', render: (m) => m.type },
          { key: 'quantity', label: 'Quantity', className: 'text-right num', render: (m) => <span className={m.quantity > 0 ? 'text-emerald-600' : 'text-red-600'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span> },
          { key: 'balanceAfter', label: 'Balance after', className: 'text-right num', render: (m) => m.balanceAfter },
          { key: 'note', label: 'Reason', render: (m) => m.note || m.refType || '—' },
          { key: 'createdBy', label: 'Recorded by', render: (m) => m.createdBy?.name || '—' },
        ]} />
      </section>
    </div>
  </div>;
}
