import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, datetime, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function InvoiceDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const { data: invoice } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => (await api.get(`/invoices/${id}`)).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  async function pay() {
    try {
      await api.post(`/invoices/${id}/payments`, { amount: Number(amount), method, reference });
      toast.success('Payment recorded');
      setAmount('');
      setReference('');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function doReturn() {
    if (!confirm('Process return for this entire invoice? Stock will be restored.')) return;
    try {
      await api.post(`/invoices/${id}/return`);
      toast.success('Invoice returned');
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (!invoice) return <div className="p-6 text-slate-500">Loading…</div>;

  return (
    <div>
      <PageHeader
        title={invoice.number}
        subtitle={`${invoice.customer?.name} · ${date(invoice.issuedAt)} · ${invoice.status.toUpperCase()}`}
        actions={
          <>
            <a className="btn-secondary" href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer">
              View PDF
            </a>
            {has('admin') && invoice.status !== 'returned' && invoice.status !== 'cancelled' && (
              <button className="btn-danger" onClick={doReturn}>Process Return</button>
            )}
          </>
        }
      />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.name}</div>
                      <div className="text-xs text-slate-400">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{it.quantity}</td>
                    <td className="px-3 py-2 text-right">{money(it.unitPrice, currency)}</td>
                    <td className="px-3 py-2 text-right">{money(it.discount, currency)}</td>
                    <td className="px-3 py-2 text-right font-medium">{money(it.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card p-5">
            <div className="font-semibold mb-3">Payments</div>
            {invoice.payments.length === 0 ? (
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
                  {invoice.payments.map((p, i) => (
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
            <div className="flex justify-between py-1 text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span>{money(invoice.subtotal, currency)}</span>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between py-1 text-sm">
                <span className="text-slate-500">Discount</span>
                <span>- {money(invoice.discount, currency)}</span>
              </div>
            )}
            {invoice.taxAmount > 0 && (
              <div className="flex justify-between py-1 text-sm">
                <span className="text-slate-500">Tax ({invoice.taxRate}%)</span>
                <span>{money(invoice.taxAmount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold mt-2 pt-2 border-t border-slate-200">
              <span>Total</span>
              <span>{money(invoice.total, currency)}</span>
            </div>
            <div className="flex justify-between py-1 text-sm">
              <span className="text-slate-500">Paid</span>
              <span>{money(invoice.paid, currency)}</span>
            </div>
            <div className="flex justify-between py-1 text-sm">
              <span className="text-slate-500">Balance</span>
              <span className={invoice.balance > 0 ? 'text-amber-600 font-medium' : ''}>
                {money(invoice.balance, currency)}
              </span>
            </div>
          </div>

          {has('admin', 'sales') && invoice.balance > 0 && (
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
              <button className="btn-primary w-full mt-4" onClick={pay} disabled={!amount}>
                Save Payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
