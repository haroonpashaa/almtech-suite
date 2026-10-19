# ALMTech ERP — System Documentation

This reference describes the current ALMTech Suite repository and the deal, product, invoice, account-ledger, and payable changes in this branch. It reflects the code, not a verified production deployment.

## Architecture

- **Frontend:** React 18, Vite, React Router, TanStack Query, Tailwind, Axios. Pages live under `frontend/src/pages`; shared UI is under `frontend/src/components`.
- **Backend:** Node.js 20+, Express, Mongoose, JWT authentication. `backend/src/app.js` mounts the API routers; `backend/src/server.js` validates configuration, connects to MongoDB, seeds/configures startup data, and listens.
- **Database:** MongoDB. Mongoose models are in `backend/src/models`. References to the newly introduced `Deal` are optional on existing Invoice, PurchaseOrder, and Expense documents; existing documents are not rewritten or assigned to deals.
- **Financial posting:** `backend/src/utils/ledger.js` owns account transaction posting, account balance increments, idempotency, transaction support detection, and compensating rollback where MongoDB transactions are unavailable.
- **Deployment:** the repository is configured for a single Node process and Hostinger. The connected production branch is `main`; changes in this branch have not been pushed or deployed.

## Modules and main workflows

| Area | Frontend | API / backend |
|---|---|---|
| Products and stock | `Products.jsx`, `ProductSummary.jsx`, `ProductForm.jsx` | `product.routes.js`, `product.controller.js`, `Product.js`, `StockMovement.js` |
| POS and invoices | `POS.jsx`, `Invoices.jsx`, `InvoiceDetail.jsx` | `invoice.routes.js`, `invoice.controller.js`, `Invoice.js` |
| Purchase orders | `PurchaseOrders.jsx`, `PurchaseOrderForm.jsx`, `PurchaseOrderDetail.jsx` | `purchaseOrder.routes.js`, `purchaseOrder.controller.js`, `PurchaseOrder.js` |
| Accounts and ledger | `Accounts.jsx`, `AccountLedger.jsx` | `account.routes.js`, `account.controller.js`, `Account.js`, `FinancialTransaction.js` |
| Expenses | `Expenses.jsx` | `expense.routes.js`, `expense.controller.js`, `Expense.js` |
| Supplier payables | `Payables.jsx`, `PayableDetail.jsx` | `finance.routes.js`, `finance.controller.js`, `Supplier.js`, `OpeningBalance.js` |
| Deal accounting | `Deals.jsx`, `DealAccounts.jsx`, `DealDetail.jsx` | `deal.routes.js`, `dealAccounts.controller.js`, `deal.controller.js`, `Deal.js` |
| Reports and settings | `Reports.jsx`, `Settings.jsx` | `report.controller.js`, `settings.controller.js`, `Settings.js` |

Sales create invoices through POS; invoices preserve sale-time product/model/price/cost snapshots and can record payments against a selected account. Stock creates purchase orders and receives inventory. Admins manage accounts, correct supplier payables, view account and deal financials, and can explicitly group eligible existing records under a deal. Expenses post to an account immediately; voiding preserves the original and records a reversal.

The Purchase Orders list filters by PO number, status, supplier (Admin/Stock), and ordered date range. Select All covers the current filtered page of at most 50 visible rows; changing a filter or page clears selection. There are no bulk PO mutation actions in the current application.

## Roles and financial permissions

Authentication uses JWT and `protect` middleware. `requireRole` checks permissions on the API as well as in the UI.

- **Admin:** account creation/edit/deactivation and ledger access; manual account adjustments; supplier payable corrections; deal creation, summaries, and record linking; finance reports; reversal/void actions.
- **Sales:** allowed invoice and expense workflows and selection of an open deal while creating records. Does not receive product purchase cost or restricted product comments from the product API.
- **Stock:** allowed product and purchase-order workflows and selection of an open deal while creating purchase orders.

Account balances and account-ledger adjustments are admin-only. The `GET /api/deals/records/options` endpoint exposes open deal identifiers and descriptions to authenticated staff so they can associate permitted new records; deal totals and linking existing records remain admin-only.

## Database models and relationships

