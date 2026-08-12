import { Link } from 'react-router-dom';
import { money, date } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge } from '../components/ui.jsx';

const statusTone = { received: 'success', partial: 'warning', ordered: 'info', cancelled: 'neutral' };

export default function PurchaseOrders() {
  const { has } = useAuth();
  const currency = useCurrency();
  const list = usePagedList({ key: ['purchase-orders'], path: '/purchase-orders', limit: 50 });
  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="Restock from suppliers and track payables"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4m11 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4" /></svg>}
        actions={has('admin', 'stock') && (
          <Link to="/purchase-orders/new" className="btn-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New PO
          </Link>
        )}
      />
      <div className="page page-w">
        <Table
          {...list.tableProps}
          caption="Purchase orders with totals, payments and balances"
          empty="No purchase orders yet"
          columns={[
            { key: 'number', label: 'Number', priority: 'primary', render: (p) => <Link to={`/purchase-orders/${p._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{p.number}</Link> },
            { key: 'orderedAt', label: 'Ordered', render: (p) => <span className="text-ink-500">{date(p.orderedAt)}</span> },
            {
              key: 'supplier', label: 'Supplier', priority: 'primary',
              // Sales can read this list but has no supplier access, so it gets plain text.
              render: (p) => !p.supplier?.name
                ? <span className="text-ink-300">—</span>
                : has('admin', 'stock')
                  ? <Link to={`/suppliers/${p.supplier._id}`} className="text-ink-800 hover:text-brand-700">{p.supplier.name}</Link>
                  : p.supplier.name,
            },
            { key: 'status', label: 'Status', render: (p) => <Badge tone={statusTone[p.status]} dot>{p.status}</Badge> },
            { key: 'total', label: `Total (${currency})`, className: 'text-right num font-medium text-ink-900', render: (p) => <Money value={p.total} /> },
            { key: 'paid', label: `Paid (${currency})`, className: 'text-right num text-emerald-600', render: (p) => <Money value={p.paid} /> },
            { key: 'balance', label: `Balance (${currency})`, className: 'text-right num', render: (p) => (
                <span className={p.balance > 0 ? 'text-amber-600 font-medium' : 'text-ink-400'}>{money(p.balance, currency)}</span>
              ) },
          ]}
        />
      </div>
    </div>
  );
}
