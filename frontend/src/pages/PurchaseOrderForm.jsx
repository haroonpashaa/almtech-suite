import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { clampQuantity, isValidQuantity } from '../lib/quantity.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Combobox from '../components/Combobox.jsx';
import { Spinner } from '../components/ui.jsx';

// A line with anything already received keeps that as its floor instead of the
// usual minimum of 1 — Rule 2: ordered quantity may never drop below what's
// already been received, since receiveItems has no notion of "un-receiving".
function clampOrderedQuantity(raw, floor) {
  const c = clampQuantity(raw);
  if (c === '') return '';
  return Math.max(floor || 1, c);
}
function isValidOrderedQuantity(value, floor) {
  return isValidQuantity(value) && Number(value) >= (floor || 1);
}

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [taxRate, setTaxRate] = useState(0);
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: po } = useQuery({
    enabled: !!id,
    queryKey: ['po', id],
    queryFn: async () => (await api.get(`/purchase-orders/${id}`)).data,
  });

  useEffect(() => {
    if (!po) return;
    setSupplier(po.supplier?._id || po.supplier || '');
    setCart(po.items.map((l) => ({
      product: l.product?._id || l.product, name: l.name, sku: l.sku,
      quantity: l.quantity, unitCost: l.unitCost, received: l.received || 0,
    })));
    setTaxRate(po.taxRate || 0);
    setExpectedAt(po.expectedAt ? po.expectedAt.slice(0, 10) : '');
    setNotes(po.notes || '');
  }, [po]);

  const { data: products } = useQuery({
    queryKey: ['products-po', search],
    queryFn: async () => (await api.get('/products', { params: { q: search } })).data,
  });
  const currency = useCurrency();

  // Financial fields (supplier/items/tax) are editable only while nothing has
  // been paid and the order isn't fully received (Rules 3 & 4) — this system
  // keeps no per-receipt cost history, so a partially-received line's cost can't
  // be safely split, and a paid PO's total can't change without risking a
  // mismatched balance. New (create) always allows full editing.
  const isEdit = !!id;
  const canEditFinancials = !isEdit || (po && po.paid === 0 && po.status !== 'received' && po.status !== 'cancelled');
  const anyReceivedAnywhere = isEdit && cart.some((l) => l.received > 0);
  const canChangeSupplier = canEditFinancials && !anyReceivedAnywhere;
  const lockedReason = isEdit && po && !canEditFinancials
    ? (po.paid > 0
      ? 'This purchase order has payments recorded against it, so its items, supplier and cost details can no longer be edited. Only notes and expected delivery can still be changed.'
      : 'This purchase order has been fully received, so its items, supplier and cost details are locked. Only notes and expected delivery can still be changed.')
    : null;

  function addToCart(p) {
    setCart((c) => {
      if (c.find((x) => x.product === p._id)) return c;
      return [...c, { product: p._id, name: p.name, sku: p.sku, unitCost: p.purchasePrice, quantity: 1, received: 0 }];
    });
  }
  function setLine(i, patch) {
    setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i) {
    setCart((c) => (c[i]?.received > 0 ? c : c.filter((_, j) => j !== i)));
  }
  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
    const tax = Math.round(subtotal * (Number(taxRate || 0) / 100) * 100) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [cart, taxRate]);

  async function submit() {
    if (!supplier || !cart.length) return toast.error('Supplier and items required');
    if (canEditFinancials) {
      const invalidQty = cart.find((l) => !isValidOrderedQuantity(l.quantity, l.received));
      if (invalidQty) return toast.error(`Enter a valid quantity for ${invalidQty.name} (at least ${invalidQty.received || 1})`);
      const invalidCost = cart.find((l) => l.unitCost === '' || !Number.isFinite(Number(l.unitCost)) || Number(l.unitCost) < 0);
      if (invalidCost) return toast.error(`Enter a valid unit cost for ${invalidCost.name}`);
    }
    setSaving(true);
    try {
      if (isEdit) {
        const payload = { expectedUpdatedAt: po.updatedAt, notes, expectedAt: expectedAt || undefined };
        if (canEditFinancials) {
          payload.supplier = supplier;
          payload.items = cart.map(({ product, quantity, unitCost }) => ({ product, quantity: Number(quantity), unitCost: Number(unitCost) }));
          payload.taxRate = Number(taxRate || 0);
        }
        const r = await api.patch(`/purchase-orders/${id}`, payload);
        toast.success(`PO ${r.data.number} updated`);
        navigate(`/purchase-orders/${id}`);
      } else {
        const r = await api.post('/purchase-orders', {
          supplier,
          items: cart.map(({ product, quantity, unitCost }) => ({ product, quantity: Number(quantity), unitCost: Number(unitCost) })),
          taxRate: Number(taxRate || 0),
          expectedAt: expectedAt || undefined,
          notes,
        });
        toast.success(`PO ${r.data.number} created`);
        navigate(`/purchase-orders/${r.data._id}`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (isEdit && !po) return null;

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: 'Purchase Orders', to: '/purchase-orders' },
          isEdit ? { label: po.number, to: `/purchase-orders/${id}` } : null,
          { label: isEdit ? 'Edit' : 'New' },
        ].filter(Boolean)}
        title={isEdit ? `Edit ${po.number}` : 'New Purchase Order'}
        subtitle={isEdit ? 'Update this purchase order' : 'Order stock from a supplier'}
      />
      <div className="page page-w grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          {lockedReason && (
            <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
              {lockedReason}
            </p>
          )}
          {canEditFinancials && (
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
          )}
          <div className="card overflow-hidden">
            {cart.length === 0 ? (
              <div className="text-center text-sm text-ink-400 py-12">No items yet — add products above.</div>
            ) : (
              <table className="hidden sm:table min-w-full text-sm">
                <thead><tr className="border-b border-ink-100 bg-ink-25 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  <th scope="col" className="th">Item</th>
                  {isEdit && <th scope="col" className="th text-right">Received</th>}
                  <th scope="col" className="th text-right">Qty</th>
                  <th scope="col" className="th text-right">Unit Cost</th>
                  <th scope="col" className="th text-right">Line Total</th>
                  {canEditFinancials && <th className="w-10"></th>}
                </tr></thead>
                <tbody>
                  {cart.map((line, i) => {
                    const costLocked = !canEditFinancials || line.received > 0;
                    return (
                      <tr key={i} className="tr">
                        <td className="td"><div className="font-medium text-ink-900">{line.name}</div><div className="t-meta font-mono">{line.sku}</div></td>
                        {isEdit && <td className="td text-right num text-ink-700">{line.received}</td>}
                        <td className="td text-right">
                          {canEditFinancials ? (
                            <input className="input input-sm w-16 text-right num" type="number" min={line.received || 1} value={line.quantity}
                                   onChange={(e) => setLine(i, { quantity: clampOrderedQuantity(e.target.value, line.received) })}
                                   onBlur={() => { if (!isValidOrderedQuantity(line.quantity, line.received)) setLine(i, { quantity: line.received || 1 }); }} />
                          ) : <span className="num text-ink-700">{line.quantity}</span>}
                        </td>
                        <td className="td text-right">
                          {costLocked
                            ? <span className="num text-ink-500" title={line.received > 0 ? 'Cost is locked once any unit has been received' : undefined}>{money(line.unitCost, currency)}</span>
                            : <input className="input input-sm w-24 text-right num" type="number" step="0.01" value={line.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />}
                        </td>
                        <td className="td text-right num font-semibold text-ink-900 whitespace-nowrap">{money((Number(line.quantity) || 0) * (Number(line.unitCost) || 0), currency)}</td>
                        {canEditFinancials && (
                          <td className="td text-right">
                            {line.received > 0 ? (
                              <span className="text-ink-300" title="Already received — cannot be removed">—</span>
                            ) : (
                              <button className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50" onClick={() => removeLine(i)} aria-label="Remove"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg></button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Phone: the same line state as editable cards. The desktop table is
                dense by design; on a phone its number inputs are unusable and
                sideways scrolling is not an acceptable substitute. */}
            {cart.length > 0 && (
              <ul className="sm:hidden divide-y divide-ink-100">
                {cart.map((line, i) => {
                  const costLocked = !canEditFinancials || line.received > 0;
                  return (
                    <li key={i} className="p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-ink-900 text-[13.5px] leading-snug">{line.name}</div>
                          <div className="t-meta font-mono truncate">{line.sku}{isEdit ? ` · ${line.received} received` : ''}</div>
                        </div>
                        {canEditFinancials && line.received === 0 && (
                          <button className="btn-icon text-ink-300 hover:text-red-600 hover:bg-red-50 shrink-0 -mt-1 -mr-1"
                                  onClick={() => removeLine(i)} aria-label={`Remove ${line.name}`}>
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /></svg>
                          </button>
                        )}
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor={`po-line-qty-${i}`} className="t-meta block mb-1">Quantity</label>
                          {canEditFinancials ? (
                            <input id={`po-line-qty-${i}`} className="input input-sm text-right num w-full" type="number" inputMode="numeric" min={line.received || 1}
                                   value={line.quantity}
                                   onChange={(e) => setLine(i, { quantity: clampOrderedQuantity(e.target.value, line.received) })}
                                   onBlur={() => { if (!isValidOrderedQuantity(line.quantity, line.received)) setLine(i, { quantity: line.received || 1 }); }} />
                          ) : <div className="input input-sm text-right num w-full bg-ink-25">{line.quantity}</div>}
                        </div>
                        <div>
                          <label htmlFor={`po-line-cost-${i}`} className="t-meta block mb-1">Unit cost</label>
                          {costLocked ? (
                            <div className="input input-sm text-right num w-full bg-ink-25">{money(line.unitCost, currency)}</div>
                          ) : (
                            <input id={`po-line-cost-${i}`} className="input input-sm text-right num w-full" type="number" inputMode="decimal" step="0.01"
                                   value={line.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-baseline justify-between">
                        <span className="t-meta">Line total</span>
                        <span className="num font-semibold text-ink-900">{money((Number(line.quantity) || 0) * (Number(line.unitCost) || 0), currency)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="card p-5 space-y-3">
              <div>
                {canChangeSupplier ? (
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
                ) : (
                  <div>
                    <label className="label">Supplier</label>
                    <div className="input bg-ink-25 text-ink-700">{po?.supplier?.name || '—'}</div>
                    {isEdit && anyReceivedAnywhere && <p className="text-xs text-ink-400 mt-1">Cannot be changed once any item has been received.</p>}
                  </div>
                )}
              </div>
              <div><label htmlFor="purchaseorderform-expected-delivery-207" className="label">Expected Delivery</label><input id="purchaseorderform-expected-delivery-207" className="input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></div>
              {canEditFinancials ? (
                <div><label htmlFor="purchaseorderform-tax-208" className="label">Tax %</label><input id="purchaseorderform-tax-208" className="input num" type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
              ) : (
                <div><label className="label">Tax %</label><div className="input bg-ink-25 text-ink-700 num">{taxRate}</div></div>
              )}
              <div><label htmlFor="purchaseorderform-notes-209" className="label">Notes</label><textarea id="purchaseorderform-notes-209" className="input" rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div className="card p-5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-ink-500">Subtotal</span><span className="num text-ink-700">{money(totals.subtotal, currency)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-ink-500">Tax</span><span className="num text-ink-700">{money(totals.tax, currency)}</span></div>
              </div>
              <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100"><span className="text-sm font-medium text-ink-900">Total</span><span className="text-2xl font-semibold num text-ink-900">{money(totals.total, currency)}</span></div>
              <button className="btn-primary btn-lg w-full mt-4" disabled={saving || !cart.length} onClick={submit}>{saving ? <><Spinner className="w-4 h-4" /> Saving…</> : isEdit ? 'Save Changes' : 'Save Purchase Order'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
