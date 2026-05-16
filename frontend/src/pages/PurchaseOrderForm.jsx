import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

export default function PurchaseOrderForm() {
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [taxRate, setTaxRate] = useState(0);
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['products-po', search],
    queryFn: async () => (await api.get('/products', { params: { q: search } })).data,
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  function addToCart(p) {
    setCart((c) => {
      if (c.find((x) => x.product === p._id)) return c;
      return [...c, { product: p._id, name: p.name, sku: p.sku, unitCost: p.purchasePrice, quantity: 1 }];
    });
  }
  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const tax = Math.round(subtotal * (Number(taxRate || 0) / 100) * 100) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [cart, taxRate]);

  async function submit() {
    if (!supplier || !cart.length) return toast.error('Supplier and items required');
    setSaving(true);
    try {
      const r = await api.post('/purchase-orders', {
        supplier,
        items: cart.map(({ product, quantity, unitCost }) => ({ product, quantity: Number(quantity), unitCost: Number(unitCost) })),
        taxRate: Number(taxRate || 0),
        expectedAt: expectedAt || undefined,
        notes,
      });
      toast.success(`PO ${r.data.number} created`);
      navigate(`/purchase-orders/${r.data._id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="New Purchase Order" />
      <div className="p-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-4">
            <input className="input" placeholder="Search product..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-slate-100">
              {(products?.items || []).map((p) => (
                <button key={p._id} className="w-full text-left px-2 py-2 hover:bg-slate-50 flex justify-between" onClick={() => addToCart(p)}>
                  <span><span className="font-medium">{p.name}</span> <span className="text-xs text-slate-500">{p.sku}</span></span>
                  <span className="text-slate-500">cost {money(p.purchasePrice, currency)}</span>
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
                  <th className="px-3 py-2 text-right">Unit Cost</th>
                  <th className="px-3 py-2 text-right">Line Total</th>
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
                      <input className="input w-28 text-right" type="number" step="0.01" value={line.unitCost} onChange={(e) => setCart((c) => c.map((l, j) => j === i ? { ...l, unitCost: Number(e.target.value) } : l))} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{money(line.quantity * line.unitCost, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-3">
            <div>
              <label className="label">Supplier *</label>
              <select className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">— select —</option>
                {(suppliers || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Expected Delivery</label>
              <input className="input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </div>
            <div>
              <label className="label">Tax %</label>
              <input className="input" type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="card p-5">
            <div className="flex justify-between font-bold py-1"><span>Total</span><span>{money(totals.total, currency)}</span></div>
            <button className="btn-primary w-full mt-3" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save Purchase Order'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
