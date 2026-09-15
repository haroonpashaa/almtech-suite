# ALM Suite ERP — Final Comprehensive Security Retest

**Purpose:** Independently retest every one of the 22 previously documented
ALM-SEC findings after Batches 1-5 remediation, using live reproduction
against real API responses, real browser behavior, and direct database
state — not by inspecting whether the code changed. This document covers
three passes in sequence: (1) the original comprehensive retest of all 22
findings (§1-§5, verification-only, no code changed), which surfaced two
new HIGH findings — ALM-SEC-023 and ALM-SEC-024 — in previously-deferred
residual areas; (2) their remediation, including a real correctness bug
and an atomicity gap discovered and fixed during a subsequent targeted
verification of the ALM-SEC-024 fix itself; and (3) a final release
verification (§6) confirming that remediation holds, with **no
application code modified** during either the original retest or this
final pass.

**Branch/checkpoint:** `security/remediation`. Originally retested at
commit `7bc42a36d0aed2838f8f3dbb95ead4ca28ed8805` (§1-§5); ALM-SEC-023/024
remediated in commit `289d365bea9cd671474c50cad1f152904a1d988c`, which is
the commit this document's final verification pass (§6) confirms.

**Baseline:** `npx vitest run` → 327/327 passed, confirmed at the start of
the original retest, again at its end, and again independently at the
start and end of the final release verification pass (§6) — four
consecutive clean runs across the whole exercise.

**Test environment:** A fresh, disposable `mongodb-memory-server` instance
and disposable backend/frontend server processes, entirely separate from
the developer's real local dev database and from production. All test
data (products, customers, suppliers, invoices, users) was created fresh
per test run with unique SKUs/emails/timestamps to avoid cross-test
interference. Real browser testing used headless Chromium via Playwright,
driving the actual built React app served by Express (matching how the
app is actually deployed — via Vercel's CDN in production, or via
Express's own static-file path in a local production-mode run — rather
than the Vite dev server, which never receives the backend's Helmet
headers and would have produced a misleading result for the clickjacking
check). Repository/branch untouched; environment fully torn down after
testing.

---

## 1. Retest results — all 22 original findings

