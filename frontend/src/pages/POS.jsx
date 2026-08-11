import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { Spinner } from '../components/ui.jsx';

export default function POS() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentAccount, setPaymentAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const barcodeRef = useRef(null);

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['products-pos', search],
    queryFn: async () => (await api.get('/products', { params: { q: search, limit: 30 } })).data,
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-pos'],
    queryFn: async () => (await api.get('/customers')).data,
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

  // Handles both a physical scanner (keyboard input terminated by Enter) and a manual
  // type/paste + Enter. Either way it resolves the barcode to a product and reuses the
  // same addToCart() the click-to-add flow uses — no separate cart or stock path.
  async function submitBarcode(e) {
    e.preventDefault();
    const code = barcode.trim();
    if (!code || scanning) return;
    setScanning(true);
    try {
      const { data: p } = await api.get('/products/barcode', { params: { code } });
      if (p.active === false) {
        toast.error(`${p.name} is inactive and cannot be sold`);
      } else if (p.stock === 0) {
        toast.error(`${p.name} is out of stock`);
      } else if ((cart.find((x) => x.product === p._id)?.quantity ?? 0) >= p.stock) {
        toast.error(`Only ${p.stock} of ${p.name} in stock`);
      } else {
        addToCart(p);
        toast.success(`${p.name} added`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      // Always clear and refocus so the next scan lands immediately, hit or miss.
      setBarcode('');
      setScanning(false);
      barcodeRef.current?.focus();
    }
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

  const itemCount = cart.reduce((s, l) => s + Number(l.quantity || 0), 0);

  async function submit() {
    if (!customer) return toast.error('Select a customer');
    if (!cart.length) return toast.error('Cart is empty');
    // An initial payment has to land somewhere — a sale with no payment is unaffected.
    if (paymentAmount > 0 && !paymentAccount) return toast.error('Select the account the payment goes into');
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
        initialPayment:
          paymentAmount > 0
            ? { amount: Number(paymentAmount), method: paymentMethod, account: paymentAccount }
            : undefined,
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
      <PageHeader
        title="Point of Sale"
        subtitle="Create a new sale and invoice"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6h15l-1.5 9h-12zM6 6 5 3H2m4 18a1 1 0 1 1 0-2 1 1 0 0 1 0 2m12 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2" /></svg>}
      />
      <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-5 gap-6 max-w-[1500px]">
        {/* LEFT: catalog + cart */}
        <div className="lg:col-span-3 space-y-4">
          {/* Barcode scan */}
          <div className="card p-4">
            <form onSubmit={submitBarcode} className="flex items-center gap-2">
              <div className="field-search flex-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v10M17 5v14M20.5 5v14" /></svg>
                <input
                  ref={barcodeRef}
                  className="input font-mono"
                  placeholder="Scan or enter barcode…"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  autoComplete="off"
                  aria-label="Scan or enter barcode"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn-secondary shrink-0" disabled={scanning || !barcode.trim()}>
                {scanning ? <Spinner className="w-4 h-4" /> : 'Add'}
              </button>
            </form>
            <p className="text-xs text-ink-400 mt-2">
              Scanner input is accepted automatically — the field clears and stays focused between scans.
            </p>
          </div>

          {/* Product search */}
          <div className="card p-4">
            <div className="field-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                className="input"
                placeholder="Search product by name, SKU, brand…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto -mx-1 px-1">
              {loadingProducts ? (
                <div className="space-y-2 py-1">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
              ) : (products?.items || []).length === 0 ? (
                <div className="text-center text-sm text-ink-400 py-8">No products found</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {(products?.items || []).map((p) => {
                    const out = p.stock === 0;
                    return (
                      <button
                        key={p._id}
                        type="button"
                        onClick={() => !out && addToCart(p)}
                        disabled={out}
                        className={`group text-left p-3 rounded-xl border transition-all ${
                          out
                            ? 'border-ink-100 opacity-50 cursor-not-allowed'
                            : 'border-ink-100 hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-soft active:scale-[0.99]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-ink-900 text-sm truncate">{p.name}</div>
                            <div className="text-[11px] text-ink-400 font-mono mt-0.5">{p.sku}</div>
                          </div>
                          <span className={`badge shrink-0 ${out ? 'badge-danger' : p.stock <= (p.reorderLevel ?? 5) ? 'badge-warning' : 'badge-neutral'}`}>
                            {out ? 'Out' : `${p.stock} in stock`}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="num font-semibold text-ink-900">{money(p.sellingPrice, currency)}</span>
                          {!out && (
                            <span className="text-[11px] font-medium text-brand-600 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                              Add
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cart */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between bg-ink-25">
              <h3 className="text-sm font-semibold text-ink-900">Cart</h3>
              <span className="text-xs text-ink-400">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
            </div>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-ink-400">
                <div className="w-12 h-12 rounded-2xl bg-ink-50 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6h15l-1.5 9h-12zM6 6 5 3H2" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>
                </div>
                <div className="text-sm">Cart is empty</div>
                <div className="text-xs text-ink-300 mt-0.5">Search and click a product to add it</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                      <th className="px-4 py-2.5 text-left">Item</th>
                      <th className="px-3 py-2.5 text-center w-28">Qty</th>
                      <th className="px-3 py-2.5 text-right">Price</th>
                      <th className="px-3 py-2.5 text-right">Disc.</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line, i) => (
                      <tr key={i} className="border-b border-ink-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink-900">{line.name}</div>
                          <div className="text-[11px] text-ink-400 font-mono">{line.sku} · {line.stock} avail.</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="inline-flex items-center rounded-lg border border-ink-200 overflow-hidden">
                            <button type="button" onClick={() => updateLine(i, { quantity: Math.max(1, line.quantity - 1) })} className="px-2 py-1 text-ink-500 hover:bg-ink-50">−</button>
                            <input
                              type="number" min="1" max={line.stock}
                              className="w-10 text-center text-sm py-1 outline-none num [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                              value={line.quantity}
                              onChange={(e) => updateLine(i, { quantity: Math.min(line.stock, Math.max(1, Number(e.target.value))) })}
                            />
                            <button type="button" onClick={() => updateLine(i, { quantity: Math.min(line.stock, line.quantity + 1) })} className="px-2 py-1 text-ink-500 hover:bg-ink-50">+</button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input type="number" step="0.01" className="input input-sm w-24 text-right num" value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <input type="number" step="0.01" className="input input-sm w-20 text-right num" value={line.discount} onChange={(e) => updateLine(i, { discount: Number(e.target.value) })} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-ink-900 num whitespace-nowrap">
                          {money(Math.max(0, line.quantity * line.unitPrice - (line.discount || 0)), currency)}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <button className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50" onClick={() => removeLine(i)} aria-label="Remove">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: checkout */}
        <div className="lg:col-span-2">
          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="card p-5 space-y-3">
              <div>
                <label className="label">Customer <span className="text-red-500">*</span></label>
                <select className="select" value={customer} onChange={(e) => setCustomer(e.target.value)}>
                  <option value="">— select customer —</option>
                  {(customers || []).map((c) => (
                    <option key={c._id} value={c._id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Discount</label>
                  <input className="input num" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </div>
                <div>
                  <label className="label">Tax %</label>
                  <input className="input num" type="number" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note for this invoice…" />
              </div>
            </div>

            <div className="card p-5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-ink-500">Subtotal</span>
                  <span className="num text-ink-700">{money(totals.subtotal, currency)}</span>
                </div>
                {Number(discount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-500">Discount</span>
                    <span className="num text-red-600">− {money(Number(discount), currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-ink-500">Tax{Number(taxRate) > 0 ? ` (${taxRate}%)` : ''}</span>
                  <span className="num text-ink-700">{money(totals.tax, currency)}</span>
                </div>
              </div>
              <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100">
                <span className="text-sm font-medium text-ink-900">Total</span>
                <span className="text-2xl font-semibold text-ink-900 num tracking-tight">{money(totals.total, currency)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="label">Initial Payment</label>
                  <input className="input num" type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
                </div>
                <div>
                  <label className="label">Method</label>
                  <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              {paymentAmount > 0 && (
                <div className="mt-3">
                  <label className="label">Deposit To <span className="text-red-500">*</span></label>
                  <select className="select" value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)}>
                    <option value="">— select account —</option>
                    {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <button className="btn-primary-gradient btn-lg w-full mt-5" onClick={submit} disabled={saving || cart.length === 0}>
                {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : <>Save Invoice · {money(totals.total, currency)}</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
