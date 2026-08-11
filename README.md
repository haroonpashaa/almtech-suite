# ALMTech Full Business Suite

A MERN stack business management system purpose-built for ALMTech's computer wholesale operations, covering the 9 modules described in `Full Business Suite Proposal.pdf`:

1. **Authentication & Access Control** — JWT login, three roles (admin / sales / stock), activity log
2. **Inventory & Product Management** — catalog, stock, serial numbers, low-stock alerts, Excel import
3. **POS & Sales** — invoices, partial payments, returns, branded PDF invoices, auto stock deduction
4. **Purchase Order Management** — orders, partial receipts, supplier payments
5. **Supplier Management** — _standalone module removed;_ supplier records are retained and drive purchase orders, payables and supplier payments. Payables now has its own module (see 9).
6. **Customer Management (CRM)** — profiles, credit limits, statements, customer ledger
7. **Financial Accounts & Payments** — cash/bank accounts, per-account ledger, every payment posted to an account
8. **Expense Management** — categorised expenses paid from an account, daily/monthly reports, void-and-reverse corrections
9. **Receivables & Payables** — who owes us / who we owe, per-invoice and per-PO outstanding, aging, net position
10. **Excel Import / Export** — validated preview-then-confirm imports, 14 typed .xlsx exports, templates, opening balances, import history
11. **Deal & Transaction History** — every sale and purchase with cash/credit split, full payment history, account traceability and timeline (derived; no Deal collection)
12. **Financial Reports & Analytics** — daily sales, P&L, sales by product/customer, receivables, payables, monthly trends
13. **Dashboard** — live revenue, low-stock alerts, top products, recent invoices
14. **Settings & Configuration** — business profile, numbering, tax defaults, user management

## Project layout

```
almtech-business-suite/
├── backend/                  # Express + MongoDB + JWT API
│   ├── src/
│   │   ├── config/db.js
│   │   ├── controllers/      # auth, products, customers, suppliers, invoices, POs, reports…
│   │   ├── middleware/       # auth (JWT, RBAC), error handler
│   │   ├── models/           # User, Product, Customer, Supplier, Invoice, Quotation, PurchaseOrder, Account, FinancialTransaction, Expense, OpeningBalance, ImportBatch, Settings, Activity, StockMovement
│   │   ├── routes/           # 12 route files, all mounted in server.js
│   │   ├── scripts/seed.js   # demo data + 3 user accounts
│   │   ├── utils/            # numbering, totals, PDF, activity log
│   │   └── server.js
│   └── package.json
└── frontend/                 # React + Vite + Tailwind + React Query
    ├── src/
    │   ├── api/client.js     # axios with JWT interceptor
    │   ├── components/       # Layout, PageHeader, StatCard, Table
    │   ├── context/AuthContext.jsx
    │   ├── pages/            # Login, Dashboard, POS, Invoices, Products, Customers, POs, Accounts, Import/Export, Transactions, Receivables, Payables, Expenses, Reports, Settings, Users, Activity…
    │   └── App.jsx
    ├── tailwind.config.js
    └── package.json
```

## Quick start

### Prerequisites
- Node.js 20+
- MongoDB 6+ running locally (or a connection string to a remote instance)

### Backend

```bash
cd backend
cp .env.example .env
# set JWT_SECRET — that is the only variable required locally:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npm run dev                   # starts API on http://localhost:5050
```

Leaving `MONGO_URI` blank locally uses a bundled embedded MongoDB that persists to
`backend/data/` — no MongoDB installation needed. Demo users, products, customers and
suppliers are seeded automatically on first run (set `ENABLE_DEMO_SEED=false` to skip).
The server refuses to start without `JWT_SECRET` rather than failing later at login.

### Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to backend)
```

### Seed login credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@almtech.org` | `admin1234` |
| Sales | `sales@almtech.org` | `sales1234` |
| Stock | `stock@almtech.org` | `stock1234` |