- **Product:** catalogue identity, hardware specifications, prices, stock, serials, and active state. Product summary combines this stored record with stock movements and invoice snapshots; it stores no duplicate sales summary.
- **Invoice:** customer, line-item snapshots, totals, payments, and optional `deal` reference. A line records model and unit cost at sale time.
- **PurchaseOrder:** supplier, ordered/received lines, totals, payments, and optional `deal` reference.
- **Account:** type, opening and current balance, active flag, and bank metadata. Types include `cash`, `bank`, `other_bank`, `wallet`, and `other`.
- **FinancialTransaction:** immutable money movement with account, amount, direction, type, description/reference, timestamp, source references, creator, and optional idempotency key.
- **Expense:** categorized posted/voided expense tied to an account, ledger movement, creator, and optional deal. Categories include Customs, Duty, and Shipping for deal-cost classification.
- **OpeningBalance:** audit record for imported opening amounts and supplier payable corrections; it is not a cash movement.
- **Deal:** unique case-insensitive identifier, optional description, status, creator, and timestamps. Invoice, PurchaseOrder, and Expense can each point to at most one deal. The association is optional, and no historical record is assigned automatically.
- **Activity:** actor, event, entity, metadata, and timestamp for business actions.

## Financial calculations and safeguards

### Account ledger

`currentBalance = openingBalance + sum(inbound transactions) - sum(outbound transactions)`. New manual adjustments use type `ledger_adjustment` and post a new transaction through the shared ledger utility. A reason becomes the transaction description; the utility records the creator and timestamp and moves the account balance. Existing transactions are not edited. An idempotency key prevents duplicate retries. Account deactivation retains ledger history and prevents new payments from using the inactive account.

### Supplier payables

Operational outstanding payables derive from open purchase orders and opening payable balances. Supplier-level correction is a distinct, admin-only action: the submitted corrected total is compared with the stored supplier balance, and the delta is recorded as an `OpeningBalance` adjustment with a required reason and actor. Editing an eligible unpaid/unreceived purchase order continues to change its own totals and adjusts the supplier payable by the corresponding delta. The UI identifies supplier-level correction separately.

Legacy currency-less financial records remain PKR; no data migration relabels them. New accounts, payable POs, supplier opening adjustments and account ledger transactions retain a `GBP` or `PKR` currency. Customer receivables and general sales/expense reports still have single-currency assumptions, so the application setting is constrained to PKR, new sales invoices are PKR-only, GBP expense posting is rejected, and general summary/report endpoints return PKR-only totals. GBP purchase-order receiving is disabled until inventory purchase costs can retain a currency. Supplier balances use two separate buckets: `Supplier.payable` is the legacy PKR bucket and `Supplier.payableGBP` is the GBP bucket. Account ledger entries must match their account currency. PO payments must match the PO currency; cross-currency settlement is rejected and no implicit FX posting is supported.

Each new PO and supplier payable correction stores an immutable FX snapshot for display: original amount/currency, equivalent amount/currency, rate, provider effective time, fetched time, validity time and source identifier. PO financial edits append a snapshot and preserve older snapshots. Current equivalents can be refreshed for display without changing payable/payment records. Legacy records without snapshots remain valid and show an unavailable historical equivalent.

Current display quotes use the ExchangeRate-API Standard endpoint (`GET https://v6.exchangerate-api.com/v6/latest/{BASE}` with `Authorization: Bearer <key>`), using its indicative midpoint for GBP/PKR display only. The backend reads `EXCHANGE_RATE_API_KEY` from its process environment and sends it using the provider-supported bearer header so the secret is not embedded in the request URL; never add it to frontend variables (for example `VITE_*`), source control, logs, or API responses. For local use, create `backend/.env` from `backend/.env.example` and set the key there when starting the API with `backend` as its working directory. If the API is started with the repository root as its working directory, set the key in that process’s root `.env` instead. For Hostinger, add `EXCHANGE_RATE_API_KEY` as a secret environment variable in the backend Node.js application settings, then restart/redeploy that backend process after configuration; do not put it in frontend build variables. The selected free plan requires a key, allows 1,500 requests/month and updates daily; confirm current account limits with the provider. API responses supply the last and next update timestamps. Each server process caches a valid rate only until the provider's next-update time and coalesces concurrent requests for the same base currency. Missing configuration, provider errors, invalid responses or expired data produce an unavailable error; the system does not invent or silently reuse an expired rate. Displayed conversions round to two decimal places. This quote is not a settlement rate: payments remain in the original payable currency.

PO financial edits change its line quantities, unit costs, supplier, or tax and recalculate the total; the controller applies the total delta to the supplier payable. This is allowed only when no payment has been posted and the PO is not fully received; costs on already-received lines and received quantities are protected. Supplier-level corrections are a separate audited workflow. There is no standalone direct edit of a PO's payable balance.

