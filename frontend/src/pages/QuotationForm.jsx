import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

export default function QuotationForm() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['products-quote', search],
    queryFn: async () => (await api.get('/products', { params: { q: search } })).data,
  });
  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  function addToCart(p) {
    setCart((c) => {
      if (c.find((x) => x.product === p._id)) return c;
      return [...c, { product: p._id, name: p.name, sku: p.sku, unitPrice: p.sellingPrice, quantity: 1, discount: 0 }];
    });
  }

  const totals = useMemo(() => {
    const subtotal = cart.reduce(
      (s, l) => s + Math.max(0, l.quantity * l.unitPrice - (l.discount || 0)),
      0
    );
    const afterDisc = Math.max(0, subtotal - Number(discount || 0));
    const tax = Math.round(afterDisc * (Number(taxRate || 0) / 100) * 100) / 100;
    return { subtotal, tax, total: afterDisc + tax };
  }, [cart, discount, taxRate]);

  async function submit() {
    if (!customer || !cart.length) return toast.error('Customer and items required');
    setSaving(true);
    try {
      const r = await api.post('/quotations', {
        customer,
        items: cart.map(({ product, quantity, unitPrice, discount }) => ({ product, quantity: Number(quantity), unitPrice: Number(unitPrice), discount: Number(discount || 0) })),
        discount: Number(discount || 0),
        taxRate: Number(taxRate || 0),
        validUntil: validUntil || undefined,
        notes,
      });
      toast.success(`Quotation ${r.data.number} created`);
      navigate('/quotations');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="New Quotation" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-4">
            <input className="input" placeholder="Search product..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-slate-100">
              {(products?.items || []).map((p) => (
                <button key={p._id} className="w-full text-left px-2 py-2 hover:bg-slate-50 flex justify-between" onClick={() => addToCart(p)}>
                  <span><span className="font-medium">{p.name}</span> <span className="text-xs text-slate-500">{p.sku}</span></span>
                  <span>{money(p.sellingPrice, currency)}</span>
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
                </tr>
              </thead>
              <tbody>
                {cart.map((line, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">{line.name}</td>
                    <td className="px-3 py-2 text-right">
                      <input className="input w-20 text-right" type="number" min="1" value={line.quantity} onChange={(e) => setCart((c) => c.map((l, j) => j === i ? { ...l, quantity: Number(e.target.value) } : l))} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input className="input w-28 text-right" type="number" value={line.unitPrice} onChange={(e) => setCart((c) => c.map((l, j) => j === i ? { ...l, unitPrice: Number(e.target.value) } : l))} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input className="input w-24 text-right" type="number" value={line.discount} onChange={(e) => setCart((c) => c.map((l, j) => j === i ? { ...l, discount: Number(e.target.value) } : l))} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {money(Math.max(0, line.quantity * line.unitPrice - (line.discount || 0)), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-3">
            <div>
              <label className="label">Customer *</label>
              <select className="input" value={customer} onChange={(e) => setCustomer(e.target.value)}>
                <option value="">— select —</option>
                {(customers || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Valid Until</label>
              <input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Discount</label><input className="input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
              <div><label className="label">Tax %</label><input className="input" type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="card p-5">
            <div className="flex justify-between font-bold py-1"><span>Total</span><span>{money(totals.total, currency)}</span></div>
            <button className="btn-primary w-full mt-3" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save Quotation'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
