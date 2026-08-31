import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Spinner } from '../components/ui.jsx';

const empty = { name: '', type: 'bank', openingBalance: '', bankName: '', accountNumber: '', accountTitle: '' };

const typeTone = { cash: 'success', bank: 'neutral', wallet: 'warning', other: 'neutral' };

export default function Accounts() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty);

  const { data, isLoading } = useQuery({
    queryKey: ['accounts-summary'],
    queryFn: async () => (await api.get('/accounts/summary')).data,
  });
  const currency = useCurrency();

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.post('/accounts', { ...form, openingBalance: Number(form.openingBalance) || 0 });
      toast.success('Account created');
      setForm(empty);
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Financial Accounts"
        subtitle="Cash and bank balances, each with its own ledger"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18M5 10V21M19 10v11M9 10v11M15 10v11M2 21h20M12 3l9 5H3z" /></svg>}
        actions={
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Account
          </button>
        }
      />
      <div className="page page-w space-y-4">
        <div className="card p-5 flex items-baseline justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Funds</div>
            <div className="text-xs text-ink-400 mt-0.5">Across all active accounts</div>
          </div>
          <div className="text-2xl font-semibold num text-ink-900 tracking-tight">{money(data?.total || 0, currency)}</div>
        </div>

        <Table
          loading={isLoading}
          empty="No accounts yet"
          columns={[
            {
              key: 'name',
              label: 'Account',
              render: (a) => (
                <Link to={`/accounts/${a._id}`} className="text-ink-900 hover:text-brand-700 font-medium">{a.name}</Link>
              ),
            },
            { key: 'type', label: 'Type', render: (a) => <Badge tone={typeTone[a.type]} dot>{a.type}</Badge> },
            { key: 'bankName', label: 'Bank', render: (a) => a.bankName || <span className="text-ink-300">—</span> },
            { key: 'accountNumber', label: 'Number', render: (a) => a.accountNumber ? <span className="font-mono text-[12px] text-ink-500">{a.accountNumber}</span> : <span className="text-ink-300">—</span> },
            { key: 'openingBalance', label: `Opening (${currency})`, className: 'text-right num text-ink-500', render: (a) => <Money value={a.openingBalance} /> },
            {
              key: 'currentBalance',
              label: `Current Balance (${currency})`,
              className: 'text-right num font-medium',
              render: (a) => (
                <span className={a.currentBalance < 0 ? 'text-red-600' : 'text-ink-900'}>{money(a.currentBalance, currency)}</span>
              ),
            },
            { key: 'active', label: '', render: (a) => (a.active ? null : <Badge tone="neutral">inactive</Badge>) },
          ]}
          rows={data?.accounts || []}
        />
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Financial Account">
        <div className="space-y-3">
          <div>
            <label htmlFor="accounts-name-4" className="label">Name <span className="text-red-500">*</span></label>
            <input id="accounts-name-4" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Meezan Bank" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="accounts-type-5" className="label">Type</label>
              <select id="accounts-type-5" className="select" value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="wallet">Wallet</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="accounts-opening-balance-6" className="label">Opening Balance</label>
              <input id="accounts-opening-balance-6" className="input num input-money" type="number" step="0.01" value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="Enter amount" />
            </div>
          </div>
          {form.type !== 'cash' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="accounts-bank-name-7" className="label">Bank Name</label>
                <input id="accounts-bank-name-7" className="input" value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
              </div>
              <div>
                <label htmlFor="accounts-account-number-8" className="label">Account Number</label>
                <input id="accounts-account-number-8" className="input font-mono" value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button className="btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Create account'}
            </button>
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
