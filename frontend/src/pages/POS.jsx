import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

export default function POS() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['products-pos', search],
    queryFn: async () => (await api.get('/products', { params: { q: search, limit: 30 } })).data,
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-pos'],
    queryFn: async () => (await api.get('/customers')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  function addToCart(p) {
    setCart((c) => {
      const existing = c.find((x) => x.product === p._id);
      if (existing) {
        return c.map((x) =>
          x.product === p._id ? { ...x, quantity: Math.min(p.stock, x.quantity + 1) } : x
        );
      }
      return [
        ...c,
        { product: p._id, name: p.name, sku: p.sku, unitPrice: p.sellingPrice, quantity: 1, discount: 0, stock: p.stock },
      ];
    });
  }

  function updateLine(idx, patch) {
    setCart((c) => c.map((line, i) => (i === idx ? { ...line, ...patch } : line)));
  }
  function removeLine(idx) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  const totals = useMemo(() => {
    const subtotal = cart.reduce(
      (s, l) => s + Math.max(0, l.quantity * l.unitPrice - (l.discount || 0)),
      0
    );
    const afterDisc = Math.max(0, subtotal - Number(discount || 0));
    const tax = Math.round(afterDisc * (Number(taxRate || 0) / 100) * 100) / 100;
    const total = Math.round((afterDisc + tax) * 100) / 100;
    return { subtotal, tax, total };
  }, [cart, discount, taxRate]);

  async function submit() {
    if (!customer) return toast.error('Select a customer');
    if (!cart.length) return toast.error('Cart is empty');
    setSaving(true);
    try {
      const payload = {
        customer,
        items: cart.map(({ product, quantity, unitPrice, discount }) => ({
          product,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          discount: Number(discount || 0),
        })),
        discount: Number(discount || 0),
        taxRate: Number(taxRate || 0),
        notes,
        initialPayment: paymentAmount > 0 ? { amount: Number(paymentAmount), method: paymentMethod } : undefined,
      };
      const r = await api.post('/invoices', payload);
      toast.success(`Invoice ${r.data.number} created`);
      navigate(`/invoices/${r.data._id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Point of Sale" subtitle="Create a new sale and invoice" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-4">
            <input
              className="input"
              placeholder="Search product by name, SKU, brand..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-slate-100">
              {(products?.items || []).map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => p.stock > 0 && addToCart(p)}
                  className={`w-full text-left px-2 py-2 hover:bg-slate-50 flex justify-between ${
                    p.stock === 0 ? 'opacity-40 cursor-not-allowed' : ''
                  }`}
                  disabled={p.stock === 0}
                >
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-slate-500 text-xs ml-2">{p.sku}</span>
                  </span>
                  <span className="text-slate-700">
                    {money(p.sellingPrice, currency)}{' '}
                    <span className="text-xs text-slate-400">· {p.stock} in stock</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-3 py-6 text-center text-slate-400">
                      No items yet — search & click a product above.
                    </td>
                  </tr>
                ) : (
                  cart.map((line, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <div>{line.name}</div>
                        <div className="text-xs text-slate-400">{line.sku} · {line.stock} avail.</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="1"
                          max={line.stock}
                          className="input w-20 text-right"
                          value={line.quantity}
                          onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="input w-28 text-right"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="input w-24 text-right"
                          value={line.discount}
                          onChange={(e) => updateLine(i, { discount: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {money(Math.max(0, line.quantity * line.unitPrice - (line.discount || 0)), currency)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button className="text-red-600 hover:underline text-xs" onClick={() => removeLine(i)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-3">
            <div>
              <label className="label">Customer *</label>
              <select className="input" value={customer} onChange={(e) => setCustomer(e.target.value)}>
                <option value="">— select customer —</option>
                {(customers || []).map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                    {c.company ? ` (${c.company})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Discount</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Tax %</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="card p-5">
            <div className="flex justify-between text-sm py-1">
              <span className="text-slate-500">Subtotal</span>
              <span>{money(totals.subtotal, currency)}</span>
            </div>
            {Number(discount) > 0 && (
              <div className="flex justify-between text-sm py-1">
                <span className="text-slate-500">Discount</span>
                <span>- {money(Number(discount), currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm py-1">
              <span className="text-slate-500">Tax</span>
              <span>{money(totals.tax, currency)}</span>
            </div>
            <div className="flex justify-between text-base font-bold mt-2 pt-2 border-t border-slate-200">
              <span>Total</span>
              <span>{money(totals.total, currency)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="label">Initial Payment</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Method</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <button className="btn-primary w-full mt-5" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Invoice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
