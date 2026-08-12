/* ---------------------------------------------------------------------------
   List pagination.

   The list endpoints used to apply a fixed `.limit(500)` (or none at all) with no
   page controls and no total. Once a business passes that many records the list
   silently stops showing the oldest ones — verified on this database: with 523
   invoices, GET /invoices returned 500 and invoice A1-INV-1, carrying 210,000
   outstanding, became unreachable from the invoice list while still existing.

   The fix is deliberately additive so that no existing caller changes behaviour:

     - no query params  → identical response to before, same cap, same array body
     - ?page / ?limit   → that window instead
     - always           → an X-Total-Count header carrying the true match count

   The response BODY stays an array in every case. Clients that ignore the header
   are unaffected; clients that read it can tell the user what they are not seeing.
   --------------------------------------------------------------------------- */

const MAX_LIMIT = 500;

/**
 * Resolve paging for a list request.
 *
 * @param {object} query          req.query
 * @param {number} defaultLimit   the endpoint's historical cap; 0 means "no cap"
 */
export function resolvePaging(query = {}, defaultLimit = 0) {
  const asked = query.page !== undefined || query.limit !== undefined;

  const rawLimit = Number(query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : defaultLimit;

  const rawPage = Number(query.page);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  // Skipping only makes sense against a bounded window.
  const skip = limit > 0 ? (page - 1) * limit : 0;

  return { paged: asked, page, limit, skip };
}

/**
 * Apply paging to a Mongoose query and publish the true total.
 *
 * Returns the documents. The caller stays in charge of the response shape, which
 * is what keeps this backward compatible.
 */
export async function runPaged(res, model, filter, { sort, select, populate, paging }) {
  const [total, items] = await Promise.all([
    model.countDocuments(filter),
    (() => {
      let q = model.find(filter);
      if (select) q = q.select(select);
      if (populate) q = Array.isArray(populate) ? populate.reduce((acc, p) => acc.populate(...[].concat(p)), q) : q.populate(populate);
      if (sort) q = q.sort(sort);
      if (paging.skip) q = q.skip(paging.skip);
      if (paging.limit > 0) q = q.limit(paging.limit);
      return q;
    })(),
  ]);

  setTotalCount(res, total);
  return items;
}

/** Publish the true match count so a client can report what it is not showing. */
export function setTotalCount(res, total) {
  res.set('X-Total-Count', String(total));
}
