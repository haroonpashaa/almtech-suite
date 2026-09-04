import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import DocumentActions from '../components/DocumentActions.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import Money from '../components/Money.jsx';
import { Badge, LoadingBlock, Spinner, EmptyState } from '../components/ui.jsx';

function Field({ label, value, className = '' }) {
  return (
    <div>
      <div className="section-title">{label}</div>
      <div className={`mt-1 text-sm text-ink-800 ${className}`}>{value || '—'}</div>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const qc = useQueryClient();
  const canManage = has('admin', 'sales');

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['customer-ledger', id],
    queryFn: async () => (await api.get(`/customers/${id}/ledger`)).data,
  });
  const currency = useCurrency();

  if (isLoading) return <LoadingBlock />;
  if (isError || !data) {
    return (
      <div className="p-8">
        <EmptyState
          tone="danger"
          title="Customer not found"
          description="This customer may have been removed, or the link is incorrect."
          action={
            <span className="inline-flex gap-2">
              <button className="btn-secondary" onClick={() => refetch()}>Try again</button>
              <Link to="/customers" className="btn-primary">Back to customers</Link>
            </span>
          }
        />
      </div>
    );
  }
  const { customer, entries, balance } = data;

  function openEdit() {
    setForm({
      name: customer.name || '', company: customer.company || '', phone: customer.phone || '',
      email: customer.email || '', cnicNtn: customer.cnicNtn || '', address: customer.address || '',
      creditLimit: customer.creditLimit ?? 0, notes: customer.notes || '', active: customer.active !== false,
    });
    setError(null);
    setEditOpen(true);
  }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e?.preventDefault();
    if (!form.name.trim()) return setError('Customer name is required');
    setSaving(true);
    setError(null);
    try {
      // Profile fields only — balance is never part of this payload; the backend's own
      // writable-field allowlist (customer.controller.js) is the real boundary, this is
      // just keeping the request honest about what it's asking to change.
      await api.patch(`/customers/${id}`, {
        name: form.name, company: form.company, phone: form.phone, email: form.email,
        cnicNtn: form.cnicNtn, address: form.address, creditLimit: Number(form.creditLimit) || 0,
        notes: form.notes, active: form.active,
      });
      toast.success('Customer updated');
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ['customer-ledger', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Customers', to: '/customers' }, { label: customer.name }]}
        title={customer.name}
        subtitle={customer.company || customer.phone || customer.email}
        actions={
          <>
            {customer.active === false && <Badge tone="neutral" dot>inactive</Badge>}
            <Badge tone={balance > 0 ? 'warning' : 'success'} dot>{balance > 0 ? 'Outstanding' : 'Settled'}</Badge>
            <DocumentActions path={`/customers/${id}/statement/pdf`} filename={`statement-${customer.name}`} label="Statement" />
            {canManage && <button className="btn-secondary" onClick={openEdit}>Edit</button>}
          </>
        }
      />
      <div className="page page-w space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3 card p-5 grid grid-cols-2 md:grid-cols-3 gap-5">
            <Field label="Phone" value={customer.phone} />
            <Field label="Email" value={customer.email} />
            <Field label="Address" value={customer.address} />
            <Field label="CNIC / NTN" value={customer.cnicNtn} />
            <Field label="Credit Limit" value={money(customer.creditLimit, currency)} className="num" />
            <Field label="Notes" value={customer.notes} />
          </div>
          <div className="card p-5 bg-brand-gradient-br text-white relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Outstanding Balance</div>
              <div className="mt-2 fig-xl font-semibold num tracking-tight">{money(balance, currency)}</div>
              <div className="mt-1 text-xs text-white/70">{balance > 0 ? 'Owed by this customer' : 'No outstanding balance'}</div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-900 mb-3">Ledger</h3>
          <Table
            columns={[
              { key: 'date', label: 'Date', render: (e) => <span className="text-ink-500 whitespace-nowrap">{date(e.date)}</span> },
              { key: 'type', label: 'Type', render: (e) => <span className="capitalize text-ink-700">{e.type}</span> },
              { key: 'reference', label: 'Reference', render: (e) => <span className="font-mono text-[12px] text-ink-500">{e.reference || '—'}</span> },
              { key: 'debit', label: `Debit (${currency})`, align: 'right', render: (e) => (e.debit ? <Money value={e.debit} /> : <span className="text-ink-300">—</span>) },
              { key: 'credit', label: `Credit (${currency})`, align: 'right', render: (e) => (e.credit ? <Money value={e.credit} tone="positive" /> : <span className="text-ink-300">—</span>) },
              { key: 'balance', label: `Balance (${currency})`, align: 'right', render: (e) => <Money value={e.balance} tone="auto" className="font-medium" /> },
            ]}
            rows={entries}
            empty="No ledger entries"
          />
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title={`Edit ${customer.name}`}
        subtitle="Profile details only — balance is driven by invoices and payments."
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
              <label htmlFor="cd-name" className="label">Name<span className="req" aria-hidden>*</span></label>
              <input id="cd-name" className="input" value={form.name} required aria-required="true" onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="cd-company" className="label">Company</label>
                <input id="cd-company" className="input" value={form.company} onChange={(e) => set('company', e.target.value)} />
              </div>
              <div>
                <label htmlFor="cd-phone" className="label">Phone</label>
                <input id="cd-phone" className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div>
                <label htmlFor="cd-email" className="label">Email</label>
                <input id="cd-email" type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div>
                <label htmlFor="cd-cnic" className="label">CNIC / NTN</label>
                <input id="cd-cnic" className="input" value={form.cnicNtn} onChange={(e) => set('cnicNtn', e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="cd-address" className="label">Address</label>
              <input id="cd-address" className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div>
              <label htmlFor="cd-credit-limit" className="label">Credit Limit ({currency})</label>
              <input id="cd-credit-limit" className="input num input-money" type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} />
              <p className="text-xs text-ink-400 mt-1">0 means no limit. This does not change the customer's current balance.</p>
            </div>
            <div>
              <label htmlFor="cd-notes" className="label">Notes</label>
              <textarea id="cd-notes" className="input" rows="2" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer pt-1">
              <input id="cd-active" type="checkbox" className="w-4 h-4 rounded accent-brand-600" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active
            </label>
          </form>
        )}
      </Modal>
    </div>
  );
}
