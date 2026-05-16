import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

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
        actions={
          has('admin', 'stock') && (
            <Link to="/products/new" className="btn-primary">+ New Product</Link>
          )
        }
      />
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            className="input max-w-xs"
            placeholder="Search by name, SKU, brand..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
            Low stock only
          </label>
          <span className="text-sm text-slate-500 ml-auto">{data?.total ?? 0} products</span>
        </div>
        <Table
          empty={isLoading ? 'Loading…' : 'No products'}
          columns={[
            { key: 'name', label: 'Name', render: (p) => (
                <Link to={`/products/${p._id}/edit`} className="text-brand-600 hover:underline font-medium">
                  {p.name}
                </Link>
              ) },
            { key: 'sku', label: 'SKU' },
            { key: 'category', label: 'Category' },
            { key: 'brand', label: 'Brand' },
            { key: 'stock', label: 'Stock', className: 'text-right', render: (p) => (
                <span className={p.stock <= p.lowStockThreshold ? 'text-amber-600 font-medium' : ''}>
                  {p.stock}
                </span>
              ) },
            { key: 'purchasePrice', label: 'Cost', className: 'text-right', render: (p) => money(p.purchasePrice, currency) },
            { key: 'sellingPrice', label: 'Price', className: 'text-right', render: (p) => money(p.sellingPrice, currency) },
          ]}
          rows={data?.items || []}
        />
      </div>
    </div>
  );
}
