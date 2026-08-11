import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge, LoadingBlock } from '../components/ui.jsx';

function Field({ label, value, className = '' }) {
  return (
    <div>
      <div className="section-title">{label}</div>
      <div className={`mt-1 text-sm text-ink-800 ${className}`}>{value || '—'}</div>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ['customer-ledger', id],
    queryFn: async () => (await api.get(`/customers/${id}/ledger`)).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  if (!data) return <LoadingBlock />;
  const { customer, entries, balance } = data;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Customers', to: '/customers' }, { label: customer.name }]}
        title={customer.name}
        subtitle={customer.company || customer.phone || customer.email}
        actions={<Badge tone={balance > 0 ? 'warning' : 'success'} dot>{balance > 0 ? 'Outstanding' : 'Settled'}</Badge>}
      />
      <div className="p-6 sm:p-8 space-y-6 max-w-[1200px]">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3 card p-5 grid grid-cols-2 md:grid-cols-3 gap-5">
            <Field label="Phone" value={customer.phone} />
            <Field label="Email" value={customer.email} />
            <Field label="Address" value={customer.address} />
            <Field label="CNIC / NTN" value={customer.cnicNtn} />
            <Field label="Credit Limit" value={money(customer.creditLimit, currency)} className="num" />
            <Field label="Notes" value={customer.notes} />
          </div>
          <div className="card p-5 bg-brand-gradient-br text-white relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Outstanding Balance</div>
              <div className="mt-2 text-3xl font-semibold num tracking-tight">{money(balance, currency)}</div>
              <div className="mt-1 text-xs text-white/70">{balance > 0 ? 'Owed by this customer' : 'No outstanding balance'}</div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-900 mb-3">Ledger</h3>
          <Table
            columns={[
              { key: 'date', label: 'Date', render: (e) => <span className="text-ink-500 whitespace-nowrap">{date(e.date)}</span> },
              { key: 'type', label: 'Type', render: (e) => <span className="capitalize text-ink-700">{e.type}</span> },
              { key: 'reference', label: 'Reference', render: (e) => <span className="font-mono text-[12px] text-ink-500">{e.reference || '—'}</span> },
              { key: 'debit', label: 'Debit', className: 'text-right num', render: (e) => (e.debit ? money(e.debit, currency) : <span className="text-ink-300">—</span>) },
              { key: 'credit', label: 'Credit', className: 'text-right num text-emerald-600', render: (e) => (e.credit ? money(e.credit, currency) : <span className="text-ink-300">—</span>) },
              { key: 'balance', label: 'Balance', className: 'text-right num font-medium text-ink-900', render: (e) => money(e.balance, currency) },
            ]}
            rows={entries}
            empty="No ledger entries"
          />
        </div>
      </div>
    </div>
  );
}
