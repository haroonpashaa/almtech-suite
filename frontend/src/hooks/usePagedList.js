import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

/* ---------------------------------------------------------------------------
   A list that tells the truth about how much it is showing.

   The backend publishes the real match count in X-Total-Count while keeping the
   response body an array. This hook reads both, so a screen can render the rows
   and separately report what it is not rendering — which is the whole point of
   the 3B work: a capped list that stays silent is a data-integrity problem, not
   a cosmetic one.

   `keepPreviousData` keeps the current page on screen while the next one loads,
   so paging does not flash an empty table.
   --------------------------------------------------------------------------- */
export function usePagedList({ key, path, params = {}, limit = 50, enabled = true }) {
  const [page, setPage] = useState(1);

  const query = useQuery({
    enabled,
    queryKey: [...key, page, limit, params],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api.get(path, { params: { ...params, page, limit } });
      const header = res.headers?.['x-total-count'];
      const total = header == null ? null : Number(header);
      // Most paged endpoints return the rows as a plain array. /products is the one
      // exception — it keeps its existing { items, total, page, limit } body because
      // POS, QuotationForm and PurchaseOrderForm also call it and already read
      // `data.items`, so its rows arrive wrapped instead of bare.
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.items ?? []);
      return { rows, total: Number.isFinite(total) ? total : null };
    },
  });

  const rows = query.data?.rows || [];
  const total = query.data?.total ?? null;

  // Reset to page 1 whenever the caller's filters change, otherwise a filter that
  // narrows the result set can leave the user stranded on a page that no longer exists.
  const filterKey = JSON.stringify(params);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    if (page !== 1) setPage(1);
  }

  return {
    rows,
    total,
    page,
    limit,
    setPage,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    // Everything the shared Table needs to render an honest footer.
    tableProps: {
      rows,
      total,
      page,
      limit,
      onPageChange: setPage,
      loading: query.isLoading,
      error: query.isError,
      onRetry: query.refetch,
    },
  };
}
