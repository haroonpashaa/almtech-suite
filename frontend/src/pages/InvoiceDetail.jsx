import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useSubmit } from '../hooks/useSubmit.js';
import { api } from '../api/client.js';
import { money, date, datetime, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import DocumentActions from '../components/DocumentActions.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, LoadingBlock, Spinner, EmptyState } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const statusTone = { paid: 'success', partial: 'warning', open: 'info', returned: 'danger', cancelled: 'neutral' };

export default function InvoiceDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [account, setAccount] = useState('');
  const [reference, setReference] = useState('');
  const [reverseTarget, setReverseTarget] = useState(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const { data: invoice, isLoading, isError, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => (await api.get(`/invoices/${id}`)).data,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const currency = useCurrency();

  async function doPay() {
    try {
      await api.post(`/invoices/${id}/payments`, { amount: Number(amount), method, reference, account });
      toast.success('Payment recorded');
      setAmount('');
      setReference('');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  // H6: guards against a double tap firing two payment POSTs.
  const { run: pay, pending: paying } = useSubmit(doPay);

  // Posts a reversing entry through the admin-only endpoint. The dialog collects the
  // mandatory reason and spells out the consequences before anything is sent.
  async function reversePayment(reason) {
    const index = reverseTarget.index;
    try {
      await api.post(`/invoices/${id}/payments/${index}/reverse`, { reason });
      toast.success('Payment reversed');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      ['accounts-summary', 'dashboard', 'receivables', 'finance-position', 'payment-history', 'deal'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  async function doReturn(reason) {
    try {
      await api.post(`/invoices/${id}/return`, { reason });
      toast.success('Invoice returned and payments refunded');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      ['accounts-summary', 'dashboard', 'receivables', 'finance-position', 'payment-history', 'deal'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  function openEditNotes() {
    setNotesDraft(invoice.notes || '');
    setEditingNotes(true);
  }

  // Notes are the only thing an invoice can be corrected on directly — anything
  // that touches money, stock or totals goes through Return, not this. See
  // updateInvoice on the backend for the full reasoning.
  async function saveNotes() {
    setSavingNotes(true);
    try {
      await api.patch(`/invoices/${id}`, { notes: notesDraft });
      toast.success('Notes updated');
      setEditingNotes(false);
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingNotes(false);
    }
  }

  if (isLoading) return <LoadingBlock />;
  if (isError || !invoice) {
    return (
      <div className="p-8">
        <EmptyState
          tone="danger"
          title="Invoice not found"
          description="This invoice may have been removed, or the link is incorrect."
          action={
            <span className="inline-flex gap-2">
              <button className="btn-secondary" onClick={() => refetch()}>Try again</button>
              <Link to="/invoices" className="btn-primary">Back to invoices</Link>
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div>
      {/* One actions prop. This element previously declared `actions` twice, so the
          second silently replaced the first and Deal history never rendered. */}
      <PageHeader
        breadcrumb={[{ label: 'Invoices', to: '/invoices' }, { label: invoice.number }]}
        title={<span className="font-mono">{invoice.number}</span>}
        subtitle={`${invoice.customer?.name} · ${date(invoice.issuedAt)}`}
        actions={
          <>
            <Badge tone={statusTone[invoice.status]} dot className="mr-1">{invoice.status}</Badge>
            <DocumentActions path={`/invoices/${id}/pdf`} filename={invoice.number} label="Invoice PDF" />
            {has('admin') && <Link to={`/deals/sales/${id}`} className="btn-secondary">Deal history</Link>}
            {has('admin') && invoice.status !== 'returned' && invoice.status !== 'cancelled' && (
              <button className="btn-danger-soft" onClick={() => setConfirmReturn(true)}>Process Return</button>
            )}
          </>
        }
      />
      <div className="page page-w grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <section>
            <h3 className="t-section mb-2">Line items</h3>
            <Table
              caption="Line items on this invoice"
              rows={invoice.items}
              rowKey={(r, i) => `${r.sku}-${i}`}
              empty="No line items"
              columns={[
                {
                  key: 'item', label: 'Item', priority: 'primary',
                  render: (it) => {
                    const specs = [it.model, it.ram, it.processor, it.storage].filter(Boolean).join(' · ');
                    return (
                      <>
                        <div className="font-medium text-ink-900">{it.name}</div>
                        <div className="t-meta font-mono">{it.sku}</div>
                        {specs && <div className="t-meta">{specs}</div>}
                        {it.serials?.length > 0 && <div className="t-meta font-mono">S/N: {it.serials.join(', ')}</div>}
                        {it.comments && <div className="text-xs text-amber-600 mt-0.5">{it.comments}</div>}
                      </>
                    );
                  },
                },
                { key: 'quantity', label: 'Qty', align: 'right', render: (it) => <span className="num">{it.quantity}</span> },
                { key: 'unitPrice', label: `Price (${currency})`, align: 'right', render: (it) => <Money value={it.unitPrice} /> },
                { key: 'discount', label: `Discount (${currency})`, align: 'right', render: (it) => <Money value={it.discount} tone="muted" /> },
                { key: 'lineTotal', label: `Total (${currency})`, align: 'right', render: (it) => <Money value={it.lineTotal} className="font-medium text-ink-900" /> },
              ]}
            />
          </section>

          <section>
            <h3 className="t-section mb-2">Payments</h3>
            <Table
              caption="Payments recorded against this invoice"
              rows={invoice.payments}
              rowKey={(r, i) => i}
              empty="No payments recorded yet"
              emptyDescription={`The full ${money(invoice.balance, currency)} is outstanding.`}
              columns={[
                { key: 'date', label: 'Date', priority: 'primary', render: (p) => <span className="text-ink-500 whitespace-nowrap">{datetime(p.date)}</span> },
                { key: 'account', label: 'Account', render: (p) => accounts?.find((a) => a._id === p.account)?.name || <span className="text-ink-300">—</span> },
                { key: 'method', label: 'Method', render: (p) => <span className="capitalize">{p.method}</span> },
                { key: 'reference', label: 'Reference', render: (p) => p.reference ? <span className="font-mono text-[12px] text-ink-500">{p.reference}</span> : <span className="text-ink-300">—</span> },
                {
                  key: 'amount', label: `Amount (${currency})`, align: 'right', priority: 'primary',
                  render: (p) => p.reversed
                    ? <Money value={p.amount} tone="muted" className="line-through" />
                    : <Money value={p.amount} tone="positive" className="font-medium" />,
                },
                {
                  key: 'action', label: '', align: 'right',
                  render: (p) => p.reversed
                    ? <span className="badge-danger" title={p.reversalReason ? `Reversed: ${p.reversalReason}` : 'Reversed'}>reversed</span>
                    : has('admin')
                      ? <button className="btn-sm btn-danger-soft" onClick={() => setReverseTarget({ index: invoice.payments.indexOf(p), payment: p })}>Reverse</button>
                      : null,
                },
              ]}
            />
          </section>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-900 mb-3">Summary</h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-ink-500">Subtotal</span><span className="num text-ink-700">{money(invoice.subtotal, currency)}</span></div>
              {invoice.discount > 0 && <div className="flex justify-between text-sm"><span className="text-ink-500">Discount</span><span className="num text-red-600">− {money(invoice.discount, currency)}</span></div>}
              {invoice.taxAmount > 0 && <div className="flex justify-between text-sm"><span className="text-ink-500">Tax ({invoice.taxRate}%)</span><span className="num text-ink-700">{money(invoice.taxAmount, currency)}</span></div>}
            </div>
            <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100">
              <span className="text-sm font-medium text-ink-900">Total</span>
              <span className="text-xl font-semibold num text-ink-900">{money(invoice.total, currency)}</span>
            </div>
            <div className="mt-3 pt-3 border-t border-ink-100 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-ink-500">Paid</span><span className="num text-emerald-600">{money(invoice.paid, currency)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-500">Balance</span><span className={`num font-medium ${invoice.balance > 0 ? 'text-amber-600' : 'text-ink-400'}`}>{money(invoice.balance, currency)}</span></div>
            </div>
          </div>

          {has('admin', 'sales') && invoice.balance > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink-900 mb-3">Record Payment</h3>
              <label htmlFor="invoicedetail-amount-24" className="label">Amount</label>
              <input id="invoicedetail-amount-24" className="input num input-money" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={money(invoice.balance, currency)} />
              <label className="label mt-3">Deposit To <span className="text-red-500">*</span></label>
              <select className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">— select account —</option>
                {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
              <label className="label mt-3">Method</label>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
              <label className="label mt-3">Reference</label>
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              <button className="btn-primary w-full mt-4" onClick={pay} disabled={!amount || !account || paying}>
                {paying ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Payment'}
              </button>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-ink-900">Notes</h3>
              {has('admin') && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={openEditNotes}>Edit</button>}
            </div>
            {invoice.notes
              ? <p className="text-sm text-ink-700 whitespace-pre-wrap">{invoice.notes}</p>
              : <p className="text-sm text-ink-300">No notes on this invoice.</p>}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!reverseTarget}
        onClose={() => setReverseTarget(null)}
        onConfirm={reversePayment}
        title="Reverse this payment?"
        description="The original payment stays on record. A matching reversing entry is posted so the money returns to the account it came from."
        consequences={reverseTarget ? [
          `${money(reverseTarget.payment.amount, currency)} leaves ${accounts?.find((a) => a._id === reverseTarget.payment.account)?.name || 'the payment account'}`,
          `Invoice ${invoice.number} paid amount decreases by ${money(reverseTarget.payment.amount, currency)}`,
          `${invoice.customer?.name || 'The customer'} will owe that amount again`,
          'The payment is marked REVERSED and cannot be reversed twice',
        ] : []}
        confirmLabel="Reverse payment"
        reasonRequired
        reasonLabel="Why is this being reversed?"
        reasonPlaceholder="e.g. Recorded against the wrong invoice"
      />

      <ConfirmDialog
        open={confirmReturn}
        onClose={() => setConfirmReturn(false)}
        onConfirm={doReturn}
        title="Return this invoice?"
        description="Returning voids the sale. Stock goes back to inventory and any money already received is refunded."
        consequences={[
          'Every item on this invoice is returned to stock',
          invoice.paid > 0
            ? `${money(invoice.paid, currency)} is refunded out of the accounts it was paid into`
            : 'No payments have been received, so nothing is refunded',
          `${invoice.customer?.name || 'The customer'} will no longer owe the outstanding balance`,
          'This cannot be undone',
        ]}
        confirmLabel="Return invoice"
        reasonRequired
        reasonLabel="Why is this invoice being returned?"
        reasonPlaceholder="e.g. Customer returned a defective unit"
      />

      <Modal open={editingNotes} onClose={() => setEditingNotes(false)} title={`Edit notes · ${invoice.number}`}>
        <div className="space-y-3">
          <p className="text-xs text-ink-500">
            Notes only — this never changes items, prices, quantities, totals or payments. A mistake in the sale
            itself is corrected through Return, not here.
          </p>
          <textarea className="input" rows={4} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Add a note about this invoice" />
          <div className="flex gap-2 pt-2">
            <button className="btn-primary" onClick={saveNotes} disabled={savingNotes}>
              {savingNotes ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save notes'}
            </button>
            <button className="btn-secondary" onClick={() => setEditingNotes(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}