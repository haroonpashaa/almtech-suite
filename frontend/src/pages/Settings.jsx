import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

const FIELDS = [
  ['businessName', 'Business Name'],
  ['address', 'Address'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['taxNumber', 'Tax Number'],
  ['currency', 'Currency Code'],
  ['logoUrl', 'Logo URL'],
  ['defaultTaxRate', 'Default Tax Rate (%)', 'number'],
  ['invoicePrefix', 'Invoice Prefix'],
  ['quotationPrefix', 'Quotation Prefix'],
  ['poPrefix', 'PO Prefix'],
];

export default function Settings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const [form, setForm] = useState({});
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function save() {
    try {
      await api.patch('/settings', form);
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Business profile, numbering, and tax defaults" />
      <div className="p-6 max-w-3xl">
        <div className="card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map(([k, label, type = 'text']) => (
            <div key={k}>
              <label className="label">{label}</label>
              <input
                className="input"
                type={type}
                value={form[k] ?? ''}
                onChange={(e) => setForm({ ...form, [k]: type === 'number' ? Number(e.target.value) : e.target.value })}
              />
            </div>
          ))}
          <label className="flex items-center gap-2 mt-2 text-sm col-span-2">
            <input
              type="checkbox"
              checked={!!form.showTaxOnInvoices}
              onChange={(e) => setForm({ ...form, showTaxOnInvoices: e.target.checked })}
            />
            Show tax line on invoices
          </label>
          <div className="col-span-2">
            <button className="btn-primary" onClick={save}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