**These demo accounts exist only in development.** Demo seeding is never enabled
automatically when `NODE_ENV=production`, so a production database never receives them —
see [Production configuration](#production-configuration) for how the first real
administrator is created.

## API surface

Base URL `/api`. All endpoints except `/auth/login` require a `Authorization: Bearer <jwt>` header.

| Method | Path | Roles |
|---|---|---|
| `POST` | `/auth/login` | public |
| `GET` | `/auth/me` | any |
| `GET` | `/reports/dashboard` | any |
| `GET` | `/products`, `/products/:id`, `/products/:id/ledger` | any |
| `GET` | `/products/barcode?code=` | any (POS barcode lookup) |
| `POST` | `/products`, `/products/:id/adjust` | admin/stock |
| `PATCH` | `/products/:id` | **admin only** (product editing, incl. barcode) |
| `DELETE` | `/products/:id` | admin |
| `POST` | `/products/import` | admin |
| `GET/POST/PATCH` | `/customers`, `/customers/:id`, `/customers/:id/ledger` | admin/sales |
| `GET` | `/suppliers` | any (read-only lookup for the PO form) |
| `GET` | `/accounts` | any (names/types only, for payment selectors) |
| `GET` | `/accounts/summary`, `/accounts/:id/ledger`, `/accounts/reconcile` | admin |
| `POST/PATCH` | `/accounts`, `/accounts/:id` | admin |
| `GET` | `/payments` (financial history, filterable) | any |
| `GET` | `/expenses`, `/expenses/:id`, `/expenses/categories` | admin |
| `GET` | `/expenses/daily?date=`, `/expenses/monthly?month=` | admin |
| `POST/PATCH` | `/expenses`, `/expenses/:id` | admin (posted expenses are financially immutable) |
| `POST` | `/expenses/:id/void` | admin (posts a reversing ledger entry) |
| `GET` | `/finance/receivables`, `/finance/receivables/:customerId` | admin |
| `GET` | `/finance/payables`, `/finance/payables/:supplierId` | admin |
| `GET` | `/finance/position` (receivables − payables) | admin |
| `GET` | `/deals/sales`, `/deals/sales/:invoiceId` | admin (derived deal history) |
| `GET` | `/deals/purchases`, `/deals/purchases/:poId` | admin (derived deal history) |
| `GET` | `/data/types`, `/data/history`, `/data/history/:id` | admin |
| `GET` | `/data/templates/:type` (7 import templates) | admin |
| `GET` | `/data/export/:type` (14 exports, filter-aware) | admin |
| `POST` | `/data/import/:type/validate` (preview, no writes) | admin |
| `POST` | `/data/import/:type/commit` | admin |
| `GET/POST` | `/invoices`, `/invoices/:id`, `/invoices/:id/pdf` | admin/sales |
| `POST` | `/invoices/:id/payments` | admin/sales |
| `POST` | `/invoices/:id/payments/:paymentId/reverse` | **admin only** (reversing entry) |
| `POST` | `/invoices/:id/return` | admin |
| `GET/POST` | `/quotations`, `/quotations/:id/convert` | admin/sales |
| `GET/POST` | `/purchase-orders`, `/purchase-orders/:id/receive`, `/purchase-orders/:id/payments` | admin/stock |
| `POST` | `/purchase-orders/:id/payments/:paymentId/reverse` | **admin only** (reversing entry) |
| `GET` | `/reports/*` | admin (some open to all) |
| `GET/PATCH` | `/settings` | admin |
| `GET/POST/PATCH/DELETE` | `/users` | admin |
| `GET` | `/activity` | admin |

## What's implemented

**Backend (100%)** — all 9 modules wired with RBAC, validation, transactions (where needed), stock movements, activity logging, PDF invoice generation, customer/supplier ledgers, and the full reports surface.

**Frontend** — every module has a working page:
- Dashboard with stat cards + 30-day revenue chart + low-stock + top-products + recent invoices
- POS with live product search, cart, totals, optional initial payment
- Invoice detail with payment recording, return processing, PDF view
- Inventory list + product create/edit form (serial tracking toggle)
- Customers list + add modal + ledger detail view
- Quotations list + builder + one-click convert to invoice
- Purchase orders list + builder + detail view with partial receive + supplier payments
- Reports with 6 views (P&L, by product, by customer, receivables, payables, monthly trends chart)
- Settings + Users + Activity log

## What's left (post-scaffold)

This scaffold covers the heart of all 9 modules end-to-end. The remaining 8-week proposal work that's intentionally lighter here:
- Barcode printing (barcode field + POS scanning implemented; no PDF/label print template yet)
- PDF customer statements (similar to `utils/pdf.js` — clone the invoice template)
- Email integration (proposal includes 5 Zoho/Google accounts; not wired)
- File upload / logo image storage (logo URL field exists; needs multer endpoint)
- Daily MongoDB backups (`mongodump` cron on the VPS)
- Server monitoring / uptime alerts (configure on the VPS, e.g. UptimeRobot)

## Production configuration

Set these as environment variables in your hosting platform. Never commit a real `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **always** | Signs login tokens. Long random string. Changing it signs everyone out. |
| `MONGO_URI` | **in production** | MongoDB connection string. There is no fallback — the embedded database is never used in production. |
| `CORS_ORIGIN` | **in production** | The exact origin the frontend is served from, e.g. `https://your-domain`. Comma-separate only for genuinely multiple origins. |
| `NODE_ENV` | **in production** | Must be `production`. Suppresses stack traces and request logging. Vercel sets this automatically. |
| `PORT` | optional | Defaults to `5050`. |
| `JWT_EXPIRES_IN` | optional | Defaults to `12h`. |
| `ENABLE_DEMO_SEED` | optional | Never set this to `true` on a real business database. |
| `BOOTSTRAP_ADMIN_EMAIL` | first boot only | Creates the first administrator on an empty production database. |
| `BOOTSTRAP_ADMIN_PASSWORD` | first boot only | Minimum 10 characters. Never logged, never returned by any API. |
| `BOOTSTRAP_ADMIN_NAME` | optional | Defaults to `Administrator`. |

The server **refuses to start** and lists exactly what is missing if any required variable
is absent, rather than starting in a half-configured state.

### Creating the first administrator

On a fresh production database there are no users. Set `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD`, start the server once, then sign in and remove those two
variables. The bootstrap is skipped entirely once any user exists, and it only ever runs
when demo seeding is off.

### Pre-deployment checklist

- [ ] `JWT_SECRET` set to a fresh random value (not the development one)
- [ ] `MONGO_URI` points at the production database, and this host is on its IP allow-list
- [ ] `CORS_ORIGIN` set to the real frontend origin
- [ ] `NODE_ENV=production`
- [ ] `ENABLE_DEMO_SEED` unset or `false`
- [ ] `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` set for the first boot only
- [ ] `GET /api/health` returns 200 with `"database": "connected"`
- [ ] Signed in as the bootstrap admin, then removed the bootstrap variables
- [ ] Scheduled database backups

## Production deployment (Ubuntu 22.04 VPS)

```bash
# install Node 20, MongoDB, Nginx, PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs mongodb-org nginx
sudo npm install -g pm2

# clone & install
git clone <repo> /var/www/almtech-suite
cd /var/www/almtech-suite/backend
cp .env.example .env  # set NODE_ENV=production, MONGO_URI, JWT_SECRET, CORS_ORIGIN
npm ci --omit=dev
pm2 start src/server.js --name almtech-api
pm2 save

cd ../frontend
npm ci
npm run build
sudo cp -r dist/* /var/www/almtech-suite-web/

# nginx config (sample)
sudo tee /etc/nginx/sites-available/almtech <<'NGX'
server {
  listen 80;
  server_name suite.almtech.org;
  root /var/www/almtech-suite-web;
  index index.html;
  location / { try_files $uri /index.html; }
  location /api { proxy_pass http://localhost:5050; proxy_set_header Host $host; }
}
NGX
sudo ln -s /etc/nginx/sites-available/almtech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL via Let's Encrypt
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d suite.almtech.org

# daily MongoDB backups (cron)
echo '0 2 * * * mongodump --db=almtech_suite --archive=/var/backups/almtech-$(date +\%F).gz --gzip && find /var/backups -name "almtech-*.gz" -mtime +14 -delete' | sudo crontab -
```

## Notes for the dev who finishes this

- Numbering counters live in the `Settings` singleton — `utils/numbering.js` increments them atomically.
- All stock changes (sale, purchase, return, adjustment) write a `StockMovement` row so the per-product ledger is queryable forever.
- Customer balance is mirrored on `Customer.balance`; the ledger endpoint recomputes from `Invoice.payments` so the two stay reconcilable.
- The PDF generator is intentionally minimal — extend `utils/pdf.js` for branded headers, multi-page, footers, etc.
- All API errors flow through `middleware/error.js` — `res.status(...)` + `throw new Error(...)` in any controller is sufficient.
