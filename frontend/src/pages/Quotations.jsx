import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

export default function Quotations() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['quotations'],
    queryFn: async () => (await api.get('/quotations')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  async function convert(id) {
    if (!confirm('Convert this quotation to an invoice? Stock will be deducted.')) return;
    try {
      const r = await api.post(`/quotations/${id}/convert`);
      toast.success(`Created invoice ${r.data.invoice.number}`);
      qc.invalidateQueries({ queryKey: ['quotations'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        actions={has('admin', 'sales') && <Link to="/quotations/new" className="btn-primary">+ New Quotation</Link>}
      />
      <div className="p-6">
        <Table
          columns={[
            { key: 'number', label: 'Number' },
            { key: 'issuedAt', label: 'Date', render: (q) => date(q.issuedAt) },
            { key: 'customer', label: 'Customer', render: (q) => q.customer?.name || '—' },
            { key: 'status', label: 'Status', render: (q) => <span className="badge bg-slate-100 capitalize">{q.status}</span> },
            { key: 'total', label: 'Total', className: 'text-right', render: (q) => money(q.total, currency) },
            { key: 'actions', label: '', className: 'text-right', render: (q) =>
                has('admin', 'sales') && q.status !== 'converted' ? (
                  <button className="text-brand-600 hover:underline text-sm" onClick={() => convert(q._id)}>
                    Convert to Invoice
                  </button>
                ) : null },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
