import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

const STATUSES = ['', 'open', 'partial', 'paid', 'returned', 'cancelled'];

const tone = {
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  open: 'bg-slate-100 text-slate-700',
  returned: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-500',
};

export default function Invoices() {
  const [status, setStatus] = useState('');
  const { data } = useQuery({
    queryKey: ['invoices', status],
    queryFn: async () => (await api.get('/invoices', { params: { status } })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  return (
    <div>
      <PageHeader
        title="Invoices"
        actions={<Link to="/pos" className="btn-primary">+ New Sale</Link>}
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4 items-center">
          <select className="input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s ? s.toUpperCase() : 'All statuses'}</option>
            ))}
          </select>
          <span className="text-sm text-slate-500 ml-auto">{data?.length || 0} invoices</span>
        </div>
        <Table
          columns={[
            { key: 'number', label: 'Number', render: (i) => (
                <Link to={`/invoices/${i._id}`} className="text-brand-600 hover:underline font-medium">
                  {i.number}
                </Link>
              ) },
            { key: 'issuedAt', label: 'Date', render: (i) => date(i.issuedAt) },
            { key: 'customer', label: 'Customer', render: (i) => i.customer?.name || '—' },
            { key: 'status', label: 'Status', render: (i) => (
                <span className={`badge ${tone[i.status] || 'bg-slate-100'}`}>{i.status}</span>
              ) },
            { key: 'total', label: 'Total', className: 'text-right', render: (i) => money(i.total, currency) },
            { key: 'paid', label: 'Paid', className: 'text-right', render: (i) => money(i.paid, currency) },
            { key: 'balance', label: 'Balance', className: 'text-right', render: (i) => (
                <span className={i.balance > 0 ? 'text-amber-600 font-medium' : ''}>{money(i.balance, currency)}</span>
              ) },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
