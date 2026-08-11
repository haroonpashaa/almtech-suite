// Shared presentational primitives used across pages.

const toneMap = {
  neutral: 'badge-neutral',
  brand: 'badge-brand',
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
};

const dotMap = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
};

// Maps common domain statuses to a tone, so badges stay consistent app-wide.
const statusTone = {
  paid: 'success', completed: 'success', received: 'success', active: 'success', accepted: 'success',
  partial: 'warning', pending: 'warning', draft: 'neutral', sent: 'info', ordered: 'info',
  unpaid: 'danger', overdue: 'danger', cancelled: 'danger', rejected: 'danger', void: 'danger',
  low: 'warning', out: 'danger', 'in stock': 'success',
};

export function Badge({ children, tone, dot = false, className = '' }) {
  const t = tone || statusTone[String(children).toLowerCase()] || 'neutral';
  return (
    <span className={`${toneMap[t] || toneMap.neutral} capitalize ${className}`}>
      {dot && <span className={`dot ${dotMap[t] || dotMap.neutral}`} />}
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}>
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-ink-50 text-ink-300 flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {description && <p className="text-sm text-ink-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Full-page / section loading state
export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-ink-400">
      <Spinner className="w-5 h-5 text-brand-500" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
