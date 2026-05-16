import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

const tone = {
  received: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  ordered: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-500',
};

export default function PurchaseOrders() {
  const { has } = useAuth();
  const { data } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => (await api.get('/purchase-orders')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';
  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        actions={has('admin', 'stock') && <Link to="/purchase-orders/new" className="btn-primary">+ New PO</Link>}
      />
      <div className="p-6">
        <Table
          columns={[
            { key: 'number', label: 'Number', render: (p) => <Link to={`/purchase-orders/${p._id}`} className="text-brand-600 hover:underline font-medium">{p.number}</Link> },
            { key: 'orderedAt', label: 'Ordered', render: (p) => date(p.orderedAt) },
            { key: 'supplier', label: 'Supplier', render: (p) => p.supplier?.name || '—' },
            { key: 'status', label: 'Status', render: (p) => <span className={`badge ${tone[p.status] || 'bg-slate-100'}`}>{p.status}</span> },
            { key: 'total', label: 'Total', className: 'text-right', render: (p) => money(p.total, currency) },
            { key: 'paid', label: 'Paid', className: 'text-right', render: (p) => money(p.paid, currency) },
            { key: 'balance', label: 'Balance', className: 'text-right', render: (p) => money(p.balance, currency) },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
