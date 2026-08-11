import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge } from '../components/ui.jsx';

export default function Products() {
  const { has } = useAuth();
  const [q, setQ] = useState('');
  const [lowStock, setLowStock] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['products', q, lowStock],
    queryFn: async () => (await api.get('/products', { params: { q, lowStock } })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Products, stock levels, and pricing"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10" /></svg>}
        actions={has('admin', 'stock') && (
          <Link to="/products/new" className="btn-primary-gradient">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Product
          </Link>
        )}
      />
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="field-search max-w-xs w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input className="input" placeholder="Search by name, SKU, brand…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button
            onClick={() => setLowStock((v) => !v)}
            className={`btn-sm border ${lowStock ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-ink-200 text-ink-600 hover:bg-ink-50'}`}
          >
            <span className={`dot ${lowStock ? 'bg-amber-500' : 'bg-ink-300'}`} />
            Low stock only
          </button>
          <span className="text-sm text-ink-400 ml-auto">{data?.total ?? 0} products</span>
        </div>
        <Table
          loading={isLoading}
          empty="No products match your filters"
          columns={[
            { key: 'name', label: 'Name', render: (p) => (
                has('admin') ? (
                  <Link to={`/products/${p._id}/edit`} className="text-ink-900 hover:text-brand-700 font-medium">{p.name}</Link>
                ) : (
                  <span className="text-ink-900 font-medium">{p.name}</span>
                )
              ) },
            { key: 'sku', label: 'SKU', render: (p) => <span className="font-mono text-[12px] text-ink-400">{p.sku}</span> },
            { key: 'category', label: 'Category', render: (p) => p.category || <span className="text-ink-300">—</span> },
            { key: 'brand', label: 'Brand', render: (p) => p.brand || <span className="text-ink-300">—</span> },
            { key: 'stock', label: 'Stock', className: 'text-right', render: (p) => (
                <span className="num">
                  {p.stock <= p.lowStockThreshold ? (
                    <Badge tone={p.stock === 0 ? 'danger' : 'warning'} dot>{p.stock}</Badge>
                  ) : p.stock}
                </span>
              ) },
            { key: 'purchasePrice', label: 'Cost', className: 'text-right num', render: (p) => money(p.purchasePrice, currency) },
            { key: 'sellingPrice', label: 'Price', className: 'text-right num font-medium text-ink-900', render: (p) => money(p.sellingPrice, currency) },
          ]}
          rows={data?.items || []}
        />
      </div>
    </div>
  );
}
