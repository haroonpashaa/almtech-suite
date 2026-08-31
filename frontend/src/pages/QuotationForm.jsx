import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { clampQuantity, isValidQuantity } from '../lib/quantity.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Combobox from '../components/Combobox.jsx';
import { Spinner } from '../components/ui.jsx';

export default function QuotationForm() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['products-quote', search],
    queryFn: async () => (await api.get('/products', { params: { q: search } })).data,
  });
  const currency = useCurrency();

  function addToCart(p) {
    setCart((c) => {
      if (c.find((x) => x.product === p._id)) return c;
      return [...c, { product: p._id, name: p.name, sku: p.sku, unitPrice: p.sellingPrice, quantity: 1, discount: '' }];
    });
  }
  function setLine(i, patch) {
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i) {
    setCart((c) => c.filter((_, j) => j !== i));
  }

  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + Math.max(0, (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0)), 0);
    const afterDisc = Math.max(0, subtotal - Number(discount || 0));
    const tax = Math.round(afterDisc * (Number(taxRate || 0) / 100) * 100) / 100;
    return { subtotal, tax, total: afterDisc + tax };
  }, [cart, discount, taxRate]);

  async function submit() {
    if (!customer || !cart.length) return toast.error('Customer and items required');
    const invalidQty = cart.find((l) => !isValidQuantity(l.quantity));
    if (invalidQty) return toast.error(`Enter a valid quantity for ${invalidQty.name}`);
    const invalidPrice = cart.find((l) => l.unitPrice === '' || !Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0);
    if (invalidPrice) return toast.error(`Enter a valid price for ${invalidPrice.name}`);
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
      <PageHeader
        breadcrumb={[{ label: 'Quotations', to: '/quotations' }, { label: 'New' }]}
        title="New Quotation"
        subtitle="Build a quote and send it to a customer"
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
                    <span className="num font-semibold text-ink-900 text-sm">{money(p.sellingPrice, currency)}</span>
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
                  <th scope="col" className="th text-right">Price</th>
                  <th scope="col" className="th text-right">Disc.</th>
                  <th scope="col" className="th text-right">Total</th>
                  <th className="w-10"></th>
                </tr></thead>
                <tbody>
                  {cart.map((line, i) => (
                    <tr key={i} className="tr">
                      <td className="td"><div className="font-medium text-ink-900">{line.name}</div><div className="t-meta font-mono">{line.sku}</div></td>
                      <td className="td text-right">
                        <input className="input input-sm w-16 text-right num" type="number" min="1" value={line.quantity}
                               onChange={(e) => setLine(i, { quantity: clampQuantity(e.target.value) })}
                               onBlur={() => { if (!isValidQuantity(line.quantity)) setLine(i, { quantity: 1 }); }} />
                      </td>
                      <td className="td text-right"><input className="input input-sm w-24 text-right num input-money" type="number" value={line.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                      <td className="td text-right"><input className="input input-sm w-20 text-right num input-money" type="number" value={line.discount} onChange={(e) => setLine(i, { discount: e.target.value })} /></td>
                      <td className="td text-right num font-semibold text-ink-900 whitespace-nowrap">{money(Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)), currency)}</td>
                      <td className="td text-right"><button className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50" onClick={() => removeLine(i)} aria-label="Remove"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Phone: editable line cards from the same cart state. */}
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
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                      <div>
                        <label htmlFor={`qt-qty-${i}`} className="t-meta block mb-1">Qty</label>
                        <input id={`qt-qty-${i}`} className="input input-sm text-right num w-full" type="number" inputMode="numeric" min="1"
                               value={line.quantity}
                               onChange={(e) => setLine(i, { quantity: clampQuantity(e.target.value) })}
                               onBlur={() => { if (!isValidQuantity(line.quantity)) setLine(i, { quantity: 1 }); }} />
                      </div>
                      <div>
                        <label htmlFor={`qt-price-${i}`} className="t-meta block mb-1">Price</label>
                        <input id={`qt-price-${i}`} className="input input-sm text-right num input-money w-full" type="number" inputMode="decimal" step="0.01"
                               value={line.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                      </div>
                      <div>
                        <label htmlFor={`qt-disc-${i}`} className="t-meta block mb-1">Disc.</label>
                        <input id={`qt-disc-${i}`} className="input input-sm text-right num input-money w-full" type="number" inputMode="decimal" step="0.01"
                               value={line.discount} onChange={(e) => setLine(i, { discount: e.target.value })} />
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between">
                      <span className="t-meta">Line total</span>
                      <span className="num font-semibold text-ink-900">
                        {money(Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)), currency)}
                      </span>
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
                  id="quotationform-customer-53"
                  label="Customer"
                  required
                  path="/customers"
                  value={customer}
                  onChange={setCustomer}
                  placeholder="Search customers by name, company, phone…"
                  getHint={(c) => [c.company, c.phone].filter(Boolean).join(' · ')}
                  emptyHint="No customer found"
                />
              </div>
              <div>
                <label htmlFor="quotationform-valid-until-54" className="label">Valid Until</label>
                <input id="quotationform-valid-until-54" className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="quotationform-discount-210" className="label">Discount</label><input id="quotationform-discount-210" className="input num input-money" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Enter amount" /></div>
                <div><label htmlFor="quotationform-tax-211" className="label">Tax %</label><input id="quotationform-tax-211" className="input num" type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
              </div>
              <div><label htmlFor="quotationform-notes-212" className="label">Notes</label><textarea id="quotationform-notes-212" className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div className="card p-5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-ink-500">Subtotal</span><span className="num text-ink-700">{money(totals.subtotal, currency)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-ink-500">Tax</span><span className="num text-ink-700">{money(totals.tax, currency)}</span></div>
              </div>
              <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100"><span className="text-sm font-medium text-ink-900">Total</span><span className="text-2xl font-semibold num text-ink-900">{money(totals.total, currency)}</span></div>
              <button className="btn-primary btn-lg w-full mt-4" disabled={saving || !cart.length} onClick={submit}>{saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Quotation'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
