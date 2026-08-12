import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { useCurrency } from '../hooks/useSettings.js';
import { money, date as fmtDate, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import DocumentActions from '../components/DocumentActions.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import Money from '../components/Money.jsx';
import { Badge, LoadingBlock, Spinner, EmptyState } from '../components/ui.jsx';

const poTone = { received: 'success', partial: 'warning', ordered: 'info', cancelled: 'neutral', draft: 'neutral' };

const LEDGER_LABELS = {
  opening_balance: 'Opening balance',
  purchase: 'Purchase order',
  payment: 'Payment',
  payment_reversal: 'Payment reversal',
};

export default function SupplierDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const currency = useCurrency();
  const canManage = has('admin', 'stock');
  const canSeeLedger = has('admin');

  const [tab, setTab] = useState('orders');
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => (await api.get(`/suppliers/${id}`)).data,
  });

  // The ledger is a separate admin-only statement; stock users simply never request it.
  const ledger = useQuery({
    enabled: canSeeLedger && tab === 'ledger',
    queryKey: ['supplier-ledger', id],
    queryFn: async () => (await api.get(`/suppliers/${id}/ledger`)).data,
  });

  function openEdit() {
    const s = data.supplier;
    setForm({
      name: s.name || '', contactPerson: s.contactPerson || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '', taxNumber: s.taxNumber || '',
      notes: s.notes || '', active: s.active !== false,
    });
    setError(null);
    setEditOpen(true);
  }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e?.preventDefault();
    if (!form.name.trim()) return setError('Supplier name is required');
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/suppliers/${id}`, form);
      toast.success('Supplier updated');
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ['supplier', id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <LoadingBlock />;
  if (isError || !data) {
    return (
      <div className="p-8">
        <EmptyState
          tone="danger"
          title="Supplier not found"
          description="This supplier may have been removed, or the link is incorrect."
          action={
            <span className="inline-flex gap-2">
              <button className="btn-secondary" onClick={() => refetch()}>Try again</button>
              <Link to="/suppliers" className="btn-primary">Back to suppliers</Link>
            </span>
          }
        />
      </div>
    );
  }

  const s = data.supplier;
  const sum = data.summary;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Purchasing', to: '/purchase-orders' }, { label: 'Suppliers', to: '/suppliers' }, { label: s.name }]}
        title={s.name}
        subtitle={[s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details recorded'}
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 9h2m4 0h1M10 21v-4h4v4" /></svg>}
        actions={
          <>
            {s.active === false && <Badge tone="neutral" dot>inactive</Badge>}
            {canSeeLedger && (
              <DocumentActions path={`/suppliers/${id}/statement/pdf`} filename={`statement-${s.name}`} label="Statement" />
            )}
            {canManage && <button className="btn-secondary" onClick={openEdit}>Edit</button>}
            {canManage && s.active !== false && (
              <Link to="/purchase-orders/new" className="btn-primary">New Purchase Order</Link>
            )}
          </>
        }
      />

      <div className="page page-w space-y-5">
        {!sum.reconciled && (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            The balance derived from purchase orders ({money(sum.outstanding, currency)}) does not match the stored
            payable ({money(sum.storedPayable, currency)}). Investigate before relying on these figures.
          </p>
        )}

        {/* Financial position — figures derive from purchase orders; Supplier.payable stays authoritative */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4">
            <div className="t-label">Total purchases</div>
            <div className="mt-1.5"><Money value={sum.totalPurchases} currency={currency} showCurrency className="text-[19px] font-semibold" /></div>
            <div className="t-meta mt-0.5">{sum.orderCount} order{sum.orderCount === 1 ? '' : 's'}</div>
          </div>
          <div className="card p-4">
            <div className="t-label">Total paid</div>
            <div className="mt-1.5"><Money value={sum.totalPaid} currency={currency} showCurrency tone="positive" className="text-[19px] font-semibold" /></div>
          </div>
          <div className="card p-4">
            <div className="t-label">Outstanding</div>
            <div className="mt-1.5"><Money value={sum.storedPayable} currency={currency} showCurrency tone="due" className="text-[19px] font-semibold" /></div>
            {sum.openingBalance > 0 && (
              <div className="t-meta mt-0.5">includes {money(sum.openingBalance, currency)} opening balance</div>
            )}
          </div>
          {/* Payables is an admin-only screen, so stock users see the fact without a dead link. */}
          {canSeeLedger ? (
            <Link to={`/payables/${id}`} className="card card-hover p-4">
              <div className="t-label">Payables</div>
              <div className="mt-1.5 text-[15px] font-medium text-brand-700">Aging &amp; detail →</div>
              <div className="t-meta mt-0.5">Last order {sum.lastOrderedAt ? fmtDate(sum.lastOrderedAt) : '—'}</div>
            </Link>
          ) : (
            <div className="card p-4">
              <div className="t-label">Last order</div>
              <div className="mt-1.5 text-[15px] font-medium text-ink-900">{sum.lastOrderedAt ? fmtDate(sum.lastOrderedAt) : '—'}</div>
            </div>
          )}
        </div>

        {/* Contact card */}
        <section className="card p-4">
          <h2 className="t-section mb-3">Contact</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
            {[
              ['Contact person', s.contactPerson],
              ['Phone', s.phone],
              ['Email', s.email],
              ['Tax number', s.taxNumber],
              ['Address', s.address],
              ['Notes', s.notes],
            ].map(([label, value]) => (
              <div key={label} className={label === 'Address' || label === 'Notes' ? 'sm:col-span-2' : ''}>
                <dt className="t-label">{label}</dt>
                <dd className="text-[13px] text-ink-800 mt-0.5">{value || <span className="text-ink-300">—</span>}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Activity */}
        <div className="segment w-fit" role="tablist" aria-label="Supplier activity">
          <button role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')} className={`segment-item ${tab === 'orders' ? 'segment-item-active' : ''}`}>
            Purchase orders
          </button>
          {canSeeLedger && (
            <button role="tab" aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')} className={`segment-item ${tab === 'ledger' ? 'segment-item-active' : ''}`}>
              Ledger
            </button>
          )}
        </div>

        {tab === 'orders' && (
          <Table
            caption={`Purchase orders raised with ${s.name}`}
            rows={data.purchaseOrders}
            total={data.purchaseOrderPaging?.total}
            // This history is windowed server-side. Saying so is the point: it
            // previously took the newest 100 silently, so a supplier with more
            // orders lost the rest with no indication.
            capped={
              data.purchaseOrderPaging != null &&
              data.purchaseOrderPaging.total > data.purchaseOrders.length
            }
            empty="No purchase orders yet"
            emptyDescription={canManage ? `Raise one to start buying from ${s.name}.` : undefined}
            emptyAction={canManage && <Link to="/purchase-orders/new" className="btn-primary">New Purchase Order</Link>}
            columns={[
              {
                key: 'number', label: 'PO Number', priority: 'primary',
                render: (p) => <Link to={`/purchase-orders/${p._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{p.number}</Link>,
              },
              { key: 'orderedAt', label: 'Ordered', render: (p) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(p.orderedAt)}</span> },
              { key: 'expectedAt', label: 'Expected', render: (p) => p.expectedAt ? <span className="text-ink-500 whitespace-nowrap">{fmtDate(p.expectedAt)}</span> : <span className="text-ink-300">—</span> },
              { key: 'status', label: 'Status', render: (p) => <Badge tone={poTone[p.status]} dot>{p.status}</Badge> },
              { key: 'total', label: `Total (${currency})`, align: 'right', render: (p) => <Money value={p.total} /> },
              { key: 'paid', label: `Paid (${currency})`, align: 'right', render: (p) => <Money value={p.paid} tone="positive" /> },
              { key: 'balance', label: `Outstanding (${currency})`, align: 'right', priority: 'primary', render: (p) => <Money value={p.balance} tone="due" /> },
            ]}
          />
        )}

        {tab === 'ledger' && canSeeLedger && (
          <>
            {ledger.data && !ledger.data.reconciled && (
              <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                Ledger closing balance ({money(ledger.data.closingBalance, currency)}) does not match the stored payable
                ({money(ledger.data.payable, currency)}).
              </p>
            )}
            <Table
              caption={`Financial history for ${s.name}`}
              loading={ledger.isLoading}
              error={ledger.isError ? 'The ledger could not be loaded.' : null}
              onRetry={ledger.refetch}
              rows={ledger.data?.entries || []}
              rowKey={(r, i) => i}
              empty="No financial history yet"
              emptyDescription="Purchase orders and payments will appear here."
              columns={[
                { key: 'date', label: 'Date', priority: 'primary', render: (e) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(e.date)}</span> },
                {
                  key: 'type', label: 'Type',
                  render: (e) => (
                    <span className={e.type === 'payment_reversal' ? 'text-red-600' : 'text-ink-700'}>
                      {LEDGER_LABELS[e.type] || e.type}
                    </span>
                  ),
                },
                {
                  key: 'description', label: 'Description', priority: 'primary',
                  render: (e) => (
                    <span className={e.reversed ? 'text-ink-400 line-through' : 'text-ink-800'}>{e.description}</span>
                  ),
                },
                {
                  key: 'reference', label: 'Reference',
                  render: (e) => e.purchaseOrder
                    ? <Link to={`/purchase-orders/${e.purchaseOrder}`} className="font-mono text-[12px] text-brand-700 hover:underline">{e.reference}</Link>
                    : e.reference ? <span className="font-mono text-[12px] text-ink-500">{e.reference}</span> : <span className="text-ink-300">—</span>,
                },
                { key: 'debit', label: `Paid (${currency})`, align: 'right', render: (e) => e.debit ? <Money value={e.debit} tone="positive" /> : <span className="text-ink-300">—</span> },
                { key: 'credit', label: `Owed (${currency})`, align: 'right', render: (e) => e.credit ? <Money value={e.credit} /> : <span className="text-ink-300">—</span> },
                { key: 'balance', label: `Balance (${currency})`, align: 'right', priority: 'primary', render: (e) => <Money value={e.balance} tone="auto" className="font-medium" /> },
              ]}
            />
            {ledger.data?.entries?.length > 0 && (
              <div className="card p-4 flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink-900">Closing balance</span>
                <div className="flex gap-6 text-sm">
                  <span className="text-ink-500">Owed <Money value={ledger.data.totalCredit} currency={currency} showCurrency className="text-ink-900 font-medium" /></span>
                  <span className="text-ink-500">Paid <Money value={ledger.data.totalDebit} currency={currency} showCurrency tone="positive" className="font-medium" /></span>
                  <span className="text-ink-500">Outstanding <Money value={ledger.data.closingBalance} currency={currency} showCurrency tone="due" className="font-semibold" /></span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title={`Edit ${s.name}`}
        subtitle="Contact details only — balances are driven by purchase orders and payments."
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving || !form?.name.trim()}>
              {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save changes'}
            </button>
          </>
        }
      >
        {form && (
          <form onSubmit={save} className="space-y-3">
            {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
            <div>
              <label htmlFor="sd-name" className="label">Name<span className="req" aria-hidden>*</span></label>
              <input id="sd-name" className="input" value={form.name} required aria-required="true" onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sd-contact" className="label">Contact person</label>
                <input id="sd-contact" className="input" value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
              </div>
              <div>
                <label htmlFor="sd-phone" className="label">Phone</label>
                <input id="sd-phone" className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div>
                <label htmlFor="sd-email" className="label">Email</label>
                <input id="sd-email" type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div>
                <label htmlFor="sd-tax" className="label">Tax number</label>
                <input id="sd-tax" className="input" value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="sd-address" className="label">Address</label>
              <input id="sd-address" className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sd-notes" className="label">Notes</label>
              <textarea id="sd-notes" className="input" rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer pt-1">
              <input id="sd-active" type="checkbox" className="w-4 h-4 rounded accent-brand-600" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active — available when raising purchase orders
            </label>
          </form>
        )}
      </Modal>
    </div>
  );
}
