import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date as fmtDate, errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, LoadingBlock, Spinner } from '../components/ui.jsx';
import { AgingBuckets, AgingNote, OverdueBadge } from '../components/Aging.jsx';

const statusTone = { paid: 'success', partial: 'warning', open: 'info', returned: 'danger', cancelled: 'neutral' };

export default function ReceivableDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [payTarget, setPayTarget] = useState(null);
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [paying, setPaying] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['receivable', id],
    queryFn: async () => (await api.get(`/finance/receivables/${id}`)).data,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  function openPay(inv) {
    setPayTarget(inv);
    setAmount(String(inv.balance));
    setAccount('');
    setMethod('cash');
    setReference('');
  }

  // Posts to the existing invoice payment endpoint — no second payment implementation.
  // That single call updates invoice paid/balance/status, reduces Customer.balance and
  // posts the money into the chosen account via the Change 3 ledger.
  async function pay() {
    setPaying(true);
    try {
      await api.post(`/invoices/${payTarget._id}/payments`, {
        amount: Number(amount),
        method,
        reference,
        account,
      });
      toast.success('Payment recorded');
      setPayTarget(null);
      qc.invalidateQueries({ queryKey: ['receivable', id] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['finance-position'] });
      qc.invalidateQueries({ queryKey: ['accounts-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['payment-history'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPaying(false);
    }
  }

  if (isLoading || !data) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Receivables', to: '/receivables' }, { label: data.customer.name }]}
        title={data.customer.name}
        subtitle={data.customer.company || 'Outstanding invoices'}
        actions={data.oldestAgeDays > 0 && <Badge tone={data.oldestAgeDays > 60 ? 'danger' : 'warning'} dot>{data.oldestAgeDays} days overdue</Badge>}
      />
      <div className="p-6 sm:p-8 space-y-4 max-w-[1300px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Outstanding</div>
            <div className="mt-2 text-2xl font-semibold num text-amber-600 tracking-tight">{money(data.outstanding, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Invoiced</div>
            <div className="mt-2 text-xl font-semibold num text-ink-900">{money(data.total, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Paid</div>
            <div className="mt-2 text-xl font-semibold num text-emerald-600">{money(data.paid, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Open Invoices</div>
            <div className="mt-2 text-xl font-semibold num text-ink-900">{data.invoices.length}</div>
            {!data.reconciled && (
              <div className="text-xs text-amber-600 mt-1">Stored balance {money(data.storedBalance, currency)}</div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="section-title">Aging</div>
            <AgingNote />
          </div>
          <AgingBuckets aging={data.aging} currency={currency} />
        </div>

        <Table
          empty="No outstanding invoices for this customer"
          columns={[
            {
              key: 'number',
              label: 'Invoice',
              render: (r) => <Link to={`/invoices/${r._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{r.number}</Link>,
            },
            { key: 'date', label: 'Date', render: (r) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(r.date)}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone[r.status]} dot>{r.status}</Badge> },
            { key: 'overdueDays', label: 'Overdue', render: (r) => <OverdueBadge days={r.overdueDays} /> },
            { key: 'total', label: 'Total', className: 'text-right num text-ink-600', render: (r) => money(r.total, currency) },
            { key: 'paid', label: 'Paid', className: 'text-right num text-emerald-600', render: (r) => money(r.paid, currency) },
            { key: 'balance', label: 'Balance', className: 'text-right num font-semibold text-amber-600', render: (r) => money(r.balance, currency) },
            {
              key: 'action',
              label: '',
              className: 'text-right',
              render: (r) => (
                <button className="btn-sm bg-white border border-ink-200 text-ink-700 hover:bg-ink-50" onClick={() => openPay(r)}>
                  Record payment
                </button>
              ),
            },
          ]}
          rows={data.invoices}
        />
      </div>

      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `Record payment · ${payTarget.number}` : ''}
        subtitle={payTarget ? `Outstanding ${money(payTarget.balance, currency)}` : ''}
        size="md"
      >
        {payTarget && (
          <div className="space-y-3">
            <div>
              <label className="label">Amount <span className="text-red-500">*</span></label>
              <input className="input num" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-ink-400 mt-1">Amounts above the outstanding balance are capped automatically.</p>
            </div>
            <div>
              <label className="label">Deposit To <span className="text-red-500">*</span></label>
              <select className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">— select account —</option>
                {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Method</label>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Reference</label>
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-primary-gradient" onClick={pay} disabled={paying || !account || !(Number(amount) > 0)}>
                {paying ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save payment'}
              </button>
              <button className="btn-secondary" onClick={() => setPayTarget(null)}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
