import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';

const empty = { name: '', email: '', password: '', role: 'sales' };

export default function Users() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(empty);

  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });

  async function save() {
    try {
      await api.post('/users', form);
      toast.success('User created');
      setForm(empty);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function toggleActive(u) {
    try {
      await api.patch(`/users/${u._id}`, { active: !u.active });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        actions={<button className="btn-primary" onClick={() => setShowAdd(true)}>+ New User</button>}
      />
      <div className="p-6">
        <Table
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role', render: (u) => <span className="badge bg-slate-100 capitalize">{u.role}</span> },
            { key: 'active', label: 'Status', render: (u) => (
                <span className={`badge ${u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                  {u.active ? 'Active' : 'Disabled'}
                </span>
              ) },
            { key: 'actions', label: '', className: 'text-right', render: (u) => (
                <button className="text-brand-600 hover:underline text-sm" onClick={() => toggleActive(u)}>
                  {u.active ? 'Disable' : 'Enable'}
                </button>
              ) },
          ]}
          rows={data || []}
        />
      </div>
      {showAdd && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-start justify-center z-50 p-6">
          <div className="card w-full max-w-md p-6 mt-16">
            <h2 className="font-bold text-lg mb-4">New User</h2>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label className="label mt-3">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label className="label mt-3">Password</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <label className="label mt-3">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="sales">Sales Staff</option>
              <option value="stock">Stock Manager</option>
            </select>
            <div className="flex gap-2 mt-5">
              <button className="btn-primary" onClick={save} disabled={!form.name || !form.email || !form.password}>
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
