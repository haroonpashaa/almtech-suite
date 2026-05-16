export default function StatCard({ label, value, hint, tone = 'default', accent }) {
  const accentBar = {
    default: 'bg-ink-100',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    brand: 'bg-brand-gradient',
  };
  return (
    <div className="card p-5 relative overflow-hidden">
      {accent && <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentBar[accent] || accentBar.brand}`} />}
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink-900 num tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}
    </div>
  );
}
