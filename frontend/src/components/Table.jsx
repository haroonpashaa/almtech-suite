import { EmptyState } from './ui.jsx';
import { splitColumnsForCard, pageWindow, rangeLabel } from './tableLayout.js';

/**
 * The application's one table.
 *
 * Column options:
 *   key        unique id
 *   label      header text — put the currency here for money columns, e.g. "Amount (PKR)"
 *              An empty label is allowed: the column still renders on a phone,
 *              it simply renders without a label. See tableLayout.js.
 *   render     (row) => node
 *   align      'right' for money/counts, otherwise left
 *   sortable   true to make the header a sort control (with `sort`/`onSort` below)
 *   priority   'primary' | 'secondary' | undefined
 *              On phones the table becomes a stacked card list: `primary` columns
 *              form the card headline, `secondary` are hidden, the rest become
 *              label/value rows. That is deliberate — a horizontally scrolling
 *              financial table is unusable one-handed.
 *   hideOnMobile  drop the column from the card entirely (layout spacers only)
 *   headClass / className  extra classes for header / cells
 *
 * Pagination is opt-in. Pass `page`, `limit`, `total` and `onPageChange` and the
 * footer appears. `total` is what makes the count honest — without it a capped
 * list cannot tell the user that records are missing, which is precisely the
 * failure this component now guards against via `capped`.
 */
export default function Table({
  columns,
  rows = [],
  empty = 'No records',
  emptyIcon,
  emptyDescription,
  emptyAction,
  onRowClick,
  loading,
  error,
  onRetry,
  skeletonRows = 6,
  sort,                 // { key, order: 'asc' | 'desc' }
  onSort,               // (key) => void
  stickyHeader = false,
  rowKey = (row, i) => row._id || row.id || i,
  caption,
  // --- pagination / honesty ---
  page,                 // 1-based
  limit,
  total,                // total matching records on the server
  onPageChange,         // (nextPage) => void
  capped,               // server returned a hard cap with no paging available
}) {
  const alignOf = (c) => (c.align === 'right' ? 'text-right' : '');

  if (error) {
    return (
      <div className="card">
        <EmptyState
          tone="danger"
          icon={
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
            </svg>
          }
          title="Could not load this data"
          description={typeof error === 'string' ? error : 'Something went wrong while fetching these records.'}
          action={onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
        />
      </div>
    );
  }

  const isEmpty = !loading && rows.length === 0;
  const paged = typeof page === 'number' && typeof onPageChange === 'function' && !!limit;
  const totalPages = paged && total != null ? Math.max(1, Math.ceil(total / limit)) : null;
  const showFooter = !loading && !isEmpty && (paged || total != null || capped);

  return (
    <div className="card overflow-hidden">
      {/* A capped, unpaged list is the one case where the table must speak up:
          records exist that it is not showing. Silence here is a data-integrity
          problem, not a cosmetic one. */}
      {capped && !loading && (
        <p role="status" className="flex items-start gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-50 text-[13px] text-amber-800">
          <svg className="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
          <span>
            Showing the most recent {rows.length}
            {total != null && <> of <span className="num font-medium">{total}</span></>} records.
            Narrow the search or use the filters to reach the rest.
          </span>
        </p>
      )}

      {/* ---------- Desktop / tablet: a real table ---------- */}
      <div className={`hidden sm:block overflow-x-auto ${stickyHeader ? 'max-h-[70vh] overflow-y-auto' : ''}`}>
        <table className={`min-w-full text-sm ${stickyHeader ? 'table-sticky' : ''}`}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const sortable = c.sortable && onSort;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`th ${alignOf(c)} ${c.headClass || ''}`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={`inline-flex items-center gap-1 hover:text-ink-700 transition-colors ${active ? 'text-ink-700' : ''}`}
                      >
                        {c.label}
                        <svg
                          className={`w-3 h-3 transition-opacity ${active ? 'opacity-100' : 'opacity-30'}`}
                          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                          aria-hidden
                        >
                          {active && sort.order === 'asc' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
                        </svg>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="tr">
                  {columns.map((c) => (
                    <td key={c.key} className={`td ${alignOf(c)}`}>
                      <div className={`skeleton h-3.5 ${c.align === 'right' ? 'ml-auto' : ''}`} style={{ width: `${40 + ((i + String(c.key).length) % 5) * 12}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : isEmpty ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <EmptyState icon={emptyIcon} title={empty} description={emptyDescription} action={emptyAction} />
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`tr ${onRowClick ? 'cursor-pointer tr-hover' : 'hover:bg-ink-50/60'}`}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`td ${alignOf(c)} ${c.className || ''}`}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- Phone: stacked cards ---------- */}
      <div className="sm:hidden divide-y divide-ink-100">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 space-y-2">
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          ))
        ) : isEmpty ? (
          <EmptyState icon={emptyIcon} title={empty} description={emptyDescription} action={emptyAction} />
        ) : (
          rows.map((row, i) => {
            const { head, body } = splitColumnsForCard(columns);
            return (
              <div
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`p-4 ${onRowClick ? 'cursor-pointer active:bg-brand-50/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    {head.map((c) => (
                      <div key={c.key} className="text-sm font-medium text-ink-900 truncate">
                        {c.render ? c.render(row) : row[c.key]}
                      </div>
                    ))}
                  </div>
                </div>
                {body.length > 0 && (
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {body.map(({ column: c, labelled }) => (
                      <div key={c.key} className={labelled ? 'min-w-0' : 'min-w-0 col-span-2'}>
                        {labelled && <dt className="t-meta truncate">{c.label}</dt>}
                        <dd className={`text-[13px] text-ink-700 ${labelled ? 'truncate' : 'flex flex-wrap items-center gap-1.5 pt-1'} ${c.align === 'right' && labelled ? 'num' : ''}`}>
                          {c.render ? c.render(row) : row[c.key]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ---------- Footer: count and paging ---------- */}
      {showFooter && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-ink-100 bg-ink-25">
          <p role="status" className="t-meta">
            {rangeLabel({ page: paged ? page : 1, limit: limit || rows.length, count: rows.length, total })}
            {total != null && <> record{total === 1 ? '' : 's'}</>}
          </p>
          {paged && totalPages > 1 && (
            <nav className="flex items-center gap-1" aria-label="Pagination">
              <button
                className="btn-sm btn-secondary"
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                Previous
              </button>
              {pageWindow(page, totalPages).map((p, i) =>
                p === null ? (
                  <span key={`gap-${i}`} className="px-1 text-ink-300" aria-hidden>…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => onPageChange(p)}
                    aria-current={p === page ? 'page' : undefined}
                    aria-label={`Page ${p}`}
                    className={`min-w-[2rem] h-8 px-2 rounded-md text-[13px] font-medium transition-colors ${
                      p === page ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                className="btn-sm btn-secondary"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
