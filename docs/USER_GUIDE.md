# ALMTech Business Suite — User Guide

A practical, plain-language guide to how the system works, how data flows through it, and what each module does.

---

## Table of Contents

1. [The big picture](#1-the-big-picture)
2. [Three ways data gets into the system](#2-three-ways-data-gets-into-the-system)
3. [Module walk-through](#3-module-walk-through)
   - [Users & Login](#users--login)
   - [Inventory / Products](#inventory--products)
   - [Customers (CRM)](#customers-crm)
   - [Suppliers](#suppliers)
   - [POS / New Sale](#pos--new-sale)
   - [Invoices](#invoices)
   - [Quotations](#quotations)
   - [Purchase Orders](#purchase-orders)
   - [Reports](#reports)
   - [Settings](#settings)
   - [Activity Log](#activity-log)
4. [Automatic behaviours (the "magic")](#4-automatic-behaviours-the-magic)
5. [Where the data lives](#5-where-the-data-lives)
6. [Suggested first-time setup order](#6-suggested-first-time-setup-order)
7. [Default login credentials](#7-default-login-credentials)
8. [Glossary](#8-glossary)

---

## 1. The big picture

Think of the system as a **digital filing cabinet that's smart**. You enter information in one place and it automatically updates every related place.

**Example:** when you sell a laptop in POS, three things happen at once:

- An invoice is created.
- The customer's outstanding balance updates.
- That laptop's stock count drops by one.

You only have to "do" one thing — the system handles the rest. This is true throughout the app: actions trigger ripple effects so the data stays consistent everywhere.

---

## 2. Three ways data gets into the system

| Method | When to use it | Where |
|---|---|---|
| **Type into a form** | Day-to-day work — add a customer, create an invoice, log a payment | Every page has **"+ New"** buttons |
| **Bulk import** (Excel / CSV) | First-time setup — load your existing product catalogue | Backend endpoint `POST /api/products/import` (UI to be added later) |
| **Automatic** | Created as a side-effect of another action | See [section 4](#4-automatic-behaviours-the-magic) |

---

## 3. Module walk-through

### Users & Login

**Three roles**, each with different access:

- **Admin** — full access: settings, reports, pricing, user management, financial data.
- **Sales** — can create invoices, view customers, view stock. Cannot edit prices or view profit reports.
- **Stock** — can manage inventory and receive purchase orders. Cannot access financial reports or customer credit.

**Add a user**: Sidebar → **Users** → **"+ New User"** → fill name, email, password, role → **Save**.

**Disable a user**: Click **Disable** next to their name (better than deleting — preserves their action history).

**Behind the scenes**: passwords are encrypted with bcrypt; logins return a JWT token that expires after 12 hours.

---

### Inventory / Products

**Add one product**: Inventory → **"+ New Product"** → fill SKU, name, brand, purchase price, selling price, opening stock → **Save**.

**Edit pricing or stock**: Click any product name → adjust fields → **Save**.

**Track laptops by serial number / IMEI**: Tick **"Track serial numbers"** on the product. From then on, every receipt or sale of that product will ask for the serial.

**Low-stock alerts**: Set a **low-stock threshold** per product. When stock drops to or below it, the product appears in the Dashboard's "Low Stock" panel automatically.

**Search**: top of the page — searches name, SKU, brand, model live.

**Excel import (backend ready)**: paste a JSON array of products to `POST /api/products/import`. The system creates new ones and updates existing ones by SKU.

---

### Customers (CRM)

**Add a customer**: Customers → **"+ New Customer"** → fill name, company, phone, credit limit, etc.

**Credit limit** = the maximum amount the customer can owe before the system blocks new sales. Set to `0` for no limit.

**Customer ledger**: Click a customer's name → see every invoice + every payment + running balance, with running totals.

**Auto-tracked**: when you sell to them their balance goes up; when they pay it comes down. You never adjust it manually.

---

### Suppliers

Mirror image of Customers — tracks what **you owe them**.

**Add via** Suppliers → **"+ New Supplier"**.

**Click a supplier** → ledger of every PO + every payment.

---

### POS / New Sale

This is the most-used screen — daily sales happen here. Sidebar → **New Sale**.

**Step-by-step**:

1. **Search** product in the top-left box → click it → goes into the cart on the right.
2. **Pick the customer** from the dropdown on the right.
3. **Adjust** quantity, unit price (auto-fills from catalogue), per-line discount if needed.
4. **Apply** overall discount and tax rate.
5. **(Optional)** Enter an **initial payment** amount and method if the customer paid some upfront.
6. Click **Save Invoice**.

**What happens automatically on save**:

- Invoice number generated (e.g. `INV-0001`).
- Stock deducted for each item sold.
- Customer's outstanding balance increased.
- Stock movement records written (so you can later see "this laptop sold on this invoice on this date").
- Activity log entry created (who did it, when).
- PDF invoice becomes available instantly.

**Safety checks**:

- If you try to sell more than is in stock → blocked.
- If the sale would push the customer over their credit limit → blocked.

---

### Invoices

**List view**: filter by status (Open / Partial / Paid / Returned / Cancelled).

**Click an invoice** → full breakdown with items, payments, and totals.

**Record a payment** on an unpaid or part-paid invoice → right-side panel asks for amount, method (cash / bank / cheque), reference (e.g. cheque #). On save:

- Customer balance drops.
- Invoice status flips to **Paid** automatically when the balance reaches zero.

**View PDF**: top-right button opens the branded PDF invoice in a new tab.

**Process Return (admin only)**: stock restored, invoice marked "returned", customer balance reduced for the unpaid portion.

---

### Quotations

For pre-sale offers to wholesale prospects.

- Create a quote (doesn't touch stock or customer balance — it's just an offer).
- When the customer accepts: click **Convert to Invoice** → a real invoice is created, stock is deducted, balance updates. The original quotation is marked **Converted**.

---

### Purchase Orders

Incoming stock from suppliers.

**Create a PO**: Purchase Orders → **"+ New PO"** → pick supplier, add products + quantities + unit costs, expected delivery date → **Save**.

On save: PO becomes **Ordered**, supplier payable balance increases by the PO total.

**When the truck arrives**:

1. Open the PO.
2. In the **"Receive Now"** column type how many of each item actually came in.
3. Click **Receive Selected**.
4. Stock increases for received items.
5. If you got only part of the shipment, the PO is marked **Partial** until you receive the rest.

**Pay the supplier**: same kind of panel as customer payments — amount, method, reference. Supplier payable drops accordingly.

---

### Reports

Six views, all with date filters:

| Report | What it shows | Access |
|---|---|---|
| **P&L Summary** | Revenue, cost, gross profit, margin % for a date range | Admin only |
| **Sales by Product** | Which products earn the most | Any role |
| **Sales by Customer** | Who buys the most | Any role |
| **Receivables** | Every customer who owes money, sorted by amount | Any role |
| **Payables** | Every supplier you owe, sorted by amount | Any role |
| **Monthly Trends** | 12-month revenue / cost / profit chart | Admin only |

---

### Settings

Admin only. Customise:

- Business name, address, phone, email, tax number (appear on every invoice PDF).
- **Currency code** (default: `PKR`).
- Default tax rate.
- Invoice prefix and starting number (e.g. `INV-` starting `0001`).
- Whether tax is shown on invoices.
- Logo URL (used in the sidebar and PDF — already wired to the embedded ALMTech logo).

---

### Activity Log

Admin only. Every action — login, invoice creation, price change, payment, return — is timestamped with the user who did it. **Cannot be edited or deleted**. This is your audit trail.

---

## 4. Automatic behaviours (the "magic")

The actions on the left trigger the side-effects on the right — automatically.

| When you do this… | The system also does this |
|---|---|
| Save a new invoice | Deducts stock · raises customer balance · logs activity · writes stock movement records |
| Record a customer payment | Reduces invoice balance · reduces customer outstanding · flips status to **Paid** when zero · logs activity |
| Save a Purchase Order | Raises supplier payable · logs activity |
| Receive PO items | Increases stock · updates the product's purchase price · writes stock movement records · updates PO status (partial / received) |
| Pay a supplier | Reduces PO balance · reduces supplier payable · logs activity |
| Process a return | Restores stock · reduces customer balance · marks invoice **returned** · logs activity |
| Convert a quotation | Creates an invoice (same effects as above) · marks quote **converted** |

---

## 5. Where the data lives

- **Development / current setup**: inside the app folder at `backend/data/`. As long as this folder exists, all your customers, products, sales, etc. are safe. If you wipe it, the app boots fresh with demo data.
- **Production**: would be a proper MongoDB instance on a server with daily backups (see `README.md` for VPS deployment notes).

---

## 6. Suggested first-time setup order

When you start using this for real (with real ALMTech data), follow this order:

1. **Sign in as Admin** → **Settings** → fill in business profile (name, address, tax number).
2. **Users** → create accounts for staff (sales, stock).
3. **Suppliers** → add your real suppliers.
4. **Inventory** → add products (manually or via import).
5. **Customers** → add wholesale clients with credit limits.
6. **Purchase Orders** → optionally log recently received stock to back-fill inventory.
7. From here on, normal daily use: sales, payments, receiving stock, running reports.

---

## 7. Default login credentials

These are seeded on first launch. **Change them immediately** in production.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@almtech.org` | `admin1234` |
| Sales | `sales@almtech.org` | `sales1234` |
| Stock | `stock@almtech.org` | `stock1234` |

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **SKU** | Stock Keeping Unit — the unique code for each product (e.g. `APL-MBP14-M3`). |
| **Credit limit** | Max amount a customer can owe before new sales to them are blocked. |
| **Outstanding balance** | What a customer owes (receivable) or what you owe a supplier (payable). |
| **Stock movement** | An immutable log entry every time stock changes (sale, purchase, return, adjustment). |
| **Ledger** | A running record of every transaction with a customer or supplier, with balance after each line. |
| **Quote → Invoice conversion** | One-click action that turns a saved quotation into a real invoice. |
| **JWT** | The token your browser uses to stay signed in for 12 hours after login. |
| **RBAC** | Role-Based Access Control — what each role can/can't see and do. |
| **PO** | Purchase Order — what you send to a supplier to buy stock. |
| **Partial payment** | A payment that doesn't cover the full invoice/PO — the system tracks the remaining balance until it's paid in full. |

---

*Document version: 1.0 · Last updated: 2026-05-15*
