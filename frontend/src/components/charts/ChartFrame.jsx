import { EmptyState } from '../ui.jsx';

/* ---------------------------------------------------------------------------
   The frame every chart sits in: title, optional control, and the four states a
   chart can be in (loading, error, empty, populated).

   It also carries the accessible fallback. A canvas of coloured paths says
   nothing to a screen reader, so each chart supplies its rows and this frame
   renders them as a visually hidden table — the same numbers, in text.

   No recharts import here, so the frame stays in the main bundle and the heavy
   chart body can be loaded separately.
   --------------------------------------------------------------------------- */
export default function ChartFrame({
  title,
  subtitle,
  action,
  loading,
  error,
  onRetry,
  isEmpty,
  emptyTitle = 'Nothing to show for this period',
  emptyDescription,
  height = 250,
  className = '',
  children,
  // Accessible fallback: { caption, columns: ['Period','Revenue'], rows: [[...]] }
  table,
}) {
  return (
    <section className={`card flex flex-col min-w-0 overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div className="min-w-0">
            {title && <h2 className="t-section truncate">{title}</h2>}
            {subtitle && <p className="t-meta mt-0.5 truncate">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="flex-1 min-h-0 p-4">
        {loading ? (
          <div className="skeleton rounded-md w-full" style={{ height }} aria-hidden />
        ) : error ? (
          <EmptyState
            tone="danger"
            title="This chart could not be loaded"
            description={typeof error === 'string' ? error : undefined}
            action={onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
          />
        ) : isEmpty ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <>
            <div style={{ height }}>{children}</div>
            {table && (
              /* The hidden class must sit on a div, not the table. `sr-only` sets
                 width:1px, but a table treats width as a minimum and its auto layout
                 grows to fit its content — these fallbacks measured 380px wide and,
                 being absolutely positioned, pushed the document to 412px on a 320px
                 screen. `clip` hides pixels, not layout: the dashboard picked up a
                 horizontal scrollbar from four tables nobody can see. A div honours
                 the 1px box and clips the table inside it. */
              <div className="sr-only">
                <table>
                  <caption>{table.caption}</caption>
                  <thead>
                    <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, i) => (
                      <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** The tooltip used by every chart, so hover reads identically everywhere. */
export function ChartTooltip({ active, payload, label, currency, moneyFn, extra }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2 shadow-pop min-w-[170px]">
      <div className="t-meta mb-1.5">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-[13px] leading-6">
          <span className="dot shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-ink-500 capitalize">{p.name || p.dataKey}</span>
          <span className="num ml-auto font-medium text-ink-900">{moneyFn(p.value, currency)}</span>
        </div>
      ))}
      {extra && extra(rows)}
    </div>
  );
}
