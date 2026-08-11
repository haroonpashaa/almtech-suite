import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge } from '../components/ui.jsx';

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusTone = { paid: 'success', partial: 'warning', open: 'info', returned: 'danger', cancelled: 'neutral' };

export default function Invoices() {
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({
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
        subtitle="Sales invoices, payments, and balances"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h4" /></svg>}
        actions={<Link to="/pos" className="btn-primary-gradient">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          New Sale
        </Link>}
      />
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <div className="segment">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={`segment-item ${status === s.value ? 'segment-item-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-ink-400 ml-auto">{data?.length || 0} invoices</span>
        </div>
        <Table
          loading={isLoading}
          empty="No invoices yet"
          onRowClick={undefined}
          columns={[
            { key: 'number', label: 'Number', render: (i) => (
                <Link to={`/invoices/${i._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{i.number}</Link>
              ) },
            { key: 'issuedAt', label: 'Date', render: (i) => <span className="text-ink-500">{date(i.issuedAt)}</span> },
            { key: 'customer', label: 'Customer', render: (i) => i.customer?.name || <span className="text-ink-300">—</span> },
            { key: 'status', label: 'Status', render: (i) => <Badge tone={statusTone[i.status]} dot>{i.status}</Badge> },
            { key: 'total', label: 'Total', className: 'text-right num font-medium text-ink-900', render: (i) => money(i.total, currency) },
            { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (i) => money(i.paid, currency) },
            { key: 'balance', label: 'Balance', className: 'text-right num', render: (i) => (
                <span className={i.balance > 0 ? 'text-amber-600 font-medium' : 'text-ink-400'}>{money(i.balance, currency)}</span>
              ) },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
