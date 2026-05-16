export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="px-8 pt-7 pb-5 bg-white border-b border-ink-100 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-500 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
    </div>
  );
}
