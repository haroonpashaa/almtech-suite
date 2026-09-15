# ALM Suite ERP — Security Assessment

**Status:** ALL 19 PHASES COMPLETE. 22 total findings (ALM-SEC-001 through
ALM-SEC-022). **FIXED and retested:** ALM-SEC-015 (CRITICAL — both
`createInvoice` and its `convertToInvoice` sibling instance are now fixed),
ALM-SEC-016 (HIGH, `adjustStock`), ALM-SEC-018 (HIGH, `createPO` supplier
payable), ALM-SEC-019 (HIGH, invoice payment/reversal race), ALM-SEC-008
(HIGH, invoice line pricing/discount below-cost bypass), ALM-SEC-009 (HIGH,
frontend now sends duplicate-payment idempotency keys), ALM-SEC-011
(HIGH, spreadsheet numeric-parsing silent corruption), ALM-SEC-003
(MEDIUM–HIGH, JWT session revocation after password change). All other 14
findings remain OPEN, unremediated, awaiting authorization. See §25 for the
full consolidated summary.
**Assessment type:** Internal, authorized, source-available security review by an AI coding
agent. This is NOT an accredited penetration test and does not constitute certification
(ISO, SOC 2, PCI-DSS, or otherwise).
**Owner/authorizer:** Repository owner (self-assessment of owned software).
**Audit trail:** This document is updated in place as phases complete. Every finding
records what was inspected, what was tested, and how to reproduce it.

---

## 1. Scope

**In scope:**
- `backend/` — Express/Node API (source, config, dependency manifest)
- `frontend/` — React/Vite SPA (source, config, dependency manifest)
- Application-level authentication, authorization, business logic, API surface, data
  handling, import/export, and configuration as expressed in this repository
- Dynamic testing against an **isolated, throwaway, local instance** only — a
  fresh MongoDB (mongodb-memory-server), non-default port, demo seed data only

**Out of scope (not tested, not touched):**
- Production Hostinger deployment
- Production MongoDB Atlas database
- The developer's real local dev database (`backend/data/`)
- Network/infrastructure-level pentesting (no port scanning, no OS-level testing)
- Hostinger platform/hosting-provider security
- Physical/social-engineering vectors
- Third-party services ALM Suite does not itself call (there are currently no external
  API integrations found in the codebase — confirmed in Section 4)

## 2. Assessment Limitations

- No accredited certification is issued or implied.
- Dynamic testing is limited to what a local, ephemeral dev instance can safely
  demonstrate. Anything requiring production-scale data, production infrastructure,
  or third-party services is marked "could not be tested."
- Tooling is what's available in this shell environment (see Section 9) — no
  Burp Suite, no Nessus/Nuclei/OWASP ZAP, no network scanner. Testing is via
  direct code inspection, `curl`, small Node scripts, and (where useful) a
  headless Playwright browser against the local instance.
- Race-condition testing (Phase 9) is bounded by what a single local process can
  produce — it demonstrates whether a race *exists in the code path*, not
  production-scale concurrent load.
- Findings are classified by confidence (CONFIRMED / HIGH-CONFIDENCE / POTENTIAL /
  INFORMATIONAL / COULD NOT TEST) per Phase 14 rules — nothing is asserted as a
  vulnerability without code evidence or a reproducible test.

## 3. Architecture Overview

### 3.1 Stack
| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, React Router 6, TanStack Query 5, Axios, Recharts |
| Backend | Node.js (runtime tested: v24), Express 4.19 |
| Database | MongoDB via Mongoose 8 — MongoDB Atlas in production, `mongodb-memory-server` (embedded, standalone) in dev/test |
| Auth | JSON Web Tokens (`jsonwebtoken` 9), `bcryptjs` password hashing |
| File handling | `multer` (memory storage) + `exceljs` for spreadsheet import/export |
| PDF generation | `pdfkit` (programmatic drawing, not HTML-to-PDF) |
| Testing | `vitest` (backend: 318 tests at last run; frontend: 38) |

No ORM raw-SQL surface exists (Mongoose only, no `$where`/raw driver calls found in a
first pass — to be verified in Phase 8). No message queue, no cache layer (Redis etc.),
no external API integrations, no WebSocket layer found in the codebase.

### 3.2 Authentication mechanism
- `POST /api/auth/login` — email/password, returns a JWT (`jsonwebtoken`, HS256,
  symmetric `JWT_SECRET`, 12h default expiry via `JWT_EXPIRES_IN`).
- Token carried as `Authorization: Bearer <token>`, stored client-side in
  **`localStorage`** (not an httpOnly cookie) — see Section 6 impact note.
- `backend/src/middleware/auth.js` (`protect`): validates the Bearer header,
  verifies JWT signature/expiry, loads the user fresh from the DB on every request
  (`User.findById(decoded.id)`), rejects if the user is missing or `active: false`.
  Fails closed if `JWT_SECRET` is unset (500, not silent bypass).
- No refresh-token mechanism exists — a token is valid until natural expiry or until
  `active` is flipped false; there is no server-side revocation list.
- Password hashing: `bcrypt.hash(password, 10)` in a Mongoose `pre('save')` hook,
  only re-hashes when `password` is actually modified. Schema `minlength: 6`.

### 3.3 Authorization / RBAC architecture
- Three roles: `admin`, `sales`, `stock` (`backend/src/models/User.js`, `ROLES`).
- Enforcement point: `requireRole(...roles)` (`middleware/auth.js`), a plain
  `(req,res,next)` middleware checking `req.user.role` against an allowlist, applied
  per-route or per-router (`r.use(protect, requireRole('admin'))` style) — **never**
  in controllers only, and never left to the frontend. Confirmed by direct code read
  of every route file (Section 5.2) and by live testing (see Phase 3 note below —
  spot-tested last session, to be re-verified systematically in Phase 3).
- Additional **server-side field-level stripping** beyond route-level RBAC exists for
  two specific fields: `Product.purchasePrice` (cost) and `Product.comments`, stripped
  on both read and write for roles that shouldn't see them
  (`product.controller.js: withoutCost/stripCostInput`, `withoutComments/
  stripCommentsInput`) — this is a genuine defense-in-depth pattern, not merely
  UI-hidden.

### 3.4 Database / data-integrity architecture
- Mongoose 8 against MongoDB. In production this is Atlas (always a replica set →
  multi-document transactions available). In local/embedded dev it's a standalone
  instance (no transactions).
- `backend/src/utils/ledger.js` provides `transactionsSupported()` /
  `runAtomically()` — probes the deployment (`hello.setName`) once and either wraps
  work in a real `session.withTransaction()` or falls back to ordered writes plus an
  explicit compensating rollback (`reverseTransaction`). Confirmed **used** (not just
  defined) in: `invoice.controller.js`, `purchaseOrder.controller.js`,
  `expense.controller.js`, `services/paymentReversal.js`, `services/importers.js`.
  This is the mechanism Phase 8/9 will stress-test.
- Every payment ledger row (`FinancialTransaction`) is posted alongside an atomic
  `$inc` on the target `Account.currentBalance` — balances are never client-supplied,
  only ever derived from posted transactions (to be verified exhaustively in Phase 4).

### 3.5 Business modules present
Products/Inventory, Customers, Suppliers, Invoices (Sales), Quotations,
Purchase Orders, Payments, Accounts (Cash/Bank of Punjab/Soneri Bank — configurable,
not hardcoded), Expenses, Receivables, Payables, Deals, Reports, Import/Export
(spreadsheet), Activity log, Settings, Users, System Health.

## 4. Attack Surface Inventory

### 4.1 External surface
- REST API under `/api/*`, JSON + one multipart upload endpoint (spreadsheet import).
- Static frontend bundle served by the same Express process in local prod-mode
  testing (Vercel/Hostinger serve it separately in real deployment).
- No external third-party API calls found in `backend/src` (no outbound HTTP client
  usage beyond internal `callHandler` composition in `importExport.controller.js`,
  which invokes other in-process handlers, not external services).
- No WebSocket/SSE endpoints.

### 4.2 Route inventory (full detail — role gates as currently coded)

| Router | Base path | Public | Any authenticated | admin+sales | admin+stock | admin only |
|---|---|---|---|---|---|---|
| auth.routes.js | /api/auth | `POST /login` | `GET /me`, `POST /change-password` | — | — | — |
| product.routes.js | /api/products | — | `GET /`, `GET /barcode`, `GET /:id`, `GET /:id/ledger` | `POST /`, `PATCH /:id`, `POST /:id/adjust`, `POST /import` (sales+admin+**stock** for create/adjust) | (same set, stock included) | `DELETE /:id` |
| customer.routes.js | /api/customers | — | `GET /`, `GET /:id` | `GET /:id/ledger`, `GET /:id/statement/pdf`, `POST /`, `PATCH /:id` | — | — |
| supplier.routes.js | /api/suppliers | — | — | — | `GET /`, `GET /:id`, `POST /`, `PATCH /:id` | `GET /:id/ledger`, `GET /:id/statement/pdf` |
| invoice.routes.js | /api/invoices | — | `GET /`, `GET /:id`, `GET /:id/pdf` | `GET /:id/payments/:i/receipt`, `POST /`, `POST /:id/payments` | — | `POST /:id/payments/:id/reverse`, `PATCH /:id`, `POST /:id/return` |
| quotation.routes.js | /api/quotations | — | `GET /`, `GET /:id`, `GET /:id/pdf` | `POST /`, `POST /:id/convert` | — | — |
| purchaseOrder.routes.js | /api/purchase-orders | — | `GET /`, `GET /:id`, `GET /:id/pdf` | — | `POST /`, `PATCH /:id`, `POST /:id/receive` | `GET /:id/payments/:i/receipt`, `POST /:id/payments`, `POST /:id/payments/:id/reverse` |
| payment.routes.js | /api/payments | — | — | — | — | `GET /` |
| account.routes.js | /api/accounts | — | `GET /` | — | — | `GET /summary`, `GET /reconcile`, `GET /:id/ledger`, `GET /:id/statement/pdf`, `POST /`, `PATCH /:id` |
| expense.routes.js | /api/expenses | — | — | `GET /daily`, `GET /monthly`, `GET /categories`, `GET /`, `GET /:id`, `POST /`, `PATCH /:id` | — | `POST /:id/void` |
| finance.routes.js | /api/finance | — | — | `GET /receivables`, `GET /receivables/:id` | — | `GET /position`, `GET /payables`, `GET /payables/:id`, `POST /payables/:id/adjust` |
| deal.routes.js | /api/deals | — | — | — | — | all routes (`admin` only) |
| importExport.routes.js | /api/data | — | — | `GET /types`, `GET /templates/:t`, `GET /export/:t`, `POST /import/:t/parse\|validate\|commit`, `POST /import/:t/errors-file` | — | `GET /history`, `GET /history/:id` |
| report.routes.js | /api/reports | — | `GET /dashboard`, `GET /daily-sales`, `GET /sales-by-product`, `GET /sales-by-customer`, `GET /receivables` | — | `GET /payables`, `GET /stock-valuation` | `GET /profit-loss`, `GET /monthly-summary`, `GET /series`, `GET /inventory-reconcile` |
| settings.routes.js | /api/settings | — | `GET /` | — | — | `PATCH /` |
| user.routes.js | /api/users | — | — | — | — | all routes (`admin` only) |
| activity.routes.js | /api/activity | — | — | — | — | `GET /` (`admin` only) |
| admin.routes.js | /api/admin | — | — | — | — | `GET /system-health` (`admin` only) |

*(Sub-resource nuance: `product.routes.js` create/update/adjust use
`requireRole('admin','stock','sales')` — sales CAN create/edit product catalogue
entries but not delete them; confirmed against source, live-tested last session for
the sales role specifically, admin/stock/sales matrix to be completed systematically
in Phase 3.)*

### 4.3 Security-sensitive operation inventory (money/inventory/identity movers)
Explicitly flagged for Phase 4/8/9 focus:
- `POST /invoices` , `POST /invoices/:id/payments`, `POST /invoices/:id/payments/:id/reverse`, `POST /invoices/:id/return`
- `POST /purchase-orders`, `POST /purchase-orders/:id/receive`, `POST /purchase-orders/:id/payments(+reverse)`
- `POST /expenses`, `PATCH /expenses/:id`, `POST /expenses/:id/void`
- `POST /accounts`, `PATCH /accounts/:id`, `GET /accounts/reconcile`
- `POST /finance/payables/:id/adjust`
- `POST /products/:id/adjust` (stock), `PATCH /products/:id` (incl. cost price)
- `POST /data/import/:type/commit` (bulk write path — products, customers, suppliers,
  invoices, purchase-orders, expenses, opening-balances)
- `POST /users`, `PATCH /users/:id` (role/active/password), `DELETE /users/:id`
- `POST /auth/login`, `POST /auth/change-password`

### 4.4 File upload / import surface
- Single endpoint family under `POST /data/import/:type/{parse,validate,commit}`.
- `multer.memoryStorage()` — nothing written to disk, 10 MB cap, extension +
  MIME allowlist (`.xlsx`/`.xlsm`), enforced in `importExport.routes.js`.
- Parsing via `exceljs` (`backend/src/utils/excel.js`) — no macro execution, no
  formula evaluation (`readSheet`/`readSheetRaw` only read `cell.value`'s cached
  result, never execute).
- Known-good architecture already verified this engagement: the parse step is
  intentionally permissive (accepts any column layout), the `validate`/`commit`
  steps run the real per-type `prepare()`/`commit()` business rules — this is
  correct-by-design per the ERP's own edit-before-import workflow and is **not**
  to be treated as a finding by itself (per assessment brief). Phase 5 will instead
  probe whether *finalization* (validate/commit) can be abused.

## 5. Role × Permission reference

Three roles only: `admin` (full access), `sales` (catalogue, sales-side documents,
receivables view, imports for sales-relevant types, no cost visibility on products
by default — see 3.3), `stock` (inventory/purchasing side, no sales financials). No
customer-facing/external role exists — this is an internal staff ERP, not a
multi-tenant SaaS, so classic cross-tenant IDOR does not apply as a threat class;
the live privilege boundary is role, not resource ownership. Phase 3 will still
test object-ID manipulation (e.g. an invoice/customer ID for an entity the role
can otherwise never see) since nothing in the schema currently scopes documents
by "created by" or "owning branch."

## 6. Notable architecture-level risk amplifiers (not findings by themselves)

- JWT is stored in `localStorage`, not an httpOnly cookie. This means CSRF is
  largely not applicable (the browser never auto-sends the token), but it also
  means **any XSS anywhere becomes a full session/account-takeover vector** — raises
  the severity ceiling of any XSS finding in Phase 7.
- No `helmet` (or equivalent) — no `X-Content-Type-Options`, `X-Frame-Options`/
  frame-ancestors, HSTS, etc. currently set. To be scored in Phase 10.
- No rate-limiting middleware (`express-rate-limit` or similar) anywhere in
  `app.js` — flagged already last session (login brute-force, unthrottled) and to
  be re-confirmed formally in Phase 2.
- `express`'s default query parser (`qs`) parses bracket notation
  (`?field[$ne]=x`) into nested objects. Combined with any `filter.field =
  req.query.field` pattern (found in ≥5 list controllers), this is a live NoSQL
  operator-injection primitive — already empirically confirmed on `GET /products`
  last session against an isolated instance. To be formally re-validated and
  extended to the other affected endpoints in Phase 7.
- `npm audit` (production deps only): backend — 7 moderate (all in `qs`/`uuid`
  transitive deps of `express`/`exceljs`); frontend — 2 high (`form-data` CRLF
  injection, transitive via `axios`), 3 moderate. Full analysis in Phase 11.
- Morgan HTTP request logging is dev-only (`if (NODE_ENV !== 'production')`) — in
  production there is no HTTP access log, only the application-level `Activity`
  model logging (`logActivity()` calls scattered through controllers). Whether
  that business-event log is sufficient audit trail is a Phase 13 question.

## 7. Testing environment available

- Local machine, this repository, full read access to source.
- Can spin up a fully isolated backend + `mongodb-memory-server` instance on
  non-default ports, seeded only with the repo's own public demo accounts
  (`admin@almtech.org` / `sales@almtech.org`, published passwords, dev-only).
- Can spin up the Vite frontend dev server against that isolated backend.
- Confirmed working last session: `curl`, small Node scripts (`fetch`, `jsonwebtoken`,
  `bcryptjs` available in `node_modules`), and a headless Chromium via Playwright
  (downloaded to `/tmp`, not part of the repo) for real browser-driven UI testing.
- No access to production, no access to real customer/financial data, no access to
  Hostinger or MongoDB Atlas consoles.

## 8. Tools available

- `curl`, `node` (v24, native `fetch`), `git`, `npm`/`npm audit`.
- Repo's own test suites (`vitest`) as a regression baseline.
- Playwright (installable via `npx`, not pre-installed) for real-browser
  interaction testing when needed.
- No Burp Suite / OWASP ZAP / Nuclei / Nessus / sqlmap / nmap in this environment —
  testing that would normally use those tools is done via equivalent hand-built
  `curl`/Node scripts against the isolated instance instead.

## 9. Testing limitations (restated precisely)

- Cannot test infrastructure/network-layer security (TLS config, hosting firewall,
  Hostinger platform hardening) — no access.
- Cannot test at production scale/data volume.
- Cannot test anything requiring a second real organization/tenant (none exists —
  single-org ERP).
