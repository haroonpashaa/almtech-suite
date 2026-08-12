import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import { usePagedList } from '../hooks/usePagedList.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import Modal from '../components/Modal.jsx';

const empty = { name: '', company: '', phone: '', email: '', cnicNtn: '', address: '', creditLimit: 0, notes: '' };

export default function Customers() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty);
  const currency = useCurrency();
  const list = usePagedList({ key: ['customers', q], path: '/customers', params: { q: q || undefined }, limit: 50 });
  const items = list.rows;

  async function save() {
    setSaving(true);
    try {
      await api.post('/customers', { ...form, creditLimit: Number(form.creditLimit) || 0 });
      toast.success('Customer added');
      setForm(empty);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Wholesale clients, credit, and outstanding balances"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16 14a4 4 0 1 0-8 0M12 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM2 21v-1a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v1" /></svg>}
        actions={has('admin', 'sales') && (
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Customer
          </button>
        )}
      />
      <div className="page page-w">
        <div className="field-search max-w-sm mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input className="input" placeholder="Search by name, company, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Table
          {...list.tableProps}
          caption="Customers with credit limits and outstanding balances"
          empty={q ? 'No customers match this search' : 'No customers yet'}
          emptyDescription={q ? 'Try a different name, company, phone or email.' : undefined}
          columns={[
            { key: 'name', label: 'Name', priority: 'primary', render: (c) => (
                <Link to={`/customers/${c._id}`} className="flex items-center gap-2.5 group">
                  <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold flex items-center justify-center shrink-0">{c.name?.[0]?.toUpperCase()}</span>
                  <span className="text-ink-900 group-hover:text-brand-700 font-medium">{c.name}</span>
                </Link>
              ) },
            { key: 'company', label: 'Company', render: (c) => c.company || <span className="text-ink-300">—</span> },
            { key: 'phone', label: 'Phone', render: (c) => c.phone || <span className="text-ink-300">—</span> },
            { key: 'email', label: 'Email', render: (c) => c.email || <span className="text-ink-300">—</span> },
            { key: 'creditLimit', label: `Credit Limit (${currency})`, align: 'right', render: (c) => <Money value={c.creditLimit} /> },
            { key: 'balance', label: `Balance (${currency})`, priority: 'primary', className: 'text-right num', render: (c) => (
                <span className={c.balance > 0 ? 'text-amber-600 font-medium' : 'text-ink-400'}>{money(c.balance, currency)}</span>
              ) },
          ]}
        />
      </div>

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="New Customer"
        subtitle="Add a wholesale client to your directory"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={!form.name || saving}>{saving ? 'Saving…' : 'Save customer'}</button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.keys(empty).map((k) =>
            k === 'notes' ? null : (
              <div key={k}>
                <label className="label capitalize">{k.replace(/([A-Z])/g, ' $1')}</label>
                <input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            )
          )}
        </div>
        <label className="label mt-3">Notes</label>
        <textarea className="input" rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Modal>
    </div>
  );
}
