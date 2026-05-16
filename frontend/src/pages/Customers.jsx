import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

const empty = { name: '', company: '', phone: '', email: '', cnicNtn: '', address: '', creditLimit: 0, notes: '' };

export default function Customers() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(empty);
  const { data: items } = useQuery({
    queryKey: ['customers', q],
    queryFn: async () => (await api.get('/customers', { params: { q } })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  async function save() {
    try {
      await api.post('/customers', { ...form, creditLimit: Number(form.creditLimit) || 0 });
      toast.success('Customer added');
      setForm(empty);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Wholesale clients, credit, and outstanding balances"
        actions={
          has('admin', 'sales') && (
            <button className="btn-primary" onClick={() => setShowAdd(true)}>+ New Customer</button>
          )
        }
      />
      <div className="p-6">
        <input
          className="input max-w-sm mb-4"
          placeholder="Search by name, company, phone, email..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Table
          columns={[
            { key: 'name', label: 'Name', render: (c) => (
                <Link to={`/customers/${c._id}`} className="text-brand-600 hover:underline font-medium">
                  {c.name}
                </Link>
              ) },
            { key: 'company', label: 'Company' },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email' },
            { key: 'creditLimit', label: 'Credit Limit', className: 'text-right', render: (c) => money(c.creditLimit, currency) },
            { key: 'balance', label: 'Balance', className: 'text-right', render: (c) => (
                <span className={c.balance > 0 ? 'text-amber-600 font-medium' : 'text-slate-500'}>
                  {money(c.balance, currency)}
                </span>
              ) },
          ]}
          rows={items || []}
        />
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-start justify-center z-50 p-6 overflow-y-auto">
          <div className="card w-full max-w-2xl p-6 mt-12">
            <h2 className="font-bold text-lg mb-4">New Customer</h2>
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
            <div className="flex gap-2 mt-5">
              <button className="btn-primary" onClick={save} disabled={!form.name}>
                Save
              </button>
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
