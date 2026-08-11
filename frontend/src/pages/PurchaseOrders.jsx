import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge } from '../components/ui.jsx';

const statusTone = { received: 'success', partial: 'warning', ordered: 'info', cancelled: 'neutral' };

export default function PurchaseOrders() {
  const { has } = useAuth();
  const { data, isLoading } = useQuery({
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
        subtitle="Restock from suppliers and track payables"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4m11 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4" /></svg>}
        actions={has('admin', 'stock') && (
          <Link to="/purchase-orders/new" className="btn-primary-gradient">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New PO
          </Link>
        )}
      />
      <div className="p-6 sm:p-8">
        <Table
          loading={isLoading}
          empty="No purchase orders yet"
          columns={[
            { key: 'number', label: 'Number', render: (p) => <Link to={`/purchase-orders/${p._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{p.number}</Link> },
            { key: 'orderedAt', label: 'Ordered', render: (p) => <span className="text-ink-500">{date(p.orderedAt)}</span> },
            { key: 'supplier', label: 'Supplier', render: (p) => p.supplier?.name || <span className="text-ink-300">—</span> },
            { key: 'status', label: 'Status', render: (p) => <Badge tone={statusTone[p.status]} dot>{p.status}</Badge> },
            { key: 'total', label: 'Total', className: 'text-right num font-medium text-ink-900', render: (p) => money(p.total, currency) },
            { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (p) => money(p.paid, currency) },
            { key: 'balance', label: 'Balance', className: 'text-right num', render: (p) => (
                <span className={p.balance > 0 ? 'text-amber-600 font-medium' : 'text-ink-400'}>{money(p.balance, currency)}</span>
              ) },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
