import { useState } from 'react';
import { useSubmit } from '../hooks/useSubmit.js';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, datetime, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import DocumentActions from '../components/DocumentActions.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import { Badge, LoadingBlock, Spinner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const statusTone = { received: 'success', partial: 'warning', ordered: 'info', cancelled: 'neutral' };

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const [receipts, setReceipts] = useState({});
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank');
  const [account, setAccount] = useState('');
  const [reference, setReference] = useState('');
  const [paying, setPaying] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);

  const { data: po } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => (await api.get(`/purchase-orders/${id}`)).data,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const currency = useCurrency();

  async function doReceive() {
    const list = Object.entries(receipts)
      .map(([product, quantity]) => ({ product, quantity: Number(quantity) }))
      .filter((r) => r.quantity > 0);
    if (!list.length) return toast.error('Enter quantities to receive');
    try {
      await api.post(`/purchase-orders/${id}/receive`, { receipts: list });
      toast.success('Stock received');
      setReceipts({});
      qc.invalidateQueries({ queryKey: ['po', id] });
      qc.invalidateQueries({ queryKey: ['accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function pay() {
    setPaying(true);
    try {
      await api.post(`/purchase-orders/${id}/payments`, { amount: Number(amount), method, reference, account });
      toast.success('Payment recorded');
      setAmount('');
      setReference('');
      qc.invalidateQueries({ queryKey: ['po', id] });
      qc.invalidateQueries({ queryKey: ['accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPaying(false);
    }
  }

  async function reversePayment(reason) {
    const index = reverseTarget.index;
    try {
      await api.post(`/purchase-orders/${id}/payments/${index}/reverse`, { reason });
      toast.success('Payment reversed');
      qc.invalidateQueries({ queryKey: ['po', id] });
      ['accounts-summary', 'dashboard', 'payables', 'finance-position', 'payment-history', 'deal'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  }

  // Stock movement: the control is latched for the duration of the request.
  const { run: receive, pending: receiving } = useSubmit(doReceive);

  if (!po) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Purchase Orders', to: '/purchase-orders' }, { label: po.number }]}
        title={<span className="font-mono">{po.number}</span>}
        subtitle={
          <>
            {has('admin', 'stock') && po.supplier?._id ? (
              <Link to={`/suppliers/${po.supplier._id}`} className="text-ink-700 hover:text-brand-700 font-medium">{po.supplier.name}</Link>
            ) : (
              po.supplier?.name
            )}
            {` · ordered ${date(po.orderedAt)}`}
          </>
        }
        actions={
          <>
            <Badge tone={statusTone[po.status]} dot>{po.status}</Badge>
            <DocumentActions path={`/purchase-orders/${id}/pdf`} filename={po.number} label="PO PDF" />
            {has('admin') && <Link to={`/deals/purchases/${id}`} className="btn-secondary">Deal history</Link>}
          </>
        }
      />
      <div className="page page-w grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 bg-ink-25"><h3 className="text-sm font-semibold text-ink-900">Items</h3></div>
            <table className="hidden sm:table min-w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="th">Item</th>
                  <th scope="col" className="th text-right">Ordered</th>
                  <th scope="col" className="th text-right">Received</th>
                  <th scope="col" className="th text-right">Receive Now</th>
                  <th scope="col" className="th text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it, i) => {
                  const pending = it.quantity - it.received;
                  return (
                    <tr key={i} className="tr">
                      <td className="td">
                        <div className="font-medium text-ink-900">{it.name}</div>
                        <div className="t-meta font-mono">{it.sku}</div>
                      </td>
                      <td className="td text-right num text-ink-700">{it.quantity}</td>
                      <td className="td text-right num">
                        {it.received === it.quantity ? <span className="text-emerald-600">{it.received}</span> : <span className="text-ink-700">{it.received}</span>}
                      </td>
                      <td className="td text-right">
                        {has('admin', 'stock') && pending > 0 ? (
                          <input
                            className="input input-sm w-20 text-right num"
                            type="number" min="0" max={pending}
                            placeholder={String(pending)}
                            value={receipts[it.product] || ''}
                            onChange={(e) => setReceipts({ ...receipts, [it.product]: e.target.value })}
                          />
                        ) : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="td text-right num text-ink-700">{money(it.unitCost, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Phone: receiving stock from the warehouse floor. Ordered, received
                and remaining are stated explicitly so the operator never has to
                subtract in their head, and the input is capped at what is left. */}
            <ul className="sm:hidden divide-y divide-ink-100">
              {po.items.map((it, i) => {
                const pending = it.quantity - it.received;
                return (
                  <li key={i} className="p-3.5">
                    <div className="font-medium text-ink-900 text-[13.5px] leading-snug">{it.name}</div>
                    <div className="t-meta font-mono truncate">{it.sku}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-ink-50 py-1.5">
                        <div className="t-meta">Ordered</div>
                        <div className="num text-[13px] text-ink-900">{it.quantity}</div>
                      </div>
                      <div className="rounded-md bg-ink-50 py-1.5">
                        <div className="t-meta">Received</div>
                        <div className={`num text-[13px] ${it.received === it.quantity ? 'text-emerald-700' : 'text-ink-900'}`}>{it.received}</div>
                      </div>
                      <div className="rounded-md bg-ink-50 py-1.5">
                        <div className="t-meta">Remaining</div>
                        <div className={`num text-[13px] ${pending > 0 ? 'text-amber-700 font-medium' : 'text-ink-400'}`}>{pending}</div>
                      </div>
                    </div>
                    {has('admin', 'stock') && pending > 0 ? (
                      <div className="mt-2.5">
                        <label htmlFor={`recv-${i}`} className="t-meta block mb-1">Receive now (max {pending})</label>
                        <input
                          id={`recv-${i}`} className="input text-right num w-full"
                          type="number" inputMode="numeric" min="0" max={pending}
                          placeholder={String(pending)}
                          value={receipts[it.product] || ''}
                          onChange={(e) => setReceipts({ ...receipts, [it.product]: e.target.value })}
                        />
                      </div>
                    ) : (
                      <p className="t-meta mt-2.5">{pending === 0 ? 'Fully received.' : 'You do not have permission to receive stock.'}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {has('admin', 'stock') && po.status !== 'received' && po.status !== 'cancelled' && (
              <div className="p-3 border-t border-ink-100 bg-ink-25 flex justify-end">
                <button className="btn-primary" onClick={receive} disabled={receiving}>
                  {receiving ? <><Spinner className="w-4 h-4" /> Receiving…</> : 'Receive Selected'}
                </button>
              </div>
            )}
          </div>

          <section>
            <h3 className="t-section mb-2">Payments</h3>
            <Table
              caption="Payments made against this purchase order"
              rows={po.payments}
              rowKey={(r, i) => i}
              empty="No payments recorded yet"
              emptyDescription={`The full ${money(po.balance, currency)} is outstanding.`}
              columns={[
                { key: 'date', label: 'Date', priority: 'primary', render: (p) => <span className="text-ink-500 whitespace-nowrap">{datetime(p.date)}</span> },
                { key: 'account', label: 'Account', render: (p) => accounts?.find((a) => a._id === p.account)?.name || <span className="text-ink-300">—</span> },
                { key: 'method', label: 'Method', render: (p) => <span className="capitalize">{p.method}</span> },
                { key: 'reference', label: 'Reference', render: (p) => p.reference ? <span className="font-mono text-[12px] text-ink-500">{p.reference}</span> : <span className="text-ink-300">—</span> },
                {
                  key: 'amount', label: `Amount (${currency})`, align: 'right', priority: 'primary',
                  render: (p) => p.reversed
                    ? <Money value={p.amount} tone="muted" className="line-through" />
                    : <Money value={p.amount} tone="negative" className="font-medium" />,
                },
                {
                  key: 'action', label: '', align: 'right',
                  render: (p) => p.reversed
                    ? <span className="badge-danger" title={p.reversalReason ? `Reversed: ${p.reversalReason}` : 'Reversed'}>reversed</span>
                    : has('admin')
                      ? <button className="btn-sm btn-danger-soft" onClick={() => setReverseTarget({ index: po.payments.indexOf(p), payment: p })}>Reverse</button>
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
              <div className="flex justify-between text-sm"><span className="text-ink-500">Subtotal</span><span className="num text-ink-700">{money(po.subtotal, currency)}</span></div>
              {po.taxAmount > 0 && <div className="flex justify-between text-sm"><span className="text-ink-500">Tax</span><span className="num text-ink-700">{money(po.taxAmount, currency)}</span></div>}
            </div>
            <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100">
              <span className="text-sm font-medium text-ink-900">Total</span>
              <span className="text-xl font-semibold num text-ink-900">{money(po.total, currency)}</span>
            </div>
            <div className="mt-3 pt-3 border-t border-ink-100 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-ink-500">Paid</span><span className="num text-emerald-600">{money(po.paid, currency)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-500">Balance</span><span className={`num font-medium ${po.balance > 0 ? 'text-amber-600' : 'text-ink-400'}`}>{money(po.balance, currency)}</span></div>
            </div>
          </div>
          {has('admin') && po.balance > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink-900 mb-3">Record Payment</h3>
              <label htmlFor="purchaseorderdetail-amount-51" className="label">Amount</label>
              <input id="purchaseorderdetail-amount-51" className="input num" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={money(po.balance, currency)} />
              <label className="label mt-3">Pay From <span className="text-red-500">*</span></label>
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
        </div>
      </div>
      <ConfirmDialog
        open={!!reverseTarget}
        onClose={() => setReverseTarget(null)}
        onConfirm={reversePayment}
        title="Reverse this supplier payment?"
        description="The original payment stays on record. A matching reversing entry returns the money to the account it left."
        consequences={reverseTarget ? [
          `${money(reverseTarget.payment.amount, currency)} returns to ${accounts?.find((a) => a._id === reverseTarget.payment.account)?.name || 'the paying account'}`,
          `Purchase order ${po.number} paid amount decreases by ${money(reverseTarget.payment.amount, currency)}`,
          `${po.supplier?.name || 'The supplier'} will be owed that amount again`,
          'The payment is marked REVERSED and cannot be reversed twice',
        ] : []}
        confirmLabel="Reverse payment"
        reasonRequired
        reasonLabel="Why is this being reversed?"
        reasonPlaceholder="e.g. Paid the wrong supplier"
      />

    </div>
  );
}