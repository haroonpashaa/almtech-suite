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

// The single empty/error placeholder for the whole app. Every list, table and panel
// routes through this so "nothing here" always looks and reads the same way.
export function EmptyState({ icon, title, description, action, tone = 'neutral', className = '' }) {
  const iconTone = tone === 'danger' ? 'bg-red-50 text-red-400' : 'bg-ink-50 text-ink-300';
  return (
    <div className={`flex flex-col items-center justify-center text-center py-14 px-6 ${className}`}>
      {icon && (
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3.5 ${iconTone}`}>
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {description && <p className="t-sub mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Inline error panel for a failed section that is not a table.
export function ErrorState({ title = 'Something went wrong', description, onRetry }) {
  return (
    <EmptyState
      tone="danger"
      icon={
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
        </svg>
      }
      title={title}
      description={description}
      action={onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
    />
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
