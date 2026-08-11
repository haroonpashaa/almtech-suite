import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, datetime, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { Badge, LoadingBlock, Spinner } from '../components/ui.jsx';

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
  const [reversing, setReversing] = useState(null);

  const { data: po } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => (await api.get(`/purchase-orders/${id}`)).data,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  async function receive() {
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

  async function reversePayment(index) {
    const reason = prompt('Why is this payment being reversed? (required)');
    if (reason === null) return;
    if (!reason.trim()) return toast.error('A reason is required to reverse a payment');
    setReversing(index);
    try {
      await api.post(`/purchase-orders/${id}/payments/${index}/reverse`, { reason });
      toast.success('Payment reversed');
      qc.invalidateQueries({ queryKey: ['po', id] });
      ['accounts-summary', 'dashboard', 'payables', 'finance-position', 'payment-history', 'deal'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReversing(null);
    }
  }

  if (!po) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Purchase Orders', to: '/purchase-orders' }, { label: po.number }]}
        title={<span className="font-mono">{po.number}</span>}
        subtitle={`${po.supplier?.name} · ordered ${date(po.orderedAt)}`}
        actions={
          <>
            <Badge tone={statusTone[po.status]} dot>{po.status}</Badge>
            {has('admin') && <Link to={`/deals/purchases/${id}`} className="btn-secondary">Deal history</Link>}
          </>
        }
      />
      <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-[1300px]">
        <div className="lg:col-span-2 space-y-4">
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 bg-ink-25"><h3 className="text-sm font-semibold text-ink-900">Items</h3></div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 text-left">Item</th>
                  <th className="px-3 py-2.5 text-right">Ordered</th>
                  <th className="px-3 py-2.5 text-right">Received</th>
                  <th className="px-3 py-2.5 text-right">Receive Now</th>
                  <th className="px-4 py-2.5 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it, i) => {
                  const pending = it.quantity - it.received;
                  return (
                    <tr key={i} className="border-b border-ink-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink-900">{it.name}</div>
                        <div className="text-[11px] text-ink-400 font-mono">{it.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right num text-ink-700">{it.quantity}</td>
                      <td className="px-3 py-2.5 text-right num">
                        {it.received === it.quantity ? <span className="text-emerald-600">{it.received}</span> : <span className="text-ink-700">{it.received}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
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
                      <td className="px-4 py-2.5 text-right num text-ink-700">{money(it.unitCost, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {has('admin', 'stock') && po.status !== 'received' && po.status !== 'cancelled' && (
              <div className="p-3 border-t border-ink-100 bg-ink-25 flex justify-end">
                <button className="btn-primary-gradient btn-sm" onClick={receive}>Receive Selected</button>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-900 mb-3">Payments</h3>
            {po.payments.length === 0 ? (
              <div className="text-sm text-ink-400">No payments recorded yet.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    <th className="text-left py-1.5">Date</th>
                    <th className="text-left py-1.5">Method</th>
                    <th className="text-left py-1.5">Reference</th>
                    <th className="text-right py-1.5">Amount</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {po.payments.map((p, i) => (
                    <tr key={i} className={`border-t border-ink-100 ${p.reversed ? 'bg-red-50/40' : ''}`}>
                      <td className="py-2 text-ink-500">{datetime(p.date)}</td>
                      <td className="py-2 capitalize text-ink-700">{p.method}</td>
                      <td className="py-2 text-ink-500 font-mono text-[12px]">{p.reference || '—'}</td>
                      <td className={`py-2 text-right num font-medium ${p.reversed ? 'text-ink-300 line-through' : 'text-emerald-600'}`}>{money(p.amount, currency)}</td>
                      <td className="py-2 text-right">
                        {p.reversed ? (
                          <span className="badge badge-danger" title={`Reversed${p.reversalReason ? `: ${p.reversalReason}` : ''}`}>reversed</span>
                        ) : has('admin') ? (
                          <button
                            className="btn-sm bg-white border border-ink-200 text-ink-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                            onClick={() => reversePayment(i)}
                            disabled={reversing === i}
                          >
                            {reversing === i ? '…' : 'Reverse'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
              <label className="label">Amount</label>
              <input className="input num" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={money(po.balance, currency)} />
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
              <button className="btn-primary-gradient w-full mt-4" onClick={pay} disabled={!amount || !account || paying}>
                {paying ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Payment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
