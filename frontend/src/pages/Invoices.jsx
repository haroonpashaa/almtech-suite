import { useState } from 'react';
import { Link } from 'react-router-dom';
import { money, date } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { usePagedList } from '../hooks/usePagedList.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge } from '../components/ui.jsx';

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'partial', label: 'Partial' },
  // A status filter, not a money column — it carries no currency, and `currency`
  // is not in scope here. Referencing it threw a ReferenceError the moment this
  // module was imported, which took the whole application down with it.
  { value: 'paid', label: 'Paid' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusTone = { paid: 'success', partial: 'warning', open: 'info', returned: 'danger', cancelled: 'neutral' };

export default function Invoices() {
  const [status, setStatus] = useState('');
  const currency = useCurrency();
  // Paged rather than capped: with 523 invoices the old call returned the newest
  // 500 and made the remaining 23 — including one carrying 210,000 outstanding —
  // unreachable from this screen.
  const list = usePagedList({
    key: ['invoices', status],
    path: '/invoices',
    params: { status: status || undefined },
    limit: 50,
  });

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Sales invoices, payments, and balances"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h4" /></svg>}
        actions={<Link to="/pos" className="btn-primary">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          New Sale
        </Link>}
      />
      <div className="page page-w">
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
          <span className="text-sm text-ink-400 ml-auto num">
            {list.total ?? 0} invoice{list.total === 1 ? '' : 's'}
          </span>
        </div>
        <Table
          {...list.tableProps}
          caption="Sales invoices with totals, payments and balances"
          empty={status ? 'No invoices with this status' : 'No invoices yet'}
          emptyDescription={status ? 'Try a different status filter.' : 'Invoices appear here once you make a sale.'}
          columns={[
            { key: 'number', label: 'Number', priority: 'primary', render: (i) => (
                <Link to={`/invoices/${i._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{i.number}</Link>
              ) },
            { key: 'issuedAt', label: 'Date', render: (i) => <span className="text-ink-500">{date(i.issuedAt)}</span> },
            { key: 'customer', label: 'Customer', priority: 'primary', render: (i) => i.customer?.name || <span className="text-ink-300">—</span> },
            { key: 'status', label: 'Status', render: (i) => <Badge tone={statusTone[i.status]} dot>{i.status}</Badge> },
            { key: 'total', label: `Total (${currency})`, className: 'text-right num font-medium text-ink-900', render: (i) => <Money value={i.total} /> },
            { key: 'paid', label: `Paid (${currency})`, className: 'text-right num text-emerald-600', render: (i) => <Money value={i.paid} /> },
            { key: 'balance', label: `Balance (${currency})`, className: 'text-right num', render: (i) => (
                <span className={i.balance > 0 ? 'text-amber-600 font-medium' : 'text-ink-400'}>{money(i.balance, currency)}</span>
              ) },
          ]}
        />
      </div>
    </div>
  );
}
