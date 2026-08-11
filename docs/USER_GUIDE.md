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
   - [Barcodes](#barcodes)
   - [POS / New Sale](#pos--new-sale)
   - [Invoices](#invoices)
   - [Quotations](#quotations)
   - [Purchase Orders](#purchase-orders)
   - [Financial Accounts](#financial-accounts)
   - [Expenses](#expenses)
   - [Receivables & Payables](#receivables--payables)
   - [Transactions (Deals)](#transactions-deals)
   - [Returns and Refunds](#returns-and-refunds)
   - [Payment Reversal](#payment-reversal)
   - [Import & Export](#import--export)
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
| **Bulk import** (Excel) | First-time setup — load your existing catalogue, customers, suppliers, history and opening balances | Sidebar → **Import / Export** (Admin only) |
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

**Excel import**: Sidebar → **Import / Export** → Products. Download the template, fill it in, preview, then confirm. Products are matched on SKU, so re-importing updates rather than duplicates. See [Import & Export](#import--export).

---

### Customers (CRM)

**Add a customer**: Customers → **"+ New Customer"** → fill name, company, phone, credit limit, etc.

**Credit limit** = the maximum amount the customer can owe before the system blocks new sales. Set to `0` for no limit. The check counts any payment taken at the point of sale, so a sale that would exceed the limit is still allowed if enough is paid up front.

**Customer ledger**: Click a customer's name → see every invoice + every payment + running balance, with running totals.

**Auto-tracked**: when you sell to them their balance goes up; when they pay it comes down. You never adjust it manually.

---

### Suppliers

> **Removed.** The standalone Suppliers section (directory, add/edit, supplier ledger) is no
> longer part of the app. Supplier records themselves are untouched — purchase orders still
> attach to a supplier, supplier payables still accrue, and the **Payables** report still lists
> everyone you owe — see [Receivables & Payables](#receivables--payables). The Purchase Order
> form lists whichever suppliers exist, and new suppliers can be added through
> [Import & Export](#import--export) → Suppliers.

---

### Barcodes

Every product can carry a barcode. It is optional, but when present it must be unique
across the whole catalogue — the system refuses a barcode that already belongs to another
product and tells you which one.

**Set one**: Inventory → open a product (admin only) → Barcode field. Leave it blank if the
product has none; clearing a barcode frees it for another product.

**Scanning**: the POS accepts any USB or Bluetooth scanner that types like a keyboard —
which is nearly all of them. Point the scanner at the *Scan or enter barcode* box and pull
the trigger; the scanner types the code and presses Enter for you. You can also type or
paste a code and press Enter.

After each scan the box clears itself and keeps the cursor, so you can scan continuously
without touching the mouse. Scanning a product already in the cart increases its quantity.
An unknown code says so and adds nothing; out-of-stock and inactive products are refused.

There is no camera scanning.

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

### Financial Accounts

Money lives in named accounts — **Cash**, **Bank of Punjab** and **Soneri Bank** are set up
for you, and you can add more (Accounts → New Account) without any developer involvement.

Each account has an opening balance and a running current balance. Every payment, expense
and reversal posts one entry to one account, so **Accounts → click an account** shows a
complete ledger: opening balance, every movement in date order with a running balance, and
the closing figure. The page also tells you whether the stored balance still agrees with the
sum of its ledger, so a discrepancy can never hide.

Account balances are visible to Admin only.

---

### Expenses

Record what the business spends and which account paid for it: Expenses → Add Expense.

Every expense needs a date, a category (Rent, Salaries, Electricity, Fuel, and so on), an
amount and a paying account. Saving it moves money out of that account immediately.

**Expense Reports** gives you a daily view (pick a date) and a monthly view (pick a month)
with a category breakdown, a day-by-day breakdown and per-account totals — all calculated
from the actual expense records, never typed in.

**Corrections**: once an expense is posted, its amount, account and date can no longer be
edited, because the money has already left the account. Instead, open it and choose
**Void & reverse** — the original stays on record and a reversing entry puts the money back.
Description, notes, reference and category can still be corrected in place.

---

### Receivables & Payables

**Receivables** answers "who owes us money?". It lists every customer with an outstanding
balance, what they were invoiced, what they have paid and what is still owed, plus the age of
the oldest unpaid invoice. Click a customer to see their individual outstanding invoices and
record a payment against any of them.

**Payables** answers the same question in reverse for suppliers and purchase orders.

Both pages show an **aging** breakdown — Current, 1–30, 31–60, 61–90 and 90+ days. Note that
the system has no payment due-date field, so aging counts days since the invoice or purchase
order was raised, not days past an agreed payment term. The pages say so on screen.

The **Net Outstanding Position** is simply receivables minus payables. It is money owed, not
profit.

---

### Transactions (Deals)

**Transactions** is the Excel replacement: one scannable list of every sale and every
purchase, with date, deal number, customer or supplier, total, paid, outstanding, status and
payment count. Filter by date, status, cash/credit or amount, search by number or name, and
sort any column.

Click any row for the full deal record: the products, the money summary, every payment with
the account it went through, links to the account ledger and to the receivable or payable,
and a timeline of everything that happened to the deal.

---

### Returns and Refunds

Returning an invoice (Invoices → open it → **Return**) does three things: the goods go back
into stock, the customer stops owing whatever was still outstanding, and **any money already
received is refunded** — each payment is reversed out of the account it was paid into, with
a matching entry in that account's ledger.

The original payments stay on the invoice, marked reversed, so the history is complete.

If the invoice contains a payment that was imported from a spreadsheet without an account,
there is nothing to refund it from, so the return is refused with an explanation rather than
guessing. Record that refund manually first.

A returned invoice cannot be returned again, and its payments cannot be reversed a second
time.

---

### Payment Reversal

If a payment was recorded in error, an Admin can reverse it from the invoice or purchase
order (or from the deal record). A reason is required.

Nothing is deleted. The original payment stays visible, marked **REVERSED**, showing who
reversed it, when and why. A matching reversing entry is posted to the same account, so the
account balance, the invoice or PO, and the customer receivable or supplier payable all
return to where they were.

A payment can only be reversed once. Payments that were imported from a spreadsheet without
an account cannot be reversed automatically, because there is no ledger entry to undo — the
system will tell you so rather than guess.

---

### Import & Export

**Import** (Admin only) brings your existing spreadsheets in: Products, Customers, Suppliers,
Sales/Invoices, Purchase Orders, Expenses and Opening Balances.

Download the template for whatever you are importing — it has the right column headers, one
clearly marked example row to delete, and instructions. Then upload your file and press
**Preview & validate**. Nothing is saved at this point: you get a row-by-row report of what
will be created, what will be updated, what will be skipped as already present, and exactly
what is wrong with any row that fails. Failed rows download as a spreadsheet you can correct
and re-upload. Only when you confirm does anything reach the database.

Re-uploading the same file does not duplicate anything.

**Opening Balances** is how you carry over where the business already stands — cash and bank
starting balances, what customers already owed you, and what you already owed suppliers.
These are a starting position, not transactions, so they create no revenue and no expense.

**Export** produces proper Excel files with readable column names, real dates and real
numbers you can sum: Products, Customers, Suppliers, Sales, Purchases, Payments, Expenses,
Receivables, Payables, Account Ledgers, Deals, P&L, and the daily and monthly expense
reports. Where a date range applies, the export respects it.

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
3. **Accounts** → set the opening balance of Cash and each bank account.
4. **Inventory** → add products (manually or via Import).
5. **Customers** → add wholesale clients with credit limits.
6. **Import → Opening Balances** → carry over what customers already owe you and what you owe suppliers.
7. **Purchase Orders** → optionally log recently received stock to back-fill inventory.
8. From here on, normal daily use: sales, payments, expenses, receiving stock, running reports.

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
| **Account** | A place money is held: Cash, or a named bank account. |
| **Ledger** (account) | Every movement in and out of one account, with a running balance. |
| **Reversing entry** | A correcting entry that undoes an earlier one. The original is kept; nothing is deleted. |
| **Opening balance** | Where a balance stood before ALMTech started tracking it. Not a transaction. |
| **Aging** | How long money has been outstanding, counted from the invoice or PO date. |
| **Deal** | One sale or one purchase, seen as a whole: products, totals, payments and history. |
| **Partial payment** | A payment that doesn't cover the full invoice/PO — the system tracks the remaining balance until it's paid in full. |

---

*Document version: 1.0 · Last updated: 2026-05-15*
