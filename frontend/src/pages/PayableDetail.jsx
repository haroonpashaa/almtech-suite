import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { money, date as fmtDate, errorMessage } from '../lib/format.js';
import { useCurrency } from '../hooks/useSettings.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Money from '../components/Money.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, LoadingBlock, Spinner } from '../components/ui.jsx';
import { AgingBuckets, AgingNote, OverdueBadge } from '../components/Aging.jsx';

const statusTone = { received: 'success', partial: 'warning', ordered: 'info', cancelled: 'neutral' };

export default function PayableDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [payTarget, setPayTarget] = useState(null);
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');
  const [paying, setPaying] = useState(false);

  const [adjusting, setAdjusting] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['payable', id],
    queryFn: async () => (await api.get(`/finance/payables/${id}`)).data,
  });
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const currency = useCurrency();

  function openPay(po) {
    setPayTarget(po);
    setAmount(String(po.balance));
    setAccount('');
    setMethod('bank');
    setReference('');
  }

  function openAdjust() {
    setAdjustAmount(String(data.storedPayable));
    setAdjustNote('');
    setAdjusting(true);
  }

  // Posts an audited correction to Supplier.payable rather than letting the total be
  // typed over directly — see adjustSupplierPayable on the backend for why.
  async function saveAdjust() {
    setSavingAdjust(true);
    try {
      await api.post(`/finance/payables/${id}/adjust`, {
        amount: Number(adjustAmount),
        note: adjustNote,
      });
      toast.success('Payable updated');
      setAdjusting(false);
      qc.invalidateQueries({ queryKey: ['payable', id] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['finance-position'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingAdjust(false);
    }
  }

  // Posts to the existing purchase-order payment endpoint. That one call updates PO
  // paid/balance, reduces Supplier.payable and takes the money out of the chosen
  // account through the Change 3 ledger.
  async function pay() {
    setPaying(true);
    try {
      await api.post(`/purchase-orders/${payTarget._id}/payments`, {
        amount: Number(amount),
        method,
        reference,
        account,
      });
      toast.success('Payment recorded');
      setPayTarget(null);
      qc.invalidateQueries({ queryKey: ['payable', id] });
      qc.invalidateQueries({ queryKey: ['payables'] });
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
        breadcrumb={[{ label: `Payables (${currency})`, to: '/payables' }, { label: data.supplier.name }]}
        title={data.supplier.name}
        subtitle={data.supplier.contactPerson ? `Contact: ${data.supplier.contactPerson}` : 'Outstanding purchase orders'}
        actions={
          <>
            {data.oldestAgeDays > 0 && <Badge tone={data.oldestAgeDays > 60 ? 'danger' : 'warning'} dot>{data.oldestAgeDays} days old</Badge>}
            {/* This screen is admin-only, so supplier access is guaranteed. */}
            <Link to={`/suppliers/${data.supplier._id}`} className="btn-secondary">Supplier profile</Link>
            <button className="btn-secondary" onClick={openAdjust}>Edit Payable</button>
          </>
        }
      />
      <div className="page page-w space-y-4">
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Total Payable</div>
            <div className="mt-2 fig-lg font-semibold num break-words text-amber-600 tracking-tight">{money(data.outstanding, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Purchase Total</div>
            <div className="mt-2 fig-md font-semibold num break-words text-ink-900">{money(data.total, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Paid</div>
            <div className="mt-2 fig-md font-semibold num break-words text-emerald-600">{money(data.paid, currency)}</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Open POs</div>
            <div className="mt-2 fig-md font-semibold num break-words text-ink-900">{data.purchaseOrders.length}</div>
            {!data.reconciled && (
              <div className="text-xs text-amber-600 mt-1">Stored payable {money(data.storedPayable, currency)}</div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="section-title">Aging</div>
            <AgingNote />
          </div>
          <AgingBuckets aging={data.aging} currency={currency} />
        </div>

        <Table
          empty="No outstanding purchase orders for this supplier"
          columns={[
            {
              key: 'number',
              label: 'Purchase Order',
              render: (r) => <Link to={`/purchase-orders/${r._id}`} className="font-mono text-[13px] text-brand-700 hover:underline font-medium">{r.number}</Link>,
            },
            { key: 'date', label: 'Ordered', render: (r) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(r.date)}</span> },
            { key: 'expectedAt', label: 'Expected', render: (r) => r.expectedAt ? <span className="text-ink-500 whitespace-nowrap">{fmtDate(r.expectedAt)}</span> : <span className="text-ink-300">—</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone[r.status]} dot>{r.status}</Badge> },
            { key: 'overdueDays', label: 'Age', render: (r) => <OverdueBadge days={r.overdueDays} /> },
            { key: 'total', label: `Total (${currency})`, className: 'text-right num text-ink-600', render: (r) => <Money value={r.total} /> },
            { key: 'paid', label: `Paid (${currency})`, className: 'text-right num text-emerald-600', render: (r) => <Money value={r.paid} /> },
            { key: 'balance', label: `Balance (${currency})`, className: 'text-right num font-semibold text-amber-600', render: (r) => <Money value={r.balance} /> },
            {
              key: 'action',
              label: '',
              className: 'text-right',
              render: (r) => (
                <div className="flex justify-end gap-2">
                  {r.status !== 'cancelled' && (
                    <Link to={`/purchase-orders/${r._id}/edit`} className="btn-sm bg-white border border-ink-200 text-ink-700 hover:bg-ink-50">
                      Edit
                    </Link>
                  )}
                  <button className="btn-sm bg-white border border-ink-200 text-ink-700 hover:bg-ink-50" onClick={() => openPay(r)}>
                    Record payment
                  </button>
                </div>
              ),
            },
          ]}
          rows={data.purchaseOrders}
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
              <label htmlFor="payabledetail-amount-33" className="label">Amount <span className="text-red-500">*</span></label>
              <input id="payabledetail-amount-33" className="input num input-money" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" />
              <p className="text-xs text-ink-400 mt-1">Amounts above the outstanding balance are capped automatically.</p>
            </div>
            <div>
              <label htmlFor="payabledetail-pay-from-34" className="label">Pay From <span className="text-red-500">*</span></label>
              <select id="payabledetail-pay-from-34" className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">— select account —</option>
                {(accounts || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="payabledetail-method-35" className="label">Method</label>
              <select id="payabledetail-method-35" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="payabledetail-reference-36" className="label">Reference</label>
              <input id="payabledetail-reference-36" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-primary" onClick={pay} disabled={paying || !account || !(Number(amount) > 0)}>
                {paying ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save payment'}
              </button>
              <button className="btn-secondary" onClick={() => setPayTarget(null)}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={adjusting}
        onClose={() => setAdjusting(false)}
        title="Edit Payable"
        subtitle={data.supplier.name}
        size="md"
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-500">
            Editing this posts an audited correction (visible on the supplier's opening-balance history) rather than
            overwriting the balance directly, so the correction and who made it stay on record — the same protection
            the Opening Balances import relies on. Use it to fix a wrong balance, not to record a payment.
          </p>
          <div>
            <label htmlFor="payabledetail-adjust-amount" className="label">Total payable <span className="text-red-500">*</span></label>
            <input id="payabledetail-adjust-amount" className="input num input-money" type="number" step="0.01" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="Enter amount" />
          </div>
          <div>
            <label htmlFor="payabledetail-adjust-note" className="label">Reason for this edit <span className="text-red-500">*</span></label>
            <textarea id="payabledetail-adjust-note" className="input" rows={3} value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Why is this balance being corrected?" />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              className="btn-primary"
              onClick={saveAdjust}
              disabled={savingAdjust || adjustAmount === '' || Number(adjustAmount) < 0 || !adjustNote.trim() || Number(adjustAmount) === data.storedPayable}
            >
              {savingAdjust ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save changes'}
            </button>
            <button className="btn-secondary" onClick={() => setAdjusting(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
