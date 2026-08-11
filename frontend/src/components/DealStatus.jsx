import { Badge } from './ui.jsx';

// Derived display statuses. These do not replace Invoice.status / PurchaseOrder.status
// — they are computed from total/paid/balance, and terminal states keep their own name
// rather than being forced into the paid/partial/credit vocabulary.
const TONE = {
  PAID: 'success',
  PARTIAL: 'warning',
  CREDIT: 'info',
  RETURNED: 'danger',
  CANCELLED: 'neutral',
  DRAFT: 'neutral',
};

export function DealStatusBadge({ status }) {
  if (!status) return null;
  return <Badge tone={TONE[status] || 'neutral'} dot>{status}</Badge>;
}

export function SettlementBadge({ settlement }) {
  if (!settlement) return <span className="text-ink-300">—</span>;
  return settlement === 'cash' ? (
    <span className="text-xs font-medium text-emerald-600">Cash</span>
  ) : (
    <span className="text-xs font-medium text-amber-600">Credit</span>
  );
}