| Finding | Description | Retest Result | Evidence |
|---|---|---|---|
| ALM-SEC-001 | Login timing side-channel | **PASS** | 10-sample median timing: existing-user 127.6ms vs. nonexistent-user 117.8ms, ratio 1.08x (was 20x+) |
| ALM-SEC-002 | No brute-force/credential-stuffing protection | **PASS** | 8 wrong-password attempts (max=6) → last 2 return `429`; unrelated account unaffected; correct login succeeds after window expiry |
| ALM-SEC-003 | No session revocation after password change | **PASS** | Full flow re-run: old tokens (both the changing session and an untouched second session) rejected `401` after password change; new login works; deactivated user still blocked |
| ALM-SEC-004 | No password strength requirement | **PASS** | 7-char password → `400`; demo-style 9-char password → `201` (unchanged); self-service change to a weak password → `400` |
| ALM-SEC-005 | No safeguard against default/example `JWT_SECRET` | **PASS** | Production startup with the exact `.env.example` placeholder → exit 1, fail-fast; a 16-char secret → exit 1; a real 32-byte random secret → starts normally |
| ALM-SEC-006 | Unhandled 500 on non-string login fields | **PASS** | Object-shaped and number/array-shaped `email`/`password` → `400` (was `500`) |
| ALM-SEC-007 | Mass assignment on product creation | **PASS** | `_id`/`createdAt` smuggling attempt → server-generated `_id`, current timestamp; all legitimate creation fields (brand, cost, stock, etc.) still settable |
| ALM-SEC-008 | Invoice line pricing entirely client-controlled | **PASS** | `unitPrice` below cost → `400`; excessive discount below cost → `400`; legitimate above-cost edit → honored; admin unrestricted; quotation creation inherits the same floor |
| ALM-SEC-009 | Duplicate-payment idempotency never engaged by frontend | **PASS** (re-verified via Batch 3/4 evidence, unaffected by Batch 5) | See §2 concurrency section — 4 concurrent distinct payments with real idempotency keys all applied correctly, summed exactly |
| ALM-SEC-010 | Stock-adjustment audit records requested, not applied, delta | **PASS** | Stock seeded to 4, adjustment of `-9999` → stock clamps to 0, `StockMovement.quantity` correctly recorded as `-4` (not `-9999`) |
| ALM-SEC-011 | Import numeric parsing mishandles scientific notation/garbled text | **PASS** | `"1.5e3"` imported as `1500` (not `1.53`); `"abc123"` correctly rejected at commit (product never created); valid decimal and currency-formatted values still import correctly; draft/parse stage remained fully permissive (all 6 rows accepted) |
| ALM-SEC-012 | No formula-trigger sanitization on exports | **PASS** | Real XLSX export re-opened and inspected: zero real `<f>` formula elements exist anywhere; all 4 trigger-character values (`=`, `@`, `+`, `-`) apostrophe-prefixed; an ordinary value preserved byte-for-byte |
| ALM-SEC-013 | NoSQL operator injection via unsanitized filters | **PASS** | All 9 confirmed fields individually retested with `$ne`/`$regex`/`$where`/nested-object payloads — every one returns `0` results, never `500`, never an unintended broadened query; legitimate filters (`category=Printers`, `status=open`) still function |
| ALM-SEC-014 | No baseline security headers / clickjacking | **PASS** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` present, `X-Powered-By` absent, confirmed on both the API and the real served frontend; a real headless-Chromium iframe embed of the login page now renders **zero** interactable content (was: fully loaded, 2 inputs present) |
| ALM-SEC-015 | Concurrent invoice creation / quotation conversion race | **PASS** | 10 concurrent invoices (qty 2, stock 10) → exactly 5 succeed, stock exactly 0; 5 concurrent conversions of the same quotation → exactly 1 succeeds |
| ALM-SEC-016 | Concurrent stock adjustment race | **PASS** | 20 concurrent `+5` adjustments from stock 0 → final stock exactly 100 |
| ALM-SEC-017 | Concurrent invoices bypass customer credit limit | **PASS** | 10 concurrent invoices of 100 against a 300 limit → exactly 3 succeed, balance exactly 300, no orphan invoices, stock consumption matches exactly |
| ALM-SEC-018 | Concurrent PO creation loses supplier-payable updates | **PASS** | 10 concurrent POs of cost 50 → supplier payable exactly 500 |
| ALM-SEC-019 | Payment reversal full-document save discards concurrent payment | **PASS** (invoice side, as originally scoped) | 5 concurrent reversal attempts of the same payment → exactly 1 succeeds, `paid` correctly returns to 0. **Note:** the PO-side mirror of this exact bug (`reverseSupplierPayment`), explicitly left untouched and flagged HIGH-CONFIDENCE in the original report, was investigated this round per instruction and is now **CONFIRMED** as a live-reproduced, unremediated issue — see §3, new finding ALM-SEC-023 |
| ALM-SEC-020 | Concurrent opening-balance corrections lose updates | **PASS** | 10 concurrent `openingBalance` corrections → `openingBalance` and `currentBalance` land on the identical value (internally consistent, no split state); all 10 requests returned `200` |
| ALM-SEC-021 | Login events missing from audit trail | **PASS** | `login_succeeded` and `login_failed` both present in `/activity` after a real login/failed-login pair; no password value anywhere in the audit payload |
| ALM-SEC-022 | Update audit entries don't capture before/after diffs | **PASS** | Verified live and independently for all four controllers this finding named: `product_updated` (sellingPrice 100→175), `customer_updated` (creditLimit 200→800), `user_updated` (role sales→stock), `supplier_updated` (active true→false) — every one carries the correct `meta.changes.{field}.{from,to}` |

**22/22 PASS.** No previously-fixed Critical or High finding regressed. The
stop condition ("if any previously-fixed Critical or High vulnerability
fails retesting, STOP immediately") was never triggered.

One test-assumption correction made during this retest: an initial RBAC
check assumed `GET /invoices` should be stock-excluded; the route source
(`invoice.routes.js`) shows `r.get('/', listInvoices)` has no role
restriction beyond `protect` — any authenticated role, including stock,
can list invoices by design. This was a flaw in the retest's own
expectation, not a regression; corrected and re-verified.

---

## 2. Critical regression areas — concurrency and database invariants

All fired as genuinely concurrent (`Promise.all`) requests against a fresh
isolated test database, verified via direct `GET` reads afterward (not
just response status codes).

| Area | Invariant checked | Result |
|---|---|---|
| Direct invoice creation | `starting stock - successful sales == final stock` | **PASS** — `10 - 5×2 = 0`, actual stock `0` |
| Direct invoice creation | `sum successful invoice totals == receivable increase` | **PASS** — expected `1000`, actual customer balance `1000` |
| Stock adjustment | no lost updates under concurrency | **PASS** — 20×`+5` from 0 → exactly `100` |
| Quotation → invoice conversion | exactly one of N concurrent conversions succeeds | **PASS** — `1/5` succeeded, stock consistent |
| Customer credit limits | limit never exceeded; rejected attempts leave no side effects | **PASS** — `3/10` succeeded at a 300 limit, balance exactly `300`, stock consumption `3`, invoice count `3` (no orphans) |
| Purchase-order creation / supplier payable | `sum successful PO totals == supplier payable increase` | **PASS** — `10/10` succeeded, payable exactly `500` |
| Invoice payment + reversal | exactly one concurrent reversal applies | **PASS** — `1/5` succeeded, `paid` returned to `0` |
| Concurrent payments (distinct, legitimate) | all apply, sum correct, no lost update | **PASS** — 4 concurrent distinct-key payments of 250 each → all 4 applied, `paid = 1000` |
| Opening-balance changes | no silently-discarded corrections, fields stay internally consistent | **PASS** — 10 concurrent corrections, all `200`, final `openingBalance == currentBalance` |

**No successful operation silently disappeared. No rejected operation left
partial state**, across every scenario tested above.

---

## 3. New findings from previously-deferred residual areas

Per instruction, the two areas the original assessment explicitly deferred
as "HIGH-CONFIDENCE but not independently live-reproduced" were now
investigated with controlled, live concurrent reproduction. **Neither was
remediated — both are reported here as new, open findings for a future
authorized batch.**

### ALM-SEC-023 — `reverseSupplierPayment` has the same concurrency weakness ALM-SEC-019 fixed on the invoice side

**Severity:** HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED (live-reproduced,
not code-review-only) &nbsp;|&nbsp; **CWE-362 (Race Condition)**

**Component:** `backend/src/controllers/purchaseOrder.controller.js`,
`reverseSupplierPayment` (~line 605): `applyDocumentUpdates` computes
`po.paid = Math.max(0, po.paid - amount)` / `po.balance = Math.max(0,
po.total - po.paid)` from the in-memory `po` document read at the top of
the request, then calls `po.save({session})` — a full-document write. This
is the exact pattern `reverseInvoicePayment` had before the ALM-SEC-019
fix. `recordSupplierPayment` (the PO-side payment-recording path) already
uses a fully atomic, conditional pipeline update — it was not the source
of the bug; the reversal path was never brought in line with it.

**Affected endpoint:** `POST /api/purchase-orders/:id/payments/:paymentId/reverse`

**Affected role:** admin (payment reversal is admin-only)

**Reproduction:** purchase order total 200; one payment of 100 already
applied (`paid=100`, `balance=100`). Fired **concurrently**: (a) a new
payment of 50, and (b) a reversal of the original 100 payment.
```
Both requests returned success (200/200).
Expected: paid=50, balance=150 (the new payment landing, net of the
reversed original).
Actual:   paid=0, balance=200 — the new payment's effect on
Purchase­Order.paid/balance was silently discarded.
```
Notably, the *payments array itself* (both entries, with correct
`reversed` flags) and *Supplier.payable* (correctly `150`) both ended up
right — only the `PurchaseOrder.paid`/`balance` top-level fields were
corrupted, because they were computed from a stale pre-race snapshot and
overwritten by the reversal's full-document save. This makes the bug
more insidious than a total data loss: the PO's headline `paid`/`balance`
figures actively disagree with its own `payments` array and with the
supplier's payable — a reconciliation-breaking inconsistency, not merely
"one payment vanished."

**Expected behavior:** matches ALM-SEC-019's already-fixed invoice-side
behavior — two independent, individually-valid concurrent operations (a
new payment and a reversal of a *different* payment) should both take
effect.

**ERP/business impact:** identical in kind to ALM-SEC-019's original
assessment — a real supplier payment can be silently discarded from the
PO's own `paid`/`balance` display if it races against an admin reversing
an unrelated earlier payment on the same PO, while the ledger and
supplier-payable figures stay correct — creating a display/reconciliation
discrepancy that would only surface on manual audit.

**Recommended remediation (not applied this round):** restructure
`reverseSupplierPayment`'s `applyDocumentUpdates` to use the identical
atomic/`arrayFilters` two-step pattern already used by
`reverseInvoicePayment` since the ALM-SEC-019 fix, rather than a
full-document `.save()`.

**Regression risk of a future fix:** Low-Medium, same shape as
ALM-SEC-019's own fix was.

**Retest procedure:** repeat the exact reproduction above; expect
`paid=50`, `balance=150` regardless of which of the two concurrent
operations' writes physically lands first.

**Status:** **FIXED — remediated and retested. See §6 for the complete
final-verification record (commit
`289d365bea9cd671474c50cad1f152904a1d988c`).**

### ALM-SEC-024 — `returnInvoice` has no atomic claim on invoice status; concurrent returns can duplicate-process and lose stock/balance updates

**Severity:** HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED (live-reproduced)
&nbsp;|&nbsp; **CWE-362 (Race Condition) / CWE-841 (Improper Enforcement of
Behavioral Workflow — duplicate execution of a one-time operation)**

**Component:** `backend/src/controllers/invoice.controller.js`,
`returnInvoice` (~line 636). Three separate non-atomic weaknesses combine
here:
1. The guard `if (invoice.status === 'returned' || invoice.status ===
   'cancelled') { ... }` is a plain read-then-branch with no compare-and-swap
   — it does not atomically claim the invoice the way `commitInvoiceEffects`
   claims stock or `convertToInvoice` claims a quotation.
2. `product.stock += it.quantity; await product.save();` (restoring stock)
   is a classic non-atomic read-modify-write, the same shape ALM-SEC-016
   fixed for `adjustStock`.
3. `customer.balance = Math.max(0, customer.balance - invoice.balance);
   await customer.save();` (crediting the return) is the same non-atomic
   pattern.

**Affected endpoint:** `POST /api/invoices/:id/return`

**Affected role:** admin (returns are admin-only)

**Reproduction 1 (duplicate processing of the SAME invoice):** a single
unpaid invoice (5 units of one product, stock seeded to 20, 5 sold →
15 remaining). Fired **5 concurrent** return requests against that one
invoice.
```
Statuses: 200, 200, 200, 200, 400
4 of 5 concurrent requests ALL SUCCEEDED — not the expected exactly 1.
Product stock after: 30 (expected 20 — 15 remaining + one legitimate
+5 restoration). The invoice was processed as "returned" multiple times
concurrently before any of them could see each other's write.
```
A **sequential** repeat of the identical two-request pattern (not
concurrent) correctly returns `200` then `400` ("Invoice already
returned") — confirming this is a concurrency-only gap, not a broken
guard in the ordinary case.

**Reproduction 2 (lost updates across two DIFFERENT invoices sharing a
product and customer):** two separate invoices (5 units each, same
product, same customer, stock seeded to 10, both sold sequentially first
→ stock 0, customer balance 1000). Fired **concurrently**: return
invoice 1 and return invoice 2.
```
Both returns individually reported success (200/200) — this part is
correct, since they are two genuinely different, individually valid
invoices.
Stock after both returns: 5 (expected 10 — both +5 restorations should
have landed).
Customer balance after both returns: 500 (expected 0 — both invoices'
outstanding amounts should have been credited back).
```

**Expected behavior:** an invoice can be returned exactly once, ever,
regardless of concurrent request timing; two different invoices' return
effects on a shared product's stock and a shared customer's balance must
both compose correctly, never overwrite each other.

**Actual behavior:** the same invoice can be "returned" multiple times
concurrently (each restoring stock and crediting the customer again,
before any payment-refund idempotency protection can engage on an unpaid
invoice — for a *paid* invoice, the existing `reversal:${transactionId}`
idempotency key on the refund side would likely prevent a duplicate
*payment* refund specifically, but does **not** protect the separate
stock-restoration or the final `invoice.status = 'returned'` write, which
have no equivalent guard at all); and legitimately different invoices'
stock/balance effects can silently clobber each other under real
concurrency.

**ERP/business impact:** HIGH. This is the most severe class of issue in
this retest's findings — not a lost update of a single number, but actual
duplicate execution of a real business operation (stock manufactured out
of thin air via repeated restoration, customer balance credited multiple
times for a single physical return). A returns desk or any workflow where
two return requests for the same invoice could plausibly race (a
double-click, a retried request after a slow response, or two staff
members processing the same return) would directly inflate inventory and
under-collect from customers.

**Recommended remediation (not applied this round):** claim the invoice
atomically first, the same way `convertToInvoice` claims a quotation
(`Invoice.findOneAndUpdate({_id, status: {$nin: ['returned','cancelled']}},
{$set: {status: 'returned'}})`, proceeding only if it matches), then
restructure the stock-restoration and customer-balance-credit steps to use
the same atomic pipeline-update pattern `adjustStock`/`commitInvoiceEffects`
already established elsewhere in this codebase, rather than
read-modify-write `.save()` calls.

**Regression risk of a future fix:** Medium — this function has several
sequential side effects (payment refunds, stock, customer balance,
`invoice.status`) that would need to be re-sequenced around an initial
atomic claim, similar in scope to the original ALM-SEC-015 rewrite.

**Retest procedure:** repeat both reproductions; expect exactly 1 success
out of N concurrent return attempts on the same invoice, and expect stock/
customer-balance figures to reflect the sum of every genuinely distinct,
successful return with no loss.

**Status:** **FIXED — remediated and retested. See §6 for the complete
final-verification record (commit
`289d365bea9cd671474c50cad1f152904a1d988c`), including a real correctness
bug and a partial-refund atomicity gap discovered and fixed during that
verification — see §6 for the full account.**

---

## 4. Automated test suite

`npx vitest run` — run before this retest (confirming the starting
baseline) and again at the end (confirming this verification-only pass
made no changes): **327/327 passed**, 23 test files, both times.

---

## 5. Limitations of this retest

- Real production timing/network behavior for ALM-SEC-001 was not
  measured (as in the original assessment) — only local-network timing,
  which is sufficient to confirm the *mechanism* closes the gap.
- ALM-SEC-005's production-startup safeguard was verified by directly
  invoking `server.js` with controlled environment variables; the actual
  production `JWT_SECRET` was neither seen nor requested, consistent with
  the original finding's own scope.
- ALM-SEC-012's underlying uncertainty (whether a real desktop Excel/
  LibreOffice/Google Sheets installation would still treat a string-typed
  XLSX cell beginning with a trigger character as a formula) remains
  unresolved — no such application is available in this environment; the
  fix itself (apostrophe-prefixing) was verified structurally, matching
  the original report's own confidence framing.
- The RBAC retest exercised representative sensitive endpoints across all
  four roles/states rather than re-running the original full 356-check
  matrix, per the task's explicit instruction that unnecessary identical
  repetition wasn't required given the automated suite's existing
  coverage; no code path touched by any of the 22 remediations changes
  any route's role gate, so this is not expected to be a source of
  undetected regression.
- The two new findings (ALM-SEC-023, ALM-SEC-024) were reproduced with a
  small, targeted number of concurrent requests (5-10) sufficient to
  demonstrate the race reliably and repeatably; a real production
  workload's exact concurrency profile for these specific low-frequency
  admin actions (payment reversal, invoice return) was not modeled.
- Stored-XSS/CSRF/clickjacking were verified with one representative
  payload/scenario each via a real browser, matching the original
  assessment's own methodology and depth, not an exhaustive fuzz of every
  text field or endpoint.

---

## 6. ALM-SEC-023 & ALM-SEC-024 remediation and final release verification

### 6.1 Remediation summary

Both findings were authorized for remediation after §1-§5 above. Files
changed: `backend/src/controllers/purchaseOrder.controller.js`
(`reverseSupplierPayment`) and `backend/src/controllers/invoice.controller.js`
(`returnInvoice`).

**ALM-SEC-023 fix:** `reverseSupplierPayment`'s `applyDocumentUpdates`
previously recomputed `po.paid`/`.balance` from a stale in-memory read and
wrote them back with a full-document `po.save()`. Replaced with the
identical atomic, two-step pattern already proven by the ALM-SEC-019 fix:
an `arrayFilters`-guarded update flipping the targeted payment's
`reversed` flag (doubling as duplicate-reversal protection), followed by
a separate aggregation-pipeline update recomputing `paid`/`balance` from
the database's live value. `Supplier.payable`'s existing atomic `$inc` is
unchanged.

**ALM-SEC-024 fix:** `returnInvoice` had no compare-and-swap on
`invoice.status`, plus non-atomic `product.stock +=`/`customer.balance -=`
read-modify-writes. Fixed by atomically claiming the invoice first
(`findOneAndUpdate` compare-and-swap, the same pattern `convertToInvoice`
uses to claim a quotation), converting stock restoration and the final
customer-balance credit to atomic single-document operations, and wrapping
the whole post-claim sequence in a try/catch that reverts the claim and
undoes any stock already restored if a later step fails.

**A targeted verification of this fix**, requested specifically to
determine whether a refund that had already committed could survive an
overall return failure, surfaced two further issues that were fixed in the
same commit before this final verification:

1. **A real correctness bug**, independent of the atomicity question: the
   first version of the ALM-SEC-024 fix never actually persisted
   `payments[].reversed` — it relied on an in-memory mutation from the
   shared `postReversal` helper that, without the removed `invoice.save()`
   call, was never written to the database. This meant the reversed flag
   stayed `false` even on a fully successful multi-payment return. Fixed
   by adding the same `arrayFilters` "flip reversed" update
   `reverseInvoicePayment`/the ALM-SEC-023 fix already use.
2. **A genuine partial-application atomicity gap**: a deterministic,
   isolated-database forced-failure test (two payments on one invoice;
   the second made unreversible via a controlled pre-existing ledger
   entry, after the first had already committed) proved that, without
   explicit compensation, the first payment's refund — money moved,
   ledger entry posted, `invoice.paid`/`balance` updated — survived a
   failed overall return, while the invoice correctly reverted to
   non-returned status. Fixed by tracking every refund a `returnInvoice`
   attempt actually completes and, if any later step fails, undoing each
   one in full — using `reverseTransaction()` (the same same-request
   compensating-rollback primitive `postPaymentAtomically` already uses
   for its own postings) plus reverting the payment's reversed flag,
   `paid`/`balance`, and `Customer.balance` to their exact pre-refund
   values.

Both fixes, plus the two issues found while verifying the second, are
included in commit `289d365bea9cd671474c50cad1f152904a1d988c` on
`security/remediation`.

### 6.2 Final release verification (this pass)

**Pre-checks:** branch confirmed `security/remediation`; HEAD confirmed at
`289d365bea9cd671474c50cad1f152904a1d988c`; working tree confirmed to
contain no application-code changes (only the two untracked report files,
unchanged from the prior pass); full suite confirmed 327/327 before any
testing began.

**Test environment:** a fresh, disposable `mongodb-memory-server` instance
and backend process, isolated from the developer's real local dev database
and from production, torn down after testing.

| Retest | Result | Evidence |
|---|---|---|
| ALM-SEC-023, exact original reproduction (concurrent new payment + reversal) | **PASS** | `PO.paid=50, balance=150` exactly (both concurrent effects composed correctly); `Supplier.payable=150`; `payments[0].reversed=true`, `payments[1].reversed=false` |
| Forced partial-refund rollback scenario (two payments, second deterministically made unreversible after the first commits) | **PASS** | `returnInvoice` correctly returns `409`; invoice fully reverted to its exact pre-return state — `paid=500, balance=0` (original values), **both** payment `reversed` flags `false`, `Customer.balance=0`, stock unchanged, and the ledger shows only the 2 original payments (the first payment's reversal transaction was fully deleted by the compensating rollback) — **no partial refund, stock, balance, invoice-state, or ledger inconsistency** |
| 5 concurrent returns against the same invoice | **PASS** | Exactly 1 of 5 succeeds (`200`), the other 4 correctly rejected (`400`); stock restored exactly once |
| Concurrent returns of two different invoices sharing the same product and customer | **PASS** | Stock exactly `10` (both `+5` restorations landed), customer balance exactly `0` (both outstanding amounts correctly credited back) — no lost update |
| Sequential double-return (non-concurrent control) | **PASS** | First returns `200`, second correctly `400` "Invoice already returned" — confirms the fix is scoped to the concurrency gap, not a broken common-case guard |
| Post-claim race: direct payment reversal vs. `returnInvoice` for the same payment | **PASS** | Losing side (`409`) correctly leaves the invoice at its pre-claim status with stock unrestored; winning side's effects are the only ones applied — no partial state either way |
| Duplicate-reversal protection | **PASS** | A second reversal attempt of an already-reversed PO payment correctly rejected (`409`, "This payment has already been reversed") |
| Broader regression: ALM-SEC-015/016/017/018/019/020 concurrency + invariants | **PASS** (12/12) | Invoice creation, quotation conversion, stock adjustment, credit limits, PO creation/payable, payment reversal, concurrent distinct payments, opening-balance corrections — all exact |
| Broader regression: ALM-SEC-008 pricing + ALM-SEC-013 NoSQL filter injection | **PASS** (19/19) | Below-cost pricing still blocked, legitimate edits still honored, admin unrestricted, quotation inherits protection; all 9 confirmed injectable fields still return 0 results under `$ne`/`$regex` attempts, legitimate filters unaffected |
| `npx vitest run` | **PASS** | 327/327, both immediately before and immediately after this verification pass |

**No regression to any previously-fixed finding.** No application code was
modified during this verification pass — every result above reflects the
already-committed fix in `289d365...`, re-tested independently.
