import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

const empty = { name: '', contactPerson: '', phone: '', email: '', address: '', taxNumber: '' };

export default function Suppliers() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(empty);
  const { data: items } = useQuery({
    queryKey: ['suppliers', q],
    queryFn: async () => (await api.get('/suppliers', { params: { q } })).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  async function save() {
    try {
      await api.post('/suppliers', form);
      toast.success('Supplier added');
      setForm(empty);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Suppliers"
        actions={has('admin', 'stock') && <button className="btn-primary" onClick={() => setShowAdd(true)}>+ New Supplier</button>}
      />
      <div className="p-6">
        <input className="input max-w-sm mb-4" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        <Table
          columns={[
            { key: 'name', label: 'Name', render: (s) => (
                <Link to={`/suppliers/${s._id}`} className="text-brand-600 hover:underline font-medium">
                  {s.name}
                </Link>
              ) },
            { key: 'contactPerson', label: 'Contact' },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email' },
            { key: 'payable', label: 'Payable', className: 'text-right', render: (s) => (
                <span className={s.payable > 0 ? 'text-amber-600 font-medium' : 'text-slate-500'}>
                  {money(s.payable, currency)}
                </span>
              ) },
          ]}
          rows={items || []}
        />
      </div>
      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-start justify-center z-50 p-6 overflow-y-auto">
          <div className="card w-full max-w-2xl p-6 mt-12">
            <h2 className="font-bold text-lg mb-4">New Supplier</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.keys(empty).map((k) => (
                <div key={k}>
                  <label className="label capitalize">{k.replace(/([A-Z])/g, ' $1')}</label>
                  <input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button className="btn-primary" onClick={save} disabled={!form.name}>Save</button>
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
