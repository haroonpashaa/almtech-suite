import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { Spinner } from '../components/ui.jsx';

const GROUPS = [
  {
    title: 'Business Profile',
    description: 'Appears on invoices, quotations, and PDFs',
    fields: [
      ['businessName', 'Business Name'],
      ['email', 'Email'],
      ['phone', 'Phone'],
      ['taxNumber', 'Tax Number'],
      ['address', 'Address'],
      ['logoUrl', 'Logo URL'],
    ],
  },
  {
    title: 'Numbering & Tax',
    description: 'Document prefixes and tax defaults',
    fields: [
      ['currency', 'Currency Code'],
      ['defaultTaxRate', 'Default Tax Rate (%)', 'number'],
      ['invoicePrefix', 'Invoice Prefix'],
      ['quotationPrefix', 'Quotation Prefix'],
      ['poPrefix', 'PO Prefix'],
    ],
  },
];

export default function Settings() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const [form, setForm] = useState({});
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await api.patch('/settings', form);
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Business profile, numbering, and tax defaults"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5z" /></svg>}
        actions={<button className="btn-primary" onClick={save} disabled={saving}>{saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Settings'}</button>}
      />
      <div className="page page-narrow space-y-5">
        {GROUPS.map((group) => (
          <div key={group.title} className="card p-6">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-ink-900">{group.title}</h3>
              <p className="text-xs text-ink-400 mt-0.5">{group.description}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {group.fields.map(([k, label, type = 'text']) => (
                <div key={k}>
                  <label htmlFor="settings-label-64" className="label">{label}</label>
                  <input id="settings-label-64"
                    className={`input ${type === 'number' ? 'num' : ''}`}
                    type={type}
                    value={form[k] ?? ''}
                    onChange={(e) => setForm({ ...form, [k]: type === 'number' ? Number(e.target.value) : e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="card p-6">
          <h3 className="text-sm font-semibold text-ink-900 mb-4">Invoice Display</h3>
          <label className="flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded accent-brand-600" checked={!!form.showTaxOnInvoices} onChange={(e) => setForm({ ...form, showTaxOnInvoices: e.target.checked })} />
            Show tax line on invoices
          </label>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save Settings'}</button>
        </div>
      </div>
    </div>
  );
}