### Deal accounting

- **Revenue:** sum of `Invoice.items.lineTotal` for linked invoices excluding draft, cancelled, and returned invoices.
- **Cost of goods sold:** sum of linked invoice-line `quantity × unitCost`, using the same sale-time cost snapshot logic as the existing P&L.
- **Purchase costs:** totals of linked non-draft, non-cancelled purchase orders. Reported separately for visibility; they are not deducted a second time because the existing gross-profit method uses sale-line cost snapshots and a linked PO may represent the same goods.
- **Gross profit:** `revenue − cost of goods sold`.
- **Other expenses:** amounts of linked posted expenses only. Voided expense records remain visible in deal history but do not count.
- **Net profit:** `gross profit − other expenses`.

Deal totals are kept in explicit currency buckets. Historical invoices/POs/expenses without a currency are treated as PKR. The existing single-value compatibility totals are PKR only; GBP totals are available under `totals.totalsByCurrency.GBP`. Revenue, cost of goods sold and gross/net profit are calculated within the invoice/expense currency bucket, so values in different currencies are never added together. Purchase costs remain shown separately from gross-profit cost of goods sold.

Each invoice, PO, or expense can link to one deal. Existing records are linked only by an explicit admin action; the activity log captures link/unlink actions. Linking does not alter the document’s amount, payment history, account ledger, stock, or supplier/customer balance. Unlinking removes only the association.

## Main API paths

- Products: `GET /api/products/:id/summary`; product list and details remain under `/api/products`.
- Invoices: `GET /api/invoices?product=<productId>&model=<snapshot text>`; both filters can be combined and must match the same invoice line. POS accepts `dealId` for an open deal and accepts a validated rectangular multi-cell spreadsheet paste into consecutive prices in row-major order.
- Purchase orders: `GET /api/purchase-orders?search=<number>&status=<status>&supplier=<supplierId>&from=<date>&to=<date>` supports list filters while retaining paged totals.
- Accounts: `POST /api/accounts/:id/adjustments` accepts a positive amount, `in`/`out` direction, reason, and idempotency key. Admin-only.
- Deals: `GET /api/deals/records/options` for open identifiers; admin-only `GET/POST /api/deals/records`, `GET /api/deals/records/:id`, `POST /api/deals/records/:id/link`, and `DELETE /api/deals/records/:id/links/:type/:recordId`.
- Purchase orders and expenses accept optional `dealId` on creation. Invoices also accept optional `dealId`.
- Supplier payable correction: existing admin endpoint `POST /api/finance/payables/:id/adjust`; supplier payment remains a separate purchase-order payment flow.
- Current display quote: admin-only `GET /api/finance/exchange-rate?from=GBP&to=PKR` (or the reverse); requires backend `EXCHANGE_RATE_API_KEY`.

## Setup and deployment

1. Install Node.js 20 or newer and MongoDB (or configure a hosted MongoDB connection).
2. Configure backend environment variables. `JWT_SECRET` is required; production also requires `MONGO_URI` (or supported equivalent), `CORS_ORIGIN`, and `NODE_ENV=production`. Use bootstrap admin variables only for first production startup and remove them afterward.
3. Install backend dependencies in `backend` and frontend dependencies in `frontend`.
4. Run `npm run dev` from the repository root for local development. To build the frontend, run `npm run build` at the root or `npm run build` in `frontend`. Start the Node API/server with `npm start` at the root. For exchange-rate-dependent payable creation/edits, configure the backend-only `EXCHANGE_RATE_API_KEY` as described above; without it, operations requiring a new snapshot fail clearly while existing snapshots remain viewable.
5. For Hostinger, configure environment variables in the hosting panel and let the configured deployment process build and start the app. Do not use a push to `main` as a staging test: it triggers the connected production deployment.

Refer to `README.md` and `HOSTINGER_DEPLOY.md` for the complete environment-variable table and deployment-specific setup. No deployment was performed for this branch.

## Testing and maintenance

- Backend suite: `cd backend && npm test`.
- Frontend suite: `cd frontend && npm test`.
- Frontend production build: `cd frontend && npm run build`.
- Keep transaction corrections auditable; use reversals or new adjustment entries rather than changing historical monetary rows.
- Keep regular MongoDB backups and verify the database health endpoint after any release. Reconcile account current balances against their ledger-derived values and investigate any reported drift.
- When adding a currency or financial field, update transaction posting, payment allocation, reports, exports, and tests together; do not infer an exchange rate from the global display setting.
