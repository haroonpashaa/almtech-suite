import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date as fmtDate, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Spinner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  date: today(),
  category: '',
  amount: '',
  account: '',
  description: '',
  notes: '',
  reference: '',
});

export default function Expenses() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');
  const [status, setStatus] = useState('posted');

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', from, to, category, account, status],
    queryFn: async () =>
      (await api.get('/expenses', {
        params: {
          from: from || undefined,
          to: to || undefined,
          category: category || undefined,
          account: account || undefined,
          status,
        },
      })).data,
  });
  // Accounts and categories both come from the server — nothing is hardcoded here,
  // so a newly created account appears in this dropdown automatically.
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => (await api.get('/expenses/categories')).data,
  });
  const currency = useCurrency();

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function refresh() {
    qc.invalidateQueries({ queryKey: ['expenses'] });
    qc.invalidateQueries({ queryKey: ['accounts-summary'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['account-ledger'] });
    qc.invalidateQueries({ queryKey: ['payment-history'] });
  }

  async function save() {
    setSaving(true);
    try {
      await api.post('/expenses', { ...form, amount: Number(form.amount) });
      toast.success('Expense recorded');
      setForm(emptyForm());
      setShowAdd(false);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function voidExpense() {
    setVoiding(true);
    try {
      await api.post(`/expenses/${detail._id}/void`, { reason: voidReason || undefined });
      toast.success('Expense voided and reversed');
      setDetail(null);
      setVoidReason('');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setVoiding(false);
    }
  }

  const canSave = form.category && form.account && Number(form.amount) > 0 && form.date;
  const filtered = from || to || category || account || status !== 'posted';

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Business expenses, paid from your financial accounts"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h4" /></svg>}
        actions={
          <button className="btn-primary" onClick={() => { setForm(emptyForm()); setShowAdd(true); }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Add Expense
          </button>
        }
      />
      <div className="page page-w space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="expenses-from-11" className="label">From</label>
            <input id="expenses-from-11" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="expenses-to-12" className="label">To</label>
            <input id="expenses-to-12" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label htmlFor="expenses-category-13" className="label">Category</label>
            <select id="expenses-category-13" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {(categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="expenses-account-14" className="label">Account</label>
            <select id="expenses-account-14" className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="expenses-status-15" className="label">Status</label>
            <select id="expenses-status-15" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="posted">Posted</option>
              <option value="voided">Voided</option>
              <option value="all">All</option>
            </select>
          </div>
          {filtered && (
            <button className="btn-secondary" onClick={() => { setFrom(''); setTo(''); setCategory(''); setAccount(''); setStatus('posted'); }}>
              Clear
            </button>
          )}
          <div className="ml-auto text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Filtered Total</div>
            <div className="text-2xl font-semibold num text-ink-900 tracking-tight">{money(data?.total || 0, currency)}</div>
            <div className="text-xs text-ink-400">{data?.count ?? 0} expense{data?.count === 1 ? '' : 's'}</div>
          </div>
        </div>

        {/* Category breakdown for the current filter */}
        {(data?.byCategory?.length || 0) > 0 && (
          <div className="card p-4">
            <div className="section-title mb-3">Category breakdown</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {data.byCategory.map((c) => (
                <div key={c.category} className="flex items-baseline justify-between gap-2 border-b border-ink-100 pb-1.5">
                  <span className="text-sm text-ink-600 truncate">{c.category}</span>
                  <span className="num text-sm font-medium text-ink-900 whitespace-nowrap">{money(c.total, currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Table
          loading={isLoading}
          empty="No expenses match these filters"
          onRowClick={(e) => setDetail(e)}
          columns={[
            { key: 'date', label: 'Date', render: (e) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(e.date)}</span> },
            { key: 'category', label: 'Category', render: (e) => <span className="font-medium text-ink-900">{e.category}</span> },
            { key: 'description', label: 'Description', render: (e) => e.description || <span className="text-ink-300">—</span> },
            { key: 'account', label: 'Account', render: (e) => e.account?.name || <span className="text-ink-300">—</span> },
            { key: 'reference', label: 'Reference', render: (e) => e.reference ? <span className="font-mono text-[12px] text-ink-500">{e.reference}</span> : <span className="text-ink-300">—</span> },
            { key: 'status', label: '', render: (e) => (e.status === 'voided' ? <Badge tone="danger" dot>voided</Badge> : null) },
            {
              key: 'amount',
              label: `Amount (${currency})`,
              className: 'text-right num font-medium',
              render: (e) => (
                <span className={e.status === 'voided' ? 'text-ink-300 line-through' : 'text-red-600'}>
                  {money(e.amount, currency)}
                </span>
              ),
            },
          ]}
          rows={data?.items || []}
        />
      </div>

      {/* Add expense */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Expense" subtitle="Money leaves the selected account immediately">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="expenses-date-16" className="label">Date <span className="text-red-500">*</span></label>
              <input id="expenses-date-16" className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </div>
            <div>
              <label htmlFor="expenses-amount-17" className="label">Amount <span className="text-red-500">*</span></label>
              <input id="expenses-amount-17" className="input num" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="expenses-category-18" className="label">Category <span className="text-red-500">*</span></label>
              <select id="expenses-category-18" className="select" value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">— select category —</option>
                {(categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="expenses-payment-account-19" className="label">Payment Account <span className="text-red-500">*</span></label>
              <select id="expenses-payment-account-19" className="select" value={form.account} onChange={(e) => set('account', e.target.value)}>
                <option value="">— select account —</option>
                {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="expenses-description-20" className="label">Description</label>
            <input id="expenses-description-20" className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Monthly electricity bill" />
          </div>
          <div>
            <label htmlFor="expenses-reference-21" className="label">Reference</label>
            <input id="expenses-reference-21" className="input font-mono" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Bill / receipt / voucher number (optional)" />
          </div>
          <div>
            <label htmlFor="expenses-notes-22" className="label">Notes</label>
            <textarea id="expenses-notes-22" className="input" rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex gap-2 pt-2">
            <button className="btn-primary" onClick={save} disabled={saving || !canSave}>
              {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Record expense'}
            </button>
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Detail / void */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.category} · ${money(detail.amount, currency)}` : ''} size="md">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="section-title">Date</div><div className="mt-1 text-ink-800">{fmtDate(detail.date)}</div></div>
              <div><div className="section-title">Account</div><div className="mt-1 text-ink-800">{detail.account?.name || '—'}</div></div>
              <div><div className="section-title">Reference</div><div className="mt-1 text-ink-800 font-mono text-[12px]">{detail.reference || '—'}</div></div>
              <div><div className="section-title">Recorded by</div><div className="mt-1 text-ink-800">{detail.createdBy?.name || '—'}</div></div>
            </div>
            <div><div className="section-title">Description</div><div className="mt-1 text-ink-800">{detail.description || '—'}</div></div>
            {detail.notes && <div><div className="section-title">Notes</div><div className="mt-1 text-ink-800 whitespace-pre-wrap">{detail.notes}</div></div>}

            {detail.status === 'voided' ? (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                <div className="flex items-center gap-2 text-red-700 font-medium">
                  <Badge tone="danger" dot>voided</Badge>
                </div>
                <p className="text-xs text-red-700 mt-1.5">
                  A reversing entry returned {money(detail.amount, currency)} to {detail.account?.name}.
                  {detail.voidReason ? ` Reason: ${detail.voidReason}` : ''}
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-ink-25 border border-ink-100 p-3">
                <p className="text-xs text-ink-500">
                  Amount, account and date cannot be edited once posted — the money has already left the account.
                  {has('admin')
                    ? ' Void this expense and record a corrected one instead.'
                    : ' Ask an administrator to void it if it was recorded in error.'}
                </p>
                {/* Voiding is not an edit: it posts a reversing entry that moves money
                    back into the account. That stays an administrator's decision. */}
                {has('admin') && (
                  <>
                    <label className="label mt-3">Void reason</label>
                    <input className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Optional" />
                    <button className="btn-secondary w-full mt-3 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirmVoid(true)} disabled={voiding}>
                      {voiding ? <><Spinner className="w-4 h-4" /> Voiding…</> : 'Void & reverse this expense'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        onConfirm={async (reason) => { setVoidReason(reason); await voidExpense(); }}
        title="Void this expense?"
        description="Nothing is deleted. The expense stays on record marked voided, and a reversing entry puts the money back."
        consequences={detail ? [
          `${money(detail.amount, currency)} returns to ${detail.account?.name || 'the paying account'}`,
          `The ${detail.category} expense is marked VOIDED and drops out of expense totals and P&L`,
          'Both the original and the reversing entry remain in the account ledger',
          'A voided expense cannot be edited or voided again',
        ] : []}
        confirmLabel="Void & reverse"
        reasonRequired
        reasonLabel="Why is this being voided?"
        reasonPlaceholder="e.g. Duplicate entry"
      />

    </div>
  );
}