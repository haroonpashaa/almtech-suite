/* ---------------------------------------------------------------------------
   How a table row becomes a card on a phone.

   This was previously inline in Table.jsx and carried a real defect: the "which
   columns belong in the card body" test was `!c.priority && c.label`. Using the
   header text as a proxy for "is this a real column" silently dropped every
   column declared with `label: ''` — which is exactly how action columns and
   several status columns are declared. The observable results were:

     - Users:     row actions vanished, and with no link in the head columns the
                  screen became entirely non-interactive on a phone
     - Suppliers: View / Edit vanished
     - Expenses:  the "voided" badge vanished, so a voided expense rendered
                  identically to a posted one
     - Accounts:  the "inactive" badge vanished, so an inactive account looked live

   A missing header is a layout statement, not a statement about content. The
   rule is now explicit: a column is excluded from the card only if it says so
   (`hideOnMobile`), and a column with no header simply renders without a label.

   Kept as a plain .js module with no React import so it can be exercised
   directly by the regression suite.
   --------------------------------------------------------------------------- */

/**
 * Split columns into the card headline and the card body.
 *
 * head — the prominent lines at the top of the card. Columns marked
 *        `priority: 'primary'`, or the first two columns when none are marked.
 * body — everything else that should appear, each as a label/value pair.
 *        Columns with an empty label render value-only (`labelled: false`).
 *
 * `priority: 'secondary'` remains a deliberate opt-out, as before.
 */
export function splitColumnsForCard(columns = []) {
  const visible = columns.filter((c) => !c.hideOnMobile && c.priority !== 'secondary');
  const primary = visible.filter((c) => c.priority === 'primary');
  const head = primary.length ? primary : visible.slice(0, 2);
  const inHead = new Set(head.map((c) => c.key));
  const body = visible
    .filter((c) => !inHead.has(c.key))
    .map((c) => ({ column: c, labelled: typeof c.label === 'string' && c.label.trim().length > 0 }));
  return { head, body };
}

/**
 * Is a row reachable on a phone? A card must be openable either because the row
 * itself is clickable, or because a head column renders a link. Tables that
 * satisfy neither are dead ends on mobile, so pages are expected to supply one.
 */
export function cardIsReachable({ columns = [], hasRowClick = false, headRendersLink = false }) {
  if (hasRowClick) return true;
  if (headRendersLink) return true;
  return splitColumnsForCard(columns).head.some((c) => c.linksTo);
}

/**
 * Page window for a paginated list: which 1-based page numbers to show, with
 * nulls standing for gaps. Kept pure so the boundary arithmetic is testable.
 */
export function pageWindow(current, totalPages, span = 1) {
  if (totalPages <= 1) return totalPages === 1 ? [1] : [];
  const pages = new Set([1, totalPages]);
  for (let p = current - span; p <= current + span; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * The range description under a table: "1–50 of 523".
 * `total` may be undefined when the endpoint does not report one.
 */
export function rangeLabel({ page = 1, limit = 0, count = 0, total }) {
  if (!count) return total ? `0 of ${total}` : '0';
  const first = limit ? (page - 1) * limit + 1 : 1;
  const last = first + count - 1;
  if (total == null) return `${first}–${last}`;
  return `${first}–${last} of ${total}`;
}
