import { useEffect, useMemo, useRef, useState } from 'react';
import { useSubmit } from '../hooks/useSubmit.js';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { newIdempotencyKey } from '../lib/idempotency.js';
import { money, errorMessage } from '../lib/format.js';
import { clampQuantity, isValidQuantity } from '../lib/quantity.js';
import { resizeSerials, compactSerials, serialsAreSubmittable } from '../lib/cartSerials.js';
import { parsePricingPaste } from '../lib/pricingPaste.js';
import { allocateBulkPrice } from '../lib/bulkPricing.js';
import { addPosStockSelection, loadAllPosStock, selectPosStock } from '../lib/posStockSelection.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePagedList } from '../hooks/usePagedList.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Combobox from '../components/Combobox.jsx';
import POSProductPicker from '../components/POSProductPicker.jsx';
import { Spinner } from '../components/ui.jsx';
import DealSelector from '../components/DealSelector.jsx';
import {
  addPosCartItem,
  buildPosProductParams,
  calculatePosTotals,
  emptyPosProductFilters,
  removePosCartItem,
} from '../lib/posProductSelection.js';

export default function POS() {
  const navigate = useNavigate();
  const auth = useAuth();
  const canSetBulkPrice = !!auth?.has('admin');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkAmount, setBulkAmount] = useState('');
  const isBulk = canSetBulkPrice && bulkMode;
  const [productFilters, setProductFilters] = useState(emptyPosProductFilters);
  const [selectedSerials, setSelectedSerials] = useState({});
  const [customer, setCustomer] = useState('');
  const [dealId, setDealId] = useState('');
  const [cart, setCart] = useState([]);
  const [stockSelection, setStockSelection] = useState({});
  const [selectingAllStock, setSelectingAllStock] = useState(false);
  const selectionRequest = useRef(0);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  useEffect(() => () => { selectionRequest.current += 1; }, []);
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentAccount, setPaymentAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // One key per sale attempt (ALM-SEC-009), covering the optional initial
  // payment — reused across retries of the same attempt, rotated once the
  // sale actually succeeds.
  const [payKey, setPayKey] = useState(newIdempotencyKey);
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const barcodeRef = useRef(null);

  const modelOptions = useQuery({
    queryKey: ['products-pos-models'],
    queryFn: async () => (await api.get('/products/pos/models')).data,
    staleTime: 5 * 60 * 1000,
  });
  const productList = usePagedList({
    key: ['products-pos', productFilters],
    path: '/products/pos',
    params: buildPosProductParams(productFilters),
    limit: 30,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const currency = useCurrency();

  const stockPreview = useMemo(() => addPosStockSelection(cart, Object.values(stockSelection), selectedSerials), [cart, stockSelection, selectedSerials]);
  const pendingStockSelection = selectingAllStock || Object.keys(stockSelection).length > 0;
  function changeProductFilters(filters) {
    selectionRequest.current += 1;
    setSelectingAllStock(false);
    setProductFilters(filters);
  }
  function toggleStock(product) {
    setStockSelection(current => {
      if (!current[product._id]) return selectPosStock(current, [product], cart);
      const next = { ...current };
      delete next[product._id];
      return next;
    });
  }
  function clearStockSelection() {
    selectionRequest.current += 1;
    setSelectingAllStock(false);
    setStockSelection({});
  }
  async function selectAllStock() {
    const request = ++selectionRequest.current;
    const params = buildPosProductParams(productFilters);
    setSelectingAllStock(true);
    try {
      const products = await loadAllPosStock(async (page, limit) => {
        if (request !== selectionRequest.current) throw new Error('Selection cancelled');
        return (await api.get('/products/pos', { params: { ...params, page, limit } })).data;
      });
      if (request !== selectionRequest.current) return;
      setStockSelection(current => selectPosStock(current, products, cartRef.current));
    } catch (error) {
      if (request === selectionRequest.current) toast.error(errorMessage(error));
    } finally {
      if (request === selectionRequest.current) setSelectingAllStock(false);
    }
  }
  function addSelectedStock() {
    if (selectingAllStock) return;
    if (stockPreview.error) return toast.error(stockPreview.error);
    setCart(stockPreview.cart);
    setSelectedSerials(current => Object.fromEntries(Object.entries(current).filter(([id]) => !stockSelection[id])));
    setStockSelection({});
    toast.success('Selected stock added to the cart. Review quantities and the selling amount before saving.');
  }

  function addToCart(p, serial = '') {
    const attempt = addPosCartItem(cart, p, serial);
    if (attempt.error) return toast.error(attempt.error);
    setCart((current) => addPosCartItem(current, p, serial).cart);
    if (serial) setSelectedSerials((current) => ({ ...current, [p._id]: '' }));
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
  function pastePrices(startIndex, event) {
    if (isBulk) return;
    const pasted = event.clipboardData?.getData('text');
    if (!pasted || !/[\t\r\n]/.test(pasted)) return;
    event.preventDefault();
    try {
      const prices = parsePricingPaste(pasted, cart.length - startIndex);
      setCart((current) => current.map((line, i) => (i >= startIndex && i < startIndex + prices.length ? { ...line, unitPrice: prices[i - startIndex] } : line)));
      toast.success(`${prices.length} price${prices.length === 1 ? '' : 's'} pasted. Review the totals before saving.`);
    } catch (error) { toast.error(error.message); }
  }
  // Quantity changes go through here rather than updateLine directly, because a
  // tracksSerials line's serial slots must grow or shrink in step with it.
  // A blank input is temporary editing state; keep its selections until the
  // next quantity (or the existing blur fallback) determines the slot count.
  function updateQuantity(idx, quantity) {
    setCart((c) => c.map((line, i) => {
      if (i !== idx) return line;
      return { ...line, quantity, serials: line.tracksSerials && quantity !== '' ? resizeSerials(line.serials, quantity) : line.serials };
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
    setCart((c) => removePosCartItem(c, idx));
  }

  const bulkPreview = useMemo(() => {
    if (!isBulk) return null;
    try { return allocateBulkPrice(cart.map(line => ({ ...line, quantity: line.quantity === '' ? 0 : Number(line.quantity) })), bulkAmount); }
    catch (error) { return { error: error.message }; }
  }, [isBulk, cart, bulkAmount]);
  const pricedCart = bulkPreview?.items || cart;
  const totals = useMemo(() => bulkPreview?.items
    ? calculatePosTotals([{ quantity: 1, unitPrice: bulkPreview.subtotal }], discount, taxRate)
    : calculatePosTotals(cart, discount, taxRate), [cart, discount, taxRate, bulkPreview]);

  const itemCount = cart.reduce((s, l) => s + Number(l.quantity || 0), 0);

  async function doSubmit() {
    if (pendingStockSelection) return toast.error('Add the selected stock to the cart or deselect it before saving the invoice');
    if (!customer) return toast.error('Select a customer');
    if (!cart.length) return toast.error('Cart is empty');
    if (isBulk && bulkPreview?.error) return toast.error(bulkPreview.error);
    const invalidLine = cart.find((l) => !isValidQuantity(l.quantity, l.stock));
    if (invalidLine) return toast.error(`Enter a valid quantity for ${invalidLine.name} (1–${invalidLine.stock})`);
    // A blank price field can now genuinely stay blank while editing (that's the fix —
    // it no longer snaps back to a confusing "0" on every keystroke), so unlike before,
    // it really can still be blank at submit time. Catch that here rather than letting
    // it silently become a $0 line.
    const invalidPriceLine = cart.find((l) => l.unitPrice === '' || !Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0);
    if (!isBulk && invalidPriceLine) return toast.error(`Enter a valid price for ${invalidPriceLine.name}`);
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
        dealId: dealId || undefined,
        ...(isBulk ? { bulkSellingTotal: bulkPreview.subtotal } : {}),
        items: pricedCart.map(({ product, quantity, unitPrice, discount, comments, name, model, ram, processor, storage, serials }) => ({
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
            ? { amount: Number(paymentAmount), method: paymentMethod, account: paymentAccount, idempotencyKey: payKey }
            : undefined,
      };
      const r = await api.post('/invoices', payload);
      toast.success(`Invoice ${r.data.number} created`);
      setPayKey(newIdempotencyKey());
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

          <POSProductPicker
            filters={productFilters}
            models={modelOptions.data || []}
            modelsLoading={modelOptions.isLoading}
            modelsError={modelOptions.isError}
            onFiltersChange={changeProductFilters}
            products={productList.rows}
            loading={productList.isLoading}
            error={productList.isError}
            total={productList.total}
            page={productList.page}
            limit={productList.limit}
            onPageChange={productList.setPage}
            cart={cart}
            selectedSerials={selectedSerials}
            onSerialChange={(productId, serial) => setSelectedSerials((current) => ({ ...current, [productId]: serial }))}
            onAdd={addToCart}
            currency={currency}
            formatMoney={money}
            bulkSelection={canSetBulkPrice ? {
              items: stockSelection,
              loading: selectingAllStock,
              error: Object.keys(stockSelection).length ? stockPreview.error : null,
              onToggle: toggleStock,
              onQuantityChange: (product, quantity) => setStockSelection(current => ({ ...current, [product._id]: { product, quantity } })),
              onSelectAll: selectAllStock,
              onClear: clearStockSelection,
              onAdd: addSelectedStock,
            } : null}
          />

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
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="th">Product / model</th>
                      <th scope="col" className="th min-w-40">Serial number</th>
                      <th scope="col" className="th">Comments</th>
                      <th scope="col" className="th text-center w-28">Qty</th>
                      <th scope="col" className="th text-right">Price</th>
                      <th scope="col" className="th text-right">Disc.</th>
                      <th scope="col" className="th text-right">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricedCart.map((line, i) => (
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
                        </td>
                        <td className="td">
                          {line.tracksSerials ? (
                            <div className="space-y-1">
                              {line.serials.map((chosen, slot) => (
                                <select key={slot} className="select input-sm" aria-label={`Serial number ${slot + 1}`} value={chosen} onChange={(e) => updateSerialSlot(i, slot, e.target.value)}>
                                  <option value="">— select —</option>
                                  {line.availableSerials.filter((sn) => sn === chosen || !line.serials.includes(sn)).map((sn) => <option key={sn} value={sn}>{sn}</option>)}
                                </select>
                              ))}
                            </div>
                          ) : '—'}
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
                          <input type="number" step="0.01" aria-label="Selling price per unit" readOnly={isBulk} className="input input-sm w-24 text-right num input-money" value={line.unitPrice} onPaste={(e) => pastePrices(i, e)} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                        </td>
                        <td className="td text-right">
                          <input type="number" step="0.01" aria-label="Line discount" readOnly={isBulk} className="input input-sm w-20 text-right num input-money" value={line.discount} onChange={(e) => updateLine(i, { discount: e.target.value })} />
                        </td>
                        <td className="td text-right font-semibold text-ink-900 num whitespace-nowrap">
                          {money(line.lineTotal ?? Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)), currency)}
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
                {pricedCart.map((line, i) => (
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
                          {money(line.lineTotal ?? Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)), currency)}
                        </span>
                      </span>
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`pos-price-${i}`} className="t-meta block mb-1">Unit price</label>
                        <input id={`pos-price-${i}`} type="number" inputMode="decimal" step="0.01"
                               aria-label="Selling price per unit" readOnly={isBulk} className="input input-sm text-right num input-money w-full" value={line.unitPrice}
                               onPaste={(e) => pastePrices(i, e)} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                      </div>
                      <div>
                        <label htmlFor={`pos-disc-${i}`} className="t-meta block mb-1">Discount</label>
                        <input id={`pos-disc-${i}`} type="number" inputMode="decimal" step="0.01"
                               aria-label="Line discount" readOnly={isBulk} className="input input-sm text-right num input-money w-full" value={line.discount}
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
              <DealSelector value={dealId} onChange={setDealId} id="pos-deal" />
              {canSetBulkPrice && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
                    <input id="pos-bulk-mode" type="checkbox" checked={bulkMode} onChange={(e) => setBulkMode(e.target.checked)} />
                    Bulk sale — one batch price
                  </label>
                  {isBulk && (
                    <div>
                      <label htmlFor="pos-bulk-selling-total" className="label">Batch selling amount ({currency}) <span className="text-red-500">*</span></label>
                      <input id="pos-bulk-selling-total" className="input num input-money" type="number" inputMode="decimal" min="0.01" step="0.01" required value={bulkAmount} onChange={(e) => setBulkAmount(e.target.value)} placeholder="Total amount for the whole batch" aria-describedby="pos-bulk-help pos-bulk-error" aria-invalid={!!bulkPreview?.error} />
                      <p id="pos-bulk-help" className="text-xs text-ink-500 mt-1">For all {itemCount} selected items in the cart, before invoice discount and tax. The amount is shared equally per unit; line discounts handle penny rounding. Buying costs stay unchanged.</p>
                      {bulkPreview?.error && <p id="pos-bulk-error" role="alert" className="text-xs text-red-600 mt-1">{bulkPreview.error}</p>}
                    </div>
                  )}
                </div>
              )}
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
              {pendingStockSelection && <p role="status" className="text-sm text-ink-600 mt-4">Add the selected stock to the cart or deselect it before saving.</p>}
              <button className="btn-primary btn-lg w-full mt-5" onClick={submit} disabled={saving || submitting || pendingStockSelection || cart.length === 0 || !!bulkPreview?.error}>
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
              disabled={saving || submitting || pendingStockSelection || cart.length === 0 || !!bulkPreview?.error}
            >
              {saving || submitting ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Invoice'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
