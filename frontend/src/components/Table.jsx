export default function Table({
  columns,
  rows,
  empty = 'No records',
  emptyIcon,
  onRowClick,
  loading,
  skeletonRows = 6,
}) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-25">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400 whitespace-nowrap ${c.className || ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="border-b border-ink-100 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-3.5 ${c.className || ''}`}>
                      <div className="skeleton h-3.5" style={{ width: `${40 + ((i + c.key.length) % 5) * 12}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center">
                  <div className="flex flex-col items-center gap-2 text-ink-400">
                    {emptyIcon && <div className="text-ink-300">{emptyIcon}</div>}
                    <div className="text-sm">{empty}</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row._id || row.id || i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-ink-100 last:border-0 transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-brand-50/40' : 'hover:bg-ink-50/50'
                  }`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-3 text-ink-700 ${c.className || ''}`}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
