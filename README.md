# ALMTech Full Business Suite

A MERN stack business management system purpose-built for ALMTech's computer wholesale operations, covering the 9 modules described in `Full Business Suite Proposal.pdf`:

1. **Authentication & Access Control** — JWT login, three roles (admin / sales / stock), activity log
2. **Inventory & Product Management** — catalog, stock, serial numbers, low-stock alerts, Excel import
3. **POS & Sales** — invoices, partial payments, returns, branded PDF invoices, auto stock deduction
4. **Purchase Order Management** — orders, partial receipts, supplier payments
5. **Supplier Management** — directory, payables, supplier ledger
6. **Customer Management (CRM)** — profiles, credit limits, statements, customer ledger
7. **Financial Reports & Analytics** — daily sales, P&L, sales by product/customer, receivables, payables, monthly trends
8. **Dashboard** — live revenue, low-stock alerts, top products, recent invoices
9. **Settings & Configuration** — business profile, numbering, tax defaults, user management

## Project layout

```
almtech-business-suite/
├── backend/                  # Express + MongoDB + JWT API
│   ├── src/
│   │   ├── config/db.js
│   │   ├── controllers/      # auth, products, customers, suppliers, invoices, POs, reports…
│   │   ├── middleware/       # auth (JWT, RBAC), error handler
│   │   ├── models/           # User, Product, Customer, Supplier, Invoice, Quotation, PurchaseOrder, Settings, Activity, StockMovement
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
    │   ├── pages/            # Login, Dashboard, POS, Invoices, Products, Customers, Suppliers, POs, Reports, Settings, Users, Activity…
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
cp .env.example .env          # then edit MONGO_URI / JWT_SECRET
npm install
npm run seed                  # creates demo users, products, customers, suppliers
npm run dev                   # starts API on http://localhost:5050
```

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

Change these immediately in production via Settings → Users.

## API surface

Base URL `/api`. All endpoints except `/auth/login` require a `Authorization: Bearer <jwt>` header.

| Method | Path | Roles |
|---|---|---|
| `POST` | `/auth/login` | public |
| `GET` | `/auth/me` | any |
| `GET` | `/reports/dashboard` | any |
| `GET/POST/PATCH/DELETE` | `/products`, `/products/:id`, `/products/:id/adjust` | admin/stock |
| `POST` | `/products/import` | admin |
| `GET/POST/PATCH` | `/customers`, `/customers/:id`, `/customers/:id/ledger` | admin/sales |
| `GET/POST/PATCH` | `/suppliers`, `/suppliers/:id`, `/suppliers/:id/ledger` | admin/stock |
| `GET/POST` | `/invoices`, `/invoices/:id`, `/invoices/:id/pdf` | admin/sales |
| `POST` | `/invoices/:id/payments` | admin/sales |
| `POST` | `/invoices/:id/return` | admin |
| `GET/POST` | `/quotations`, `/quotations/:id/convert` | admin/sales |
| `GET/POST` | `/purchase-orders`, `/purchase-orders/:id/receive`, `/purchase-orders/:id/payments` | admin/stock |
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
- Customers & Suppliers list + add modal + ledger detail view
- Quotations list + builder + one-click convert to invoice
- Purchase orders list + builder + detail view with partial receive + supplier payments
- Reports with 6 views (P&L, by product, by customer, receivables, payables, monthly trends chart)
- Settings + Users + Activity log

## What's left (post-scaffold)

This scaffold covers the heart of all 9 modules end-to-end. The remaining 8-week proposal work that's intentionally lighter here:
- Excel/CSV upload UI (backend `/products/import` endpoint works; needs a frontend page that parses XLSX)
- Barcode printing (data field exists, no PDF/print template yet)
- PDF customer statements (similar to `utils/pdf.js` — clone the invoice template)
- Email integration (proposal includes 5 Zoho/Google accounts; not wired)
- File upload / logo image storage (logo URL field exists; needs multer endpoint)
- Daily MongoDB backups (`mongodump` cron on the VPS)
- Server monitoring / uptime alerts (configure on the VPS, e.g. UptimeRobot)

## Production deployment (Ubuntu 22.04 VPS)

```bash
# install Node 20, MongoDB, Nginx, PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs mongodb-org nginx
sudo npm install -g pm2

# clone & install
git clone <repo> /var/www/almtech-suite
cd /var/www/almtech-suite/backend
cp .env.example .env  # set MONGO_URI, JWT_SECRET, CORS_ORIGIN
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
