import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { money, date as fmtDate, datetime } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { LoadingBlock } from '../components/ui.jsx';
import { DealStatusBadge, SettlementBadge } from '../components/DealStatus.jsx';

const KIND_ICON = {
  created: 'M12 5v14M5 12h14',
  payment: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  received: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7',
  returned: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1',
  reversed: 'M3 12a9 9 0 1 0 3-6.7M3 3v6h6',
};

function Timeline({ events, currency }) {
  if (!events?.length) return null;
  return (
    <ol className="relative pl-6">
      <span className="absolute left-[7px] top-2 bottom-2 w-px bg-ink-100" aria-hidden />
      {events.map((e, i) => (
        <li key={i} className="relative pb-5 last:pb-0">
          <span
            className={`absolute -left-6 top-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
              e.kind === 'payment' ? 'bg-emerald-100 text-emerald-700' : e.kind === 'returned' || e.kind === 'reversed' ? 'bg-red-100 text-red-700' : 'bg-brand-50 text-brand-600'
            }`}
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d={KIND_ICON[e.kind] || KIND_ICON.created} />
            </svg>
          </span>
          <div className="text-xs text-ink-400">{datetime(e.at)}</div>
          <div className="text-sm text-ink-900 font-medium mt-0.5">{e.title}</div>
          <div className="text-sm text-ink-600 mt-0.5 flex flex-wrap items-center gap-x-2">
            {e.amount != null && <span className="num font-medium">{money(e.amount, currency)}</span>}
            {e.account && (
              <>
                <span className="text-ink-300">·</span>
                <Link to={`/accounts/${e.accountId}`} className="text-brand-700 hover:underline">{e.account}</Link>
              </>
            )}
            {e.by && <><span className="text-ink-300">·</span><span className="text-ink-400">{e.by}</span></>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function DealDetail() {
  const { kind, id } = useParams();
  const isSale = kind === 'sales';

  const { data, isLoading } = useQuery({
    queryKey: ['deal', kind, id],
    queryFn: async () => (await api.get(`/deals/${kind}/${id}`)).data,
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const currency = settings?.currency || 'PKR';

  if (isLoading || !data) return <LoadingBlock />;

  const t = data.totals;
  const owed = isSale ? data.receivable : data.payable;
  const docPath = isSale ? `/invoices/${data._id}` : `/purchase-orders/${data._id}`;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Transactions', to: `/deals?kind=${kind}` }, { label: data.number }]}
        title={<span className="font-mono">{isSale ? 'DEAL' : 'PURCHASE'} #{data.number}</span>}
        subtitle={`${data.party?.name || '—'} · ${fmtDate(data.date)}`}
        actions={
          <>
            <DealStatusBadge status={data.dealStatus} />
            <Link to={docPath} className="btn-secondary">{isSale ? 'Open invoice' : 'Open purchase order'}</Link>
          </>
        }
      />
      <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-[1400px]">
        <div className="lg:col-span-2 space-y-4">
          {/* Products */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 bg-ink-25">
              <h3 className="text-sm font-semibold text-ink-900">Products</h3>
            </div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-2.5 text-left">Item</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right">{isSale ? 'Unit Price' : 'Unit Cost'}</th>
                  <th className="px-4 py-2.5 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || []).map((it, i) => (
                  <tr key={i} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink-900">{it.name}</div>
                      <div className="text-[11px] text-ink-400 font-mono">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right num text-ink-700">{it.quantity}</td>
                    <td className="px-3 py-2.5 text-right num text-ink-700">{money(isSale ? it.unitPrice : it.unitCost, currency)}</td>
                    <td className="px-4 py-2.5 text-right num font-medium text-ink-900">{money(it.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment history — one list, initial POS payment included */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 bg-ink-25 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">Payment History</h3>
              <span className="text-xs text-ink-400">{data.paymentCount} payment{data.paymentCount === 1 ? '' : 's'}</span>
            </div>
            {data.payments.length === 0 ? (
              <div className="py-10 text-center text-sm text-ink-400">
                No payments yet — the full {money(t.total, currency)} is outstanding.
              </div>
            ) : (
              <>
                <Table
                  columns={[
                    { key: 'seq', label: '#', className: 'text-right num text-ink-400', render: (p) => p.seq },
                    { key: 'date', label: 'Date', render: (p) => <span className="text-ink-500 whitespace-nowrap">{fmtDate(p.date)}</span> },
                    { key: 'method', label: 'Method', render: (p) => <span className="capitalize text-ink-700">{p.method}</span> },
                    {
                      key: 'account',
                      label: 'Account',
                      render: (p) =>
                        p.account ? (
                          <Link to={`/accounts/${p.account._id}`} className="text-brand-700 hover:underline">{p.account.name}</Link>
                        ) : (
                          <span className="text-ink-300 italic">pre-ledger</span>
                        ),
                    },
                    { key: 'reference', label: 'Reference', render: (p) => p.reference ? <span className="font-mono text-[12px] text-ink-500">{p.reference}</span> : <span className="text-ink-300">—</span> },
                    { key: 'recordedBy', label: 'By', render: (p) => <span className="text-ink-500">{p.recordedBy || '—'}</span> },
                    {
                      key: 'tag',
                      label: '',
                      render: (p) =>
                        p.reversed ? (
                          <span className="badge badge-danger" title={p.reversalReason || 'Reversed'}>reversed</span>
                        ) : p.isInitial ? (
                          <span className="badge badge-neutral">initial</span>
                        ) : null,
                    },
                    {
                      key: 'amount',
                      label: 'Amount',
                      className: 'text-right num font-medium',
                      render: (p) => (
                        <span className={p.reversed ? 'text-ink-300 line-through' : isSale ? 'text-emerald-600' : 'text-red-600'}>
                          {money(p.amount, currency)}
                        </span>
                      ),
                    },
                  ]}
                  rows={data.payments}
                />
                {data.payments.some((p) => p.reversed) && (
                  <div className="px-4 py-3 border-t border-ink-100 bg-red-50/40 space-y-1">
                    {data.payments.filter((p) => p.reversed).map((p) => (
                      <div key={p.seq} className="text-xs text-red-700">
                        <span className="font-medium">Payment #{p.seq} ({money(p.amount, currency)}) reversed</span>
                        {p.reversedAt && <> on {fmtDate(p.reversedAt)}</>}
                        {p.reversedBy && <> by {p.reversedBy}</>}
                        {p.reversalReason && <> — {p.reversalReason}</>}
                      </div>
                    ))}
                    <p className="text-[11px] text-red-600/80">Reversed payments remain on record; Total Paid excludes them.</p>
                  </div>
                )}
                <div className="px-4 py-3 border-t border-ink-100 bg-ink-25 flex justify-end gap-8 text-sm">
                  <span className="text-ink-500">Total Paid <span className="num font-semibold text-emerald-600">{money(data.totalPaid, currency)}</span></span>
                  <span className="text-ink-500">{isSale ? 'Remaining' : 'Remaining Payable'} <span className="num font-semibold text-amber-600">{money(data.remaining, currency)}</span></span>
                </div>
              </>
            )}
          </div>

          {/* Timeline */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-900 mb-4">Transaction Timeline</h3>
            <Timeline events={data.timeline} currency={currency} />
          </div>
        </div>

        {/* Summary rail */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-900 mb-3">{isSale ? 'Customer' : 'Supplier'}</h3>
            <div className="text-base font-medium text-ink-900">{data.party?.name || '—'}</div>
            {data.party?.company && <div className="text-sm text-ink-500">{data.party.company}</div>}
            {data.party?.contactPerson && <div className="text-sm text-ink-500">{data.party.contactPerson}</div>}
            {data.party?.phone && <div className="text-sm text-ink-400 mt-0.5">{data.party.phone}</div>}
            <div className="mt-3 pt-3 border-t border-ink-100 flex items-center justify-between text-sm">
              <span className="text-ink-500">Settlement</span>
              <SettlementBadge settlement={data.settlement} />
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-900 mb-3">Deal Summary</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-ink-500">Subtotal</span><span className="num text-ink-700">{money(t.subtotal, currency)}</span></div>
              {t.discount > 0 && <div className="flex justify-between"><span className="text-ink-500">Discount</span><span className="num text-red-600">− {money(t.discount, currency)}</span></div>}
              {t.taxAmount > 0 && <div className="flex justify-between"><span className="text-ink-500">Tax ({t.taxRate}%)</span><span className="num text-ink-700">{money(t.taxAmount, currency)}</span></div>}
            </div>
            <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-ink-100">
              <span className="text-sm font-medium text-ink-900">{isSale ? 'Total Deal' : 'Total Purchase'}</span>
              <span className="text-xl font-semibold num text-ink-900">{money(t.total, currency)}</span>
            </div>
            <div className="mt-3 pt-3 border-t border-ink-100 space-y-1.5 text-sm">
              {isSale && t.initialPayment > 0 && (
                <div className="flex justify-between"><span className="text-ink-500">Initial Payment</span><span className="num text-emerald-600">{money(t.initialPayment, currency)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-ink-500">Paid</span><span className="num text-emerald-600">{money(t.paid, currency)}</span></div>
              <div className="flex justify-between">
                <span className="text-ink-500">{isSale ? 'Outstanding Credit' : 'Outstanding Payable'}</span>
                <span className={`num font-semibold ${t.outstanding > 0 ? 'text-amber-600' : 'text-ink-300'}`}>{money(t.outstanding, currency)}</span>
              </div>
            </div>
          </div>

          {owed && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink-900 mb-1">
                {isSale ? 'Outstanding Receivable' : 'Outstanding Payable'}
              </h3>
              <div className="text-2xl font-semibold num text-amber-600 tracking-tight">{money(owed.outstanding, currency)}</div>
              <div className="text-sm text-ink-500 mt-1">{isSale ? owed.customerName : owed.supplierName}</div>
              <Link
                to={isSale ? `/receivables/${owed.customerId}` : `/payables/${owed.supplierId}`}
                className="btn-secondary w-full mt-3"
              >
                {isSale ? 'View receivable' : 'View payable'}
              </Link>
            </div>
          )}

          {(data.notes || data.createdBy) && (
            <div className="card p-5 text-sm">
              {data.createdBy && (
                <div className="flex justify-between"><span className="text-ink-500">Created by</span><span className="text-ink-700">{data.createdBy}</span></div>
              )}
              {data.expectedAt && (
                <div className="flex justify-between mt-1.5"><span className="text-ink-500">Expected</span><span className="text-ink-700">{fmtDate(data.expectedAt)}</span></div>
              )}
              {data.notes && (
                <div className="mt-3 pt-3 border-t border-ink-100">
                  <div className="section-title">Notes</div>
                  <p className="mt-1 text-ink-700 whitespace-pre-wrap">{data.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
