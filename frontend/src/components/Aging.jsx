import { money } from '../lib/format.js';

// Shared by both the Receivables and Payables screens so the two never drift apart.
export const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1–30 Days' },
  { key: 'd31_60', label: '31–60 Days' },
  { key: 'd61_90', label: '61–90 Days' },
  { key: 'd90_plus', label: '90+ Days' },
];

const TONE = {
  current: 'text-ink-700',
  d1_30: 'text-ink-700',
  d31_60: 'text-amber-600',
  d61_90: 'text-orange-600',
  d90_plus: 'text-red-600',
};

// The system has no payment-due-date field, so this is stated everywhere aging is
// shown rather than left for the reader to assume.
export function AgingNote() {
  return (
    <p className="text-xs text-ink-400">
      Aging is measured from the transaction date — the system has no payment due-date field.
    </p>
  );
}

export function AgingBuckets({ aging, currency, active, onSelect }) {
  if (!aging) return null;
  return (
    <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {BUCKETS.map((b) => {
        const value = aging[b.key] || 0;
        const isActive = active === b.key;
        const clickable = typeof onSelect === 'function';
        return (
          <button
            key={b.key}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onSelect(isActive ? '' : b.key)}
            className={`card p-4 text-left transition-all ${clickable ? 'hover:border-brand-300 hover:shadow-soft cursor-pointer' : 'cursor-default'} ${
              isActive ? 'border-brand-400 ring-1 ring-brand-200' : ''
            }`}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{b.label}</div>
            {/* Five buckets across leaves each one narrow. At a fixed text-lg the
                Current bucket rendered `PKR 4,541,682,314.` with the `01` cut off —
                a figure that reads as complete and is not. The fig scale shrinks and,
                failing that, wraps. */}
            <div className={`mt-1.5 fig-md font-semibold num tracking-tight ${value > 0 ? TONE[b.key] : 'text-ink-300'}`}>
              {money(value, currency)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function OverdueBadge({ days }) {
  if (!days || days <= 0) return <span className="text-ink-300">—</span>;
  const tone = days > 90 ? 'text-red-600' : days > 60 ? 'text-orange-600' : days > 30 ? 'text-amber-600' : 'text-ink-500';
  return <span className={`text-xs font-medium ${tone}`}>{days} day{days === 1 ? '' : 's'}</span>;
}
