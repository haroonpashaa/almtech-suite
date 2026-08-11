import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, datetime } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge, LoadingBlock } from '../components/ui.jsx';

const TYPE_LABELS = {
  customer_payment: 'Customer payment',
  sale_payment: 'Sale payment',
  other_income: 'Other income',
  transfer_in: 'Transfer in',
  expense_reversal: 'Expense reversal',
  payment_reversal: 'Payment reversal',
  expense: 'Expense',
  supplier_payment: 'Supplier payment',
  purchase_payment: 'Purchase payment',
  other_payment: 'Other payment',
  transfer_out: 'Transfer out',
};

export default function AccountLedger() {
  const { id } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['account-ledger', id, from, to, type],
    queryFn: async () => (await api.get(`/accounts/${id}/ledger`, { params: { from: from || undefined, to: to || undefined, type: type || undefined } })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  if (isLoading && !data) return <LoadingBlock />;
  if (!data) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: data.account.name }]}
        title={data.account.name}
        subtitle={`${data.account.type} account · ledger`}
        actions={<Badge tone={data.reconciled ? 'success' : 'danger'} dot>{data.reconciled ? 'reconciled' : 'balance drift'}</Badge>}
      />
      <div className="p-6 sm:p-8 space-y-4 max-w-[1300px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Opening Balance</div>
            <div className="mt-2 text-xl font-semibold num text-ink-900">{money(data.openingBalance, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Money In</div>
            <div className="mt-2 text-xl font-semibold num text-emerald-600">+ {money(data.totalIn, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Money Out</div>
            <div className="mt-2 text-xl font-semibold num text-red-600">− {money(data.totalOut, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Current Balance</div>
            <div className={`mt-2 text-xl font-semibold num ${data.currentBalance < 0 ? 'text-red-600' : 'text-ink-900'}`}>
              {money(data.currentBalance, currency)}
            </div>
            {!data.reconciled && (
              <div className="text-xs text-red-600 mt-1">Ledger derives {money(data.derivedBalance, currency)}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {(from || to || type) && (
            <button className="btn-secondary" onClick={() => { setFrom(''); setTo(''); setType(''); }}>Clear</button>
          )}
        </div>

        <Table
          loading={isLoading}
          empty="No transactions in this account yet"
          columns={[
            { key: 'date', label: 'Date', render: (e) => <span className="text-ink-500 whitespace-nowrap">{datetime(e.date)}</span> },
            { key: 'type', label: 'Type', render: (e) => <span className="text-ink-700">{TYPE_LABELS[e.type] || e.type}</span> },
            {
              key: 'party',
              label: 'Customer / Supplier',
              render: (e) => e.customer || e.supplier || <span className="text-ink-300">—</span>,
            },
            {
              key: 'ref',
              label: 'Reference',
              render: (e) =>
                e.invoice ? (
                  <Link to={`/invoices/${e.invoiceId}`} className="font-mono text-[12px] text-brand-700 hover:underline">{e.invoice}</Link>
                ) : e.purchaseOrder ? (
                  <Link to={`/purchase-orders/${e.purchaseOrderId}`} className="font-mono text-[12px] text-brand-700 hover:underline">{e.purchaseOrder}</Link>
                ) : e.reference ? (
                  <span className="font-mono text-[12px] text-ink-500">{e.reference}</span>
                ) : (
                  <span className="text-ink-300">—</span>
                ),
            },
            { key: 'user', label: 'By', render: (e) => <span className="text-ink-500">{e.user || '—'}</span> },
            {
              key: 'amount',
              label: 'Amount',
              className: 'text-right num font-medium',
              render: (e) => (
                <span className={e.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}>
                  {e.direction === 'in' ? '+' : '−'} {money(e.amount, currency)}
                </span>
              ),
            },
            { key: 'balance', label: 'Balance', className: 'text-right num text-ink-700', render: (e) => money(e.balance, currency) },
          ]}
          rows={data.entries || []}
        />
      </div>
    </div>
  );
}
