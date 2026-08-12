import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Combobox from '../components/Combobox.jsx';
import { Spinner } from '../components/ui.jsx';

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
  const currency = useCurrency();

  function addToCart(p) {
    setCart((c) => {
      if (c.find((x) => x.product === p._id)) return c;
      return [...c, { product: p._id, name: p.name, sku: p.sku, unitCost: p.purchasePrice, quantity: 1 }];
    });
  }
  function setLine(i, patch) {
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i) {
    setCart((c) => c.filter((_, j) => j !== i));
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
      <PageHeader
        breadcrumb={[{ label: 'Purchase Orders', to: '/purchase-orders' }, { label: 'New' }]}
        title="New Purchase Order"
        subtitle="Order stock from a supplier"
      />
      <div className="page page-w grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="card p-4">
            <div className="field-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input className="input" placeholder="Search product to add…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="mt-3 max-h-64 overflow-y-auto grid sm:grid-cols-2 gap-2">
              {(products?.items || []).map((p) => (
                <button key={p._id} className="text-left p-3 rounded-xl border border-ink-100 hover:border-brand-300 hover:bg-brand-50/40 transition active:scale-[0.99]" onClick={() => addToCart(p)}>
                  <div className="font-medium text-ink-900 text-sm truncate">{p.name}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="t-meta font-mono">{p.sku}</span>
                    <span className="num text-ink-500 text-xs">cost {money(p.purchasePrice, currency)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="card overflow-hidden">
            {cart.length === 0 ? (
              <div className="text-center text-sm text-ink-400 py-12">No items yet — add products above.</div>
            ) : (
              <table className="hidden sm:table min-w-full text-sm">
                <thead><tr className="border-b border-ink-100 bg-ink-25 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  <th scope="col" className="th">Item</th>
                  <th scope="col" className="th text-right">Qty</th>
                  <th scope="col" className="th text-right">Unit Cost</th>
                  <th scope="col" className="th text-right">Line Total</th>
                  <th className="w-10"></th>
                </tr></thead>
                <tbody>
                  {cart.map((line, i) => (
                    <tr key={i} className="tr">
                      <td className="td"><div className="font-medium text-ink-900">{line.name}</div><div className="t-meta font-mono">{line.sku}</div></td>
                      <td className="td text-right"><input className="input input-sm w-16 text-right num" type="number" min="1" value={line.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></td>
                      <td className="td text-right"><input className="input input-sm w-24 text-right num" type="number" step="0.01" value={line.unitCost} onChange={(e) => setLine(i, { unitCost: Number(e.target.value) })} /></td>
                      <td className="td text-right num font-semibold text-ink-900 whitespace-nowrap">{money(line.quantity * line.unitCost, currency)}</td>
                      <td className="td text-right"><button className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50" onClick={() => removeLine(i)} aria-label="Remove"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Phone: the same line state as editable cards. The desktop table is
                dense by design; on a phone its number inputs are unusable and
                sideways scrolling is not an acceptable substitute. */}
            {cart.length > 0 && (
              <ul className="sm:hidden divide-y divide-ink-100">
                {cart.map((line, i) => (
                  <li key={i} className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink-900 text-[13.5px] leading-snug">{line.name}</div>
                        <div className="t-meta font-mono truncate">{line.sku}</div>
                      </div>
                      <button className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50 shrink-0 -mt-1 -mr-1"
                              onClick={() => removeLine(i)} aria-label={`Remove ${line.name}`}>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg>
                      </button>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`po-line-qty-${i}`} className="t-meta block mb-1">Quantity</label>
                        <input id={`po-line-qty-${i}`} className="input input-sm text-right num w-full" type="number" inputMode="numeric" min="1"
                               value={line.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label htmlFor={`po-line-cost-${i}`} className="t-meta block mb-1">Unit cost</label>
                        <input id={`po-line-cost-${i}`} className="input input-sm text-right num w-full" type="number" inputMode="decimal" step="0.01"
                               value={line.unitCost} onChange={(e) => setLine(i, { unitCost: Number(e.target.value) })} />
                      </div>
                    </div>
                    
                    <div className="mt-2.5 flex items-baseline justify-between">
                      <span className="t-meta">Line total</span>
                      <span className="num font-semibold text-ink-900">{money(line.quantity * line.unitCost, currency)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="card p-5 space-y-3">
              <div>
                <Combobox
                  id="purchaseorderform-supplier-52"
                  label="Supplier"
                  required
                  path="/suppliers"
                  params={{ active: 'true' }}
                  value={supplier}
                  onChange={setSupplier}
                  placeholder="Search suppliers by name, contact, phone…"
                  getHint={(s) => [s.contactPerson, s.phone].filter(Boolean).join(' · ')}
                  emptyHint="No supplier found"
                />
              </div>
              <div><label htmlFor="purchaseorderform-expected-delivery-207" className="label">Expected Delivery</label><input id="purchaseorderform-expected-delivery-207" className="input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></div>
              <div><label htmlFor="purchaseorderform-tax-208" className="label">Tax %</label><input id="purchaseorderform-tax-208" className="input num" type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
              <div><label htmlFor="purchaseorderform-notes-209" className="label">Notes</label><textarea id="purchaseorderform-notes-209" className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div className="card p-5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-ink-500">Subtotal</span><span className="num text-ink-700">{money(totals.subtotal, currency)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-ink-500">Tax</span><span className="num text-ink-700">{money(totals.tax, currency)}</span></div>
              </div>
              <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100"><span className="text-sm font-medium text-ink-900">Total</span><span className="text-2xl font-semibold num text-ink-900">{money(totals.total, currency)}</span></div>
              <button className="btn-primary btn-lg w-full mt-4" disabled={saving || !cart.length} onClick={submit}>{saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Purchase Order'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
