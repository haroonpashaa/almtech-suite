import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { useCurrency } from '../hooks/useSettings.js';
import { money, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import Money from '../components/Money.jsx';
import { Badge, Spinner } from '../components/ui.jsx';

const emptyForm = { name: '', contactPerson: '', phone: '', email: '', address: '', taxNumber: '', notes: '', active: true };

export default function Suppliers() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const currency = useCurrency();
  const canManage = has('admin', 'stock');
  const isAdmin = has('admin');

  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [sort, setSort] = useState({ key: 'name', order: 'asc' });
  const [editing, setEditing] = useState(null); // null | 'new' | supplier
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['suppliers', q, activeFilter],
    queryFn: async () =>
      (await api.get('/suppliers', { params: { q: q || undefined, active: activeFilter || undefined } })).data,
  });

  const filtered = !!(q || activeFilter);

  // Sorting is client-side because the supplier list is a short reference table —
  // there is no pagination to coordinate with.
  const rows = useMemo(() => {
    const list = [...(data || [])];
    const dir = sort.order === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (typeof x === 'number' || typeof y === 'number') return ((x || 0) - (y || 0)) * dir;
      return String(x || '').localeCompare(String(y || '')) * dir;
    });
    return list;
  }, [data, sort]);

  const totalPayable = (data || []).reduce((t, s) => t + (s.payable || 0), 0);
  const owing = (data || []).filter((s) => (s.payable || 0) > 0).length;

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setEditing('new');
  }
  function openEdit(s) {
    setForm({
      name: s.name || '', contactPerson: s.contactPerson || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '', taxNumber: s.taxNumber || '',
      notes: s.notes || '', active: s.active !== false,
    });
    setError(null);
    setEditing(s);
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e?.preventDefault();
    if (!form.name.trim()) {
      setError('Supplier name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await api.post('/suppliers', form);
        toast.success('Supplier created');
      } else {
        await api.patch(`/suppliers/${editing._id}`, form);
        toast.success('Supplier updated');
      }
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, order: s.order === 'asc' ? 'desc' : 'asc' } : { key, order: 'asc' }));

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Who you buy from, and what you owe them"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 9h2m4 0h1M9 13h2m4 0h1M10 21v-4h4v4" /></svg>}
        actions={
          canManage && (
            <button className="btn-primary" onClick={openNew}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              New Supplier
            </button>
          )
        }
      />

      <div className="page page-w space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="t-label">Suppliers</div>
            <div className="mt-1.5 text-[19px] font-semibold text-ink-900 num">{data?.length ?? 0}</div>
          </div>
          <div className="card p-4">
            <div className="t-label">With a balance owing</div>
            <div className="mt-1.5 text-[19px] font-semibold text-ink-900 num">{owing}</div>
          </div>
          {/* Payables is an admin-only screen, so stock users get the figure without a dead link. */}
          {isAdmin ? (
            <Link to="/payables" className="card card-hover p-4 col-span-2 lg:col-span-1">
              {/* Summed over the rows actually listed, so under a filter it must say
                  so rather than reading as a company-wide total. */}
              <div className="t-label">{filtered ? 'Payable · filtered' : 'Total payable'}</div>
              <div className="mt-1.5">
                <Money value={totalPayable} currency={currency} showCurrency tone="due" className="text-[19px] font-semibold" />
              </div>
              <div className="t-meta mt-0.5">View payables →</div>
            </Link>
          ) : (
            <div className="card p-4 col-span-2 lg:col-span-1">
              <div className="t-label">{filtered ? 'Payable · filtered' : 'Total payable'}</div>
              <div className="mt-1.5">
                <Money value={totalPayable} currency={currency} showCurrency tone="due" className="text-[19px] font-semibold" />
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="field-search max-w-xs w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input
              id="suppliers-search"
              className="input"
              placeholder="Search name, contact, phone or email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search suppliers"
            />
          </div>
          <div>
            <label htmlFor="suppliers-status" className="label">Status</label>
            <select id="suppliers-status" className="select" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          {(q || activeFilter) && (
            <button className="btn-secondary" onClick={() => { setQ(''); setActiveFilter(''); }}>Clear</button>
          )}
          <span className="t-meta ml-auto">{rows.length} shown</span>
        </div>

        <Table
          caption="Suppliers and outstanding balances"
          loading={isLoading}
          error={isError ? 'The supplier list could not be loaded.' : null}
          onRetry={refetch}
          sort={sort}
          onSort={toggleSort}
          rows={rows}
          empty={q || activeFilter ? 'No suppliers match these filters' : 'No suppliers yet'}
          emptyDescription={
            q || activeFilter
              ? 'Try a different search or clear the filters.'
              : canManage ? 'Add your first supplier to start raising purchase orders.' : undefined
          }
          emptyAction={canManage && !q && !activeFilter && <button className="btn-primary" onClick={openNew}>New Supplier</button>}
          emptyIcon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 9h2m4 0h1M10 21v-4h4v4" /></svg>}
          columns={[
            {
              key: 'name', label: 'Supplier', sortable: true, priority: 'primary',
              render: (s) => (
                <Link to={`/suppliers/${s._id}`} className="font-medium text-ink-900 hover:text-brand-700">
                  {s.name}
                </Link>
              ),
            },
            { key: 'contactPerson', label: 'Contact', sortable: true, render: (s) => s.contactPerson || <span className="text-ink-300">—</span> },
            { key: 'phone', label: 'Phone', render: (s) => s.phone || <span className="text-ink-300">—</span> },
            { key: 'email', label: 'Email', render: (s) => s.email || <span className="text-ink-300">—</span> },
            {
              key: 'payable', label: `Outstanding (${currency})`, align: 'right', sortable: true, priority: 'primary',
              render: (s) => <Money value={s.payable} tone="due" />,
            },
            {
              key: 'active', label: 'Status',
              render: (s) => (s.active === false ? <Badge tone="neutral" dot>inactive</Badge> : <Badge tone="success" dot>active</Badge>),
            },
            {
              key: 'actions', label: '', align: 'right',
              render: (s) => (
                <span className="inline-flex gap-1.5">
                  <Link to={`/suppliers/${s._id}`} className="btn-sm btn-secondary">View</Link>
                  {canManage && (
                    <button className="btn-sm btn-secondary" onClick={() => openEdit(s)}>Edit</button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* Create / edit */}
      <Modal
        open={!!editing}
        onClose={() => !saving && setEditing(null)}
        title={editing === 'new' ? 'New supplier' : `Edit ${editing?.name || 'supplier'}`}
        subtitle="Contact details only — balances are driven by purchase orders and payments."
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : editing === 'new' ? 'Create supplier' : 'Save changes'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-3">
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
          )}
          <div>
            <label htmlFor="supplier-name" className="label">Name<span className="req" aria-hidden>*</span></label>
            <input
              id="supplier-name" className="input" value={form.name} required
              aria-required="true" aria-invalid={error && !form.name.trim() ? 'true' : undefined}
              onChange={(e) => set('name', e.target.value)} placeholder="e.g. Asia Trading Co."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="supplier-contact" className="label">Contact person</label>
              <input id="supplier-contact" className="input" value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
            </div>
            <div>
              <label htmlFor="supplier-phone" className="label">Phone</label>
              <input id="supplier-phone" className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label htmlFor="supplier-email" className="label">Email</label>
              <input id="supplier-email" type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label htmlFor="supplier-tax" className="label">Tax number</label>
              <input id="supplier-tax" className="input" value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="supplier-address" className="label">Address</label>
            <input id="supplier-address" className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label htmlFor="supplier-notes" className="label">Notes</label>
            <textarea id="supplier-notes" className="input" rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer pt-1">
            <input
              id="supplier-active" type="checkbox" className="w-4 h-4 rounded accent-brand-600"
              checked={form.active} onChange={(e) => set('active', e.target.checked)}
            />
            Active — available when raising purchase orders
          </label>
        </form>
      </Modal>
    </div>
  );
}
