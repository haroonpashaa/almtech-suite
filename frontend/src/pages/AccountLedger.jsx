import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, datetime, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import DocumentActions from '../components/DocumentActions.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, LoadingBlock, Spinner, EmptyState } from '../components/ui.jsx';

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
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // `page: 0` means "the newest page" — resolved below once the total is known.
  // A ledger that silently showed the OLDEST 500 rows while presenting them
  // newest-first was the defect this page is paged to fix.
  const [page, setPage] = useState(0);
  const { data, isLoading, isError, refetch } = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['account-ledger', id, from, to, type, page],
    queryFn: async () => {
      const params = { from: from || undefined, to: to || undefined, type: type || undefined, limit: 200 };
      const first = (await api.get(`/accounts/${id}/ledger`, { params: { ...params, page: 1 } })).data;
      // Land on the most recent activity by default rather than the start of history.
      if (page === 0 && first.totalPages > 1) {
        return (await api.get(`/accounts/${id}/ledger`, { params: { ...params, page: first.totalPages } })).data;
      }
      if (page === 0 || page === 1) return first;
      return (await api.get(`/accounts/${id}/ledger`, { params: { ...params, page } })).data;
    },
  });
  const currency = useCurrency();

  function openEdit() {
    setForm({
      name: data.account.name,
      type: data.account.type,
      bankName: data.account.bankName || '',
      accountNumber: data.account.accountNumber || '',
      accountTitle: data.account.accountTitle || '',
      openingBalance: String(data.account.openingBalance ?? 0),
      active: data.account.active,
      notes: data.account.notes || '',
    });
    setEditing(true);
  }

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // currentBalance is never sent — the backend shifts it by the opening-balance
  // delta itself, exactly like the payable/opening-balance adjustment mechanism.
  async function saveEdit() {
    setSaving(true);
    try {
      await api.patch(`/accounts/${id}`, {
        ...form,
        openingBalance: Number(form.openingBalance) || 0,
      });
      toast.success('Account updated');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['account-ledger', id] });
      qc.invalidateQueries({ queryKey: ['accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading && !data) return <LoadingBlock />;
  if (isError || !data) {
    return (
      <div className="p-8">
        <EmptyState
          tone="danger"
          title="Account not found"
          description="This account's ledger could not be loaded, or the link is incorrect."
          action={
            <span className="inline-flex gap-2">
              <button className="btn-secondary" onClick={() => refetch()}>Try again</button>
              <Link to="/accounts" className="btn-primary">Back to accounts</Link>
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Accounts', to: '/accounts' }, { label: data.account.name }]}
        title={data.account.name}
        subtitle={`${data.account.type} account · ledger`}
        actions={
          <>
            <Badge tone={data.reconciled ? 'success' : 'danger'} dot>{data.reconciled ? 'reconciled' : 'balance drift'}</Badge>
            <button className="btn-secondary" onClick={openEdit}>Edit</button>
            <DocumentActions path={`/accounts/${id}/statement/pdf`} filename={`statement-${data.account?.name || 'account'}`} label="Statement" />
          </>
        }
      />
      <div className="page page-w space-y-4">
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Opening Balance</div>
            <div className="mt-2 fig-md font-semibold num break-words text-ink-900">{money(data.openingBalance, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Money In</div>
            <div className="mt-2 fig-md font-semibold num break-words text-emerald-600">+ {money(data.totalIn, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Money Out</div>
            <div className="mt-2 fig-md font-semibold num break-words text-red-600">− {money(data.totalOut, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Current Balance</div>
            <div className={`mt-2 fig-md font-semibold num break-words ${data.currentBalance < 0 ? 'text-red-600' : 'text-ink-900'}`}>
              {money(data.currentBalance, currency)}
            </div>
            {!data.reconciled && (
              <div className="text-xs text-red-600 mt-1">Ledger derives {money(data.derivedBalance, currency)}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="accountledger-from-1" className="label">From</label>
            <input id="accountledger-from-1" className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
          </div>
          <div>
            <label htmlFor="accountledger-to-2" className="label">To</label>
            <input id="accountledger-to-2" className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </div>
          <div>
            <label htmlFor="accountledger-type-3" className="label">Type</label>
            <select id="accountledger-type-3" className="select" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
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
              label: `Amount (${currency})`,
              className: 'text-right num font-medium',
              render: (e) => (
                <span className={e.direction === 'in' ? 'text-emerald-600' : 'text-red-600'}>
                  {e.direction === 'in' ? '+' : '−'} {money(e.amount, currency)}
                </span>
              ),
            },
            { key: 'balance', label: `Balance (${currency})`, className: 'text-right num text-ink-700', render: (e) => <Money value={e.balance} /> },
          ]}
          rows={data.entries || []}
          page={data.page}
          limit={data.limit}
          total={data.totalEntries}
          onPageChange={setPage}
        />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${data.account.name}`}>
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="accountledger-edit-name" className="label">Name <span className="text-red-500">*</span></label>
              <input id="accountledger-edit-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="accountledger-edit-type" className="label">Type</label>
                <select id="accountledger-edit-type" className="select" value={form.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="wallet">Wallet</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="accountledger-edit-opening" className="label">Opening Balance</label>
                <input id="accountledger-edit-opening" className="input num input-money" type="number" step="0.01" value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} />
                <p className="text-xs text-ink-400 mt-1">Current balance shifts by the same amount — ledger history is untouched.</p>
              </div>
            </div>
            {form.type !== 'cash' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="accountledger-edit-bank" className="label">Bank Name</label>
                  <input id="accountledger-edit-bank" className="input" value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="accountledger-edit-number" className="label">Account Number</label>
                  <input id="accountledger-edit-number" className="input font-mono" value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="accountledger-edit-title" className="label">Account Title</label>
              <input id="accountledger-edit-title" className="input" value={form.accountTitle} onChange={(e) => set('accountTitle', e.target.value)} />
            </div>
            <div>
              <label htmlFor="accountledger-edit-notes" className="label">Notes</label>
              <textarea id="accountledger-edit-notes" className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active
            </label>
            <div className="flex gap-2 pt-2">
              <button className="btn-primary" onClick={saveEdit} disabled={saving || !form.name.trim()}>
                {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save changes'}
              </button>
              <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
