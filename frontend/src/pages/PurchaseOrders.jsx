import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge } from '../components/ui.jsx';
import { toggleVisibleSelection } from '../lib/selection.js';

const statusTone = { received: 'success', partial: 'warning', ordered: 'info', cancelled: 'neutral' };

export default function PurchaseOrders() {
  const { has } = useAuth();
  const canManage = has('admin', 'stock');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [supplier, setSupplier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState([]);
  const filters = useMemo(() => ({ search: search.trim() || undefined, status: status || undefined, supplier: supplier || undefined, from: from || undefined, to: to || undefined }), [search, status, supplier, from, to]);
  const list = usePagedList({ key: ['purchase-orders'], path: '/purchase-orders', params: filters, limit: 50 });
  const suppliers = useQuery({ queryKey: ['suppliers', 'purchase-order-filter'], enabled: canManage, queryFn: async () => (await api.get('/suppliers')).data });
  const visibleIds = list.rows.map((po) => po._id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectionDisabled = list.isFetching || visibleIds.length === 0;
  useEffect(() => { setSelected([]); }, [filters, list.page]);
  const toggleVisible = () => setSelected((current) => toggleVisibleSelection(current, visibleIds));
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
        <div className="card mb-4 p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-ink-500">PO number<input className="input mt-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number" /></label>
          <label className="text-xs text-ink-500">Status<select className="select mt-1" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="ordered">Ordered</option><option value="partial">Partial</option><option value="received">Received</option><option value="cancelled">Cancelled</option></select></label>
          {canManage && <label className="text-xs text-ink-500">Supplier<select className="select mt-1" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">All suppliers</option>{(suppliers.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label>}
          <label className="text-xs text-ink-500">Ordered from<input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs text-ink-500">Ordered to<input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {canManage && <div className="flex items-center gap-3 mb-2 text-sm"><button type="button" className="btn-secondary" disabled={selectionDisabled} onClick={toggleVisible}>{allVisibleSelected ? 'Deselect All' : 'Select All on this page'}</button><span className="text-ink-500">{selected.length} selected on the current filtered page</span></div>}
        <Table
          {...list.tableProps}
          caption="Purchase orders with totals, payments and balances"
          empty="No purchase orders yet"
          columns={[
            ...(canManage ? [{ key: 'select', label: <input type="checkbox" aria-label="Select all purchase orders on this page" checked={allVisibleSelected} onChange={toggleVisible} disabled={selectionDisabled} />, render: (p) => <input type="checkbox" aria-label={`Select ${p.number}`} checked={selected.includes(p._id)} disabled={selectionDisabled} onChange={() => setSelected((current) => current.includes(p._id) ? current.filter((id) => id !== p._id) : [...current, p._id])} onClick={(e) => e.stopPropagation()} /> }] : []),
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
            { key: 'currency', label: 'Currency', render: (p) => p.currency || 'PKR' },
            { key: 'total', label: 'Total', className: 'text-right num font-medium text-ink-900', render: (p) => <Money value={p.total} currency={p.currency || 'PKR'} showCurrency /> },
            { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (p) => <Money value={p.paid} currency={p.currency || 'PKR'} showCurrency /> },
            { key: 'balance', label: 'Balance', className: 'text-right num', render: (p) => (
                <span className={p.balance > 0 ? 'text-amber-600 font-medium' : 'text-ink-400'}>{money(p.balance, p.currency || 'PKR')}</span>
              ) },
          ]}
        />
      </div>
    </div>
  );
}
