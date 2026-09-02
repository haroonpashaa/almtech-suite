import { useMemo, useRef, useState } from 'react';
import { useSubmit } from '../hooks/useSubmit.js';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { clampQuantity, isValidQuantity } from '../lib/quantity.js';
import { resizeSerials, compactSerials, serialsAreSubmittable } from '../lib/cartSerials.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Combobox from '../components/Combobox.jsx';
import { specLine } from './Products.jsx';
import { Spinner } from '../components/ui.jsx';

export default function POS() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState('');
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
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const currency = useCurrency();

  function addToCart(p) {
    setCart((c) => {
      const existing = c.find((x) => x.product === p._id);
      if (existing) {
        return c.map((x) => {
          if (x.product !== p._id) return x;
          const quantity = clampQuantity(Number(x.quantity || 0) + 1, p.stock);
          return { ...x, quantity, serials: x.tracksSerials ? resizeSerials(x.serials, quantity) : x.serials };
        });
      }
      const tracksSerials = !!p.tracksSerials;
      return [
        ...c,
        {
          // The catalog comment (often auto-composed grading/inspection text from
          // import) is internal/product-level information, not a sale-time note —
          // the salesperson starts blank and types whatever this specific sale needs,
          // rather than having to delete boilerplate first.
          // A product with no selling price set yet (or never priced) has
          // sellingPrice 0 in the database — pre-filling that literally would
          // put the exact "starts with a zero you have to delete" problem
          // right back into the one field this whole fix was about. A real,
          // already-set price is still a helpful default and stays pre-filled.
          product: p._id, name: p.name, sku: p.sku, unitPrice: p.sellingPrice || '',
          // Specification snapshot: starts as a copy of the product's own values, but
          // from here on belongs to this sale line — editing it corrects what this
          // sale says was sold, and never writes back to the product record.
          model: p.model || '', ram: p.ram || '', processor: p.processor || '', storage: p.storage || '',
          quantity: 1, discount: '', stock: p.stock, comments: '',
          tracksSerials,
          // Snapshot of what's sellable right now. Taken once, at add-to-cart time —
          // the backend re-validates against the live product record at submit time
          // regardless, so a stale snapshot here can only under-offer a choice, never
          // let an invalid one through.
          availableSerials: tracksSerials ? (p.serials || []).filter((s) => s.status === 'in_stock').map((s) => s.serial) : [],
          serials: tracksSerials ? resizeSerials([], 1) : [],
        },
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
  // Quantity changes go through here rather than updateLine directly, because a
  // tracksSerials line's serial slots must grow or shrink in step with it.
  function updateQuantity(idx, quantity) {
    setCart((c) => c.map((line, i) => {
      if (i !== idx) return line;
      return { ...line, quantity, serials: line.tracksSerials ? resizeSerials(line.serials, quantity) : line.serials };
    }));
  }
  function updateSerialSlot(idx, slotIndex, value) {
    setCart((c) => c.map((line, i) => {
      if (i !== idx) return line;
      const serials = [...(line.serials || [])];
      serials[slotIndex] = value;
      return { ...line, serials };
    }));
  }
  function removeLine(idx) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  const totals = useMemo(() => {
    const subtotal = cart.reduce(
      (s, l) => s + Math.max(0, (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) - (Number(l.discount) || 0)),
      0
    );
    const afterDisc = Math.max(0, subtotal - Number(discount || 0));
    const tax = Math.round(afterDisc * (Number(taxRate || 0) / 100) * 100) / 100;
    const total = Math.round((afterDisc + tax) * 100) / 100;
    return { subtotal, tax, total };
  }, [cart, discount, taxRate]);

  const itemCount = cart.reduce((s, l) => s + Number(l.quantity || 0), 0);

  async function doSubmit() {
    if (!customer) return toast.error('Select a customer');
    if (!cart.length) return toast.error('Cart is empty');
    const invalidLine = cart.find((l) => !isValidQuantity(l.quantity, l.stock));
    if (invalidLine) return toast.error(`Enter a valid quantity for ${invalidLine.name} (1–${invalidLine.stock})`);
    // A blank price field can now genuinely stay blank while editing (that's the fix —
    // it no longer snaps back to a confusing "0" on every keystroke), so unlike before,
    // it really can still be blank at submit time. Catch that here rather than letting
    // it silently become a $0 line.
    const invalidPriceLine = cart.find((l) => l.unitPrice === '' || !Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0);
    if (invalidPriceLine) return toast.error(`Enter a valid price for ${invalidPriceLine.name}`);
    const blankNameLine = cart.find((l) => !String(l.name || '').trim());
    if (blankNameLine) return toast.error('Enter an item name for every line in the cart');
    // Serial capture stays optional (unchanged from before this was editable at
    // all) — only a PARTIAL selection is rejected, since it could never correspond
    // to a complete, valid set of inventory units.
    const badSerialLine = cart.find((l) => l.tracksSerials && !serialsAreSubmittable(l.serials, l.quantity));
    if (badSerialLine) {
      return toast.error(`Select ${badSerialLine.quantity} distinct serial number(s) for ${badSerialLine.name}, or leave them all unselected`);
    }
    // An initial payment has to land somewhere — a sale with no payment is unaffected.
    if (paymentAmount > 0 && !paymentAccount) return toast.error('Select the account the payment goes into');
    setSaving(true);
    try {
      const payload = {
        customer,
        items: cart.map(({ product, quantity, unitPrice, discount, comments, name, model, ram, processor, storage, serials }) => ({
          product,
          name: name.trim(),
          model: model || '',
          ram: ram || '',
          processor: processor || '',
          storage: storage || '',
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
          discount: Number(discount || 0),
          comments: comments || '',
          serials: compactSerials(serials),
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

  // A sale posts money and moves stock; the control is latched while in flight.
  const { run: submit, pending: submitting } = useSubmit(doSubmit);

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader
        title="Point of Sale"
        subtitle="Create a new sale and invoice"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6h15l-1.5 9h-12zM6 6 5 3H2m4 18a1 1 0 1 1 0-2 1 1 0 0 1 0 2m12 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2" /></svg>}
      />
      <div className="page page-w grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT: catalog + cart */}
        <div className="lg:col-span-3 space-y-4">
          {/* Barcode scan */}
          <div className="card p-4">
            {/* autoFocus is applied only on a pointer device: on a phone it would
                open the keyboard over the catalogue the moment the till loads. */}
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
                  autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
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
                            {/* Two machines often differ only by memory and storage, so
                                the specification belongs on the card the salesperson picks. */}
                            {specLine(p) && <div className="text-[11px] text-ink-500 mt-0.5 truncate">{specLine(p)}</div>}
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
              <div className="hidden sm:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="th">Item</th>
                      <th scope="col" className="th">Comments</th>
                      <th scope="col" className="th text-center w-28">Qty</th>
                      <th scope="col" className="th text-right">Price</th>
                      <th scope="col" className="th text-right">Disc.</th>
                      <th scope="col" className="th text-right">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line, i) => (
                      <tr key={i} className="tr align-top">
                        <td className="td min-w-[16rem]">
                          <input
                            className="input input-sm w-full font-medium"
                            aria-label="Item name"
                            value={line.name}
                            onChange={(e) => updateLine(i, { name: e.target.value })}
                          />
                          <div className="t-meta font-mono mt-1">{line.sku} · {line.stock} avail.</div>
                          {/* Specification snapshot for this sale line — starts from the
                              product's own values, freely correctable, never written back. */}
                          <div className="mt-1.5 grid grid-cols-2 gap-1">
                            <input className="input input-sm" placeholder="Model" aria-label="Model" value={line.model || ''} onChange={(e) => updateLine(i, { model: e.target.value })} />
                            <input className="input input-sm" placeholder="RAM" aria-label="RAM" value={line.ram || ''} onChange={(e) => updateLine(i, { ram: e.target.value })} />
                            <input className="input input-sm" placeholder="Processor" aria-label="Processor" value={line.processor || ''} onChange={(e) => updateLine(i, { processor: e.target.value })} />
                            <input className="input input-sm" placeholder="Storage" aria-label="Storage" value={line.storage || ''} onChange={(e) => updateLine(i, { storage: e.target.value })} />
                          </div>
                          {line.tracksSerials && (
                            <div className="mt-1.5">
                              <div className="t-meta mb-1">Serial number{line.serials.length === 1 ? '' : 's'}</div>
                              <div className="flex flex-wrap gap-1">
                                {line.serials.map((chosen, slot) => (
                                  <select
                                    key={slot}
                                    className="select input-sm"
                                    aria-label={`Serial number ${slot + 1}`}
                                    value={chosen}
                                    onChange={(e) => updateSerialSlot(i, slot, e.target.value)}
                                  >
                                    <option value="">— select —</option>
                                    {line.availableSerials
                                      .filter((sn) => sn === chosen || !line.serials.includes(sn))
                                      .map((sn) => <option key={sn} value={sn}>{sn}</option>)}
                                  </select>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="td">
                          <input
                            className="input input-sm w-36"
                            placeholder="Note about this unit…"
                            value={line.comments || ''}
                            onChange={(e) => updateLine(i, { comments: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <div className="inline-flex items-center rounded-lg border border-ink-200 overflow-hidden">
                            <button type="button" onClick={() => updateQuantity(i, clampQuantity((Number(line.quantity) || 0) - 1, line.stock))} className="px-2 py-1 text-ink-500 hover:bg-ink-50">−</button>
                            <input
                              type="number" min="1" max={line.stock}
                              className="w-10 text-center text-sm py-1 outline-none num [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                              value={line.quantity}
                              onChange={(e) => updateQuantity(i, clampQuantity(e.target.value, line.stock))}
                              onBlur={() => { if (!isValidQuantity(line.quantity, line.stock)) updateQuantity(i, 1); }}
                            />
                            <button type="button" onClick={() => updateQuantity(i, clampQuantity((Number(line.quantity) || 0) + 1, line.stock))} className="px-2 py-1 text-ink-500 hover:bg-ink-50">+</button>
                          </div>
                        </td>
                        <td className="td text-right">
                          <input type="number" step="0.01" className="input input-sm w-24 text-right num input-money" value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                        </td>
                        <td className="td text-right">
                          <input type="number" step="0.01" className="input input-sm w-20 text-right num input-money" value={line.discount} onChange={(e) => updateLine(i, { discount: e.target.value })} />
                        </td>
                        <td className="td text-right font-semibold text-ink-900 num whitespace-nowrap">
                          {money(Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)), currency)}
                        </td>
                        <td className="td text-right">
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

            {/* Phone: the same cart state as editable cards. A six-column table
                with number inputs cannot be operated with a thumb, and sideways
                scrolling is not an acceptable answer for the till screen. */}
            {cart.length > 0 && (
              <ul className="sm:hidden divide-y divide-ink-100">
                {cart.map((line, i) => (
                  <li key={i} className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <input
                          className="input input-sm w-full font-medium"
                          aria-label="Item name"
                          value={line.name}
                          onChange={(e) => updateLine(i, { name: e.target.value })}
                        />
                        <div className="t-meta font-mono truncate mt-1">{line.sku} · {line.stock} avail.</div>
                      </div>
                      <button
                        className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50 shrink-0 -mt-1 -mr-1"
                        onClick={() => removeLine(i)}
                        aria-label={`Remove ${line.name} from the cart`}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg>
                      </button>
                    </div>

                    {/* Specification snapshot for this sale line — same rule as desktop:
                        starts from the product, freely correctable, never written back. */}
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <input className="input input-sm" placeholder="Model" aria-label="Model" value={line.model || ''} onChange={(e) => updateLine(i, { model: e.target.value })} />
                      <input className="input input-sm" placeholder="RAM" aria-label="RAM" value={line.ram || ''} onChange={(e) => updateLine(i, { ram: e.target.value })} />
                      <input className="input input-sm" placeholder="Processor" aria-label="Processor" value={line.processor || ''} onChange={(e) => updateLine(i, { processor: e.target.value })} />
                      <input className="input input-sm" placeholder="Storage" aria-label="Storage" value={line.storage || ''} onChange={(e) => updateLine(i, { storage: e.target.value })} />
                    </div>
                    {line.tracksSerials && (
                      <div className="mt-2">
                        <div className="t-meta mb-1">Serial number{line.serials.length === 1 ? '' : 's'}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {line.serials.map((chosen, slot) => (
                            <select
                              key={slot}
                              className="select input-sm"
                              aria-label={`Serial number ${slot + 1}`}
                              value={chosen}
                              onChange={(e) => updateSerialSlot(i, slot, e.target.value)}
                            >
                              <option value="">— select —</option>
                              {line.availableSerials
                                .filter((sn) => sn === chosen || !line.serials.includes(sn))
                                .map((sn) => <option key={sn} value={sn}>{sn}</option>)}
                            </select>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="inline-flex items-center rounded-md border border-ink-200 overflow-hidden shrink-0">
                        <button type="button" aria-label="Decrease quantity"
                                onClick={() => updateQuantity(i, clampQuantity((Number(line.quantity) || 0) - 1, line.stock))}
                                className="w-11 h-11 text-lg text-ink-600 active:bg-ink-100">−</button>
                        <input
                          type="number" inputMode="numeric" min="1" max={line.stock}
                          aria-label={`Quantity of ${line.name}`}
                          className="w-12 h-11 text-center text-sm outline-none num [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          value={line.quantity}
                          onChange={(e) => updateQuantity(i, clampQuantity(e.target.value, line.stock))}
                          onBlur={() => { if (!isValidQuantity(line.quantity, line.stock)) updateQuantity(i, 1); }}
                        />
                        <button type="button" aria-label="Increase quantity"
                                onClick={() => updateQuantity(i, clampQuantity((Number(line.quantity) || 0) + 1, line.stock))}
                                className="w-11 h-11 text-lg text-ink-600 active:bg-ink-100">+</button>
                      </div>
                      <span className="ml-auto text-right">
                        <span className="block t-meta">Line total</span>
                        <span className="num font-semibold text-ink-900 whitespace-nowrap">
                          {money(Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)), currency)}
                        </span>
                      </span>
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`pos-price-${i}`} className="t-meta block mb-1">Unit price</label>
                        <input id={`pos-price-${i}`} type="number" inputMode="decimal" step="0.01"
                               className="input input-sm text-right num input-money w-full" value={line.unitPrice}
                               onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                      </div>
                      <div>
                        <label htmlFor={`pos-disc-${i}`} className="t-meta block mb-1">Discount</label>
                        <input id={`pos-disc-${i}`} type="number" inputMode="decimal" step="0.01"
                               className="input input-sm text-right num input-money w-full" value={line.discount}
                               onChange={(e) => updateLine(i, { discount: e.target.value })} />
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <label htmlFor={`pos-comments-${i}`} className="t-meta block mb-1">Comments</label>
                      <input id={`pos-comments-${i}`} className="input input-sm w-full"
                             placeholder="Note about this unit…" value={line.comments || ''}
                             onChange={(e) => updateLine(i, { comments: e.target.value })} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: checkout */}
        <div className="lg:col-span-2">
          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="card p-5 space-y-3">
              <div>
                <Combobox
                  id="pos-customer-26"
                  label="Customer"
                  required
                  path="/customers"
                  value={customer}
                  onChange={setCustomer}
                  placeholder="Search customers…"
                  getHint={(c) => [c.company, c.phone].filter(Boolean).join(' · ')}
                  emptyHint="No customer found"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pos-discount-27" className="label">Discount</label>
                  <input id="pos-discount-27" className="input num input-money" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Enter amount" />
                </div>
                <div>
                  <label htmlFor="pos-tax-28" className="label">Tax %</label>
                  <input id="pos-tax-28" className="input num" type="number" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="pos-notes-29" className="label">Notes</label>
                <textarea id="pos-notes-29" className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note for this invoice…" />
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
                  <label htmlFor="pos-initial-payment-30" className="label">Initial Payment</label>
                  <input id="pos-initial-payment-30" className="input num input-money" type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Enter amount" />
                </div>
                <div>
                  <label htmlFor="pos-method-31" className="label">Method</label>
                  <select id="pos-method-31" className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              {paymentAmount > 0 && (
                <div className="mt-3">
                  <label htmlFor="pos-deposit-to-32" className="label">Deposit To <span className="text-red-500">*</span></label>
                  <select id="pos-deposit-to-32" className="select" value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)}>
                    <option value="">— select account —</option>
                    {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <button className="btn-primary btn-lg w-full mt-5" onClick={submit} disabled={saving || submitting || cart.length === 0}>
                {saving || submitting ? <><Spinner className="w-4 h-4" /> Saving…</> : <>Save Invoice · {money(totals.total, currency)}</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Phone: the total and the primary action stay in the thumb zone. The
          checkout panel is otherwise below the catalogue and the whole cart, so
          completing a sale meant scrolling past everything first. */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_10px_rgba(16,24,40,0.06)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="t-meta">{itemCount} item{itemCount === 1 ? '' : 's'} · Total</div>
              <div className="num font-semibold text-[17px] text-ink-900 truncate">{money(totals.total, currency)}</div>
            </div>
            <button
              className="btn-primary btn-lg shrink-0"
              onClick={submit}
              disabled={saving || submitting || cart.length === 0}
            >
              {saving || submitting ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Invoice'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}