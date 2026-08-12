import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { usePagedList } from '../hooks/usePagedList.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import DocumentActions from '../components/DocumentActions.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge } from '../components/ui.jsx';

const statusTone = { converted: 'success', sent: 'info', draft: 'neutral', expired: 'danger', rejected: 'danger' };

export default function Quotations() {
  // Converting is consequential: it creates an invoice and consumes stock. It is
  // confirmed rather than fired straight from a table row — especially on a phone,
  // where the button sits under a thumb.
  const [convertTarget, setConvertTarget] = useState(null);
  const { has } = useAuth();
  const qc = useQueryClient();
  const currency = useCurrency();
  const list = usePagedList({ key: ['quotations'], path: '/quotations', limit: 50 });

  async function convert() {
    try {
      const r = await api.post(`/quotations/${convertTarget._id}/convert`);
      toast.success(`Created invoice ${r.data.invoice.number}`);
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;   // keeps the dialog open so the operator sees the failure
    }
  }

  return (
    <>
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Draft quotes and convert won deals to invoices"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /></svg>}
        actions={has('admin', 'sales') && (
          <Link to="/quotations/new" className="btn-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Quotation
          </Link>
        )}
      />
      <div className="page page-w">
        <Table
          {...list.tableProps}
          caption="Quotations and their conversion status"
          empty="No quotations yet"
          columns={[
            { key: 'number', label: 'Number', priority: 'primary', render: (q) => <span className="font-mono text-[13px] text-ink-700">{q.number}</span> },
            { key: 'issuedAt', label: 'Date', render: (q) => <span className="text-ink-500">{date(q.issuedAt)}</span> },
            { key: 'customer', label: 'Customer', priority: 'primary', render: (q) => q.customer?.name || <span className="text-ink-300">—</span> },
            { key: 'status', label: 'Status', render: (q) => <Badge tone={statusTone[q.status]} dot>{q.status}</Badge> },
            { key: 'total', label: `Total (${currency})`, className: 'text-right num font-medium text-ink-900', render: (q) => <Money value={q.total} /> },
            { key: 'pdf', label: '', className: 'text-right', render: (q) => (
                <DocumentActions path={`/quotations/${q._id}/pdf`} filename={q.number} label="PDF" size="btn-sm" />
              ) },
            { key: 'actions', label: '', className: 'text-right', render: (q) =>
                has('admin', 'sales') && q.status !== 'converted' ? (
                  <button className="btn-secondary" onClick={() => setConvertTarget(q)}>
                    Convert to Invoice
                  </button>
                ) : q.status === 'converted' ? <span className="text-xs text-emerald-600 font-medium">Converted</span> : null },
          ]}
        />
      </div>
    </div>

      <ConfirmDialog
        open={!!convertTarget}
        onClose={() => setConvertTarget(null)}
        onConfirm={convert}
        title="Convert this quotation to an invoice?"
        confirmLabel="Create invoice"
        consequences={[
          `Quotation ${convertTarget?.number || ''} will be marked as converted`,
          'A new invoice will be created for the same line items',
          'Stock will be reduced for every item on the quotation',
          'This cannot be undone from here — the invoice would have to be returned',
        ]}
      />
    </>
  );
}