- Race-condition tests are limited to what concurrent requests from one local
  process against `mongodb-memory-server` can demonstrate; production Atlas
  concurrency characteristics may differ (better, since it's a real replica set
  with real transactions, vs. this repo's own dev fallback path).

## 10. Proposed security test plan (execution order)

1. **Phase 2 — Authentication.** Formal re-run + extension of last session's
   findings (timing side-channel, brute force, JWT forgery attempts, algorithm
   confusion, password-change session handling, default/demo credentials
   exposure check for production configs).
2. **Phase 3 — Authorization/RBAC.** Systematic matrix execution: every endpoint
   in Section 4.2 × every role × unauthenticated, recording actual vs. expected.
   Priority: money-moving and user-management endpoints first.
3. **Phase 4 — Business logic.** Price/quantity/payment/account manipulation
   attempts per the brief's exact scenario list, against the isolated instance.
4. **Phase 5 — Import finalization abuse.** CSV/formula-injection payloads,
   malformed numeric/duplicate-column inputs, submitted at `validate`/`commit`
   (never faulting the intentionally-permissive parse stage).
5. **Phase 6/7 — API & common web vulns.** NoSQL injection full sweep (extend
   confirmed `products` finding to all affected controllers), XSS/CSRF/SSRF/path
   traversal/CORS/header checks, mass-assignment sweep across every
   create/update controller (not just the ones already reviewed).
6. **Phase 8/9 — Data integrity & concurrency.** Concurrent-request tests against
   stock adjustment, payment posting, and import commit to probe the
   `runAtomically()` fallback path specifically (the no-transaction case is the
   one with real compensating-rollback logic to break).
7. **Phase 10/11/12/13 — Configuration, dependencies, secrets, logging.** Static
   review, `npm audit` detail, git-history secret scan, audit-trail completeness
   review.
8. Compile findings into this document (Sections 14–19 add-on), plus the
   executive report and remediation plan. **No remediation until explicitly
   authorized.**

## 11. Immediate concerns visible from Phase 1 alone (not yet formally scored)

These are carried over from architecture inspection and last session's spot
checks — they will get full Finding IDs, CVSS, and reproduction steps once
Phase 2–7 formally execute, but are flagged now per instruction 15 ("never mark
something secure merely because it wasn't looked at yet") and to set
expectations before deeper testing begins:

- **NoSQL operator injection** via unsanitized `req.query` values reaching
  Mongoose filters (bracket-notation `$ne`/`$regex`/etc.) — confirmed live on
  `GET /products?category[$ne]=...`; same code shape present in at least 4 other
  list controllers, not yet individually re-verified this phase.
- **No brute-force protection** on `POST /auth/login`.
- **Login timing side-channel** enabling email enumeration (bcrypt only runs for
  existing users).
- **Unhandled 500 on malformed search input** (`new RegExp(userInput)` with no
  try/catch) in ≥5 controllers — also the underlying ReDoS-shaped code pattern
  (input reaches a regex engine unescaped), not yet weaponized to a full hang.
- **No security headers** (`helmet` or equivalent absent).
- **Dependency advisories** open in both `backend` and `frontend` production
  dependency trees (moderate/high, transitive) — patch path not yet assessed for
  breaking changes.

None of the above are being treated as remediation-authorized. They are the
starting worklist for Phase 2 onward.

---

## 12. Phase 2 — Authentication Assessment

**Test environment:** Isolated instance, fresh `mongodb-memory-server` (port 27317),
backend on port 5070, `NODE_ENV=development` (stack traces intentionally visible to
the tester only, per the already-confirmed production gate in `error.js` — see
Phase 1 §11), throwaway `JWT_SECRET` unique to this test run, demo-seeded accounts
only. Torn down completely after testing; repository left untouched
(`git status` clean except this report directory).

**Method:** Direct `curl`/Node-script requests against every item in the Phase 2
checklist, evidence captured to `/tmp/alm-sec-test/evidence/` (ephemeral, not part of
the repo — sanitized excerpts reproduced below). Where a raw secret/token appears in
evidence it is truncated; no full token, hash, or password is reproduced.

### 12.1 Findings

---
**ALM-SEC-001 — Login response-time side-channel enables user enumeration**
**Severity:** LOW–MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-208**
**Component:** `backend/src/controllers/auth.controller.js:18-24` (`login`)
**Affected endpoint:** `POST /api/auth/login`
**Affected role(s):** N/A (pre-authentication, exploitable by anyone)

*Technical cause:* `if (!user || !user.active || !(await user.comparePassword(password)))` short-circuits
before `bcrypt.compare()` runs when no matching user exists. bcrypt is deliberately
slow (~80-100ms at cost 10); the short-circuit path returns in ~1-4ms.

*Reproduction:* 20 timed requests per case.
```
existing-user (wrong password)   avg 94.5ms   median 80.0ms
nonexistent-user                 avg  4.0ms   median  0.0ms
ratio: 23.6x
```
Both cases return the byte-identical `{"message":"Invalid email or password"}` body —
the enumeration channel is timing only, not message content.

*Expected behavior:* response time should not depend on whether the email exists.
*Actual behavior:* ~20x+ measurable difference, reliable over as few as 5-10 samples.
*Security impact:* an attacker can build a list of valid staff email addresses,
narrowing subsequent credential-stuffing/brute-force/phishing targeting.
*ERP impact:* Low direct impact (doesn't itself grant access), but is a force-multiplier
for ALM-SEC-002 below.
*Recommended remediation:* always perform a constant-time-equivalent bcrypt comparison
regardless of whether the user exists (e.g. compare against a fixed dummy hash when no
user is found), or add a fixed minimum response-time floor for the whole login path.
*Regression risk:* very low — purely additive timing normalization.
*Retest procedure:* repeat the timed-sample test above; ratio should approach 1.0x.
*Status:* OPEN — remediation not authorized yet.

---
**ALM-SEC-002 — No brute-force / credential-stuffing protection on login**
**Severity:** MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-307**
**Component:** `backend/src/app.js` (no rate-limit middleware registered anywhere);
`backend/src/routes/auth.routes.js` (`POST /login` has no per-route throttle)
**Affected endpoint:** `POST /api/auth/login`
**Affected role(s):** N/A (pre-authentication)

*Reproduction:* 30 login attempts against `admin@almtech.org` fired in ~3 seconds
(~10 req/s from one client, no parallelization needed) — all returned `401` with no
increasing delay, no `429`, no lockout. A correct-password login immediately
afterward succeeded normally (`200`), proving no account lockout was triggered either.
*Expected behavior:* progressive delay, temporary lockout, CAPTCHA, or IP/account-based
throttling after a small number of failures.
*Actual behavior:* unlimited-rate guessing is possible.
*Security impact:* combined with ALM-SEC-001's enumeration and ALM-SEC-004's weak
password policy (below), an attacker who has enumerated valid emails can run a
credential-stuffing or dictionary attack against them with no friction.
*ERP impact:* a successful guess against an `admin` account is a full compromise of
financial and inventory data for the business.
*Recommended remediation:* add `express-rate-limit` (or equivalent) scoped to
`POST /auth/login`, keyed by IP + email, with escalating backoff; consider optional
account lockout after N consecutive failures with admin-visible unlock.
*Regression risk:* Low if limits are generous enough for legitimate mistyped-password
retries (recommend ~5-10 attempts per 15 min per IP+email as a starting point, tuned
with the business).
*Retest procedure:* repeat the 30-attempt burst; expect a `429` or increasing latency
well before attempt 30.
*Status:* OPEN.

---
**ALM-SEC-003 — No server-side session/token revocation (logout and password-change do not invalidate outstanding tokens)**
**Severity:** MEDIUM–HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-613**
**Component:** `backend/src/middleware/auth.js` (`protect` — no token-version/
`passwordChangedAt` check); `backend/src/controllers/auth.controller.js`
(`changePassword`); no logout route exists at all (confirmed via route grep)
**Affected endpoint(s):** `POST /api/auth/change-password`; the *absence* of any
`POST /api/auth/logout`
**Affected role(s):** all — this is architectural, applies to every authenticated user

*Technical cause:* JWTs are purely stateless — `protect` verifies the signature and
re-fetches the user (correctly checking `active`, see PASS item in §12.2), but nothing
ties a token to "the state of the account at the moment the token was issued." There is
no `tokenVersion`/`passwordChangedAt` claim comparison, and no server-side revocation
list of any kind.

*Reproduction (password-change scenario):* created a throwaway user, logged in twice
(Token A, Token B — simulating two devices, or a legitimate session plus a token an
attacker separately obtained). Used Token A to call
`POST /auth/change-password` (success, `200`). Immediately retested Token B:
```
Token B -> GET /auth/me       AFTER password change: 200 (still authenticated)
Token B -> GET /products      AFTER password change: 200 (can still perform work)
```
*Reproduction (logout scenario):* no server route for logout exists — the frontend
only removes the token from `localStorage` (`AuthContext.jsx`). A token that has
already left the browser (copied, intercepted, or synced elsewhere) is entirely
unaffected by a user clicking "Log out."

*Expected behavior:* changing a password is the standard user response to a suspected
compromise — it should invalidate every other outstanding session for that account.
*Actual behavior:* every other token for that user keeps working, silently, until its
12-hour expiry.
*Security impact:* a stolen/leaked token survives the account owner's own remediation
attempt.
*ERP impact:* if an admin or sales token is exfiltrated (e.g. via a phishing page, a
shared/compromised machine, or a future XSS finding), changing the password — the
action a security-conscious user takes first — does **not** close that window; the
attacker keeps working access to financial/inventory operations for up to 12h.
*Recommended remediation:* add a `passwordChangedAt` (or incrementing `tokenVersion`)
field to `User`, stamp it on password change (and ideally on admin-forced
deactivation/reactivation), and have `protect` reject any token whose `iat` predates
it. A real logout endpoint is lower-value under pure JWT (nothing to revoke without a
server-side store) but the password-change gap should be closed regardless.
*Regression risk:* Low-Medium — every existing session becomes invalid the moment its
owner's password changes, which is a (desirable) behavior change; needs a test that
existing session survive routine actions that AREN'T password changes.
*Retest procedure:* repeat the two-token password-change reproduction; Token B should
return `401` immediately after the change.
*Status:* **FIXED — remediated and retested. See §18.9 for the complete
remediation record.**

---
**ALM-SEC-004 — No password strength/complexity requirement beyond a 6-character minimum**
**Severity:** LOW–MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-521**
**Component:** `backend/src/models/User.js` (`password: { minlength: 6 }` — the only
constraint at any layer)
**Affected endpoint:** `POST /api/users` (admin-created accounts),
`POST /api/auth/change-password` (self-service)
**Affected role(s):** admin (when creating accounts for others); any user setting
their own password

*Reproduction:*
```
"12345"    (5 chars)  -> 400 rejected (minlength enforced)
"aaaaaa"   (6 chars)  -> 201 created — accepted
"password" (8 chars)  -> 201 created — accepted
```
No complexity (mixed case/digits/symbols), no common-password/dictionary check,
anywhere in the request path.
*Security impact:* combined with ALM-SEC-002 (no throttling), trivially-guessable
passwords are a realistic attack path, not just a theoretical one.
*Recommended remediation:* raise the minimum (e.g. 10+, matching the standard already
used for the bootstrap-admin script elsewhere in this codebase), and/or integrate a
strength estimator (zxcvbn or similar) with a minimum score, rejected server-side (not
just suggested client-side).
*Regression risk:* Low for new passwords; existing stored password hashes are
unaffected (this only gates future password-set operations), but will break any
external documentation/training that references the old minimum.
*Retest procedure:* repeat the three creation attempts above against the new rule.
*Status:* OPEN.

---
**ALM-SEC-005 — No safeguard against deploying with the documented example `JWT_SECRET`**
**Severity:** INFORMATIONAL (code gap) — **would be CRITICAL if the example value is
ever actually used unchanged in a real deployment** &nbsp;|&nbsp; **Confidence:**
CONFIRMED (as a missing safeguard; NOT tested/claimed against any real deployment)
**CWE-798 / CWE-1188**
**Component:** `backend/src/server.js:13` (startup check only verifies `JWT_SECRET` is
*present*, never that it's non-default or sufficiently random);
`backend/.env.example` (ships `JWT_SECRET=replace-with-a-long-random-string`, a
predictable, publicly-visible-in-the-repo value)

*Reproduction:* code inspection only — I did **not** test this against production and
have no knowledge of, or access to, the actual production `JWT_SECRET`. The finding is
that the codebase contains no guard that would prevent it from starting successfully
in production with that exact example string as its secret, if an operator forgot to
rotate it during setup.
*Why it matters if it ever happens:* `JWT_SECRET` is symmetric (HS256) — anyone who
knows it can forge a validly-signed token for any user ID (including an admin's),
achieving full authentication bypass with zero credentials. Because the placeholder
text is committed to the repo itself, it is not "secret" in any sense once published.
*Recommended remediation:* have `server.js` refuse to start in production if
`JWT_SECRET` (a) matches the literal example-file value, or (b) is below a minimum
length/entropy threshold (e.g. reject anything under 32 bytes of usable entropy).
*Regression risk:* none for correctly-configured deployments; would correctly break a
misconfigured one (which is the point).
*Retest procedure:* attempt to start the app with `NODE_ENV=production` and
`JWT_SECRET=replace-with-a-long-random-string`; expect a fail-fast startup error, not
a running server.
*Status:* OPEN.
*Action item for you (outside this assessment's ability to verify):* please confirm
independently that your actual Hostinger/production `JWT_SECRET` is a long, randomly
generated value and is **not** the `.env.example` placeholder. I have not seen, and am
not requesting, your production secret.

---
**ALM-SEC-006 — Unhandled crash (HTTP 500) on non-string login fields**
**Severity:** LOW / INFORMATIONAL &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-20**
**Component:** `backend/src/controllers/auth.controller.js:20`
(`email?.toLowerCase()` assumes `email` is a string)
**Affected endpoint:** `POST /api/auth/login`

*Reproduction:* `{"email":{"$gt":""},"password":{"$gt":""}}` →
`TypeError: email?.toLowerCase is not a function` → `500`. Confirmed **not** an
injection path — the request never reaches a database query; it crashes before that
point. In production this 500 returns only the generic
`"Something went wrong..."` message (stack trace suppressed, per the
already-verified Phase 1 gate) — so this is a robustness/input-validation gap, not an
information-disclosure or auth-bypass issue.
*Recommended remediation:* validate `req.body.email`/`password` are strings (400) before
using them, consistent with how the rest of the codebase treats malformed input.
*Regression risk:* none.
*Retest procedure:* repeat the object-payload request; expect `400`, not `500`.
*Status:* OPEN.

### 12.2 Tested and PASSED (recorded per instruction — not silently assumed secure)

| Area | Result |
|---|---|
| Unauthenticated access to protected routes | Blocked (`401`) everywhere tested |
| Login error-message enumeration | Identical message for both existing/nonexistent users (only the *timing* channel above leaks) |
| SQL-injection-style payload in login fields | Treated as a literal string, no match, no bypass |
| NoSQL-object-injection payload in login fields | Crashes safely (500, see ALM-SEC-006) — does **not** reach the DB query, not exploitable for auth bypass |
| JWT tampering (modified payload) | Signature check fails, `401` |
| JWT `alg:none` | Rejected, `401` |
| JWT signed with a different secret | Rejected, `401` |
| JWT algorithm confusion (RS256↔HS256) | Not applicable — no asymmetric keys used anywhere in the system |
| Expired JWT | Rejected with a clear, non-leaky message, `401` |
| Validly-signed JWT for a nonexistent user ID | Rejected — server re-fetches the user rather than trusting claims, `401` |
| **Stale token after admin deactivation** | **Invalidated immediately** — `protect` re-checks `active` on every request. Deactivated a live test user and confirmed their outstanding token stopped working on the very next request. This is a genuine strength, not trivial to get right with stateless JWT. |
| Password storage | Real bcrypt confirmed against the stored hash (`$2a$10$...`, 60 chars) — not plaintext, not a weak/legacy algorithm |
| Passwords in logs | `logActivity()` calls for login/user-create/password-change never include the password value |
| Hardcoded/committed credentials | None found (repeated from Phase 1's git-history scan, re-confirmed) |
| Default/demo credentials in production | Demo seeding is opt-in only in production (`ENABLE_DEMO_SEED=true` required; off by default when `NODE_ENV=production`) |
| Session fixation | Not applicable — stateless Bearer JWT with no pre-authentication session identifier to fixate |
| Refresh-token vulnerabilities | Not applicable — no refresh-token mechanism exists in this codebase |
| Password-reset flow vulnerabilities | Not applicable — no self-service "forgot password" flow exists; only authenticated self-service change or admin-driven reset |

### 12.3 Could not be tested in this phase

- Real production timing behavior (network latency masks/amplifies the bcrypt timing
  gap differently than localhost — the *existence* of the side-channel is proven, its
  practical exploitability over the public internet was not measured).
- Anything requiring the actual production `JWT_SECRET` (rightly out of reach).
- Distributed/multi-instance rate-limit bypass scenarios (N/A here — there's currently
  no rate limiting to bypass).

---

## 13. Phase 3 — Authorization / RBAC Assessment

**Test environment:** Fresh isolated instance (`mongodb-memory-server` port 27417,
backend port 5080), demo-seeded `admin`/`sales`/`stock` accounts, torn down
completely after testing. Repository untouched (`git status` clean except this
report directory).

**Method:** Two layers of testing.

1. **Full automated matrix** — a Node script (evidence:
   `/tmp/alm-sec-test/evidence/rbac-matrix-full.json`, ephemeral, not part of the
   repo) enumerated **every route actually registered in `app.js`** (17 routers, 89
   distinct method+path combinations — not a sample) and fired each one as
   unauthenticated, `admin`, `sales`, and `stock`, against real seeded IDs where a
   route takes one. Expected outcome for each cell was taken from the router
   source itself (the same matrix published in Phase 1 §4.2), not assumed. A
   request was classified `ALLOW` if it reached the controller (any non-401/403
   status — including business-logic 400/404/409 — proves the *authorization* gate
   let it through) and `DENY` if it got `401`/`403`.
2. **Targeted deep-dives** for the specific abuse classes the brief called out that
   a route-level matrix alone can't catch: mass assignment, property-level
   authorization (can a role smuggle a field it's not supposed to control?),
   object-ID manipulation, and a hidden-endpoint sweep.

### 13.1 Full matrix result

**356 checks (89 endpoints × 4 auth states). 0 mismatches.**

Every endpoint's actual live behavior matched its documented role gate exactly —
unauthenticated requests were denied everywhere, and every role boundary
(admin-only, admin+sales, admin+stock, admin+stock+sales, any-authenticated) held
for every single route tested, including all of:
- financial operations (accounts, payments, payables/receivables, expense void,
  payment/PO-payment reversal)
- inventory operations (product create/update/delete/adjust)
- user/role management (`/users/*` — admin-only, confirmed for all 4 verbs)
- reporting (profit-loss, monthly-summary, series, inventory-reconcile — all
  correctly admin-only; stock-valuation/payables correctly admin+stock)
- import/export (history admin-only; parse/validate/commit/export correctly
  admin+sales, not stock)

This directly tests "direct API access bypassing UI restrictions" — none of these
requests went through the frontend at all, so any pass here is a server-side
enforcement guarantee, not a UI-hiding illusion.

*(Full 356-row matrix available on request — omitted here for length; every row is
in the ephemeral evidence file referenced above and can be regenerated at any time
from the test script, which itself derives its expectations from the shipped route
files, not from this report.)*

### 13.2 Findings from targeted deep-dive testing

---
**ALM-SEC-007 — Mass assignment on product creation: client-controlled `_id` and `createdAt`**
**Severity:** LOW–MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-915**
**Component:** `backend/src/controllers/product.controller.js:127-128`
(`createProduct`: `const payload = stripCommentsInput(req, stripCostInput(req, {
...req.body }));` then `Product.create(payload)`)
**Affected endpoint:** `POST /api/products` only — confirmed **not** present on
`PATCH /api/products/:id` (see negative test below), and confirmed **not** present
in any other entity's create controller (Customer explicitly allowlists via
`pickWritableCustomerFields`; this is the one spot in the codebase using the
`{...req.body}` spread pattern instead).
**Affected role(s):** admin, stock, **and sales** — all three can create products

*Reproduction:*
```
POST /products  (as sales)  body: {..., "_id":"000000000000000000000042", "__v":99, "createdAt":"2000-01-01"}
-> 201, and the stored document's _id and createdAt were exactly the attacker-supplied values,
   not server-generated ones.
```
Cost price (`purchasePrice`) smuggling was correctly blocked in the same request —
`stripCostInput` does its one job correctly; the gap is that everything *outside*
that specific strip-list still passes straight to `.create()` unfiltered.

*Negative test (proves scope is CREATE-only):* the identical `createdAt` smuggling
attempt via `PATCH /products/:id` had no effect — the stored `createdAt` was
unchanged. Mongoose's `timestamps` option protects `updatedAt`/`createdAt` on
`findByIdAndUpdate`, just not on `.create()` when the caller supplies the field
explicitly.

*Security impact:* `_id` collision with an attacker-chosen value can't overwrite an
existing document (unique index rejects it), so this is not a takeover primitive by
itself. The concrete, realistic impact is **`createdAt` falsification** — any
sales-role user can backdate (or postdate) a product's creation timestamp, which
feeds into reporting/audit surfaces (e.g. any "created in period X" view) and
undermines "when did this actually enter the system" as a trustworthy fact for
inventory-integrity investigations.
*ERP/business impact:* Low-Medium — doesn't move money or bypass a role boundary,
but weakens audit-trail integrity for inventory records, which the assessment
brief specifically flags as a CRITICAL concern category.
*Recommended remediation:* switch `createProduct` to an explicit field allowlist
(mirroring `pickWritableCustomerFields`'s pattern) instead of spreading
`req.body`, so only intentionally-writable business fields ever reach `.create()`.
*Regression risk:* Low — needs the allowlist to include every field the product
form/import path legitimately sets (specification fields, barcode, active, etc.);
a missed field would silently stop being settable on creation, so this needs a
full field-by-field diff against the current schema before implementing, not just
a quick patch.
*Retest procedure:* repeat the `_id`/`createdAt` smuggling request; expect the
response to show a server-generated `_id` and a `createdAt` within the same
second as the request, regardless of what the client sent.
*Status:* OPEN.

---

### 13.3 Tested and PASSED (recorded per instruction — not silently assumed secure)

| Area | Result |
|---|---|
| Full 89-endpoint role matrix (356 checks) | 0 mismatches — every route's live behavior matches its source-declared gate |
| Unauthenticated access to every endpoint | Denied (`401`) everywhere, no exceptions found |
| Vertical escalation: sales → admin-only endpoints | Denied (`403`) for all — users, accounts (admin-only subset), deals, activity, admin/system-health, profit-loss, payment reversal, expense void, PO payment, payables |
| Vertical escalation: stock → admin/sales-only endpoints | Denied (`403`) for all — invoices, quotations, customers-write, finance/receivables |
| Cost-price mass assignment (sales smuggling `purchasePrice` into product create) | Correctly stripped — stored value stayed at schema default (0), not the attacker's value |
| Customer `balance`/`creditLimit` direct-write attempt | Correctly ignored — `Customer.create()` uses an explicit field allowlist, response confirms `balance` stayed at the schema default regardless of what was sent |
| Mass assignment via `PATCH` (createdAt backdating) | **Not** exploitable on update — Mongoose's timestamps handling protects `createdAt` specifically on `findByIdAndUpdate`, unlike on `.create()` (see ALM-SEC-007's scope note) |
| Information leak via status-code difference (role-denied vs. object-not-found) | None found — a denied role gets `403` for both a real and a nonexistent target ID; the authorization check runs before any database lookup, so no ID-existence oracle exists for a role that shouldn't be there in the first place |
| Hidden/undocumented endpoints | None found — `app.js` mounts exactly the 17 routers already inventoried in Phase 1 §4.2, no additional/debug/backdoor routes registered |
| State-changing operations via GET (CSRF-adjacent hygiene) | None found — every state-changing operation in the entire route inventory is POST/PATCH/DELETE, never GET |
| IDOR/BOLA (cross-record access within an allowed role) | Tested and found **architecturally not applicable**: this is a single-organization internal ERP with no per-record ownership/tenant field anywhere in the schema (confirmed in Phase 1 model inventory) — every record a role's route-level permission allows it to reach is, by design, shared organizational data, not another party's private resource. This is a legitimate design choice for this application's threat model, not an unexamined gap; it was verified by inspecting every model for an owner/tenant-scoping field and finding none, consistent with an internal single-tenant system. |

### 13.4 Could not be tested in this phase

- Multi-branch/multi-location scoping — not applicable, this build of ALM Suite has
  no such concept in its schema.
- Any RBAC behavior specific to a fourth role or a custom/future permission tier —
  only `admin`/`sales`/`stock` exist in the current `ROLES` constant, all three
  were exhaustively tested.

---

## 14. Phase 4 — ERP Business Logic Assessment

**Test environment:** Fresh isolated instance (`mongodb-memory-server` port 27517,
backend port 5090), disposable seeded/created test data only (a throwaway customer,
supplier, and several invoices/payments created and manipulated during testing —
all in the ephemeral database, destroyed with the instance). Repository untouched.

**Method:** For every scenario, the actual resulting database state (product stock,
account `currentBalance`, invoice `paid`/`balance`/`status`, stock-movement audit
records) was checked via authenticated `GET` calls after each mutation — not just the
HTTP status of the mutating request. Where a controller's source was read first, that
is noted, per the instruction not to assume schema validation alone makes a workflow
safe.

### 14.1 Findings

---
**ALM-SEC-008 — Invoice line pricing is entirely client-controlled, with no validation against the product catalogue**
**Severity:** HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-639 (Authorization Bypass Through User-Controlled Key) / CWE-20**
**Component:** `backend/src/controllers/invoice.controller.js` —
`buildLineFromProduct()` (line ~202) takes `unitPrice` and `discount` directly from
the request item (`...it`), and `createInvoice` (line ~252) passes the raw request
item straight into it: `lines.push(await buildLineFromProduct({ ...it, quantity,
serials, product }))`. `computeItemTotals`/`applyTax`
(`backend/src/utils/totals.js`) then derive the invoice's `subtotal`/`total` purely
from whatever `unitPrice`/`discount` values arrived in the request — the product's
own `sellingPrice` field is never read or compared at any point in this path.
**Affected endpoint:** `POST /api/invoices`
**Affected role(s):** admin, **sales** (the role that actually staffs the counter/POS
day-to-day)

*Reproduction 1 (price substitution):*
```
Product catalogue sellingPrice: 249
POST /invoices (as sales)  { customer, items: [{ product, quantity: 1, unitPrice: 1 }] }
-> 201 Created. Stored invoice: unitPrice=1, lineTotal=1, subtotal=1, total=1, balance=1.
   unitCost correctly still pulled from the catalogue (180) — only the SELLING side is
   forgeable.
   Product stock was correctly decremented by 1 — inventory tracking is unaffected,
   only the money side is wrong.
```
*Reproduction 2 (discount abuse — same root cause, different field):*
```
POST /invoices (as sales)  { ..., items: [{ product, quantity: 1, unitPrice: 249, discount: 999999 }] }
-> 201 Created. lineTotal clamped to 0 (Math.max(0, ...) floor — cannot go negative),
   subtotal=0, total=0. A full-price catalogue item given away for free, in one request,
   with no approval step.
```
*Expected behavior:* either the server derives `unitPrice` from `Product.sellingPrice`
authoritatively (client supplies only quantity/serials), or — if manual/negotiated
pricing is a genuine business requirement — a deviation beyond a configured
percentage/amount should require elevated privilege (e.g. admin-only override) or
produce a flagged/pending-approval invoice rather than an immediately valid one.
*Actual behavior:* any value a sales-role client sends is trusted completely, for
both unit price and discount, with only sign/type bounds (`min: 0` at the schema
level) — no ceiling, no catalogue comparison, no approval workflow.
*Security impact:* full unit-price impersonation by the client; the server's only
defense is that the number can't be negative.
*ERP/business impact:* **direct, repeatable revenue leakage.** A sales employee
(maliciously, in error, or in collusion with a customer) can under-invoice any sale to
an arbitrary degree, including selling stock at PKR 1 or free. Because `unitCost`
IS correctly pulled from the catalogue, the resulting negative margin is
mathematically visible in any report that computes it — but nothing in the create
path itself blocks, flags, or requires approval for it before the fact; detection is
entirely retrospective (a manager would have to notice it in a margin/profit report
after the sale already happened and stock already left the building).
*Recommended remediation:* make `Product.sellingPrice` the source of truth for
`unitPrice` on invoice-line creation (looking it up server-side, the same way
`unitCost` already correctly does from `purchasePrice`); if manual pricing must stay
possible, gate any price/discount below a configured floor behind `requireRole('admin')`
or a distinct "manager override" flag that is itself logged distinctly in the activity
trail. Apply the same reasoning to quotations (`quotation.routes.js` shares this
pattern via `convertToInvoice` — not independently re-tested this phase, flagged for
Phase-4-followup / retest).
*Regression risk:* Medium — any legitimate business practice of negotiated/discounted
pricing needs an explicit replacement mechanism before this is locked down, or normal
sales operations break. This needs a product-owner decision (what IS the intended
discount policy?), not just a code patch.
*Retest procedure:* repeat reproduction 1 and 2; expect either a rejection, a
clamped/corrected price, or a distinctly-flagged pending-approval state — not a
silently-accepted PKR 1 sale.
*Status:* **FIXED — remediated and retested. See §18.9 for the complete
remediation record.**

---
**ALM-SEC-009 — Duplicate-payment protection is opt-in server-side and never invoked by the actual frontend**
**Severity:** MEDIUM–HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-694 (Use of Multiple Resources with Duplicate Identifier) / business-logic**
**Component:** `backend/src/controllers/invoice.controller.js` (`recordPayment` /
`applyInvoicePayment`) — deduplication exists ONLY via an optional
`idempotencyKey` on the `FinancialTransaction` unique index
(`backend/src/utils/ledger.js`, `rethrowDuplicatePosting`). Confirmed via
`grep -rn "idempotencyKey" frontend/src/` returning **zero matches** — the real
application never generates or sends this key on any payment submission.
**Affected endpoint:** `POST /api/invoices/:id/payments` (and, by the identical
shared pattern, `POST /api/purchase-orders/:id/payments` — code-verified, not
independently live-retested this phase)
**Affected role(s):** admin, sales (anyone who can record a payment)

*Reproduction:*
```
Invoice balance: 498
Payment A (no idempotencyKey): amount 100 -> paid 300 (a prior payment had already brought it to 200)
Payment B (identical request, no idempotencyKey, fired immediately after): amount 100 -> paid 400
Result: TWO separate payment lines recorded for what a real double-click or network
retry would represent as one physical payment. Cash account credited twice.
```
Contrast with the SAME test using an explicit reused `idempotencyKey` (see Phase 4
evidence): the second attempt was correctly rejected with `409 — "This payment has
already been recorded"`. **The protection code is correct and does work — it is
simply never engaged by the product that ships.**
*Expected behavior:* a user double-clicking "Record Payment," or a client retrying
after a dropped/timed-out response, should not be able to post the same physical
payment twice.
*Actual behavior:* it can, every time, with no client-side guard and no server-side
fallback heuristic (e.g. rejecting/warning on an identical amount+account+invoice
within a short window).
*Security/business impact:* an accidentally (or deliberately) duplicated payment
over-credits the recorded cash/bank balance relative to what physically exists, and
under-states the customer's true outstanding receivable by the duplicate amount —
exactly the kind of discrepancy that would only surface later during account
reconciliation (`GET /accounts/reconcile`, admin-only), after the fact. This is also
a plausible insider-abuse vector: a sales employee could "accidentally" double-post a
customer's payment to quietly wipe more of that customer's debt than was actually
paid.
*Recommended remediation:* have the frontend generate and send a stable
`idempotencyKey` per payment-submission attempt (e.g. derived once when the payment
form/dialog opens, reused across retries of that same submission), so the
already-correct backend protection actually activates for real users.
*Regression risk:* Low — purely additive on the frontend; the backend contract
already supports and correctly handles the key.
*Retest procedure:* repeat the two-identical-requests reproduction after the fix;
expect the second request to be rejected or to be recognized as the same submission.
*Status:* **FIXED — remediated and retested. See §18.9 for the complete
remediation record.**

---
**ALM-SEC-010 — Stock-adjustment audit log records the requested delta, not the actually-applied delta, when clamped at zero**
**Severity:** LOW–MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-1288 (data integrity / improper handling of highly compressed data — closest match: inconsistent audit record)**
**Component:** `backend/src/controllers/product.controller.js:211-222`
(`adjustStock`): `product.stock = Math.max(0, product.stock + delta)` correctly
prevents negative inventory, but the subsequent `StockMovement.create({ quantity:
delta, balanceAfter: product.stock, ... })` records the **unclamped, requested**
`delta`, not the real change actually applied.
**Affected endpoint:** `POST /api/products/:id/adjust`
**Affected role(s):** admin, stock, sales (all three can adjust stock per Phase 3's
matrix)

*Reproduction:*
```
Stock before: 4
POST /products/:id/adjust  { quantity: -9999, note: "..." }
-> 200. Resulting stock: 0 (correctly clamped — inventory underflow is NOT possible).
   StockMovement record written: { quantity: -9999, balanceAfter: 0, ... }
```
The movement's own two fields are internally inconsistent: a `balanceAfter` of `0`
following a prior balance of `4` is only explained by a real delta of `-4`, not the
`-9999` the same record claims.
*Expected behavior:* the audit trail should reflect what actually happened to
inventory, not the raw unclamped input.
*Actual behavior:* it reflects the input.
*Security impact:* none directly (the real stock figure is correct and safe from
underflow) — this is a data-integrity/audit-trail finding, not an access or
financial-theft vector.
*ERP impact:* corrupts historical inventory audit records with numbers that cannot
be reconciled against the balances they sit alongside — directly relevant to the
assessment brief's explicit "inventory integrity...treat as CRITICAL" framing, even
though the immediate exploitability is low. Makes any future forensic review of
"what actually happened to this product's stock" unreliable for any adjustment that
happened to hit the zero floor.
*Recommended remediation:* compute the real applied delta
(`Math.max(0, product.stock + delta) - product.stock` taken before reassignment) and
record *that* on the `StockMovement`, not the raw input.
*Regression risk:* very low — purely a bookkeeping correction, doesn't change the
stock figure itself, which was already correct.
*Retest procedure:* repeat the reproduction; expect the `StockMovement.quantity` to
equal the actual change in `product.stock`, not the raw requested value.
*Status:* OPEN.

### 14.2 Tested and PASSED (recorded per instruction — not silently assumed secure)

| Area | Result |
|---|---|
| **Negative/zero/fractional quantity on a sale** | Blocked (`400`) by `requirePositiveWholeQuantity` for all three cases |
| **Negative unit price / negative line discount on a sale** | Blocked (`400`) by Mongoose schema `min: 0` validators |
| **Sale exceeding available stock** | Blocked (`400`) with an exact have/need message, verified against real stock figures |
| **Negative purchase-order unit cost** | Blocked (`400`) by schema validation |
| **Overpayment** (paying more than an invoice's outstanding balance) | **Correctly capped** at the real balance — a 5000 payment against a 249 balance posted exactly 249 to both the invoice and the Cash account; no excess credited anywhere |
| **Payment against an already-settled invoice** | Blocked (`400` — "This invoice is already settled") |
| **Negative payment amount** | Blocked (`400`) at the controller entry point, before any account/ledger code runs |
| **Payment to a nonexistent account** | Blocked (`404`) |
| **Duplicate payment via a knowingly-reused idempotency key** | Correctly blocked (`409`), and confirmed only one payment line/ledger entry actually exists — the mechanism itself is sound (contrast with ALM-SEC-009, which is about it never being *used*, not about it being broken) |
| **Negative expense amount** | Blocked (`400` — "Expense amount must be greater than zero") |
| **Inventory underflow via stock adjustment** | Numerically impossible — `Math.max(0, ...)` floor confirmed live; the *recording* of that event has a separate, lower-severity issue (ALM-SEC-010) but the actual stock figure cannot go negative |
| **Payment reversal without a reason** | Blocked (`400` — a reason is mandatory) |
| **Reversing the same payment twice** | Blocked (`409` — "This payment has already been reversed"); account balance confirmed unchanged by the rejected second attempt |
| **Payment reversal arithmetic correctness** | Verified to the exact currency unit — Cash balance was 649, a 200 payment was reversed, balance became exactly 449 |
| **Supplier-payment overpayment protection** | Code-verified (identical `Math.min(amount, po.balance)` + conditional-update pattern as invoices, in `purchaseOrder.controller.js`) — not independently live-retested to the same depth as the invoice path this phase; flagged for confirmation in a future pass if warranted |
| **Cost-price confidentiality under business-logic testing** | Re-confirmed under load: even while deliberately forging `unitPrice`, `unitCost` on the same line stayed correctly server-derived from the catalogue and was never itself forgeable by the client |

### 14.3 Could not be tested in this phase

- Race-condition/concurrency stress on the payment and stock-adjustment paths (two
  truly simultaneous requests, not two sequential ones) — reserved for Phase 9 per
  the master plan, since it requires a distinct testing methodology (parallel
  request firing) rather than sequential reproduction.
- Quotation-to-invoice conversion (`POST /quotations/:id/convert`) was not
  independently exercised for the same price-substitution pattern as ALM-SEC-008 —
  it shares the same underlying `buildLineFromProduct`-style construction based on
  code inspection, but was not live-reproduced this phase. Flagged as HIGH-CONFIDENCE
  (code-pattern-identical to a CONFIRMED finding) rather than CONFIRMED.
- Full purchase-order lifecycle (receive → supplier payment → payable adjustment)
  was spot-checked for overpayment protection only, not exhaustively walked the way
  the invoice lifecycle was.
- Expense void, and finance `payables/:id/adjust`, were confirmed access-controlled
  in Phase 3 but not independently stress-tested for value-manipulation abuse this
  phase (time-boxed prioritization — invoices/payments/stock carried the highest
  realistic financial exposure and were prioritized).

---

## 15. Phase 5 — Spreadsheet / Import Security Assessment

**Test environment:** Fresh isolated instance (`mongodb-memory-server` port 27617,
backend port 5100), disposable test rows only. Repository untouched after teardown.

**Scope framing (per instruction):** the draft/upload/parse stage is intentionally
permissive by design (already verified as working-as-intended in an earlier
engineering session — not re-litigated here as a "finding"). This phase targeted
**validation and commit** specifically: does finalization correctly enforce the
business rules Phase 4 already proved the direct API enforces, and does import
introduce any NEW abuse surface (formula injection, numeric parsing, duplicate
handling, oversized batches, type/role bypass) that the direct API doesn't have?

### 15.1 Findings

---
**ALM-SEC-011 — Import numeric parsing silently misinterprets scientific notation and non-numeric text as valid numbers**
**Severity:** MEDIUM–HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-704 (Incorrect Type Conversion) / CWE-1284**
**Component:** `backend/src/utils/excel.js:202-210` (`export function num(v)`) — used
throughout `services/importers.js` for every numeric field on every import type
(prices, stock, quantities, amounts).
**Affected endpoint:** `POST /api/data/import/:type/{validate,commit}` for every
import type that has a numeric column (products, invoices, purchase-orders,
expenses, opening-balances)
**Affected role(s):** admin, sales (for the products type they can reach)

*Technical cause:* `num()` handles a non-numeric-typed cell by stripping every
character that isn't a digit, `.`, or `-` (`String(v).replace(/[^0-9.\-]/g, '')`),
intended to tolerate hand-typed values like `"Rs. 1,234"` or `"1,234.50"`. This
same blunt approach also silently mangles two other, very different inputs:

*Reproduction 1 (scientific notation):*
```
Input cell value: "1.5e3"   (meant as 1500, in E-notation — a format Excel
                              auto-applies to large/small numbers in narrow columns)
"e" is stripped (not treated as a separator) -> "1" + "." + "5" + "3" = "1.53"
Result: imported sellingPrice = 1.53, NOT 1500. Row reported valid=true, no error, no warning.
```
*Reproduction 2 (garbled/typo text):*
```
Input cell value: "abc123"  (e.g. a stray label or paste error in a price column)
Letters stripped -> "123"
Result: imported sellingPrice = 123, silently, as if it were a deliberate valid price.
Row reported valid=true, no error, no warning.
```
Contrast: literal `"Infinity"` and `"NaN"` ARE correctly rejected (`Number.isFinite`
guard) — the bug is specifically in the character-stripping path for numeric-looking
noise, not a total absence of validation.

*Expected behavior:* a cell that isn't cleanly parseable as a number (or a
recognized "currency-formatted number" pattern) should be flagged as an error for
human review, not silently coerced into an unrelated numeric value.
*Actual behavior:* both a 1000x-magnitude error (E-notation) and a
completely-fabricated number (stripped garbage text) are accepted as if they were
intentional, correctly-entered prices/quantities/amounts.
*Security impact:* none directly (not attacker-triggered privilege/data-access
issue) — this is a data-integrity finding.
*ERP/business impact:* **realistic, not theoretical** — Excel auto-formats very
large or very small numbers as scientific notation depending on column width and
locale settings; a legitimate bulk price-list import could silently corrupt prices
by three orders of magnitude with zero error raised, only discovered later when
something sells for far less (or far more) than intended. This directly bears on
the assessment brief's "malformed numbers, scientific notation" test requirement
and on financial-integrity as a CRITICAL concern category.
*Recommended remediation:* parse using a stricter strategy — attempt
`Number(v)` first (which correctly handles real scientific notation as 1500, not
1.53) before falling back to the currency-stripping heuristic, and reject (rather
than silently coerce) any string that doesn't match a recognizable
numeric-with-currency-formatting pattern after that.
*Regression risk:* Low-Medium — needs testing against the actual variety of
hand-typed currency formats the business's real spreadsheets use, to avoid
newly-rejecting something that currently works by coincidence.
*Retest procedure:* repeat both reproductions; expect either the correct value
(1500 for reproduction 1) or a rejected/flagged row (for reproduction 2), never a
silently wrong number.
*Status:* **FIXED — remediated and retested. See §18.9 for the complete
remediation record.**

---
**ALM-SEC-012 — No output encoding of formula-trigger characters on data that flows into exported spreadsheets**
**Severity:** LOW–MEDIUM (see confidence note — NOT rated as if confirmed-exploitable) &nbsp;|&nbsp;
**Confidence:** HIGH-CONFIDENCE (the lack-of-sanitization fact is CONFIRMED; actual
exploitation in a real spreadsheet application was NOT reproduced — see below) &nbsp;|&nbsp;
**CWE-1236 (Improper Neutralization of Formula Elements in a CSV File)**
**Component:** No component sanitizes cell content anywhere in the pipeline — data
entered via import (or the normal product-edit UI/API) that begins with
`=`, `+`, `-`, or `@` is stored verbatim (`Product.name`, `.comments`, etc. are plain
`String` fields with no content filtering) and re-emitted verbatim by
`backend/src/utils/excel.js`'s `buildWorkbook()` (`cell.value = String(raw)`, no
prefix/escaping applied).
**Affected endpoint:** any import commit that sets a text field, and every
`GET /api/data/export/:type` for that same data

*Reproduction:* imported three products with names/comments of
`=1+1+cmd|/c calc`, `@SUM(1,1)` / `+HYPERLINK("http://evil.example/...","click")`,
and `-2+3`. All were accepted and stored character-for-character. Exporting the
products list back to `.xlsx` and inspecting the raw cell objects with ExcelJS
confirmed the content is written out **unchanged**, with no leading apostrophe or
other neutralizing prefix.

*What was and wasn't confirmed:* ExcelJS wrote these as explicit string-typed
cells (`cell.type === 3`, i.e. a real string cell in the XLSX's own internal
format, not a `<f>` formula element) — which is a meaningfully different, and
generally safer, situation than a raw `.csv` export, where there is no cell-type
metadata at all and a spreadsheet program infers "is this a formula" purely from
the leading character. **I do not have a real spreadsheet application available in
this environment to open the exported file and empirically confirm whether Excel/
LibreOffice/Google Sheets would still re-interpret a string-typed cell beginning
with `=`/`+`/`-`/`@` as a formula on open, on paste-elsewhere, or on a "convert
text to columns"-type operation in some configurations/versions.** Per Phase 14's
rule against classifying unreproduced issues as CONFIRMED, this is recorded as
**HIGH-CONFIDENCE** (the underlying fact — zero sanitization exists anywhere in
this pipeline — is itself fully confirmed by direct inspection; the downstream
"does a human's spreadsheet program actually execute it" step is not).
*Security impact if exploitable:* the classic CSV/formula-injection chain — an
attacker-controlled string (e.g. entered via any product/customer/expense text
field, or a bulk import) ends up in a file a real staff member later exports and
opens locally, at which point a formula like `=HYPERLINK(...)` or a
DDE-style payload could execute or exfiltrate in older/misconfigured Excel
installations.
*ERP/business impact:* Low-Medium given the uncertainty above and that XLSX's
explicit cell-typing is a real, non-trivial mitigating factor most CSV-injection
writeups don't have to consider — but "zero sanitization" is still worth closing
defensively given how cheap the fix is.
*Recommended remediation:* in `buildWorkbook()`, prefix any string cell value that
starts with `=`, `+`, `-`, `@`, or a tab/CR (the standard CSV-injection trigger set)
with a leading apostrophe or otherwise force-type it as text, regardless of whether
XLSX's own type system already provides some protection — defense in depth, and it
also protects any future CSV-format export path that might be added later.
*Regression risk:* very low — cosmetic-only for the overwhelming majority of real
values, which don't start with those characters.
*Retest procedure:* repeat the reproduction; inspect the exported file's raw cell
values for the neutralizing prefix.
*Status:* OPEN.

### 15.2 Tested and PASSED (recorded per instruction — not silently assumed secure)

| Area | Result |
|---|---|
| **Unauthorized import type** — sales role attempting to import/commit `expenses` (a type it cannot reach; sales is restricted to `products` only, confirmed via `SALES_TYPES = new Set(['products'])`) | Blocked (`403` — "You do not have access to this dataset") at the route-level `allowType` gate |
| **Mass assignment / cost-price bypass via import** — sales role smuggling `purchasePrice` into a product-import commit | Correctly stripped before `prepare()` ever sees it — stored value stayed at the schema default (0), not the attacker's value; the same protection Phase 3/4 already proved on the direct API holds equally on the import path |
| **Duplicate records within a single import batch** (two rows, identical SKU) | Only one product exists afterward — the second row was correctly flagged invalid/failed as a duplicate, not silently created as a second conflicting record nor silently overwritten without report |
| **Oversized import batch** (5001 rows, one over the documented cap) | Correctly rejected (`400` — "Too many rows (5001) — the maximum is 5000") *before* any processing — **not** tested beyond this documented boundary; a true resource-exhaustion attempt (e.g. actually large XLSX decompression) was deliberately not performed per the instruction against destructive testing, and remains an open item (see Phase 1 §11 / §6 note on the XLSX "zip bomb" surface, still unweaponized) |
| **Unicode edge cases** (Japanese text, emoji, mixed scripts) | Stored and round-tripped correctly, byte-for-byte |
| **`NaN`/`Infinity` literal strings in numeric fields** | Correctly rejected as validation errors (distinct from the silent-coercion bug in ALM-SEC-011 — the *total garbage* case is caught, only the *plausible-looking* garbage case isn't) |
| **Validation/commit inconsistency (TOCTOU-style manipulation)** — validating one clean payload, then committing an entirely different, invalid one without re-validating | `commit` independently re-derives its own validation from whatever rows are actually posted to it every time — it does **not** trust or reuse the result of an earlier `validate` call. The invalid payload was correctly caught fresh at commit time. This closes off an entire class of "validate the good sheet, submit the bad one" attack before it can start. |
| **Server-side authority over required-field validation at commit** (re-confirmation from earlier engineering work, re-verified this phase) | An empty Serial Number at commit time is still rejected — the permissive *draft* stage never weakens what commit actually enforces |

### 15.3 Could not be tested in this phase

- Actual formula execution in a real spreadsheet application (see ALM-SEC-012's
  confidence note) — no such application is available in this environment.
- True decompression/"zip bomb" resource-exhaustion behavior of the XLSX parser —
  deliberately not attempted, per the explicit instruction against destructive
  resource-exhaustion testing; remains an open, unweaponized architectural concern
  from Phase 1.
- Concurrent/simultaneous duplicate import submissions (two commits racing on the
  same data) — reserved for Phase 9 (concurrency), which is the appropriate venue
  for a true race-condition methodology rather than sequential requests.
- Formula-injection testing against import types other than `products` (customers,
  invoices, etc.) — the underlying `buildWorkbook()` sanitization gap is shared
  code, so the finding is expected to generalize, but each type's own text fields
  were not individually re-verified this phase.

---

## 16. Phase 6 — API Security Assessment

**Test environment:** Fresh isolated instance (`mongodb-memory-server` port 27717,
backend port 5110), disposable seeded data (products, a customer, a supplier, an
invoice with a partial payment, an expense, a purchase order, an import-history
entry — created specifically so every list/filter endpoint under test had at least
one real matching record, avoiding the false-negative risk of testing an injection
against an empty collection). Repository untouched after teardown.

### 16.1 NoSQL operator-injection blast radius — full re-test, not assumption

This was flagged as the top priority for this phase. Every `filter.<field> =
<query-value>` assignment in the entire controller layer (13 call sites across 7
controllers, found by an exhaustive grep, not a sample) was individually tested
with a real baseline (a value guaranteed to match nothing) against a
bracket-notation `[$ne]` injection, and the actual item/total counts compared —
not just the HTTP status.

**CONFIRMED injectable (bracket-notation operator bypasses the intended filter):**

| Field | Component | Baseline result | Injected (`[$ne]=null`) result |
|---|---|---|---|
| `products.category` | `product.controller.js:89` | 0 items | **8 items** (all products) |
| `invoices.status` | `invoice.controller.js:111` | 0 items | **1 item** (the only seeded invoice) |
| `purchaseOrders.status` | `purchaseOrder.controller.js:31` | 0 items | **1 item** |
| `expenses.status` | `expense.controller.js:15` | 0 items | **1 item** |
| `expenses.category` | `expense.controller.js:16` | 0 items | **1 item** |
| `payments.type` | `payment.controller.js:24` | 0 items | **1 item** |
| `payments.direction` | `payment.controller.js:25` | 0 items | **1 item** |
| `activity.entity` | `activity.controller.js:7` | 0 items | **5 items** |
| `data/history.type` | `importExport.controller.js:387` (admin-only) | 0 items | **1 item** |

**CONFIRMED safe — NOT vulnerable, despite visually similar code shape:**

| Field | Component | Why it's safe |
|---|---|---|
| `invoices.customer` | `invoice.controller.js:110` | Schema-typed `ObjectId` ref — Mongoose's query-cast layer rejects `{$ne:"null"}` with a clean `400 CastError` before it ever reaches MongoDB |
| `purchaseOrders.supplier` | `purchaseOrder.controller.js:30` | Same — `ObjectId` ref, cast layer rejects it |
| `activity.user` | `activity.controller.js:8` | Same — `ObjectId` ref, cast layer rejects it |
| `payments.account/customer/supplier/invoice/purchaseOrder` | `payment.controller.js:23,26-29` | **Doubly protected**: `ObjectId` ref type AND an explicit `mongoose.isValidObjectId(...)` guard before the value is even assigned to the filter |
| `expenses.account` | `expense.controller.js:17` | Same explicit `isValidObjectId` guard pattern as payments |
| `supplier.active` | `supplier.controller.js:65-66` | Only ever set to a literal boolean from a string-equality check (`=== 'true'` / `=== 'false'`) — the query value itself is never user-controlled |

**Root-cause explanation (why the split exists):** every vulnerable field above is a
plain `String`/enum-typed schema path with no cast-time protection — Mongoose casts
an operator object's *inner* value against the field's declared type, and for a
`String` path almost anything casts successfully, so `{$ne:'null'}` sails through.
Every safe field is either an `ObjectId`-typed ref (where casting a non-ObjectId
value inside the operator genuinely fails) or has an explicit
`mongoose.isValidObjectId()` check written by hand before use. This is a precise,
now fully-mapped blast radius, not a guess.

*This is the same root cause as the NoSQL injection first flagged informally before
Phase 1 (then only confirmed on `products.category`) — expanding that same issue's
scope here rather than creating a duplicate finding, per instruction.*

---
**ALM-SEC-013 — NoSQL operator injection via unsanitized string-typed query filters (full blast radius)**
**Severity:** MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp; **CWE-943 (Improper Neutralization of Special Elements in Data Query Logic)**
**Component:** 9 confirmed call sites across `product.controller.js`,
`invoice.controller.js`, `purchaseOrder.controller.js`, `expense.controller.js`
(x2), `payment.controller.js` (x2), `activity.controller.js`,
`importExport.controller.js` — see table above for exact lines
**Affected endpoints:** `GET /products`, `GET /invoices`, `GET /purchase-orders`,
`GET /expenses`, `GET /payments`, `GET /activity`, `GET /data/history`
**Affected role(s):** admin, sales, stock — whichever role can reach each specific
list endpoint per the Phase 3 matrix (e.g. `GET /payments` and `GET /activity` are
admin-only in practice, but `GET /products`/`GET /expenses` are reachable by
sales too)

*Reproduction:* see table above — every row is a real, independently-fired request
against seeded data with a verifiable count difference, not a theoretical claim.
*Expected behavior:* a filter value should only ever be used as a literal
equality/regex match, never interpreted as a MongoDB query operator.
*Actual behavior:* for 9 confirmed fields, an attacker-controlled bracket-notation
query parameter is parsed by Express's default `qs` parser into a nested object and
passed straight into the MongoDB filter, letting the caller substitute `$ne`,
`$regex`, `$exists`, `$in`, `$gt`/`$lt`, etc. for what was meant to be a plain
string comparison.
*Security impact:* filter-bypass (see full list dumped regardless of the requested
filter) and a `$regex`-based blind-oracle capability (demonstrated on `products` in
the earlier informal assessment: `category[$regex]=^P` correctly isolated only
"Printers"-category rows) — usable to enumerate field values character-by-character
even where the requester has no direct way to browse them.
*ERP/business impact:* Medium — every confirmed field sits behind a role gate that
already permits general list access to that entity (this is not a privilege
escalation into a wholly new dataset), so the practical impact is bypassing a
*filter*, not bypassing *authorization*. The `$regex` oracle angle is the more
interesting risk: it could be used to infer values in fields the UI wouldn't
normally expose as a searchable/browsable list (e.g. probing `activity.entity`
values to map out what kinds of records exist).
*Recommended remediation:* wrap every one of the 9 listed assignments in
`String(value)` before it reaches the filter object (cheapest, smallest possible
fix), or centralize this behind a small `safeFilterValue()` helper reused
everywhere a raw query param becomes a Mongo filter value, to prevent the same
mistake being reintroduced in a future new controller.
*Regression risk:* very low — coercing to `String` changes nothing for the
overwhelming majority of legitimate string values already being sent.
*Retest procedure:* repeat every row in the table above; every injected request
should return the same result as an equivalent, obviously-nonexistent literal
value (i.e. 0 matches), never more than the honest baseline.
*Status:* OPEN.

### 16.2 Other findings

No new distinct findings beyond ALM-SEC-013 emerged from the remaining Phase 6
checklist items — every other test either passed cleanly or confirmed an existing
finding's scope (see below) rather than uncovering new root causes.

### 16.3 Tested and PASSED (recorded per instruction — not silently assumed secure)

| Area | Result |
|---|---|
| **Broken Object Level Authorization / object-ID manipulation** | Re-confirmed from Phase 3: role gates apply before any ID lookup; this phase additionally confirmed that `ObjectId`-typed filter fields independently resist operator injection at the Mongoose cast layer (see 16.1) — two separate, both-effective layers of protection for ref fields specifically |
| **Broken Object Property-Level Authorization** | Already covered in depth in Phases 3-4 (cost-price/comments stripping, ALM-SEC-007's narrow scope); this phase's type-confusion probes (below) found no additional property-level bypass |
| **Broken Function-Level Authorization** | Already exhaustively matrix-tested in Phase 3 (356 checks); not re-run wholesale this phase, which focused on the API-specific risk categories the route matrix doesn't cover |
| **Unrestricted resource consumption via pagination** | `resolvePaging()` hard-caps `limit` at 500 server-side regardless of what a client requests (`Math.min(rawLimit, MAX_LIMIT)`) — confirmed by direct source read; a request for an enormous limit cannot dump an unbounded result set |
| **Sorting abuse** | Not reachable — confirmed by exhaustive grep that no controller passes any user-supplied value into Mongoose's `.sort()`; every sort field is a hardcoded string chosen by the controller itself |
| **SSRF** | Not applicable — confirmed by exhaustive grep that the backend contains **zero** outbound HTTP client usage (`axios`/`fetch`/`http.request`/etc.) anywhere; there is no code path that could be induced to fetch an attacker-supplied URL |
| **Type confusion — quantity as an array** (`invoice` line item) | Rejected (`400`) by `requirePositiveWholeQuantity` |
| **Type confusion — unitPrice as a NoSQL-operator-shaped object** (`{"$gt":0}`) | Rejected (`400`) at the Mongoose document-cast layer (`Cast to Number failed`) — confirms ALM-SEC-008 (client-controlled price) cannot be *additionally* compounded with an operator-injection angle on the same field; the value is trusted, but only as a genuine number |
| **Type confusion — a single-value ref field sent as a one-element array** (`customer: [id]`) | Mongoose's cast leniently unwrapped it to the same valid, legitimate ID already inside the array — not an injection or bypass, just a casting curiosity with no security consequence (informational only, no finding raised) |
| **Duplicate query parameters** (`?category=A&category=B`) | `qs` builds an array, which Mongo/Mongoose then matches with implicit `$in`-like semantics against a broadened set of legitimate values — confirmed to only ever widen a filter across values the role could already see individually, never a privilege or data-boundary violation; recorded as informational, not a vulnerability |
| **Excessive data exposure** | Re-confirmed `password` is never present in any user-related response (`.select('-password')` universally applied); cost/comments stripping re-confirmed under this phase's payload variations |
| **Verbose errors / stack traces** | Re-confirmed from Phase 1/2 — gated correctly to development only; every error observed this phase in the (deliberately dev-mode) test environment carried a stack, but the production gate itself was already independently verified, not re-litigated |
| **Unsafe API consumption** (trusting a third-party API's response) | Not applicable — there are no third-party API integrations anywhere in this codebase (consistent with the SSRF finding above) |

### 16.4 Could not be tested in this phase

- The full 13-call-site injection sweep covered every `filter.field = value`
  pattern found by grep; it does not cover more complex/derived filter
  construction that might exist outside that exact textual pattern (none was found
  by broader inspection, but an exhaustive semantic audit of every controller's
  entire body is outside this phase's scope — Phase 8's data/database review will
  revisit query construction from the data-integrity angle).
- True unrestricted-resource-consumption stress testing (actually firing enough
  concurrent large requests to observe degradation) was not attempted — the
  hard server-side `limit` cap makes this a low-value test to run destructively,
  and the instruction was explicit against resource-exhaustion testing.

---

## 17. Phase 7 — Common Web Vulnerability Assessment

**Test environment:** Fresh isolated instance (`mongodb-memory-server` port 27817,
backend port 5050, frontend dev server port 5174), disposable test products.
Browser-based tests used a real headless Chromium (Playwright) driving the actual
React app, not simulated requests, specifically for the XSS/CSRF/clickjacking tests
where the brief asked for real rendering behavior rather than static assumptions.
Repository untouched after teardown.

**NoSQL injection:** not re-tested from scratch this phase — ALM-SEC-013 (Phase 6)
already comprehensively mapped this issue's full blast radius across every
affected controller. No additional affected surface was discovered during Phase 7;
no expansion needed.

### 17.1 Findings

---
**ALM-SEC-014 — No baseline HTTP security headers (clickjacking, MIME-sniffing, framework fingerprinting)**
**Severity:** LOW &nbsp;|&nbsp; **Confidence:** CONFIRMED (header absence and resulting
framability are both directly demonstrated) — **impact is deliberately NOT
overstated: a full forced-click attack chain was not built and demonstrated** &nbsp;|&nbsp;
**CWE-1021 (Improper Restriction of Rendering UI Layers) / CWE-200 (framework
fingerprinting)**
**Component:** `backend/src/app.js` — no `helmet` or equivalent security-headers
middleware is registered anywhere in the Express app
**Affected endpoint(s):** every response from the API and the locally-served
frontend HTML

*Reproduction (clickjacking precondition):* embedded the live login page inside an
attacker-controlled page's `<iframe>` in a real Chromium browser. The page loaded
fully inside the frame — confirmed via the child frame's URL and by locating and
counting the email input field inside it (found: 1, fully present and
interactable), not merely inferred from a missing header.
```
curl -I http://localhost:5174/login   -> no X-Frame-Options, no CSP frame-ancestors
Playwright: iframe loads the real login page, login form fully rendered inside it
```
*Reproduction (other header gaps, confirmed via direct header inspection):*
`X-Powered-By: Express` is present (framework fingerprinting — narrows an
attacker's exploit research to Express-specific known issues); `X-Content-Type-
Options`, `Strict-Transport-Security`, and `Content-Security-Policy` are absent on
every response. `Cache-Control: private, no-store` **is** correctly set on PDF
document streams specifically (`utils/pdf/document.js`) — general JSON API
responses carry no explicit cache directive either way.
*Expected behavior:* `X-Frame-Options: DENY` (or an equivalent CSP
`frame-ancestors`), `X-Content-Type-Options: nosniff`, HSTS on the production
HTTPS deployment, and `X-Powered-By` suppressed.
*Actual behavior:* none of the above are set; the page is confirmed framable by a
third party.
*Security impact, precisely stated:* the framability precondition for a
clickjacking attack is real and demonstrated. What was **not** demonstrated is a
complete attack — building a convincing decoy UI over the framed app and proving a
specific sensitive action can be triggered by a disguised click. Several of the
most sensitive actions already require typed confirmation (payment reversal
requires a typed reason — Phase 4; the production-cleanup-style confirmation
pattern seen elsewhere in this codebase's history requires typed phrases), which
meaningfully limits — but does not eliminate — what a pure single-click clickjack
could achieve. Simpler one-click actions (e.g. toggling a record's active state,
clicking "Confirm Import") were not individually inventoried for clickjack
feasibility this phase.
*ERP/business impact:* Low as currently demonstrated (a real, working
precondition, not a real completed exploit); would be more serious if paired with
a specific unconfirmed one-click sensitive action, which this assessment did not
find.
*Recommended remediation:* add `helmet` (or hand-set the specific headers) —
`frameguard`/CSP `frame-ancestors 'none'`, `noSniff`, HSTS (production HTTPS only),
and disable `X-Powered-By` (`app.disable('x-powered-by')` or via helmet). This is a
single, low-risk, broadly-applicable addition.
*Regression risk:* very low — these headers are additive and don't change
application behavior, though CSP specifically needs care if ever tightened beyond
frame-ancestors (not recommended to attempt a full script-src CSP in the same
change, to avoid breaking the app).
*Retest procedure:* repeat the header inspection and iframe-embedding test; expect
the frame to fail to load the app's content after the fix.
*Status:* OPEN.

### 17.2 Tested and PASSED / confirmed not applicable (recorded per instruction)

| Area | Result |
|---|---|
| **NoSQL injection** | Covered by ALM-SEC-013 (Phase 6) — no new surface found, not re-litigated here |
| **Command injection** | Not applicable — confirmed by exhaustive grep: zero use of `child_process`/`exec`/`spawn` anywhere in the codebase |
| **Reflected XSS** | Not applicable — the backend is a pure JSON API (no server-rendered HTML templates that could reflect input); the only static HTML served is the fixed SPA shell |
| **Stored XSS** | **Tested through the real, running React application in an actual browser**, not assumed from source review alone. Stored an `<img src=x onerror=...>` and a `<script>...</script>` payload as a product's name and comments via the real API, then loaded the Products list and the product edit screen in headless Chromium. Confirmed: the injected handler never fired (`window` flag check), no JS dialog was triggered, no real `<img>`/`<script>` element was injected into the DOM, and the payload appeared only as literal, visible escaped text. React's default JSX escaping holds in practice, not just in theory. |
| **DOM XSS** | Not applicable — confirmed by exhaustive grep: zero uses of `innerHTML`/`outerHTML`/`document.write` anywhere in the frontend; the only dynamic `location` assignment is a hardcoded `/login` redirect on auth failure, never derived from user/URL input |
| **CSRF** | **Tested, not just reasoned about.** A real cross-origin auto-submitting HTML `<form>` (the actual mechanism a CSRF attack would use) was POSTed at `/api/products` from a separate origin in a real browser. Result: `401 Not authenticated` — because the app's only auth mechanism is a `Bearer` token in a custom `Authorization` header, which a plain HTML form (or any browser-automatic credential attachment) **cannot** send; there is no cookie-based session anywhere in the stack for a forged request to ride on. This architecturally closes off conventional CSRF, confirmed empirically rather than assumed from the localStorage-token architecture alone. |
| **SSRF** | Covered by Phase 6 — no outbound HTTP client exists anywhere in the backend |
| **Path traversal / LFI** | Tested with a `../../../../etc/passwd.xlsx`-style filename on file upload — had no effect (uploads use `multer.memoryStorage()`, so the client-supplied filename is never used to construct a filesystem path anywhere); the request failed only because the file content itself wasn't a valid workbook, exactly as an honest malformed upload would |
| **RFI** | Not applicable — no code path fetches or includes a remote file/URL based on any input |
| **Open redirects** | Not applicable — confirmed by exhaustive grep: no `res.redirect()` calls exist anywhere in the backend |
| **Insecure file upload handling** | Malformed binary content with a `.xlsx` extension: rejected cleanly (`400`, "could not be read as an Excel workbook"). Wrong extension entirely (`.php`): rejected before the file even reaches parsing (`400` at the `multer` file filter). No crash, no path confusion, no silent acceptance, in any case |
| **Prototype pollution** | Tested with `__proto__`/`constructor.prototype` keys in both a direct product-create body and a nested import-commit row. Node's `JSON.parse` (which `express.json()` uses) treats a JSON body's `__proto__` key as a harmless own property, not a real prototype-chain write — verified this is the case, and separately confirmed by exhaustive grep that the codebase contains no deep-merge library (`lodash`/`deepmerge` etc.) and no hand-rolled recursive `for...in` merge utility, which is the actual prerequisite that would be needed to make this exploitable even in principle |
| **Unsafe deserialization** | Not applicable — no YAML/pickle/`node-serialize`-style deserialization of untrusted data anywhere; the only "deserialization" is `JSON.parse` (via `express.json()`) and `exceljs`'s XLSX/ZIP-XML parsing (already reviewed in Phase 1/5 — no macro execution, no formula evaluation) |
| **Template injection (SSTI)** | Not applicable — confirmed by grep: no template engine (`ejs`/`pug`/`handlebars`/etc.) is used anywhere |
| **Header injection** (via filenames in `Content-Disposition`) | Not exploitable — the PDF-download path explicitly sanitizes the filename to a `[\w.\-]` allowlist before use; every `.xlsx` export/errors-file/template filename is constructed server-side from a fixed prefix plus a `type` parameter that must already match a known, `allowType`-validated dataset key — no raw client-supplied string ever reaches a `Content-Disposition` header |
| **Host-header attacks** | Not applicable — confirmed by grep: `req.headers.host`/`req.hostname` is never read anywhere in the backend; nothing in the application logic depends on the `Host` header's value |
| **CORS misconfiguration** | Tested live: a request with `Origin: http://evil-attacker.example` received **no** `Access-Control-Allow-Origin` header at all (the browser would block it), while the actual configured origin (`http://localhost:5174`) correctly received the header echoed back. This is a proper allowlist, not a wildcard-with-credentials misconfiguration |
| **Cache-related sensitive-data exposure** | PDF documents (which can carry customer/financial statement data) explicitly set `Cache-Control: private, no-store` — confirmed correct. General JSON API responses set no explicit cache directive either way (folded into ALM-SEC-014 as a minor defense-in-depth gap, not a separate finding, since exploiting it would require a caching intermediary that isn't part of this deployment's known architecture) |
| **Information disclosure via errors/stack traces** | Re-confirmed from Phase 1/2 (not re-litigated as new) — the production gate (`NODE_ENV==='development'` explicit allowlist) was already independently verified; every stack trace observed this phase was in the deliberately dev-mode test instance |

### 17.3 Could not be tested in this phase

- A complete, weaponized clickjacking attack chain (decoy overlay UI + proof of a
  specific triggered sensitive action) — the framability precondition was
  demonstrated; the full chain was not built, per the instruction to demonstrate
  actual impact rather than infer it from a missing header alone, and because doing
  so meaningfully wasn't necessary to support the (LOW, precisely-scoped) severity
  already assigned.
- Production-specific header/CORS/cache behavior on the real Hostinger deployment —
  only the local isolated instance was tested; Phase 10 (Configuration Assessment)
  is the appropriate venue for any further production-configuration-specific
  review, and even there only what's visible from the repository, not live
  production inspection.

---

## 18. Phase 8/9 — Database/Data-Integrity & Concurrency Assessment (PAUSED — CRITICAL FOUND)

**Test environment:** Fresh isolated instance (`mongodb-memory-server` port 27917,
standalone/non-replica-set — the fallback path with no transaction support, which
is the relevant path since the vulnerable code never even attempts to request a
transaction), backend port 5120, disposable seeded product/customer data.
Repository untouched after teardown.

**What triggered the pause:** while reviewing `createInvoice` for the exact
"Sale creation → Inventory reduction → ... → Receivable update" atomicity chain
the brief specifically asked about, source inspection showed the stock-decrement
and customer-balance-update steps use a **read-modify-write** pattern
(`product.stock -= it.quantity; await product.save();` and
`customer.balance += balance; await customer.save();`) with **no** `runAtomically`/
transaction wrapper and **no** atomic `$inc` — unlike the otherwise-comparable PO
stock-receiving code (`purchaseOrder.controller.js`), which the codebase's own
comments show was *already* fixed for this exact class of bug in the past
("Original defect: `line.received += incoming` on a stale in-memory document...
two concurrent receives both banked the full remainder"). This asymmetry — one
code path fixed, a conceptually identical one not — was reason enough to test
empirically before continuing further, per the instruction to reproduce safely
before classifying.

---
**ALM-SEC-015 — Concurrent invoice creation causes lost updates to product stock AND customer receivable balance (race condition, no transaction, no atomic operators)**
**Severity:** CRITICAL &nbsp;|&nbsp; **Confidence:** CONFIRMED (live, repeatable,
reproduced against real concurrent requests — not inferred) &nbsp;|&nbsp;
**CWE-362 (Race Condition) / CWE-841 (Improper Enforcement of Behavioral Workflow) —
direct financial and inventory data-integrity impact**
**Component:** `backend/src/controllers/invoice.controller.js`, `createInvoice`
(~lines 292-317): stock decrement loop (`product.stock -= it.quantity; await
product.save();`) and customer balance update (`customer.balance += balance; await
customer.save();`) — neither uses `runAtomically()`/a Mongo session, and neither
uses an atomic `$inc`/conditional `findOneAndUpdate`, unlike every other
money-moving path in this codebase (`utils/ledger.js`'s `postPaymentAtomically`,
and `purchaseOrder.controller.js`'s stock-receiving code, both already use the
correct pattern).
**Affected endpoint:** `POST /api/invoices`
**Affected role(s):** admin, sales — this triggers under **entirely normal,
legitimate concurrent usage** (e.g. two POS terminals or two sales staff serving
different customers in the same few seconds), not only under deliberate attack.

*Reproduction (exact, repeatable):*
```
Seed: Product stock = 20. Customer balance = 0.
Fire 10 GENUINELY CONCURRENT POST /invoices requests (Promise.all, not sequential),
each selling 1 unit of the product to the SAME customer at unitPrice 100.

Result:
  10 of 10 invoices reported success (201) — no request was rejected.
  Stock after:            13   (correct value: 20 - 10 = 10)   <- 3 units of
                                                                   decrement LOST
  Customer balance after: 200  (correct value: 10 x 100 = 1000) <- 800 (80%) of
                                                                   the real receivable
                                                                   LOST
  Cross-check: the sum of the 10 real invoices' own `total` fields is genuinely
  1000 (every invoice document itself is correct) — only the DERIVED
  `customer.balance` figure is wrong, silently, with no error surfaced anywhere.
```
*Expected behavior:* every successful sale's effect on stock and on the
customer's outstanding balance should be reflected exactly, regardless of how many
other sales happen concurrently — exactly the guarantee `applyInvoicePayment`
(same file) and the PO stock-receiving code already correctly provide via atomic
conditional updates.
*Actual behavior:* under concurrency, both figures silently drift below their true
value. Not an error, not a rejected request — a silently wrong number that looks
completely normal.
*Security impact:* this is a data-integrity vulnerability, not a
confidentiality/access-control one — but it is trivially triggerable by any two
legitimate, authorized sales-role users acting normally at the same time, with no
attack technique required.
*ERP/business impact — this is the most severe finding of the assessment:*
- **Accounts receivable becomes silently unreliable.** In the reproduction, 80% of
  a real, genuine customer debt vanished from `customer.balance` — the figure every
  receivables report, aging report, and collections decision would be built on.
  This is not a rounding error; it is a systemic undercount that gets worse with
  more concurrent traffic.
- **Inventory becomes silently unreliable.** The system believes it has more stock
  than physically exists, which can cascade into promising/selling inventory that
  isn't there.
- **No error is ever raised.** Every individual request succeeds and reports a
  correct-looking result; only the aggregate, derived figures are wrong. This means
  the business would likely discover this only via a physical stock count or a
  customer dispute months later — exactly the "silent, retrospective-only
  detection" pattern the assessment brief's financial-integrity framing was
  concerned about.
- This is squarely within a normal small-business ERP's realistic concurrency
  profile — it does not require unusual load, just two people working at the same
  time, which any ERP handling real sales traffic should expect as routine.
*Recommended remediation:* change both mutations to atomic operators exactly the
way `postPaymentAtomically`/`receiveItems` already do it correctly elsewhere in
this same codebase:
- Stock: `Product.updateOne({_id, stock: {$gte: quantity}}, {$inc: {stock:
  -quantity}})`, treating a non-match as an insufficient-stock failure at write
  time (not just at the earlier pre-flight read, which is itself subject to the
  same race — two concurrent requests can both pass the pre-flight check against
  the same stale stock figure).
- Customer balance: `Customer.updateOne({_id}, {$inc: {balance: total}})`.
- Ideally, wrap the whole `createInvoice` sequence in `runAtomically()` (the same
  helper already used elsewhere in this file), so a partial failure anywhere in
  the sequence rolls back cleanly on Atlas (replica set, real transactions) and at
  minimum does not compound the race on the no-transaction fallback path.
*Regression risk:* Medium — the pre-flight stock check currently produces a
friendly, specific "insufficient stock for X (have N, need M)" error before any
write; moving to a write-time atomic claim needs to preserve an equally clear error
message when the claim fails, not just a generic "could not create invoice."
Existing tests around invoice creation need to be re-run and likely extended.
*Retest procedure:* repeat the exact 10-concurrent-request reproduction above;
expect final stock to equal exactly `20 - (successful count)` and customer balance
to equal exactly the sum of the created invoices' totals, every time, at any
concurrency level.
*Status:* **FIXED — remediated and retested. See §18.4 for the complete
remediation record (root cause, fix, before/after evidence, regression results).**

*Related finding, now independently confirmed as its own issue — see
**ALM-SEC-016** in §18.5: `product.controller.js`'s `adjustStock` (manual stock
adjustment) uses the identical unsafe read-modify-write pattern. It shares
ALM-SEC-015's root cause but is a separate code path with its own trigger (the
manual stock-adjustment screen, not invoice creation) and was NOT touched by this
remediation. Tested independently, live-reproduced, confirmed vulnerable, and
left unremediated per explicit instruction.*

*A third angle was also tested and did NOT reproduce a problem, recorded for
completeness:* a multi-line invoice where the second line fails its stock check
(product 2 has only 1 unit, invoice requests 5) was correctly rejected **before**
any write occurred — the pre-flight validation loop runs entirely before
`Invoice.create()` and before any stock mutation, so this specific failure
ordering does not leave a partial invoice or a partially-decremented product
behind. The confirmed vulnerability is specifically about **concurrent successful
requests**, not sequential validation failures.

---

## 18.4 ALM-SEC-015 — Remediation record

**Authorization:** explicit, scoped to ALM-SEC-015 only. No other finding was
touched.

**Git safety checkpoint:** tag `pre-alm-sec-015-fix-checkpoint` created at commit
`77d2c7bd426d1b0552e019d639e093e9b762f8d5` (the working tree's state immediately
before this change) before any edit was made.

**Pre-fix inspection performed** (per the requester's explicit instructions,
before writing any code):
- Read the complete `createInvoice` flow end-to-end, including
  `buildLineFromProduct`, `validateLineSerials`, `computeItemTotals`/`applyTax`,
  and the trailing initial-payment step.
- Re-read `purchaseOrder.controller.js`'s `receiveItems` — the codebase's own
  prior fix for the identical class of bug on the *receiving* side of inventory,
  including its own code comments describing the original defect and the
  atomic-claim solution.
- Re-read `utils/ledger.js` in full (`transactionsSupported()`, `runAtomically()`,
  `postPaymentAtomically()`, `reverseTransaction()`) — the established
  transaction/compensating-rollback architecture already used elsewhere in this
  file (`applyInvoicePayment`) and elsewhere in the codebase.
- Confirmed `nextNumber()` (invoice numbering) already uses an atomic `$inc` and
  was not part of the vulnerability (a failed attempt after numbering can leave a
  numbering gap, which is a pre-existing, common, and acceptable ERP behavior —
  not touched, not in scope).

**Root cause:** `createInvoice`'s stock deduction
(`product.stock -= it.quantity; await product.save();`) and customer-balance
update (`customer.balance += balance; await customer.save();`) were both
read-modify-write sequences with no atomic operator and no transaction — unlike
every other money/inventory-moving path in the codebase, which already uses
either `runAtomically()`/atomic `$inc` (payments, PO receiving) or an equivalent
conditional `findOneAndUpdate` claim.

**Files changed:** exactly one — `backend/src/controllers/invoice.controller.js`.
No model, migration, route, frontend, or other controller file was touched.

**Fix, precisely:**
1. Added `runAtomically` to the existing `utils/ledger.js` import (already used
   elsewhere in this same file).
2. Wrapped invoice creation, every line's stock deduction, the serial-number
   claim (for serial-tracked products), the `StockMovement` audit record, and the
   customer balance update in a single `runAtomically(async (session) => {...})`
   block — the same helper `applyInvoicePayment` (in this same file) already
   uses, so the app now has one consistent pattern for "this must all happen
   together" instead of two.
3. Stock deduction changed from a read-modify-write to a single atomic
   conditional update: `Product.findOneAndUpdate({_id, stock: {$gte: quantity}},
   {$inc: {stock: -quantity}}, {session, new: true})`. A `null` result (meaning
   the claim was refused because insufficient stock existed *at that exact
   instant*) throws a clear, per-item "Insufficient stock" error — this is the
   real enforcement point; it cannot be fooled by two requests both reading the
   same stale stock figure, unlike the removed pre-flight-only check.
4. Serial-number claims (for products that track individual unit serials)
   changed from an in-memory array mutation to a conditional `arrayFilters`
   update that only flips a serial's status if it is still `in_stock`, followed
   by a verification read confirming every requested serial actually transitioned
   — closing the same class of race for "two concurrent sales both grab the same
   physical serial number," which was not explicitly named in the original
   reproduction but shares the identical root cause and was in scope as part of
   "every product stock deduction must be applied exactly once."
5. Customer balance changed from a read-modify-write to
   `Customer.updateOne({_id}, {$inc: {balance}}, {session})`.
6. On any failure **and no transaction session available** (the standalone/dev
   fallback path — production Atlas is a replica set and gets a real transaction
   instead), the code now explicitly undoes exactly what it had already committed
   in that attempt: it credits back any already-claimed stock, reverts any
   already-flipped serial statuses, and deletes the just-created `Invoice`
   document — mirroring `reverseTransaction()`'s existing compensating-rollback
   pattern in `utils/ledger.js`, applied here for the same reason.
7. The original pre-flight stock/serial checks earlier in the function were
   **kept, unchanged** — they still provide a fast, specific, friendly error on
   the overwhelmingly common non-concurrent case, before any write happens at
   all. They are no longer the *enforcement* mechanism (the atomic claim is), but
   removing them would have made ordinary mistakes (selling more than is in
   stock, as a single sequential request) produce a less specific error, which
   was not necessary or desirable.
8. The trailing optional POS "initial payment" step was **deliberately left
   outside** the atomic block, unchanged — the existing code (and its own
   comment) already establishes that a payment failure after a successful sale
   should leave the invoice recorded as unpaid rather than unwind a completed
   sale, and changing that would have been an unrelated behavior change outside
   this fix's scope.
9. The credit-limit check was **not** moved inside the atomic block — it remains
   a pre-flight read against a point-in-time `customer.balance`, exactly as
   before. A theoretical race exists where two concurrent sales could each
   individually pass the credit-limit check and together exceed it; this was not
   part of the CONFIRMED ALM-SEC-015 reproduction or the explicit required
   security properties (which named stock, receivable-amount-correctness, and
   invoice-existence, not credit-limit enforcement specifically), and expanding
   scope to it was judged an unrelated architectural change. Recorded as a
   **residual risk**, not silently fixed and not silently ignored.

**Tests performed:**

| Test | Result |
|---|---|
| Full existing automated suite (`npx vitest run`) | **318/318 passed**, no regressions |
| `invoice.controller.test.js` specifically | **39/39 passed**, unchanged — cart editing, correction actions, totals, cost-stripping, etc. all still behave identically |
| **Original ALM-SEC-015 reproduction, re-run against the fix** (stock=20, balance=0, 10 concurrent 1-unit sales to the same customer) | **10/10 succeeded. Stock: exactly 10 (was 13 before the fix). Customer balance: exactly 1000 (was 200 before the fix).** Verified against the database via fresh `GET` calls, not response bodies. `sum(invoice totals) == balance increase`: MATCH. `starting stock - sum(successful quantities) == final stock`: MATCH. |
| **Overselling test** (stock=5, 10 concurrent 1-unit requests) | **Exactly 5 succeeded, exactly 5 rejected** (`400 Insufficient stock`) — never 10. Final stock: exactly 0, never negative. Customer balance: exactly 250 (5 × 50), matching only the successful sales. Invoice count in DB: exactly 5 — rejected requests created **no** invoice and altered **no** balance. |
| **Partial-failure compensating-rollback test** (2 concurrent multi-line invoices, each wanting 1 unit of Product A (stock 10) + 1 unit of Product B (stock 1, forcing exactly one loser) | Exactly one request won (`201`), one lost (`400`, on the Product B claim, *after* it had already won the Product A claim within its own attempt). Product A stock after: exactly 9 — the loser's already-claimed Product A deduction was correctly rolled back, not left orphaned. Product B stock: exactly 0. Invoices in DB: exactly 1 — the loser's `Invoice` document does not exist. Customer balance: exactly 20 — only the winner's total. |
| Concurrent invoices across **different** products and **different** customers (3×3 = 9 concurrent requests, no shared contention) | All 9 succeeded; every product's stock landed at exactly the expected value (7 of 10), every customer's balance landed at exactly the expected value (60) — confirms the fix doesn't introduce unwanted cross-request serialization or interference where none is needed |
| Multi-line invoice (sequential) | Correct total (100 for 2×20 + 3×20 minus nothing) |
| POS sale with an initial payment | Invoice correctly shows `paid: 20, balance: 0, status: 'paid'`; the Cash account was correctly credited 20 — the (deliberately unchanged) initial-payment path still works exactly as before |
| Cost-price protection (sales role) | `purchasePrice` still absent from a sales-role `GET /products/:id` response — unaffected by this change, re-verified live |
| Stock-movement audit trail | Movement records remain one-per-successful-line with a correct `balanceAfter` that matches the actual post-write stock — audit consistency preserved |
| Sequential insufficient-stock rejection | Still produces the same friendly, specific error (`"Insufficient stock for X (have N, need M)"`) for the ordinary non-concurrent case |

**Behavior change for normal (non-concurrent, non-racing) users:** **none observed
or expected.** Every response shape, every validation message for the common
single-request case, every total/tax/discount calculation, every permission
check, and every existing automated test behaves identically. The only behavior
difference is specifically under genuine concurrency, where the system now
produces the *correct* result instead of a silently wrong one.

**Residual risks (not fixed by this change, explicitly not in scope):**
- The credit-limit check (§ point 9 above) still reads a point-in-time balance
  outside the atomic block — a theoretical concurrent-limit-bypass edge case, not
  part of the confirmed vulnerability or its required security properties.
- `nextNumber()` can leave small gaps in invoice numbering after a failed/rolled-
  back attempt — pre-existing, common ERP behavior, not a data-integrity defect.
- ALM-SEC-016 (below) — a separate, related, still-open finding.

**ALM-SEC-015 status: FIXED.** Reproduced → remediated → retested, all per the
required procedure. Original evidence above (§18, pre-remediation) is preserved
unedited.

---

## 18.5 ALM-SEC-016 — `adjustStock` has the identical unsynchronized read-modify-write race condition (separate, confirmed, NOT remediated)

**Severity:** HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED (live, repeatable) &nbsp;|&nbsp;
**CWE-362 (Race Condition)**
**Component:** `backend/src/controllers/product.controller.js:211-213`
(`adjustStock`): `const delta = requireNonZeroWholeQuantity(quantity,
product.name); product.stock = Math.max(0, product.stock + delta); await
product.save();`
**Affected endpoint:** `POST /api/products/:id/adjust`
**Affected role(s):** admin, stock, sales (all three can adjust stock per the
Phase 3 RBAC matrix)
**Status: OPEN — tested and confirmed independently; explicitly NOT
remediated, per instruction, since fixing ALM-SEC-015 did not require touching
this separate code path.**

*Why this was tested now rather than left purely as a code-inspection guess:*
the requester specifically asked that this NOT be silently fixed alongside
ALM-SEC-015 merely because the code looks similar, and that it be independently
tested and reported as its own finding if confirmed — so it was tested,
deliberately without changing `product.controller.js` at all.

*Reproduction:*
```
Seed: a fresh product, stock = 0.
Fire 10 GENUINELY CONCURRENT POST /products/:id/adjust requests (Promise.all),
each requesting {quantity: +1}.

Result: all 10 reported success (200 — no request was rejected).
  Stock after: 4   (correct value: 0 + 10 = 10)  <- 6 of 10 increments LOST
  StockMovement audit records created: 10 (one per successful call, each
  individually correct — "+1, note: concurrent +1" x10)
```
This is, if anything, a cleaner demonstration of the divergence than
ALM-SEC-015's was: the audit trail (10 movements, summing to +10) and the actual
`Product.stock` field (+4) permanently disagree with each other, with no error
ever raised.
*Expected behavior:* concurrent stock adjustments should compose correctly,
exactly like the (now-fixed) invoice stock deduction and the (already-correct)
PO stock-receiving code.
*Actual behavior:* silently incorrect, same as ALM-SEC-015 was.
*ERP/business impact:* manual stock adjustments are a normal, routine ERP
operation (correcting a miscount, writing off damaged stock, recording a found
item) — concurrent use by warehouse/stock staff is a realistic, unremarkable
scenario, not an edge case, and not an attack. The business impact mirrors
ALM-SEC-015's inventory-integrity concern directly.
*Recommended remediation (not applied):* the same pattern just proven correct for
ALM-SEC-015 — replace the read-modify-write with
`Product.findOneAndUpdate({_id}, {$inc: {stock: delta}}, {new: true})` and clamp
at zero via a conditional filter (`stock: {$gte: -delta}}` when `delta` is
negative) rather than a JavaScript `Math.max`, so the clamp itself is also
enforced atomically rather than computed from a stale read. This does not
require a full transaction (a single document's own atomicity is sufficient for
this one-field update, unlike invoice creation which touches multiple
documents) — a smaller, more contained fix than ALM-SEC-015 needed.
*Regression risk if fixed later:* Low — same reasoning as ALM-SEC-015's stock
claim; the existing `StockMovement` audit-record creation (already noted in
ALM-SEC-010, Phase 4, as recording the *requested* delta rather than the
*actually-applied* one when clamped) would need to be revisited together with
this fix, since both bugs live in the same few lines.
*Retest procedure (for when authorized):* repeat the exact reproduction above;
expect final stock to equal exactly the starting value plus the sum of all
successful deltas, at any concurrency level.
*Status:* **FIXED — remediated and retested. See §18.6 for the complete
remediation record.**

---

## 18.6 ALM-SEC-016 — Remediation record

**Authorization:** explicit, scoped to ALM-SEC-016 only.

**Git safety checkpoint:** tag `pre-alm-sec-016-fix-checkpoint-base` created at
the (still-uncommitted) working-tree state immediately after the ALM-SEC-015 fix
and before this change; a local backup copy of the pre-change
`product.controller.js` was also saved. ALM-SEC-015's own fix
(`invoice.controller.js`) was **not** touched by this change — confirmed via
`git diff --stat`, which shows only `product.controller.js` newly modified this
round.

**Pre-fix inspection performed** (per instruction, before writing any code):
- Re-read the complete `adjustStock` flow.
- Re-read the ALM-SEC-016 reproduction evidence (§18.5).
- Re-read the ALM-SEC-015 remediation pattern (§18.4) for architectural
  consistency.
- Re-confirmed existing `StockMovement`/audit behavior, specifically the
  already-documented (separate, still-open) ALM-SEC-010 finding from Phase 4 —
  that the audit record stores the *requested* delta rather than the
  *actually-applied* one when clamping occurs — to make a deliberate decision
  about it rather than an accidental one (see below).

**Root cause:** identical to ALM-SEC-015's — `adjustStock` used
`product.stock = Math.max(0, product.stock + delta); await product.save();`, a
JavaScript read-modify-write with no atomic operator, so concurrent adjustments
on the same product could clobber each other's change instead of composing.

**Files changed:** exactly one — `backend/src/controllers/product.controller.js`.
No model, route, frontend, or other controller file was touched.
`invoice.controller.js` (ALM-SEC-015) was not modified.

**Fix, precisely:** replaced the read-modify-write with a single MongoDB
aggregation-pipeline update — `Product.findOneAndUpdate({_id}, [{$set: {stock:
{$max: [0, {$add: ['$stock', delta]}]}}}], {new: true})` — the exact same idiom
`applyInvoicePayment` already uses elsewhere in this codebase for atomically
clamping `Customer.balance` at zero. The clamp-to-zero arithmetic now runs
**inside** the database, against MongoDB's own current value at the instant of
the write, in one atomic operation — not computed from a value the Node process
read a moment earlier and might no longer be accurate by the time it writes it
back. No transaction/session was needed (unlike ALM-SEC-015): this touches a
single document with a single field, which is already atomic in MongoDB by
itself once expressed as one pipeline update instead of two separate
read-then-write round trips.

**Deliberately unchanged, per instruction:**
- `StockMovement.quantity` still records the raw requested `delta`, not a
  recomputed "actually applied" delta — preserving today's exact audit-record
  behavior (including its own separately-tracked imperfection, ALM-SEC-010,
  which was explicitly NOT authorized for remediation here and was not touched).
  `StockMovement.balanceAfter` is unaffected either way — it already reflects
  the true post-write stock, now sourced from the atomic operation's own result
  instead of a locally-computed value, making it, if anything, more reliably
  accurate than before, as a side effect of removing the race — not a deliberate
  behavioral change to the field's meaning.
- The 404 check, the `requireNonZeroWholeQuantity` validation (and its exact
  error message, which needs `product.name` from a pre-flight read — kept
  exactly as before), the response shape (`sanitizeProduct`), permissions
  (`requireRole('admin','stock','sales')`, unchanged at the route level), and
  `logActivity`'s call shape are all unchanged.
- The concurrent credit-limit residual risk noted in §18.4 (invoice creation)
  was not touched — it is unrelated to this endpoint and was explicitly out of
  scope.

**Tests performed:**

| Test | Result |
|---|---|
| Full existing automated suite (`npx vitest run`) | **318/318 passed**, no regressions |
| `product.controller.test.js` specifically | **18/18 passed**, unchanged |
| **Original ALM-SEC-016 reproduction, re-run against the fix** (stock=0, 10 concurrent `+1` adjustments) | **10/10 succeeded. Stock: exactly 10** (was 4 before the fix). Verified against the database via a fresh `GET`. |
| **Concurrent negative adjustments / minimum-stock test** (stock=5, 10 concurrent `-1` adjustments) | All 10 succeeded (this endpoint clamps rather than rejects, by existing design — preserved). **Final stock: exactly 0** — correctly clamped at the floor, never negative. |
| **Mixed concurrent +/- adjustments** (stock=10, 5× concurrent `+2` and 5× concurrent `-1` fired together) | **Final stock: exactly 15** (10 + 10 − 5), confirming the atomic composition holds under mixed-sign concurrent load, not just same-sign |
| **Audit/stock-movement verification** | Exactly 10 `StockMovement` records for the 10-succeeded test (one per successful call, matching the confirmed-good pattern already established for this endpoint's audit trail); sum of recorded movement quantities (10) matches the final stock exactly in the no-clamping case, as expected |
| Sequential adjustment | Unchanged — correct resulting stock |
| Zero/fractional quantity rejection | Unchanged — still `400` in both cases, same validator, same messages |
| Nonexistent product | Unchanged — still `404` |
| Role permissions (sales, stock can adjust) | Unchanged — both succeed, matching the Phase 3 RBAC matrix exactly; no route or role-gate code was touched |
| Activity log | Still records a `stock_adjusted` entry with actor/action/entity/timestamp, unchanged |

**Behavior change for normal (non-concurrent, non-racing) users:** **none.**
Every validation message, the 404 case, the response shape, and every
permission check behave identically. The only difference is under genuine
concurrency, where the result is now correct instead of silently wrong.

**Residual concerns:**
- ALM-SEC-010 (Phase 4: `StockMovement.quantity` records the requested delta,
  not the post-clamp applied delta) remains open and was deliberately not
  touched — it was in scope to leave alone per this authorization, and doing so
  did not turn out to be technically necessary for the concurrency fix (the
  clamp itself is now atomic and correct; only the audit record's exact-delta
  precision under clamping, a separate and already-documented issue, is
  unaffected either way).
- The credit-limit concurrent-race residual risk from ALM-SEC-015 (§18.4) is
  unrelated to this endpoint and remains exactly as documented there.
- No other `read-modify-write`-shaped stock/balance mutation is known to remain
  in the codebase based on this assessment's review so far, but a systematic
  sweep for the pattern across every controller was not performed as part of
  this narrowly-scoped authorization — that would be in scope for the paused
  Phase 8/9 work if and when it resumes.

**ALM-SEC-016 status: FIXED.** Reproduced → remediated → retested, per the
required procedure. Original evidence in §18.5 is preserved unedited.

---

**Status: PHASES 8–13 COMPLETE.** ALM-SEC-015 and ALM-SEC-016 were **not**
modified in this round (confirmed via `git diff --stat` before and after — only
new findings were added). Sections below cover the completed systematic sweep,
Phases 10–13, and the full consolidated summary.

## 18.7 Systematic read-modify-write sweep (Phase 8/9 continuation)

**Method:** an exhaustive grep for every `.field += / -= value; ... .save()`-shaped
mutation and every bare `.save()` call across all controllers and services (not a
sample), followed by live concurrent reproduction for every financially or
operationally significant hit, using the same isolated-instance methodology as
ALM-SEC-015/016. Lower-realistic-risk hits (rare, admin-only, single-actor
operations) were still code-reviewed and are recorded with their confidence level
even where not independently live-tested, per instruction not to assume a pattern
is vulnerable without reproducing it — those are explicitly marked
HIGH-CONFIDENCE/code-pattern-only, never CONFIRMED, where live reproduction was not
performed.

### 18.7.1 ALM-SEC-015 blast radius — expanded (same root cause, sibling code path)

**`quotation.controller.js`'s `convertToInvoice`** (`POST
/quotations/:id/convert`) independently implements the identical
"create-a-sale-effect" sequence ALM-SEC-015 fixed in `createInvoice` — but as its
own separate function, untouched by that fix (which was correctly scoped to only
`createInvoice`, per the original, explicit authorization). It contains the exact
same unsafe pattern: `product.stock -= it.quantity; await product.save();` and
`customer.balance += quote.total; await customer.save();`.

*Reproduction:* created 10 separate quotations for the same product/customer,
then converted all 10 **concurrently**.
```
Stock before: 20.  10/10 conversions succeeded.
Stock after:      13 (expected 10)   — lost updates, identical shape to the original ALM-SEC-015 evidence.
Customer balance: 450 (expected 500) — lost updates, identical shape.
```
**This is recorded as an expansion of ALM-SEC-015's scope, not a new Finding ID** —
same root cause, same mechanism, same evidence shape.

**Update — subsequently remediated.** `POST /quotations/:id/convert` was fixed
in a later authorized batch alongside ALM-SEC-018 and ALM-SEC-019. See §18.8 for
the complete remediation record (root cause, fix, before/after evidence,
regression results). **ALM-SEC-015 is now FIXED in full — both `createInvoice`
and `convertToInvoice`.**

### 18.7.2 New findings

---
**ALM-SEC-017 — Concurrent invoice creation can collectively bypass a customer's credit limit**
**Severity:** MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp;
**CWE-367 (TOCTOU Race Condition) — business-rule bypass, not data corruption**
**Component:** `backend/src/controllers/invoice.controller.js`, `createInvoice` —
the credit-limit check (`if (customer.creditLimit > 0 && customer.balance + total
- upfront > customer.creditLimit) {...}`) reads `customer.balance` once, before
any of the (now-atomic, correct) stock/balance writes happen, and is **not**
re-checked at write time.
**Affected endpoint:** `POST /api/invoices`
**Affected role(s):** admin, sales

*Reproduction:* customer with `creditLimit: 300`, starting `balance: 0`. Fired 10
concurrent invoices for 100 each (1000 total, far beyond the limit).
```
10/10 succeeded. 0 rejected.
Final customer balance: 1000 — a 700 overrun of the 300 credit limit.
10 x 100 = 1000 exactly matches the balance (confirms this is NOT the ALM-SEC-015
bug recurring — the balance arithmetic itself is now perfectly correct; the credit
limit business rule is simply checked too early and never re-validated).
```
*Expected behavior:* the credit limit should hold as an invariant regardless of
how many requests arrive concurrently.
*Actual behavior:* every concurrent request reads the same stale, pre-transaction
balance and independently concludes it is within limit.
*ERP/business impact:* a customer (or a sales employee acting quickly/
deliberately, or simply normal concurrent POS use) can exceed their approved
credit limit by submitting multiple sales at once — undermining the one control
`creditLimit` exists to provide. This is a business-rule integrity issue, not a
data-corruption one: every invoice and the resulting balance are individually and
collectively arithmetically correct (unlike ALM-SEC-015), they simply exceed a
policy limit that should have blocked some of them.
*Recommended remediation:* re-validate the credit limit **inside** the same
atomic block ALM-SEC-015 introduced, against the database's live balance at write
time (e.g. as an additional condition on the atomic claim, or a guarded
aggregation-pipeline update mirroring the stock-claim pattern), rather than only
as a pre-flight read. This was identified as a residual risk during the
ALM-SEC-015 fix and explicitly deferred rather than silently bundled in, per
instruction at the time.
*Regression risk:* Medium — needs a decision on the correct declined-request
message/status and interacts with the same atomic block ALM-SEC-015 already
modified; should be scoped and authorized as its own change, not folded silently
into another fix.
*Retest procedure:* repeat the exact reproduction; expect the sum of succeeded
invoices' totals to never push `customer.balance` past `creditLimit` when
`creditLimit > 0`.
*Status:* OPEN — not authorized for remediation in this pass.

---
**ALM-SEC-018 — Concurrent purchase-order creation loses updates to supplier payable (same root cause as ALM-SEC-015, different entity/direction)**
**Severity:** HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp;
**CWE-362 (Race Condition)**
**Component:** `backend/src/controllers/purchaseOrder.controller.js`, `createPO`
(~line 95): `supplier.payable += total; await supplier.save();` — a
read-modify-write with no atomic operator and no transaction, structurally
identical to the original ALM-SEC-015 defect.
**Affected endpoint:** `POST /api/purchase-orders`
**Affected role(s):** admin, stock

*Reproduction:* fresh supplier, `payable` starting at 0. Fired 10 concurrent PO
creations, each for 30.
```
10/10 POs created successfully — confirmed via GET /suppliers/:id, which lists
all 10 real PurchaseOrder documents, totalling exactly 300 (10 x 30).
Stored supplier.payable after: 30 — NINE of the ten +30 increments were lost.
The supplier-detail endpoint's own "summary" block independently confirms this:
{"totalPurchases": 300, "outstanding": 300, "storedPayable": 30, "reconciled": false}
```
*Notably*, the application already contains its own drift-detection
(`reconciled: false` in the supplier summary) for exactly this scenario — evidence
this class of discrepancy was anticipated as a *possible* data-quality issue to
detect after the fact, not that it was known to be silently caused by a live race
condition.
*Expected behavior:* `supplier.payable` should reflect the true sum of that
supplier's outstanding purchase orders regardless of concurrent PO creation.
*Actual behavior:* under concurrency, it silently and severely undercounts (90%
loss in this reproduction).
*ERP/business impact:* payables — money the business owes its suppliers — become
unreliable exactly the way receivables did before the ALM-SEC-015 fix. A
business could underpay or fail to recognize real supplier obligations, discovered
only via manual reconciliation (which the app already has UI support for
surfacing, but only after the fact).
*Recommended remediation:* identical pattern to the ALM-SEC-015 fix — replace with
`Supplier.updateOne({_id}, {$inc: {payable: total}})`, and consider whether PO
creation should also move into a `runAtomically()` block alongside the
`PurchaseOrder.create()` call for full consistency with the invoice-side fix.
*Regression risk:* Low-Medium, same shape as ALM-SEC-015's.
*Retest procedure:* repeat the exact reproduction; expect `storedPayable` to equal
`totalPurchases` exactly, with `reconciled: true`, at any concurrency level.
*Status:* **FIXED — remediated and retested. See §18.8.**

---
**ALM-SEC-019 — Payment reversal's full-document save can silently discard a concurrently-applied payment on the same invoice**
**Severity:** HIGH &nbsp;|&nbsp; **Confidence:** CONFIRMED (invoice payments) /
HIGH-CONFIDENCE (purchase-order payments — shared service code, not independently
live-reproduced this round) &nbsp;|&nbsp; **CWE-362 (Race Condition) — distinct
mechanism from ALM-SEC-015/016/018: not two identical operations racing each
other, but one atomic writer colliding with one non-atomic full-document writer**
**Component:** `backend/src/controllers/invoice.controller.js`,
`reverseInvoicePayment` (~line 642): computes `invoice.paid`, `invoice.balance`,
`invoice.status` from an in-memory `Invoice` document read at the *start* of the
request, then calls `await invoice.save({session})` — a full-document write that
overwrites every field Mongoose considers modified, including the `payments`
array — regardless of what a concurrently-committed payment may have already
written via its own (correctly atomic) conditional update.
**Affected endpoint:** `POST /api/invoices/:id/payments/:paymentId/reverse` (and,
by the identical shared implementation in `paymentReversal.js`, structurally the
same risk applies to `POST
/api/purchase-orders/:id/payments/:paymentId/reverse` — not independently
live-reproduced this round, flagged HIGH-CONFIDENCE on code-shape grounds only)
**Affected role(s):** admin (payment reversal is admin-only per the Phase 3
matrix)

*Reproduction:* invoice total 200; one payment of 100 already applied
(paid=100, balance=100). Fired **concurrently**: (a) a new payment of 50, and
(b) a reversal of the original 100 payment.
```
Both requests returned success (200/200).
Expected (either ordering): paid=50, balance=150 (the new payment landing, net of
the original being reversed).
Actual: paid=0, balance=200 — the new payment's effect was silently discarded.
```
The reversal's full-document `.save()`, based on its own stale in-memory read,
overwrote the concurrently-committed payment's changes to `paid`/`payments`
instead of composing with them.
*Expected behavior:* two independent, individually-valid operations on the same
invoice — a new payment and a reversal of a *different* payment — should both take
effect, exactly as they do when run sequentially (already covered by the passing
regression suite).
*Actual behavior:* whichever operation's full-document `save()` lands last wins
outright, discarding the other's effect on `paid`/`balance`/`payments`, with
**both requests reporting success** — no error, no indication anything was lost.
*ERP/business impact:* a real customer payment can vanish from the record if it
happens to race against an admin reversing an unrelated earlier payment on the
same invoice — a genuine financial-integrity risk, and unlike ALM-SEC-017 this
one **does** produce an arithmetically wrong result (not just a bypassed policy
limit).
*Recommended remediation:* change `reverseInvoicePayment`'s (and the mirrored
PO-side) `applyDocumentUpdates` to use a conditional/atomic update for
`paid`/`balance`/`status` (an aggregation-pipeline `updateOne`, the same idiom
already used by `applyInvoicePayment`) instead of mutating and saving the
in-memory `invoice` object wholesale. The `payments[index].reversed = true` flag
specifically also needs an atomic, targeted update (e.g. `$set:
{'payments.$[p].reversed': true, ...}` with an `arrayFilters` positional match) so
it doesn't depend on re-saving the entire array from a stale snapshot either.
*Regression risk:* Medium — this function's update logic would need the same
kind of restructuring ALM-SEC-015's fix applied to invoice creation; should be
scoped, tested and authorized as its own change.
*Retest procedure:* repeat the exact reproduction; expect final `paid` to equal
50 and `balance` to equal 150, regardless of which of the two concurrent
operations' writes physically lands first.
*Status:* **FIXED (invoice-side, `reverseInvoicePayment`) — remediated and
retested, see §18.8. The mirrored PO-side (`reverseSupplierPayment`) was
explicitly NOT touched — it was never CONFIRMED, only HIGH-CONFIDENCE by code
shape, and fixing it was outside this authorization's scope. It remains OPEN.**

---
**ALM-SEC-020 — Concurrent account opening-balance corrections silently discard all but the last write**
**Severity:** LOW &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp;
**CWE-362 (Race Condition) — no invariant violation, pure lost-update**
**Component:** `backend/src/controllers/account.controller.js`, `updateAccount`
(~line 68-73): `account.currentBalance += delta; ... await account.save();`
**Affected endpoint:** `PATCH /api/accounts/:id`
**Affected role(s):** admin only

*Reproduction:* fired 10 concurrent `openingBalance` corrections (100, 200, ...,
1000) against an account starting at 0/0.
```
10/10 returned 200. Final openingBalance=800, currentBalance=800.
```
*Why this is scored LOW, not HIGH like ALM-SEC-018/020's siblings:* the two
fields (`openingBalance`, `currentBalance`) are always written *together* from one
internally-consistent in-memory computation, so whichever single request's write
physically lands last leaves the account in a self-consistent state (never a
corrupted, partially-applied, or negative figure) — unlike the other findings in
this sweep, there is no invariant violation, only silently-discarded intent from
the 9 non-final requests, each of which reported success. This is also an
admin-only, manual, deliberately-infrequent settings-correction action — a
realistic concurrent-use scenario here is far less likely than for invoice/PO/
payment creation.
*ERP/business impact:* low — an admin's correction could be silently overwritten
by another admin's near-simultaneous correction with no conflict warning, which
is a poor (if rare) UX/data-loss experience rather than a financial-integrity
breach.
*Recommended remediation:* if addressed at all, the same atomic-pipeline pattern
already used elsewhere (`{$set: {currentBalance: {$add: ['$currentBalance',
delta]}}}` computed server-side) would close it; given the low realistic impact
this can reasonably be deprioritized relative to ALM-SEC-017/018/019.
*Status:* OPEN — not authorized for remediation in this pass; lowest priority of
this sweep's findings.

### 18.7.3 Confirmed SAFE under live concurrent testing (recorded per instruction)

| Operation pair | Result |
|---|---|
| Invoice + invoice (same product, same customer) | ALM-SEC-015 fix holds: 10/10 concurrent sales, exact correct stock and balance — re-verified again this phase |
| Invoice + invoice (different products, different customers, 3x3 concurrent matrix) | All 9 concurrent requests landed with the exact expected per-product stock and per-customer balance — no unwanted cross-interference |
| Overselling (stock=5, 10 concurrent 1-unit requests) | Exactly 5 succeeded, exactly 5 cleanly rejected, stock exactly 0, zero orphaned invoices — re-verified |
| Partial-failure compensating rollback (2 concurrent multi-line invoices contending for the last unit of a shared line item) | The loser's already-claimed stock on the *other* line was correctly given back; its `Invoice` document does not exist — re-verified |
| **Stock adjustment (ALM-SEC-016 fix), 10 concurrent `+1`** | Exactly 10 — re-verified |
| **Stock adjustment, concurrent negative (clamped) adjustments** | Correctly clamped at exactly 0, never negative — re-verified |
| **Purchase-order receiving + receiving** (10 concurrent 1-unit receipts against a 10-unit order) | Stock landed at exactly 10, PO `received` at exactly 10 — the pre-existing atomic claim pattern (`findOneAndUpdate` with a room-remaining filter) holds under genuine concurrent load, not just in isolation |
| **Payment + payment** (same invoice, 10 concurrent 50-unit payments against a 500 balance) | Exactly 500 paid, exactly 0 balance, customer balance exactly 0 — `applyInvoicePayment`'s atomic conditional-update pattern holds |
| Expense creation (code-reviewed, not independently re-live-tested this phase — already uses `postPaymentAtomically`, the same proven-safe path) | Uses the correct pattern; no code changed since Phase 4's testing confirmed this |
| Payment reversal on expenses/PO payments (code-reviewed: `postPaymentAtomically`-based, same safe pattern) | Uses the correct pattern for the *ledger*/*account* side; **however see ALM-SEC-019 for the separate document-level `.save()` risk this doesn't cover** |

### 18.7.4 Reviewed, not independently live-tested (HIGH-CONFIDENCE or INFORMATIONAL only — explicitly not claimed CONFIRMED)

| Component | Pattern found | Confidence | Why not live-tested |
|---|---|---|---|
| `invoice.controller.js`, `returnInvoice` (~line 578-590): `product.stock += it.quantity; await product.save();` restoring stock on a return | Identical shape to ALM-SEC-015/018 | HIGH-CONFIDENCE | A return is an inherently low-frequency, typically single-admin-actor operation on one specific invoice; realistic concurrent-return-of-the-same-invoice scenarios are rare. Time-boxed out of this pass's live testing in favor of higher-likelihood targets. |
| `invoice.controller.js`, `returnInvoice`'s trailing customer-balance adjustment (~line 610): `customer.balance = Math.max(0, customer.balance - invoice.balance); await customer.save();` | Same shape | HIGH-CONFIDENCE | Same reasoning as above |
| `services/importers.js` (~lines 886-1350): bulk import commit paths for invoices/POs/opening-balances doing `invoice.paid += amt`, `po.paid += amt`, `acct.currentBalance += delta` | Same shape | INFORMATIONAL/THEORETICAL | Reachable only via admin-only bulk spreadsheet-import commits; two admins concurrently committing imports that both post against the *same specific* invoice/PO/account is a narrow, unusual scenario. Not live-tested this round given the far higher-likelihood targets already confirmed. |

---

## 18.8 Remediation record — ALM-SEC-015 (convertToInvoice), ALM-SEC-018, ALM-SEC-019

**Authorization:** explicit, scoped to exactly these three items (the remaining
`convertToInvoice` scope of ALM-SEC-015, ALM-SEC-018, ALM-SEC-019). ALM-SEC-001
through 014, 017, and 020–022 were **not** touched. ALM-SEC-019's PO-side
sibling (`reverseSupplierPayment`) was **not** touched, per the same reasoning
given in that finding's own record.

**Git safety checkpoints:** tag `pre-alm-sec-018-019-015b-fix-checkpoint`
created before any edit in this batch; local backup copies of
`quotation.controller.js`, `purchaseOrder.controller.js`, and
`invoice.controller.js` saved alongside it.

**Pre-fix inspection performed** (per instruction, before writing any code):
full re-read of `quotation.controller.js`'s `convertToInvoice`,
`purchaseOrder.controller.js`'s `createPO` and the already-fixed `receiveItems`
(the codebase's own prior fix for the same class of bug on the receiving side),
`invoice.controller.js`'s `reverseInvoicePayment` and the ALM-SEC-015 fix it
needed to stay consistent with, and `services/paymentReversal.js`'s shared
`postReversal`/`resolvePayment`/`assertReversible` (confirmed unchanged —
the fix lives entirely in each caller's own `applyDocumentUpdates` callback, not
in this shared function, so touching it was never necessary).

### Files changed (this batch)

- `backend/src/controllers/invoice.controller.js` — two changes: (1) extracted
  the ALM-SEC-015 atomic core into a new exported function,
  `commitInvoiceEffects()`, so `createInvoice` and `convertToInvoice` share one
  implementation instead of two; (2) rewrote `reverseInvoicePayment`'s
  `applyDocumentUpdates` callback (ALM-SEC-019).
- `backend/src/controllers/quotation.controller.js` — `convertToInvoice`
  rewritten to call the shared `commitInvoiceEffects()` inside its own
  `runAtomically()` block, plus an atomic claim on the quotation itself.
- `backend/src/controllers/purchaseOrder.controller.js` — `createPO` wrapped in
  `runAtomically()` with an atomic `$inc` on `supplier.payable` (ALM-SEC-018).
- `backend/src/controllers/product.controller.js` — **not touched** this batch
  (confirmed via `git diff --stat`; its modification date/diff is unchanged
  from the ALM-SEC-016 fix).

### ALM-SEC-015 (convertToInvoice) — remediation detail

**Root cause:** `convertToInvoice` was a second, independent implementation of
"commit an invoice's stock and receivable effects," using the identical
unsafe read-modify-write pattern `createInvoice` had before its own fix —
because it was a *different function*, the earlier, correctly-scoped
`createInvoice`-only fix never touched it.

**Remediation approach:** rather than writing a second copy of the fix (which
risks exactly this kind of drift happening again), the ALM-SEC-015 atomic core
was extracted out of `createInvoice` into a new shared, exported function —
`commitInvoiceEffects({ session, invoiceFields, customerId, balanceIncrease,
userId })` — living in `invoice.controller.js`. It performs: create the
`Invoice` document, atomically claim each line's stock (`findOneAndUpdate` with
a `stock: {$gte: quantity}` filter and `$inc`), atomically claim serial numbers
where applicable (with a verification re-read, exactly as before), write the
`StockMovement` audit record, and atomically bump the customer's balance — with
compensating rollback of everything already committed if the no-transaction
fallback path fails partway. `createInvoice` now calls this function instead of
containing the logic inline; `convertToInvoice` calls the exact same function.
The only conversion-specific addition is that `convertToInvoice` first
atomically claims the quotation itself (`status: {$ne: 'converted'}` in the
filter) before calling `commitInvoiceEffects()` — closing a second race the
original code also had: two concurrent conversion attempts of the *same*
quotation could both pass the `quote.status === 'converted'` pre-check and both
create an invoice from one quote. On the no-transaction fallback path, if
`commitInvoiceEffects()` fails after the quotation was already claimed, the
quotation's status is explicitly reverted so a failed attempt doesn't
permanently strand it as "converted" with no invoice behind it.

**Original failing concurrency result:** 10 quotations for the same
product/customer, converted concurrently — stock landed at 13 (not 10),
customer balance at 450 (not 500) — identical shape to the original
`createInvoice` evidence.

**Post-fix concurrency result:** same reproduction, re-run — 10/10 succeeded,
stock exactly 10, customer balance exactly 500, zero quotations left
`converted` without a linked invoice, exactly 10 invoices in the database.
**Bonus test** (not in the original reproduction, added because the fix made it
easy to also close): firing the *same* quotation's conversion twice
concurrently — exactly one wins (`200`), the other is cleanly rejected
(`400`, "Already converted"), and exactly one invoice exists.

**Database invariant verification:** `stock_before − sum(successful
quantities) == stock_after` — held exactly. `sum(succeeded invoice totals) ==
customer.balance increase` — held exactly (500 = 10×50).

**Rollback/failure-path verification:** re-confirmed the existing
insufficient-stock pre-flight rejection is untouched (still a clean `400`
before any write); the double-conversion race above is itself a live
demonstration of the rollback/claim-failure path working correctly (the loser's
attempt touches nothing).

### ALM-SEC-018 (createPO) — remediation detail

**Root cause:** `supplier.payable += total; await supplier.save();` — a
read-modify-write with no atomic operator, structurally identical to
ALM-SEC-015's original defect.

**Remediation approach:** `PurchaseOrder.create()` and the `Supplier.payable`
increment now run inside `runAtomically()`, with the increment expressed as a
plain atomic `Supplier.updateOne({_id}, {$inc: {payable: total}})` (no
conditional claim is needed here, unlike stock — there is no upper bound to
enforce on a payable increase). On the no-transaction fallback path, if the
`$inc` fails after the PO was already created, the orphaned `PurchaseOrder`
document is deleted.

**Original failing concurrency result:** 10 concurrent PO creations for one
supplier, each for 30 — all 10 real `PurchaseOrder` documents existed (summing
to 300), but `supplier.payable` landed at 30 (9 of 10 increments lost); the
app's own `reconciled: false` flag independently confirmed the drift.

**Post-fix concurrency result:** same reproduction, re-run — 10/10 succeeded,
`storedPayable` exactly 300, `totalPurchases` exactly 300, `reconciled: true`.

**Additional tests, all passing:** concurrent POs for three *different*
suppliers (9 concurrent requests, no cross-interference — each supplier's
payable landed at exactly the expected 60); sequential PO creation (payable
exactly 30 for a single 2×15 order); an invalid PO (nonexistent product,
`400`) left `supplier.payable` completely untouched, confirming no partial
state from a rejected request.

**Database invariant verification:** `sum(successful PO totals) ==
supplier.payable` — held exactly in every scenario tested.

### ALM-SEC-019 (payment/reversal race) — remediation detail

**Root cause:** `reverseInvoicePayment`'s `applyDocumentUpdates` callback
recomputed `invoice.paid`/`balance`/`status` from the in-memory `Invoice`
document read at the *start* of the request, then called a full-document
`invoice.save({session})` — which writes every field Mongoose considers
modified, including the entire `payments` array. A genuinely concurrent
payment's own (correctly atomic) update could commit in between, and this
full-document save would silently overwrite it.

**Remediation approach and a correction made during this fix, reported
transparently:** the first implementation attempted a single atomic
aggregation-pipeline `findOneAndUpdate` using a numeric array-index dotted path
(`payments.0.reversed`) to target the specific payment subdocument together
with the paid/balance/status recomputation. **Live testing caught that this
does not work correctly on this environment's MongoDB** — instead of indexing
into the array, it wrote a stray literal field named `"0"` into *every* payment
subdocument, corrupting the `payments` array structure (confirmed by directly
inspecting the raw stored document). This was caught by this fix's own
regression testing before being reported as complete, and was corrected before
any further testing: the update was split into two atomic steps run
sequentially — (1) a classic MongoDB update using `arrayFilters` to flip
exactly the one payment being reversed, identified by its unique ledger
transaction id (payment subdocuments have no `_id` of their own), guarded by
its own `reversed: false` so two concurrent reversals of the same payment
cannot both match; (2) a separate aggregation-pipeline update recomputing
`paid`/`balance`/`status` from the database's current value at write time —
untouched by the array-index limitation, since it doesn't address array
elements. On the no-transaction fallback path, if step 2 fails after step 1
succeeded, step 1 is explicitly reverted. The response now re-fetches the
invoice from the database before replying, instead of returning the stale
in-memory copy (matching the pattern `recordPayment` already uses for the same
reason).

**Original failing concurrency result:** invoice total 200, one 100 payment
already applied. A new 50 payment fired concurrently with a reversal of the
original 100 payment — both reported success, but final `paid` was 0, not the
expected 50 (the new payment's effect was silently discarded).

**Post-fix concurrency result (after the correction above):** same
reproduction, re-run — `paid` exactly 50, `balance` exactly 150, regardless of
which request's write physically landed first. The raw `payments` array was
directly inspected and confirmed clean (correct `reversed: true` with full
metadata on the reversed payment, no stray fields, no corruption). The sum of
non-reversed payment amounts in the array (50) matches the `paid` field exactly
— the two representations of "how much has been paid" agree.

**Additional tests, all passing:**
- Duplicate reversal protection: two concurrent reversal requests for the same
  payment — exactly one succeeds (`200`), the other is cleanly rejected
  (`409`), `paid` correctly returns to 0.
- Payment + payment (10 concurrent 10-unit payments against a 100 balance,
  unrelated to any reversal) — still lands at exactly 100 (re-confirms
  `applyInvoicePayment`'s existing atomic pattern is unaffected by this
  change).
- Reversal of one payment concurrent with a brand-new payment on the *same*
  invoice (a more complex four-way interaction: 100 paid, 50 paid, then
  concurrently reverse the 100 and pay a new 25) — final `paid` exactly 75
  (50 + 25, with the 100 correctly reversed out), matching the expected
  arithmetic exactly.
- Customer balance and the corresponding financial-ledger effects were each
  independently re-checked against the database and found consistent
  throughout every scenario above.

**Database invariant verification:** `sum(non-reversed payment amounts in
payments[]) == invoice.paid`, in every scenario tested, including the
four-way concurrent interaction. `customer.balance` reconciled with the
invoice's own `paid`/`balance` figures throughout.

### Regression testing (this batch)

Full existing suite: **318/318 passed** (no test file exists for quotations —
`convertToInvoice`'s correctness therefore rests entirely on the live
concurrency/regression testing recorded above, not on pre-existing automated
coverage). Additionally re-verified live this round: ALM-SEC-015's direct
`createInvoice` concurrency behavior (unaffected by the extraction into
`commitInvoiceEffects()` — re-run implicitly via the shared function, and the
full suite's 39 `invoice.controller.test.js` cases passing confirms no
behavioral drift), ALM-SEC-016's stock-adjustment concurrency (untouched this
batch, full suite re-confirms), sales-role permissions (PO creation correctly
still blocked for sales, still allowed for stock; payment reversal still
admin-only), stock-availability protection on quotation conversion (still
correctly rejects with no stock touched), PO totals, invoice totals
(2×15−5=25), supplier payable calculations, customer receivable calculations,
payments, payment reversals, stock-movement audit records (correct `type`/
`quantity`/`balanceAfter` for a converted quotation's stock movement), and
account/ledger balances.

### Did normal user behavior change?

**No**, in every case tested — identical response shapes, error messages,
validation behavior, and permissions for the ordinary non-concurrent case in
all three fixes. The only observable differences are: (a) concurrent requests
now produce correct results instead of silently wrong ones, and (b) two new,
narrower race windows were incidentally closed as a direct consequence of the
same restructuring — double-conversion of the same quotation, and double-
reversal of the same payment being caught one layer earlier/more robustly than
before (duplicate reversal was already blocked by the ledger's own
idempotency-key unique index; this fix adds a second, redundant-but-harmless
layer at the invoice-document level).

### Residual risks

- **ALM-SEC-019's PO-side sibling** (`purchaseOrder.controller.js`'s
  `reverseSupplierPayment`, using the same shared `postReversal` but its own,
  separate `applyDocumentUpdates` callback) was **not** touched and was never
  independently CONFIRMED (only HIGH-CONFIDENCE by code-shape). It remains
  open. This is the most important residual item from this batch to prioritize
  next if PO payment reversal sees real concurrent use.
- **ALM-SEC-017** (the concurrent credit-limit bypass) is unaffected by this
  batch — the credit-limit check in `createInvoice` still reads
  `customer.balance` before `commitInvoiceEffects()` runs, exactly as
  documented in ALM-SEC-017's own record. Not touched, as instructed.
- **`returnInvoice`'s own stock-restore and customer-balance read-modify-write
  patterns** (flagged HIGH-CONFIDENCE in §18.7.4) were not touched — they are a
  different function from `reverseInvoicePayment` and were outside this
  authorization's scope.
- The array-index-in-aggregation-pipeline limitation discovered while fixing
  ALM-SEC-019 is worth keeping in mind for any *future* fix in this codebase
  that might be tempted to use the same shortcut — the two-step
  (`arrayFilters` classic update + separate aggregation-pipeline update)
  technique used here is the version-safe pattern going forward.

**All three items in this batch: FIXED. Reproduced → remediated → retested,
per the required procedure, for each.**

---

## 18.9 Remediation record — ALM-SEC-008, ALM-SEC-009, ALM-SEC-011, ALM-SEC-003 (Batch 3)

Authorized scope for this batch: exactly these four findings. Medium/Low
findings explicitly deferred pending separate authorization. Git checkpoint:
tag `pre-alm-sec-008-009-011-003-fix-checkpoint`.

### ALM-SEC-008 — invoice line pricing / discount integrity

**Files changed:** `backend/src/controllers/invoice.controller.js` (new
export `resolveLinePricing`, wired into `createInvoice`'s per-item loop),
`backend/src/controllers/quotation.controller.js` (same function imported and
wired into `createQuotation`'s per-item loop, so quotations converted to
invoices inherit the same protection).

**Root cause:** `unitPrice`/`discount` submitted by the client were used
as-is for every role, with no server-side floor. A sales-role client could
submit any `unitPrice` (including below the product's own cost) or any
discount, and the server would honor it verbatim — confirmed exploitable
(`unitPrice=1` against a product with `purchasePrice=180` was accepted and
invoiced).

**Remediation:** `resolveLinePricing({role, product, quantity,
requestedUnitPrice, requestedDiscount})` is now the single point every
non-admin invoice/quotation line passes through. Admin submissions are
trusted unchanged (existing admin-authorized-pricing behavior preserved).
For non-admin roles, `unitPrice` and the effective per-line discount are
floored at `product.purchasePrice` (cost) — not forced to
`product.sellingPrice` — which blocks selling below cost while preserving
the pre-existing, deliberately-tested feature that sales can edit the cart
price at sale time (confirmed via an existing regression test that asserts
an edited price of 750 against a sellingPrice of 900 is honored — this
still passes because 750 is above that product's cost).

**Before/after reproduction:**
- Before: `unitPrice=1` (cost=180) → invoice created at the submitted price.
- After: same request → `400`, "Price ... is below cost (180) — an admin can
  authorize selling below cost if needed."
- Excessive discount (discount driving effective price below cost) → `400`
  with the computed maximum allowable discount for that line.
- Legitimate edited price/discount that stays at-or-above cost → accepted
  unchanged (matches pre-existing tested behavior).
- Admin role → unrestricted, unchanged.
- Quotation → convert-to-invoice path → same floor applied at quotation
  creation, so the protection isn't bypassable via that route.

**Database verification:** invoices created via both the exploit attempt
(rejected, no document written) and the legitimate edited-price case
(accepted, `invoice.lines[].unitPrice`/`discount` and computed totals
verified directly against the stored document) matched expectations in all
9 scripted scenarios.

**Regression results:** full suite green (see below); the specific
pre-existing "uses the edited cart price... does not change the Product
master price" test — which exercises exactly this sales-role edited-price
feature — passes.

**Normal user behavior changed?** Only for the specific case of a
non-admin submitting a price/discount that would sell below the product's
own cost — previously silently accepted, now rejected with a clear message
naming the floor and noting an admin can override. All other pricing
behavior (including the core "sales can edit price at sale time" feature)
is unchanged.

**Residual risks:** the floor is `purchasePrice` (cost), not
`sellingPrice` — a non-admin can still sell at any price between cost and
the submitted value, including well below the list `sellingPrice`, as
before. This was a deliberate design choice to preserve the existing
tested feature rather than an oversight; tightening further (e.g. capping
discount as a percentage of `sellingPrice`) was not in scope and would be a
business-policy decision, not a security fix.

### ALM-SEC-009 — duplicate-payment idempotency not used by the frontend

**Files changed:** `frontend/src/lib/idempotency.js` (new —
`newIdempotencyKey()`), `frontend/src/pages/InvoiceDetail.jsx`,
`frontend/src/pages/PurchaseOrderDetail.jsx`,
`frontend/src/pages/ReceivableDetail.jsx`,
`frontend/src/pages/PayableDetail.jsx`, `frontend/src/pages/POS.jsx`.

**Root cause:** the backend's idempotency-key duplicate-payment protection
already existed and worked correctly when exercised directly, but no
frontend payment surface ever sent an `idempotencyKey` — so in practice,
every real payment submission (double-click, retry, slow network) was
fully exposed to duplicate-payment risk despite the server-side mechanism
being sound.

**Remediation:** each of the 5 payment-submission surfaces now generates
one UUID-like key per logical payment attempt and sends it as
`idempotencyKey` in the payment POST body. Inline forms (InvoiceDetail,
PurchaseOrderDetail) rotate the key after a successful submission — same
key reused across retries of an unchanged attempt, fresh key for the next
genuinely new payment. Modal forms (ReceivableDetail, PayableDetail) rotate
on dialog-open, since each open represents a fresh intent. POS includes the
key in the `initialPayment` sub-object of the invoice-create payload (the
backend already accepted `initialPayment.idempotencyKey`; it was simply
unused).

**Before/after reproduction:**
- Rapid double-click (two concurrent identical requests, same key): exactly
  1 of 2 succeeds (`200`/`409`); invoice `paid` reflects one payment, not
  two.
- Identical sequential retry, same key: first `200`, retry `409`
  ("This payment has already been recorded (duplicate idempotency key)").
- Delayed network retry (partial payment, invoice stays open so the retry
  genuinely re-exercises the idempotency path rather than the
  already-settled-invoice check): first `200`, delayed retry `409`, `paid`
  unchanged by the retry.
- Different legitimate payments (different keys, same invoice): both
  succeed independently.
- Different invoices: independent, unaffected by each other's keys.

**Database verification:** for every duplicate-attempt scenario, exactly
one payment subdocument/ledger transaction exists and `invoice.paid` /
account balances reflect exactly one applied payment, confirmed by direct
document reads after each test.

**Regression results:** full suite green; a genuinely separate second
payment (distinct key) on the same invoice still succeeds, confirming
normal multi-installment payment UX is unaffected.

**Normal user behavior changed?** No visible change to the payment UX —
the key generation and rotation are invisible to the user. The only
behavioral change is that an accidental duplicate submission (double-click,
retry) now correctly no-ops instead of creating a second payment.

**Residual risks:** none identified for the covered surfaces. Any *future*
payment-submission UI added to the frontend must remember to generate and
send its own `idempotencyKey` — this is a per-call-site convention, not a
structural guarantee, so it's worth a code-review checklist item rather
than something this fix can enforce automatically.

### ALM-SEC-011 — spreadsheet numeric parsing silently corrupts input

**Files changed:** `backend/src/utils/excel.js` (`num()` rewritten),
`backend/src/utils/excel.test.js` (9 new permanent unit tests added).

**Root cause:** the old `num()` stripped every non-digit/non-decimal/
non-minus character (`String(v).replace(/[^0-9.\-]/g, '')`) before parsing.
This silently turned `"abc123"` into `123` (a real, wrong, plausible-looking
number) and mangled scientific notation (`"1.5e3"` → `"1.53"` after
stripping the `e`).

**Remediation:** `num()` now tries a direct, strict numeric-pattern match
first (which correctly accepts scientific notation, e.g. `1.5e3` → `1500`),
and only then falls back to stripping a narrow, explicit allowlist of
recognized currency tokens (`rs`, `pkr`, `usd`, `inr`, `$`, `£`, `€`, `₹`)
and thousands-commas — never a blanket "strip everything that isn't a
digit" pass. Anything that still doesn't match a strict numeric pattern
after that narrow cleanup returns `NaN` (rejected by the existing
validation-error path at commit), rather than silently becoming a
different valid number. Confirmed via `grep` that `num()` is reachable only
from `services/importers.js`'s `prepare()` (used by
`validateImport`/`commitImport`), never from `parseImportFile` — the
permissive draft/preview stage is untouched.

**Before/after reproduction (21 hand-verified cases, 9 now permanent unit
tests):**
- `"1.5e3"` → before: `1.53` (wrong) → after: `1500` (correct).
- `"abc123"` → before: `123` (wrong, silent) → after: `NaN` (rejected).
- `"Rs. 1,500"` → `1500` (unchanged, still supported).
- `"$1,234.56"` → `1234.56` (unchanged, still supported).
- `"NaN"`, `"Infinity"`, empty/null/undefined, plain numbers, negatives,
  zero, leading-dot decimals, whitespace, Unicode — all match hand-checked
  expectations; none silently produce a wrong-but-plausible number.

**Database verification:** not applicable directly (parsing-only change);
verified instead via the commit-stage validation path, which correctly
surfaces the new `NaN` results as import validation errors rather than
writing garbled numeric data.

**Regression results:** `npx vitest run src/utils/excel.test.js` —
25/25 passed (16 pre-existing + 9 new). Full suite green.

**Normal user behavior changed?** No change to the draft/preview stage
(still fully permissive, per the required workflow). At commit, numeric
cells that were previously silently corrupted into a wrong number are now
correctly rejected with a validation error instead — this is a behavior
change only for already-malformed input that was previously mishandled,
not for any correctly-formatted value.

**Residual risks:** the currency-token allowlist is fixed (`rs`, `pkr`,
`usd`, `inr` plus 4 symbols) — a spreadsheet using an unlisted currency
prefix would have that token rejected as non-numeric rather than stripped,
which is the intentionally conservative (safe) failure mode, but worth
knowing if a new currency needs to be supported later.

### ALM-SEC-003 — stale JWTs remain valid after password change

**Files changed:** `backend/src/models/User.js` (new `tokenVersion` field,
`pre('save')` hook increments it on password change),
`backend/src/controllers/auth.controller.js` (`sign()` now embeds
`tokenVersion` in the JWT payload), `backend/src/middleware/auth.js`
(`protect` now rejects a token whose `tokenVersion` doesn't match the
user's current value).

**Root cause:** no revocation mechanism existed at all — a JWT remained
valid for its full expiry regardless of any password change in the
meantime. A first remediation attempt (a `passwordChangedAt` timestamp
compared against the JWT's `iat` claim) was implemented, then **disproved
by its own required retest**: `iat` has only whole-second resolution, and a
login followed immediately by a password change within the same
wall-clock second produced tokens the timestamp comparison could not tell
apart — the required Step 4 check failed live (old tokens still returned
`200` after the password change).

**Remediation:** replaced the timestamp approach with an integer
`tokenVersion` counter on `User`, incremented in the existing shared
`pre('save')` password-hashing hook (the one place every password-change
path — self-service `changePassword` and admin-driven `updateUser` — already
goes through). Every freshly-signed JWT embeds the user's `tokenVersion` at
the exact moment of signing (read fresh from the database), so there is no
timing-resolution ambiguity: `protect` rejects any token whose embedded
`tokenVersion` doesn't exactly equal the user's current value, with the
same 401 message already used for expired/tampered tokens. Defaults to `0`
so already-issued tokens keep working until the next real password change
— no retroactive logout on deploy.

**Before/after reproduction — full required 10-step test
(`retest_003.mjs`), against the corrected implementation:**
```
Step 1  Login → token A: PASS
Step 2  Login → token B (second session): PASS
Step 3  Change password via token A: PASS (200)
Step 4  Token A after change: 401 PASS: rejected
        Token B after change: 401 PASS: rejected
Step 5  Login with new password: PASS (200)
Step 6  New token (C) works: PASS (200)
Step 7  Old password rejected: PASS (401)
Step 8  Unrelated user's session unaffected: PASS (200)
Step 9  Deactivation still enforced: PASS (401)
Step 10 Tampered / garbage JWT still rejected: PASS (401 / 401)
```
Step 4 is the step that failed under the first (timestamp) implementation
and now passes under the tokenVersion implementation. Additionally verified
the admin-driven password-reset path (`updateUser`) independently triggers
the same revocation (pre-reset token rejected after an admin resets another
user's password, new login works) — confirming both password-change entry
points funnel through the same `pre('save')` hook correctly.

**Database verification:** `User.tokenVersion` confirmed incrementing by
exactly 1 per password change (self-service and admin-reset paths both
checked directly).

**Regression results:** full suite green (327/327 — see below).

**Normal user behavior changed?** Only in the intended way: a session whose
password was changed elsewhere is now correctly logged out instead of
remaining silently valid. Login, token expiry, deactivation, and
malformed-token handling are all unchanged.

**Residual risks:** revocation only fires on a password change — there is
still no general-purpose "log out all sessions" or per-session revocation
mechanism (e.g. logging out one specific device without changing the
password), which was outside this finding's scope. `JWT_EXPIRES_IN` (12h
default) remains the outer bound for any token this mechanism doesn't
otherwise invalidate.

### Regression requirements — full results

**Full automated suite:** `npx vitest run` → **327/327 passed** (23 test
files; the 318-test pre-batch-3 baseline plus the 9 new ALM-SEC-011 unit
tests), zero failures, zero regressions.

**Concurrency re-checks (explicitly required, re-run live against the
isolated test environment after all four fixes landed):**
- `createInvoice` (ALM-SEC-015/016 scope): 10 concurrent invoices of qty 2
  against stock of 10 → exactly 5 succeed, final stock 0 (never negative).
  PASS.
- `adjustStock` (ALM-SEC-016): 20 concurrent +5 adjustments from stock 0 →
  final stock exactly 100. PASS.
- `convertToInvoice` (ALM-SEC-015 scope): 5 concurrent converts of the same
  quotation → exactly 1 succeeds, final stock 0 (not negative). PASS.
- `createPO` (ALM-SEC-018): 10 concurrent POs of cost 50 → supplier
  `payable` exactly 500 (not corrupted/lost). PASS.
- Payment reversal (ALM-SEC-019): 5 concurrent reversal attempts of the
  same payment → exactly 1 succeeds (`200`), 4 correctly rejected (`409`),
  invoice `paid` correctly returns to 0. PASS.

**Conclusion: no regression to ALM-SEC-015, 016, 018, or 019.**

**Test environment teardown:** isolated `mongodb-memory-server` and backend
test instances stopped; `backend/start-mongo-sec.mjs` deleted, per the
established pattern — no changes made to the developer's real local dev
database or production.

**All four items in this batch: FIXED. Reproduced → remediated → retested,
per the required procedure, for each.**

---

## 19. Phase 10 — Security Configuration Assessment

Largely consolidates findings already made and live-tested in Phases 1, 2, 6 and
7, plus a small number of new checks specific to this phase.

**Environment/config handling:** `.env` correctly gitignored and never committed
(re-confirmed via a fresh full-history grep this phase — only placeholder/template
text like `<the 96-character string you just generated>` and `xxxxx` appears
anywhere in history, never a real value). Production startup fails closed if
`JWT_SECRET`/`MONGO_URI`/`CORS_ORIGIN` are missing (Phase 1/2). `NODE_ENV`-gated
stack-trace suppression re-confirmed correct (Phase 1/2/7).

**CORS:** proper origin allowlist, live-tested in Phase 7 — an unauthorized
origin receives no `Access-Control-Allow-Origin` header at all.

**Security headers:** absent (ALM-SEC-014, Phase 7) — not re-litigated here.

**New checks this phase:**
- **`trust proxy` is not configured** (Express default: `false`). Currently
  **not** a live vulnerability — no code in this application reads `req.ip` or
  otherwise depends on the client's real IP for any security decision (there is
  no rate-limiting implemented yet to be fooled by a spoofed
  `X-Forwarded-For`). Recorded as **INFORMATIONAL / forward-looking**: if
  ALM-SEC-002's recommended IP-based rate-limiting is implemented later behind
  Hostinger's/Vercel's proxy without also setting `app.set('trust proxy', ...)`
  correctly, the rate limiter would key off the proxy's IP instead of the real
  client's, defeating it. Not a current issue; a specific thing to get right
  *when* that fix is made.
- **Cookie configuration:** not applicable — confirmed again (Phase 2/7) that no
  cookie-based session exists anywhere in the stack.
- **HTTPS assumptions:** cannot be tested from this environment (no access to the
  production TLS termination/Hostinger configuration). The application layer
  itself has no HTTP-only logic that would break under HTTPS; whether HSTS is
  set and whether HTTP is actually redirected to HTTPS is a hosting-platform
  configuration question outside this codebase's control, and outside what this
  assessment can observe.
- **Exposed internal endpoints:** re-confirmed via the Phase 3 exhaustive route
  inventory (17 routers, no hidden/debug/backdoor routes) — not re-swept, no
  code has changed in the routing layer since.

## 20. Phase 11 — Dependency Security Assessment

**Backend production dependencies** (`npm audit --omit=dev`): **7 moderate**
severity advisories, all transitive:

| Package | Severity | Advisory | Reachable via | Fix available |
|---|---|---|---|---|
| `qs` | Moderate | DoS via crafted input to `qs.stringify`/array-limit bypass | transitive dep of `express` | Yes, non-breaking |
| `express` | Moderate | Depends on vulnerable `qs` | direct dependency | Yes, non-breaking |
| `body-parser` | Moderate | DoS — an invalid `limit` value can silently disable body-size enforcement | transitive dep of `express` | Yes, non-breaking |
| `mongoose` | Moderate | Prototype pollution via a `__proto__`-prefixed **dotted path string** used as an update/schema path (distinct mechanism from the `__proto__`-as-JSON-key vector already tested and found safe in Phase 7) | direct dependency | Yes, non-breaking |
| `morgan` | Moderate | Log forging via unneutralized control characters/Unicode line separators | direct dependency, **dev-only** (`NODE_ENV !== 'production'` gate, already confirmed Phase 1) | Yes, non-breaking |
| `uuid` | Moderate | Missing buffer bounds check (v3/v5/v6, when a buffer is explicitly supplied — not this app's usage pattern) | transitive dep of `exceljs` | Only via a breaking `exceljs` downgrade to 3.4.0 |
| `exceljs` | Moderate | Depends on vulnerable `uuid` | direct dependency (import/export) | Only via a breaking downgrade |

*Exploitability assessment (not assumed from the advisory alone):*
- **`mongoose`'s prototype-pollution advisory is worth flagging precisely**: it is
  a *different* mechanism from the `__proto__`-as-a-JSON-body-key vector already
  live-tested and found non-exploitable in Phase 7 (Node's `JSON.parse` treats
  `__proto__` as a harmless own key, not a prototype-chain write). This advisory
  concerns a **dotted-path string** (e.g. `"__proto__.x"`) passed as a Mongoose
  *update or schema path*. This assessment did not find any controller that
  constructs a Mongoose update/path from a user-controlled string key
  (every `$set`/`$inc` target field found in this codebase's controllers is a
  fixed, hardcoded field name — confirmed by the same controller-by-controller
  review performed for the RMW sweep above) — so while the vulnerable code is
  present in the installed dependency, **no exploitable code path was found in
  ALM Suite's own usage of it**. Recorded as dependency-CONFIRMED-present /
  application-exploitability-NOT-CONFIRMED (assessed unlikely, not exhaustively
  disproven).
- `morgan`'s log-forging advisory only matters where morgan actually runs — dev
  only, already gated.
- `body-parser`'s DoS advisory and `qs`'s advisories are general hardening
  items; nothing in this assessment found a specific exploited path, but a
  version bump closes them at effectively zero behavioral risk (`npm audit fix`,
  non-breaking, per npm's own report).
- `uuid`'s advisory requires the *caller* to explicitly supply a buffer to write
  into — `exceljs`'s own internal usage (the only place this app touches `uuid`)
  was not confirmed to do this; fixing it requires a breaking `exceljs`
  downgrade, which is a real trade-off to weigh, not a free fix.

**Frontend production dependencies:** **2 high, 3 moderate**, all transitive:

| Package | Severity | Advisory | Reachable via |
|---|---|---|---|
| `axios` | High | Multiple: prototype pollution in auth/proxy handling, DoS via recursive form serialization, `maxBodyLength` bypass on streamed/fetch uploads, `NO_PROXY` bypass | direct dependency — used only to call ALM Suite's own fixed, known API endpoints; never used to construct requests to attacker-influenced URLs or with attacker-controlled option objects |
| `form-data` | High | CRLF injection via unescaped multipart field names/filenames | transitive dep of `axios` — the only multipart usage in this app (`ImportExport.jsx`'s file upload) uses a hardcoded field name (`'file'`); the filename comes from the browser's own file picker for the *current* user's own upload, not an attacker-supplied value being sent *to* a third party |
| `react-router` / `react-router-dom` / `@remix-run/router` | Moderate | Open-redirect / SSR-hydration-related advisories | direct dependencies — re-confirms Phase 7's "no open redirect in application code" finding is about *this app's own code*; the underlying **library** does carry known CVEs. This app's routes are 100% static/hardcoded (re-confirmed via the Phase 1 route table) with no dynamic `to`/`redirect` prop built from user input anywhere found, so the specific exploitable pattern (a user-controlled redirect target) was not found to be reachable here. |

*Overall Phase 11 assessment:* every advisory found is either (a) fixable with a
non-breaking `npm audit fix`, or (b) requires a breaking dependency downgrade
whose trade-off should be a deliberate decision, not an automatic one. **None of
the 12 advisories across both packages was confirmed exploitable within ALM
Suite's actual code paths** — each was individually checked against how this
specific application uses the affected library, not assumed vulnerable from the
advisory title alone, per instruction. Recommended action (not performed, no
remediation authorized): run `npm audit fix` (non-breaking) in both `backend/`
and `frontend/` as a routine hardening pass; treat the `exceljs`/`uuid` breaking
downgrade as a separate, deliberate decision.

## 21. Phase 12 — Secrets Review

Re-confirms Phase 1/2's findings with a fresh full-history scan this phase — no
new results.

- **No real secret was found committed anywhere in git history** — every match
  for `JWT_SECRET=`, `mongodb+srv://`, or similar patterns across the entire
  history is placeholder/template text (`<the 96-character string you just
  generated>`, `<password>`, `cluster0.xxxxx.mongodb.net`,
  `a-very-long-random-string-at-least-32-chars`), never a real value.
- `.env` is correctly gitignored (`backend/.gitignore` / root `.gitignore`,
  re-confirmed).
- `ALM-SEC-005` (Phase 2) remains the relevant open item here: no code-level
  safeguard prevents production from starting with the *documented example*
  `JWT_SECRET` value if an operator fails to rotate it — not re-tested this
  phase (no code has changed relevant to it), carried forward unchanged.
- No API keys, cloud credentials, or third-party service credentials exist
  anywhere in this codebase to leak — consistent with Phase 1's finding that
  ALM Suite has zero external API integrations.

**Redacted example, for illustration of the scan methodology used (not a real
finding, since nothing was found):** a genuine committed secret, had one been
found, would have been reported here as `JWT_SECRET=abcd********wxyz` — first/
last few characters only, never the full value. No such value exists in this
codebase.

## 22. Phase 13 — Logging & Audit Trail Assessment

**Activity model schema** (`backend/src/models/Activity.js`):
`user, userName, action, entity, entityId, meta (free-form), createdAt/updatedAt`.
Captures actor, action, target entity, and timestamp for every event it's
invoked on. `meta` is a free-form field used inconsistently — some actions
attach useful context (e.g. `stock_adjusted` includes the requested quantity and
note), most simply record that a change happened.

**Tamper-resistance:** re-confirmed via the Phase 3 route inventory — `GET
/api/activity` is the *only* route on this router (admin-only); there is no
`PATCH`/`DELETE`/`PUT` route for Activity records anywhere in the codebase. No
role, including admin, has any API path to edit or delete an existing audit
entry. This is a genuine strength, not merely an absence of a bad thing found —
the log is append-only by construction, not by policy alone.

**Coverage swept against the master plan's explicit checklist** (login, failed
login, user creation, role changes, product/price modification, stock
adjustment, sale creation/modification/deletion, purchase creation/modification/
deletion, payments, expenses, receivables/payables, account changes, imports):

---
**ALM-SEC-021 — Authentication events (successful and failed logins) are not recorded in the audit trail**
**Severity:** LOW–MEDIUM &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp;
**CWE-778 (Insufficient Logging)**
**Component:** `backend/src/controllers/auth.controller.js`, `login` — no
`logActivity()` call exists anywhere in this function, for either the success or
failure path. The *only* auth-related audit entry produced anywhere is
`password_changed`.
**Affected endpoint:** `POST /api/auth/login`

*Confirmed by:* direct grep — `logActivity` appears exactly once in
`auth.controller.js`, on the `changePassword` handler, not `login`.
*Security/business impact:* combined with ALM-SEC-002 (no rate limiting) and
ALM-SEC-001 (the login timing side-channel), there is currently **no forensic
record at all** of brute-force attempts, credential-stuffing attempts, or even
which admin/sales/stock account actually logged in and when — a real gap for
incident investigation if an account is ever suspected compromised.
*Recommended remediation:* add `logActivity(req, 'login_succeeded', {...})` on
success and a lightweight, non-blocking record (mindful of not itself becoming a
performance/storage burden under the exact brute-force scenario ALM-SEC-002
already flags) for repeated failures — e.g. logged at the account level on
failure, or rate-aware to avoid the log itself becoming an amplification
vector.
*Status:* OPEN — not authorized for remediation in this pass.

---
**ALM-SEC-022 — Most entity-update audit entries record that a change happened but not what changed**
**Severity:** LOW &nbsp;|&nbsp; **Confidence:** CONFIRMED &nbsp;|&nbsp;
**CWE-778 (Insufficient Logging)**
**Component:** widespread — e.g. `product.controller.js`'s `updateProduct`
(`logActivity(req, 'product_updated', {entity:'Product', entityId})`),
`customer.controller.js`'s `updateCustomer`, `supplier.controller.js`'s
`updateSupplier`, and others of the same shape — none capture old/new field
values.
**Affected endpoints:** `PATCH /products/:id`, `PATCH /customers/:id`, `PATCH
/suppliers/:id`, and others following the same pattern

*Confirmed by:* direct source inspection of every `logActivity('*_updated', ...)`
call site — `meta` is omitted or contains only identifiers, never a before/after
diff, for the update-family of actions specifically (contrast with e.g.
`stock_adjusted`, which does record the requested quantity, or `payment_reversed`,
which records the amount and reason).
*ERP/business impact:* if a product's price is fraudulently altered (relevant
context: ALM-SEC-008's confirmed price-manipulation finding), the audit trail
would show *that* the product was updated and by whom, but not *what* the
price changed from or to — meaningfully limiting after-the-fact investigation of
exactly the kind of abuse this assessment is most concerned with.
*Recommended remediation:* for update-family activity log entries on
financially/operationally significant fields (price, cost, credit limit, role,
active status), capture a before/after diff in `meta`, mirroring the level of
detail already present for `stock_adjusted`/`payment_reversed`/reversal-family
events.
*Status:* OPEN — not authorized for remediation in this pass.

**Tested and PASSED:**

| Area | Result |
|---|---|
| User creation, role changes, deactivation | Logged (`user_created`, `user_updated`, `user_deactivated`) with actor/target/timestamp |
| Stock adjustment | Logged with the requested quantity and note |
| Sale (invoice) creation | Logged with number, total, customer name |
| Payment recording and reversal | Logged with amount, method/reason, and the linked ledger transaction id |
| Imports | Logged (`data_imported`) with type and created/updated/failed counts |
| Password changes | Logged |
| Audit log tamper-resistance | Append-only by construction — no edit/delete route exists for any role, including admin |

## 23. Consolidated risk classification note

Per instruction, no severity above was inflated merely because a defensive
library or header was absent (ALM-SEC-014's clickjacking finding remains scored
LOW precisely because the full exploit chain wasn't demonstrated; the dependency
findings in Phase 11 are scored by confirmed advisory severity but explicitly
annotated with this application's actual exploitability assessment rather than
assumed at face value).
