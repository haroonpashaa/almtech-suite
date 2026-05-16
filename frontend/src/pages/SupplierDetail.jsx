import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

export default function SupplierDetail() {
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ['supplier-ledger', id],
    queryFn: async () => (await api.get(`/suppliers/${id}/ledger`)).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';
  if (!data) return <div className="p-6 text-slate-500">Loading…</div>;
  const { supplier, entries, payable } = data;
  return (
    <div>
      <PageHeader title={supplier.name} subtitle={supplier.contactPerson} />
      <div className="p-6 space-y-6">
        <div className="card p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-500 uppercase">Phone</div>
            <div>{supplier.phone || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Email</div>
            <div>{supplier.email || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Tax Number</div>
            <div>{supplier.taxNumber || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Payable</div>
            <div className={payable > 0 ? 'text-amber-600 font-semibold' : ''}>{money(payable, currency)}</div>
          </div>
        </div>
        <div>
          <div className="font-semibold text-slate-800 mb-3">Ledger</div>
          <Table
            columns={[
              { key: 'date', label: 'Date', render: (e) => date(e.date) },
              { key: 'type', label: 'Type', render: (e) => <span className="capitalize">{e.type}</span> },
              { key: 'reference', label: 'Reference' },
              { key: 'credit', label: 'Purchase', className: 'text-right', render: (e) => (e.credit ? money(e.credit, currency) : '—') },
              { key: 'debit', label: 'Payment', className: 'text-right', render: (e) => (e.debit ? money(e.debit, currency) : '—') },
              { key: 'balance', label: 'Balance', className: 'text-right', render: (e) => money(e.balance, currency) },
            ]}
            rows={entries}
            empty="No ledger entries"
          />
        </div>
      </div>
    </div>
  );
}
