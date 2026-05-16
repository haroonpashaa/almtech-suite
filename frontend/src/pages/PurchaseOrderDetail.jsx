import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, datetime, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const [receipts, setReceipts] = useState({});
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');

  const { data: po } = useQuery({
    queryKey: ['po', id],
    queryFn: async () => (await api.get(`/purchase-orders/${id}`)).data,
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
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function pay() {
    try {
      await api.post(`/purchase-orders/${id}/payments`, { amount: Number(amount), method, reference });
      toast.success('Payment recorded');
      setAmount('');
      setReference('');
      qc.invalidateQueries({ queryKey: ['po', id] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (!po) return <div className="p-6 text-slate-500">Loading…</div>;

  return (
    <div>
      <PageHeader title={po.number} subtitle={`${po.supplier?.name} · ordered ${date(po.orderedAt)} · ${po.status.toUpperCase()}`} />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Receive Now</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it, i) => {
                  const pending = it.quantity - it.received;
                  return (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{it.name}</div>
                        <div className="text-xs text-slate-400">{it.sku}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">{it.received}</td>
                      <td className="px-3 py-2 text-right">
                        {has('admin', 'stock') && pending > 0 ? (
                          <input
                            className="input w-20 text-right"
                            type="number"
                            min="0"
                            max={pending}
                            placeholder={String(pending)}
                            value={receipts[it.product] || ''}
                            onChange={(e) => setReceipts({ ...receipts, [it.product]: e.target.value })}
                          />
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{money(it.unitCost, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {has('admin', 'stock') && po.status !== 'received' && po.status !== 'cancelled' && (
              <div className="p-3 border-t border-slate-200 bg-slate-50">
                <button className="btn-primary" onClick={receive}>Receive Selected</button>
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="font-semibold mb-3">Payments</div>
            {po.payments.length === 0 ? (
              <div className="text-sm text-slate-400">No payments yet.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-1">Date</th>
                    <th className="text-left py-1">Method</th>
                    <th className="text-left py-1">Reference</th>
                    <th className="text-right py-1">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {po.payments.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1">{datetime(p.date)}</td>
                      <td className="py-1 capitalize">{p.method}</td>
                      <td className="py-1">{p.reference || '—'}</td>
                      <td className="py-1 text-right">{money(p.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">Subtotal</span><span>{money(po.subtotal, currency)}</span></div>
            {po.taxAmount > 0 && (
              <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">Tax</span><span>{money(po.taxAmount, currency)}</span></div>
            )}
            <div className="flex justify-between font-bold mt-2 pt-2 border-t border-slate-200"><span>Total</span><span>{money(po.total, currency)}</span></div>
            <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">Paid</span><span>{money(po.paid, currency)}</span></div>
            <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">Balance</span><span className={po.balance > 0 ? 'text-amber-600 font-medium' : ''}>{money(po.balance, currency)}</span></div>
          </div>
          {has('admin') && po.balance > 0 && (
            <div className="card p-5">
              <div className="font-semibold mb-3">Record Payment</div>
              <label className="label">Amount</label>
              <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <label className="label mt-2">Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
              <label className="label mt-2">Reference</label>
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              <button className="btn-primary w-full mt-4" onClick={pay} disabled={!amount}>Save Payment</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
