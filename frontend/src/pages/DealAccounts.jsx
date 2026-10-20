import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage, money, date } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import { Spinner } from '../components/ui.jsx';

const TYPES = [
  { value: 'invoice', label: 'Sales invoice' },
  { value: 'purchase', label: 'Purchase order' },
  { value: 'expense', label: 'Expense' },
];

export default function DealAccounts() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currency = useCurrency();
  const [creating, setCreating] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState('invoice');
  const [recordId, setRecordId] = useState('');
  const [linking, setLinking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { data: deals, isLoading: listLoading } = useQuery({
    enabled: !id, queryKey: ['deal-accounts'], queryFn: async () => (await api.get('/deals/records')).data,
  });
  const { data: detail, isLoading: detailLoading } = useQuery({
    enabled: !!id, queryKey: ['deal-account', id], queryFn: async () => (await api.get(`/deals/records/${id}`)).data,
  });
  const { data: candidates = [] } = useQuery({
    enabled: !!id,
    queryKey: ['deal-candidates', type],
    queryFn: async () => {
      if (type === 'invoice') return (await api.get('/invoices', { params: { limit: 100 } })).data;
      if (type === 'purchase') return (await api.get('/purchase-orders', { params: { limit: 100 } })).data;
      return (await api.get('/expenses', { params: { limit: 100, status: 'posted' } })).data.items;
    },
  });
  const dealMoney = (totals, field) => {
    const buckets = totals?.totalsByCurrency || { [currency]: totals?.[field] || 0 };
    return Object.values(buckets).map((bucket) => money(bucket[field] || 0, bucket.currency)).join(' · ');
  };

  async function create() {
    if (!identifier.trim() || saving) return;
    setSaving(true);
    try {
      const response = await api.post('/deals/records', { identifier: identifier.trim(), description: description.trim() });
      toast.success(`Deal ${response.data.identifier} created`);
      setCreating(false); setIdentifier(''); setDescription('');
      qc.invalidateQueries({ queryKey: ['deal-accounts'] });
      navigate(`/deal-accounts/${response.data._id}`);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setSaving(false); }
  }

  async function link() {
    if (!recordId || linking) return;
    setLinking(true);
    try {
      await api.post(`/deals/records/${id}/link`, { type, recordId });
      toast.success('Record linked to deal'); setRecordId('');
      qc.invalidateQueries({ queryKey: ['deal-account', id] });
      qc.invalidateQueries({ queryKey: ['deal-accounts'] });
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setLinking(false); }
  }

  async function unlink(recordType, record) {
    try {
      await api.delete(`/deals/records/${id}/links/${recordType}/${record._id}`);
      toast.success('Record unlinked; its transaction history is unchanged');
      qc.invalidateQueries({ queryKey: ['deal-account', id] }); qc.invalidateQueries({ queryKey: ['deal-accounts'] });
    } catch (error) { toast.error(errorMessage(error)); }
  }

  async function removeDeal() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete(`/deals/records/${deleteTarget.deal._id}`);
      toast.success(`Deal ${deleteTarget.deal.identifier} deleted`);
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['deal-accounts'] });
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally { setDeleting(false); }
  }

  if (!id) return <div>
    <PageHeader title="Deal accounts" subtitle="Group selected sales, purchases, and expenses under a unique deal identifier" actions={<button className="btn-primary" onClick={() => setCreating(true)}>New deal</button>} />
    <div className="page page-w"><Table loading={listLoading} rows={deals || []} empty="No deal accounts yet" columns={[
      { key: 'identifier', label: 'Deal', render: (deal) => <Link className="font-mono text-brand-700 hover:underline font-medium" to={`/deal-accounts/${deal.deal._id}`}>{deal.deal.identifier}</Link> },
      { key: 'description', label: 'Description', render: (deal) => deal.deal.description || '—' },
      { key: 'revenue', label: 'Revenue by currency', className: 'text-right num', render: (deal) => dealMoney(deal.totals, 'revenue') },
      { key: 'grossProfit', label: 'Gross profit by currency', className: 'text-right num', render: (deal) => dealMoney(deal.totals, 'grossProfit') },
      { key: 'netProfit', label: 'Net profit by currency', className: 'text-right num font-medium', render: (deal) => dealMoney(deal.totals, 'netProfit') },
      { key: 'status', label: 'Status', render: (deal) => deal.deal.status },
      { key: 'actions', label: '', render: (deal) => <button className="btn-danger-soft" aria-label={`Delete deal ${deal.deal.identifier}`} onClick={() => { setDeleteError(''); setDeleteTarget(deal); }}>Delete</button> },
    ]} /></div>
    <Modal open={creating} onClose={() => !saving && setCreating(false)} title="Create deal account">
      <div className="space-y-3"><div><label className="label" htmlFor="deal-identifier">Deal identifier *</label><input id="deal-identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. 931x" /></div><div><label className="label" htmlFor="deal-description">Description</label><input id="deal-description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div><div className="flex gap-2"><button className="btn-primary" disabled={saving || !identifier.trim()} onClick={create}>{saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Create deal'}</button><button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button></div></div>
    </Modal>
    <Modal open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title="Delete deal account" subtitle="This permanently removes the deal record; linked financial records are never deleted">
      {deleteTarget && <div className="space-y-4">
        <p className="text-sm text-ink-700">Permanently delete deal <strong className="font-mono">{deleteTarget.deal.identifier}</strong>? This is allowed only when it has no linked sales invoices, purchase orders, or expenses.</p>
        <p className="text-sm text-ink-500">If records are linked, deletion will be blocked. Open the deal and unlink those records first; their original transactions and history will remain unchanged.</p>
        {deleteError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-danger" disabled={deleting} onClick={removeDeal}>{deleting ? <><Spinner className="w-4 h-4" /> Deleting…</> : 'Delete permanently'}</button>
          <button className="btn-secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
        </div>
      </div>}
    </Modal>
  </div>;

  if (detailLoading || !detail) return <div className="p-8">Loading deal…</div>;
  const { deal, totals, records } = detail;
  const available = candidates.filter((record) => !record.deal && (type !== 'expense' || record.status === 'posted'));
  const candidateLabel = (record) => type === 'expense'
    ? `${date(record.date)} · ${record.description || record.category} · ${money(record.amount, record.currency || 'PKR')}`
    : `${record.number} · ${date(record.issuedAt || record.orderedAt)} · ${money(record.total, record.currency || 'PKR')}`;
  return <div>
    <PageHeader breadcrumb={[{ label: 'Deal accounts', to: '/deal-accounts' }]} title={`Deal ${deal.identifier}`} subtitle={deal.description || 'Deal financial record'} />
    <div className="page page-w space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        <StatCard label="Revenue" value={dealMoney(totals, 'revenue')} hint="Invoice line revenue, matching existing P&L" />
        <StatCard label="Purchase orders" value={dealMoney(totals, 'purchaseCosts')} hint="Linked PO totals, shown separately" />
        <StatCard label="Cost of goods sold" value={dealMoney(totals, 'costOfGoods')} hint="Invoice quantity × sale-time unit cost" />
        <StatCard label="Other expenses" value={dealMoney(totals, 'otherExpenses')} hint="Linked posted expenses" />
        <StatCard label="Gross profit" value={dealMoney(totals, 'grossProfit')} hint="Revenue − cost of goods sold" />
        <StatCard label="Net profit" value={dealMoney(totals, 'netProfit')} hint="Gross profit − linked other expenses" />
      </div>
      <section className="card p-4 space-y-3">
        <h2 className="font-semibold text-ink-900">Link an existing record</h2>
        <p className="text-sm text-ink-500">Only unassigned records can be linked. Linking changes the deal association; it does not edit or move the underlying payment or expense.</p>
        <div className="flex flex-wrap gap-2">
          <select className="select" value={type} onChange={(e) => { setType(e.target.value); setRecordId(''); }} aria-label="Record type">{TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <select className="select min-w-72 flex-1" value={recordId} onChange={(e) => setRecordId(e.target.value)} aria-label="Record to link"><option value="">Choose an unassigned record</option>{available.map((record) => <option key={record._id} value={record._id}>{candidateLabel(record)}</option>)}</select>
          <button className="btn-primary" disabled={!recordId || linking} onClick={link}>{linking ? 'Linking…' : 'Link record'}</button>
        </div>
      </section>
      {[
        ['Sales invoices', 'invoice', records.invoices, (r) => <Link className="text-brand-700 hover:underline font-mono" to={`/invoices/${r._id}`}>{r.number}</Link>, (r) => money(r.total, currency), 'issuedAt'],
        ['Purchase orders', 'purchase', records.purchases, (r) => <Link className="text-brand-700 hover:underline font-mono" to={`/purchase-orders/${r._id}`}>{r.number}</Link>, (r) => money(r.total, currency), 'orderedAt'],
        ['Expenses', 'expense', records.expenses, (r) => r.description || r.category, (r) => money(r.amount, currency), 'date'],
      ].map(([title, recordType, rows, name, amount, dateField]) => <section className="card" key={title}><div className="p-4 font-semibold text-ink-900">{title}</div><Table rows={rows} empty={`No ${title.toLowerCase()} linked`} columns={[
        { key: 'number', label: 'Record', render: name },
        { key: 'date', label: 'Date', render: (r) => date(r[dateField]) },
        { key: 'amount', label: 'Amount', className: 'text-right num', render: (r) => amount(r) },
        { key: 'unlink', label: '', render: (r) => <button className="btn-secondary" onClick={() => unlink(recordType, r)}>Unlink</button> },
      ]} /></section>)}
      <p className="text-xs text-ink-400">Purchase order totals are reported for visibility. Gross profit follows the existing P&amp;L method, which uses sale-time invoice cost snapshots; subtracting purchase orders again would double-count acquisition costs when both records represent the same goods.</p>
    </div>
  </div>;
}
