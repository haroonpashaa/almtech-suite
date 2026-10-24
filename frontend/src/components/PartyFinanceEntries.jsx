import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date as fmtDate, datetime, errorMessage } from '../lib/format.js';
import { newIdempotencyKey } from '../lib/idempotency.js';
import Modal from './Modal.jsx';
import { Spinner } from './ui.jsx';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const validMoney = value => value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 0.000001;

export default function PartyFinanceEntries({ category, partyId, currency = 'PKR', entries = [], history = [], accounts = [] }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const [pending, setPending] = useState(false);
  const latch = useRef(false);
  const noun = category === 'receivables' ? 'receivable' : 'payable';
  const open = (action, entry, payment) => setDialog({ action, entry, payment, total: entry?.total ?? '', amount: entry?.balance ?? '', date: entry?.date?.slice(0, 10) || today(), description: entry?.description || '', reference: entry?.reference || '', reason: '', account: '', method: category === 'receivables' ? 'cash' : 'bank', key: newIdempotencyKey() });
  const patch = (key, value) => setDialog(current => ({ ...current, [key]: value }));
  const close = () => { if (!latch.current) setDialog(null); };
  async function submit() {
    if (!dialog || latch.current) return;
    latch.current = true; setPending(true);
    try {
      const { action, entry } = dialog;
      let path = `/finance/${category}/${partyId}/entries`;
      const payload = { reason: dialog.reason.trim(), idempotencyKey: dialog.key };
      if (entry) { path += `/${entry._id}`; payload.expectedVersion = entry.version; }
      if (action === 'create' || action === 'edit') Object.assign(payload, { total: Number(dialog.total), date: dialog.date, description: dialog.description.trim(), reference: dialog.reference.trim() });
      if (action === 'create') payload.currency = currency;
      if (action === 'pay') {
        path += '/payments';
        Object.assign(payload, { amount: Number(dialog.amount), date: dialog.date, account: dialog.account, method: dialog.method, reference: dialog.reference.trim() });
      }
      if (action === 'reverse') path += `/payments/${dialog.payment.transaction}/reverse`;
      if (action === 'void') path += '/void';
      await api[action === 'edit' ? 'patch' : 'post'](path, payload);
      toast.success('Financial entry updated');
      setDialog(null);
      ['receivable', 'payable', 'receivables', 'payables', 'finance-position', 'dashboard', 'accounts', 'accounts-summary', 'account-ledger', 'payment-history', 'customer', 'customer-ledger', 'supplier', 'supplier-ledger', 'report-receivables', 'report-payables', 'customers', 'suppliers'].forEach(key => qc.invalidateQueries({ queryKey: [key] }));
    } catch (error) { toast.error(errorMessage(error)); }
    finally { latch.current = false; setPending(false); }
  }
  const isAmountEdit = dialog && ['create', 'edit'].includes(dialog.action);
  const valid = dialog && dialog.reason.trim() && (isAmountEdit ? validMoney(dialog.total) && Number(dialog.total) >= (dialog.entry?.paid || 0) && dialog.date && dialog.description.trim() : dialog.action === 'pay' ? validMoney(dialog.amount) && Number(dialog.amount) <= dialog.entry.balance && dialog.account && dialog.date : true);
  const titles = { create: `Add ${noun} entry`, edit: `Correct ${noun} entry`, pay: category === 'receivables' ? 'Record payment received' : 'Record supplier payment', reverse: 'Reverse payment', void: `Void ${noun} entry` };
  return <section className="card p-4 space-y-4" aria-label={`Manage ${noun} entries`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="section-title">Other {category} · Admin editing</h2><p className="mt-1 text-xs text-ink-500">Manage amounts owed without an invoice or PO. Totals and open counts recalculate automatically. These entries do not create stock, sales revenue, or purchase costs.</p></div>
      <button type="button" className="btn-secondary" disabled={currency !== 'PKR'} onClick={() => open('create')}>Add {noun}</button>
    </div>
    {!entries.length && <p className="text-sm text-ink-500">No standalone entries yet.</p>}
    <ul className="divide-y divide-ink-100">
      {entries.map(entry => <li key={entry._id} className="py-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 break-words"><div className="font-medium text-sm text-ink-900">{entry.description}</div><div className="text-xs text-ink-500">{fmtDate(entry.date)}{entry.reference ? ` · ${entry.reference}` : ''} · {entry.status === 'void' ? 'Voided' : entry.balance === 0 ? 'Settled' : 'Open'}</div></div>
          <div className="text-xs text-ink-500">Total {money(entry.total, currency)} · Paid {money(entry.paid, currency)} · <span className="font-semibold text-ink-900">Outstanding {money(entry.balance, currency)}</span></div>
        </div>
        {entry.status !== 'void' && <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-sm btn-secondary" disabled={currency !== 'PKR'} onClick={() => open('edit', entry)}>Edit entry</button>
          <button type="button" className="btn-sm btn-secondary" disabled={currency !== 'PKR' || entry.balance <= 0} onClick={() => { open('pay', entry); setDialog(current => ({ ...current, date: today(), reference: '' })); }}>Record payment</button>
          <button type="button" className="btn-sm btn-secondary" disabled={entry.paid > 0} title={entry.paid > 0 ? 'Reverse payments before voiding' : undefined} onClick={() => open('void', entry)}>Void entry</button>
        </div>}
        {entry.payments?.length > 0 && <ul className="pl-3 border-l border-ink-100 space-y-2">{entry.payments.map(payment => <li key={payment.transaction} className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span>{fmtDate(payment.date)} · {money(payment.amount, currency)} · {payment.account?.name || 'Account'}{payment.reference ? ` · ${payment.reference}` : ''}{payment.reversed ? ' · Reversed' : ''}</span>
          {!payment.reversed && <button type="button" className="btn-sm btn-secondary" onClick={() => open('reverse', entry, payment)}>Reverse payment</button>}
        </li>)}</ul>}
      </li>)}
    </ul>
    {history.length > 0 && <details><summary className="cursor-pointer text-sm font-medium text-ink-700">Entry audit history ({history.length})</summary><ul className="mt-2 space-y-2">{history.map(event => <li key={event._id} className="text-xs text-ink-500 break-words"><details><summary className="cursor-pointer">{datetime(event.createdAt)} · {event.action.replaceAll('_', ' ')} · {event.createdBy?.name || 'Admin'} · {event.reason}</summary><div className="mt-1 pl-3 space-y-1"><p>Total: {money(event.before?.total || 0, currency)} → {money(event.after?.total || 0, currency)} · Paid: {money(event.before?.paid || 0, currency)} → {money(event.after?.paid || 0, currency)}</p><p>Outstanding: {money(event.before?.balance || 0, currency)} → {money(event.after?.balance || 0, currency)}</p><p>Date: {event.before?.date ? fmtDate(event.before.date) : '—'} → {event.after?.date ? fmtDate(event.after.date) : '—'}</p><p>Reference: {event.before?.reference || '—'} → {event.after?.reference || '—'}</p><p>Description: {event.before?.description || '—'} → {event.after?.description || '—'}</p></div></details></li>)}</ul></details>}
    <Modal open={!!dialog} onClose={close} title={titles[dialog?.action] || ''} subtitle={currency} size="md">
      {dialog && <div className="space-y-3">
        {isAmountEdit && <>
          <div><label className="label" htmlFor="party-entry-description">Description</label><input id="party-entry-description" className="input" value={dialog.description} maxLength={500} disabled={pending} onChange={e => patch('description', e.target.value)} /></div>
          <div><label className="label" htmlFor="party-entry-total">Total ({currency})</label><input id="party-entry-total" className="input num" type="number" step="0.01" min={dialog.entry?.paid || '0.01'} value={dialog.total} disabled={pending} onChange={e => patch('total', e.target.value)} /><p className="text-xs text-ink-500 mt-1">Paid is calculated from recorded payments. To correct it, reverse the wrong payment and record the correct one.</p></div>
        </>}
        {dialog.action === 'pay' && <>
          <div><label className="label" htmlFor="party-entry-amount">Payment amount ({currency})</label><input id="party-entry-amount" className="input num" type="number" min="0.01" max={dialog.entry.balance} step="0.01" value={dialog.amount} disabled={pending} onChange={e => patch('amount', e.target.value)} /></div>
          <div><label className="label" htmlFor="party-entry-account">{category === 'receivables' ? 'Receive into' : 'Pay from'}</label><select id="party-entry-account" className="select" value={dialog.account} disabled={pending} onChange={e => patch('account', e.target.value)}><option value="">Select account</option>{accounts.filter(a => a.active !== false && (a.currency || 'PKR') === currency).map(a => <option key={a._id} value={a._id}>{a.name} · {currency}</option>)}</select></div>
          <div><label className="label" htmlFor="party-entry-method">Method</label><select id="party-entry-method" className="select" value={dialog.method} disabled={pending} onChange={e => patch('method', e.target.value)}><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></div>
        </>}
        {(isAmountEdit || dialog.action === 'pay') && <>
          <div><label className="label" htmlFor="party-entry-date">Date</label><input id="party-entry-date" className="input" type="date" value={dialog.date} disabled={pending} onChange={e => patch('date', e.target.value)} /></div>
          <div><label className="label" htmlFor="party-entry-reference">Reference</label><input id="party-entry-reference" className="input" maxLength={200} value={dialog.reference} disabled={pending} onChange={e => patch('reference', e.target.value)} /></div>
        </>}
        {dialog.action === 'void' && <p className="text-sm text-ink-500">This removes the unpaid obligation from outstanding totals. Its original entry and audit history stay on record. Stock is unchanged.</p>}
        {dialog.action === 'reverse' && <p className="text-sm text-ink-500">This reverses {money(dialog.payment.amount, currency)} in the original account and restores the entry’s outstanding balance. The original payment stays in history.</p>}
        <div><label className="label" htmlFor="party-entry-reason">Reason</label><textarea id="party-entry-reason" className="input" rows={2} maxLength={500} value={dialog.reason} disabled={pending} onChange={e => patch('reason', e.target.value)} /></div>
        <div className="flex gap-2"><button type="button" className="btn-primary" disabled={pending || !valid} onClick={submit}>{pending ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save financial change'}</button><button type="button" className="btn-secondary" disabled={pending} onClick={close}>Cancel</button></div>
      </div>}
    </Modal>
  </section>;
}
