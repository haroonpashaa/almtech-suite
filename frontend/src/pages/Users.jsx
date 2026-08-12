import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import { Badge } from '../components/ui.jsx';

const empty = { name: '', email: '', password: '', role: 'sales' };
const roleTone = { admin: 'brand', sales: 'info', stock: 'warning' };

export default function Users() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });

  async function save() {
    setSaving(true);
    try {
      await api.post('/users', form);
      toast.success('User created');
      setForm(empty);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
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
        subtitle="Team members and role-based access"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>}
        actions={
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New User
          </button>
        }
      />
      <div className="page page-w">
        <Table
          loading={isLoading}
          empty="No users yet"
          columns={[
            { key: 'name', label: 'Name', render: (u) => (
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-brand-gradient text-white text-xs font-semibold flex items-center justify-center shrink-0">{u.name?.[0]?.toUpperCase()}</span>
                  <span className="font-medium text-ink-900">{u.name}</span>
                </div>
              ) },
            { key: 'email', label: 'Email', render: (u) => <span className="text-ink-500">{u.email}</span> },
            { key: 'role', label: 'Role', render: (u) => <Badge tone={roleTone[u.role]}>{u.role}</Badge> },
            { key: 'active', label: 'Status', render: (u) => <Badge tone={u.active ? 'success' : 'neutral'} dot>{u.active ? 'Active' : 'Disabled'}</Badge> },
            { key: 'actions', label: '', className: 'text-right', render: (u) => (
                <button className="btn-secondary btn-sm" onClick={() => toggleActive(u)}>
                  {u.active ? 'Disable' : 'Enable'}
                </button>
              ) },
          ]}
          rows={data || []}
        />
      </div>

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="New User"
        subtitle="Invite a team member and assign their role"
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={!form.name || !form.email || !form.password || saving}>{saving ? 'Saving…' : 'Create user'}</button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="users-name-65" className="label">Name</label>
            <input id="users-name-65" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="users-email-66" className="label">Email</label>
            <input id="users-email-66" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label htmlFor="users-password-67" className="label">Password</label>
            <input id="users-password-67" className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <label htmlFor="users-role-68" className="label">Role</label>
            <select id="users-role-68" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="sales">Sales Staff</option>
              <option value="stock">Stock Manager</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
