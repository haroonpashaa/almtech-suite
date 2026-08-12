const accentBar = {
  default: 'bg-ink-200',
  brand: 'bg-brand-600',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

export default function StatCard({ label, value, hint, accent, icon, delta, loading }) {
  if (loading) {
    return (
      <div className="card p-5 relative overflow-hidden">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-7 w-32 mt-3" />
        <div className="skeleton h-3 w-20 mt-3" />
      </div>
    );
  }

  const up = delta != null && delta >= 0;
  return (
    <div className="card card-hover p-5 relative overflow-hidden group">
      {accent && (
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar[accent] || accentBar.brand}`} />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
        {icon && (
          <div className="w-8 h-8 -mt-0.5 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-2 fig-lg font-semibold text-ink-900 num tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-2 min-h-[1.1rem]">
        {delta != null && (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
              up ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {up ? <path d="M7 17 17 7M9 7h8v8" /> : <path d="M7 7l10 10M17 7v10H7" />}
            </svg>
            {Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </div>
    </div>
  );
}
