import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge } from '../components/ui.jsx';

const statusTone = { converted: 'success', sent: 'info', draft: 'neutral', expired: 'danger', rejected: 'danger' };

export default function Quotations() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
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
        subtitle="Draft quotes and convert won deals to invoices"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /></svg>}
        actions={has('admin', 'sales') && (
          <Link to="/quotations/new" className="btn-primary-gradient">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Quotation
          </Link>
        )}
      />
      <div className="p-6 sm:p-8">
        <Table
          loading={isLoading}
          empty="No quotations yet"
          columns={[
            { key: 'number', label: 'Number', render: (q) => <span className="font-mono text-[13px] text-ink-700">{q.number}</span> },
            { key: 'issuedAt', label: 'Date', render: (q) => <span className="text-ink-500">{date(q.issuedAt)}</span> },
            { key: 'customer', label: 'Customer', render: (q) => q.customer?.name || <span className="text-ink-300">—</span> },
            { key: 'status', label: 'Status', render: (q) => <Badge tone={statusTone[q.status]} dot>{q.status}</Badge> },
            { key: 'total', label: 'Total', className: 'text-right num font-medium text-ink-900', render: (q) => money(q.total, currency) },
            { key: 'actions', label: '', className: 'text-right', render: (q) =>
                has('admin', 'sales') && q.status !== 'converted' ? (
                  <button className="btn-secondary btn-sm" onClick={() => convert(q._id)}>
                    Convert to Invoice
                  </button>
                ) : q.status === 'converted' ? <span className="text-xs text-emerald-600 font-medium">Converted</span> : null },
          ]}
          rows={data || []}
        />
      </div>
    </div>
  );
}
