// Builds a standalone, downloadable HTML guide with the ALMTech logo embedded.
// Output: /Users/haroon/Desktop/ALMTech-Business-Suite-Guide.html
import fs from 'node:fs';
import path from 'node:path';

const LOGO = '/Users/haroon/almtech-business-suite/frontend/public/almtech-logo-tight.png';
const OUT = '/Users/haroon/Desktop/ALMTech-Business-Suite-Guide.html';
const logoB64 = fs.readFileSync(LOGO).toString('base64');
const logoDataUrl = `data:image/png;base64,${logoB64}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ALMTech Business Suite — Complete User Guide</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --brand-deep: #163e93;
    --brand: #0950b9;
    --brand-light: #0086cd;
    --brand-50: #eff6ff;
    --brand-100: #dbeafe;
    --ink-900: #0b1220;
    --ink-700: #1e293b;
    --ink-500: #475569;
    --ink-400: #64748b;
    --ink-300: #94a3b8;
    --ink-200: #cbd5e1;
    --ink-100: #e2e8f0;
    --ink-50: #f1f5f9;
    --amber: #b45309;
    --emerald: #047857;
    --red: #b91c1c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: var(--ink-900);
    background: var(--ink-50);
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    font-feature-settings: 'cv11', 'ss01';
  }
  .page {
    max-width: 880px;
    margin: 0 auto;
    background: white;
    padding: 64px 72px;
    box-shadow: 0 1px 3px rgba(15,23,42,0.06);
  }
  /* Cover */
  .cover {
    background: linear-gradient(135deg, #163e93 0%, #0950b9 50%, #0086cd 100%);
    color: white;
    padding: 80px 72px 96px;
    margin: -64px -72px 64px;
    position: relative;
    overflow: hidden;
  }
  .cover::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 80% 10%, rgba(255,255,255,0.15), transparent 50%),
      radial-gradient(circle at 10% 90%, rgba(0,0,0,0.15), transparent 50%);
    pointer-events: none;
  }
  .cover-logo { position: relative; max-width: 280px; filter: brightness(0) invert(1); }
  .cover h1 {
    position: relative;
    font-size: 44px;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 32px 0 8px;
  }
  .cover .tag { position: relative; opacity: 0.85; font-size: 16px; }
  .cover .meta { position: relative; margin-top: 48px; font-size: 12px; opacity: 0.75; letter-spacing: 0.1em; text-transform: uppercase; }
  /* Typography */
  h1, h2, h3, h4 { font-weight: 700; letter-spacing: -0.015em; color: var(--ink-900); }
  h1 { font-size: 32px; margin: 56px 0 16px; padding-top: 24px; border-top: 4px solid var(--brand); }
  h2 { font-size: 24px; margin: 40px 0 12px; }
  h3 { font-size: 18px; margin: 28px 0 8px; color: var(--brand-deep); }
  h4 { font-size: 15px; margin: 18px 0 6px; color: var(--ink-700); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  p { margin: 8px 0 14px; color: var(--ink-700); font-size: 15px; }
  ul, ol { padding-left: 20px; }
  li { margin-bottom: 6px; color: var(--ink-700); font-size: 15px; }
  strong { color: var(--ink-900); font-weight: 600; }
  code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 13px;
    background: var(--ink-50);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--brand-deep);
  }
  hr { border: none; border-top: 1px solid var(--ink-100); margin: 32px 0; }
  a { color: var(--brand); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
  a:hover { border-bottom-color: var(--brand); }
  /* TOC */
  .toc {
    background: var(--brand-50);
    border-radius: 12px;
    padding: 28px 32px;
    margin: 32px 0;
  }
  .toc h2 { margin-top: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--brand-deep); }
  .toc ol { padding-left: 22px; counter-reset: toc; }
  .toc li { font-size: 14px; margin: 4px 0; }
  .toc a { color: var(--ink-700); }
  /* Cards / callouts */
  .callout {
    border-radius: 10px;
    padding: 16px 20px;
    margin: 20px 0;
    border-left: 4px solid var(--brand);
    background: var(--brand-50);
  }
  .callout.tip { background: #ecfdf5; border-color: var(--emerald); }
  .callout.tip strong { color: var(--emerald); }
  .callout.warn { background: #fffbeb; border-color: #f59e0b; }
  .callout.warn strong { color: var(--amber); }
  .callout strong { color: var(--brand-deep); display: block; margin-bottom: 4px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
  .callout p { margin: 4px 0 0; font-size: 14px; color: var(--ink-700); }
  /* Tables */
  table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px; }
  th { text-align: left; font-weight: 600; padding: 12px 14px; background: var(--ink-50); color: var(--ink-700); border-bottom: 2px solid var(--ink-100); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 12px 14px; border-bottom: 1px solid var(--ink-100); color: var(--ink-700); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  /* Steps */
  .steps { counter-reset: step; list-style: none; padding-left: 0; margin: 16px 0; }
  .steps > li {
    counter-increment: step;
    position: relative;
    padding-left: 44px;
    margin-bottom: 16px;
    min-height: 30px;
  }
  .steps > li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #163e93, #0086cd);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 13px;
  }
  /* Roles */
  .role-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .role-admin { background: #fef3c7; color: #92400e; }
  .role-sales { background: #dbeafe; color: #1e40af; }
  .role-stock { background: #d1fae5; color: #065f46; }
  /* Footer */
  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--ink-100);
    color: var(--ink-400);
    font-size: 12px;
    text-align: center;
  }
  /* Print */
  @media print {
    body { background: white; }
    .page { box-shadow: none; padding: 32px 48px; max-width: 100%; }
    .cover { margin: -32px -48px 48px; padding: 64px 48px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .callout, .toc, th, .steps > li::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1 { page-break-before: always; }
    h1:first-of-type { page-break-before: avoid; }
    .toc { page-break-inside: avoid; }
    .callout { page-break-inside: avoid; }
    table { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

<div class="cover">
  <img class="cover-logo" src="${logoDataUrl}" alt="ALMTech" />
  <h1>Business Suite</h1>
  <div class="tag">Complete User Guide — every workflow, every screen, every journey</div>
  <div class="meta">Version 1.0 · For internal use</div>
</div>

<div class="toc">
  <h2>Table of contents</h2>
  <ol>
    <li><a href="#about">About this guide</a></li>
    <li><a href="#overview">Big picture: how the system thinks</a></li>
    <li><a href="#login">Signing in</a></li>
    <li><a href="#dashboard">Tour of the Dashboard</a></li>
    <li><a href="#sales-journey">Daily sales journey (end-to-end)</a></li>
    <li><a href="#purchase-journey">Purchasing journey (receiving stock from suppliers)</a></li>
    <li><a href="#customer-journey">Customer management journey</a></li>
    <li><a href="#quote-journey">Quotations journey</a></li>
    <li><a href="#returns">Processing a return</a></li>
    <li><a href="#reports">Reading reports</a></li>
    <li><a href="#settings">Settings &amp; customisation</a></li>
    <li><a href="#users">Managing staff &amp; roles</a></li>
    <li><a href="#activity">Activity log &amp; audit trail</a></li>
    <li><a href="#auto">What the system does automatically</a></li>
    <li><a href="#setup">First-time setup checklist</a></li>
    <li><a href="#tips">Tips, troubleshooting &amp; FAQ</a></li>
    <li><a href="#glossary">Glossary</a></li>
  </ol>
</div>

<h1 id="about">1 · About this guide</h1>
<p>This document is the full operating manual for the ALMTech Business Suite — a web application that replaces the Excel workflow used to run the ALMTech wholesale business. It covers every screen, every common workflow, and explains what happens behind the scenes when you click a button.</p>
<p>You do not need to be technical to read this guide. If you can use Excel, you can use this system.</p>

<div class="callout tip">
<strong>How to read this guide</strong>
<p>If you are about to use the system for the first time, read sections 1–5 in order. If you already know the basics, jump straight to any workflow chapter using the table of contents above.</p>
</div>

<h1 id="overview">2 · Big picture: how the system thinks</h1>
<p>The system is best understood as a <strong>smart filing cabinet</strong>. You enter information in one place, and it automatically updates every other place that needs to know.</p>
<p>Here is the key idea, in one sentence:</p>
<div class="callout">
<strong>Core principle</strong>
<p>You do <em>one thing</em> — like saving a sale — and the system updates stock, customer balances, the dashboard, reports, the activity log, and the printable invoice all at once. You never type the same fact twice.</p>
</div>
<h3>A concrete example</h3>
<p>When you sell one MacBook Pro to a wholesale customer for PKR 250,000 with PKR 100,000 paid upfront, this is what you do:</p>
<ul>
  <li>Open the New Sale screen, pick the product, pick the customer, enter the upfront payment, click Save.</li>
</ul>
<p>That is your only action. The system then automatically:</p>
<ul>
  <li>Generates an invoice (e.g. <code>INV-0042</code>).</li>
  <li>Subtracts 1 MacBook from inventory.</li>
  <li>Records the PKR 100,000 payment.</li>
  <li>Sets the customer's outstanding balance to PKR 150,000 (the remaining amount).</li>
  <li>Marks the invoice as "Partial".</li>
  <li>Updates today's revenue on the Dashboard.</li>
  <li>Writes an entry to the activity log saying you did it, at the time it happened.</li>
  <li>Makes a branded PDF of the invoice available to print or email.</li>
</ul>

<h1 id="login">3 · Signing in</h1>
<p>Open <code>http://localhost:5174</code> in your browser. You will see the login screen with the ALMTech logo.</p>
<ol class="steps">
  <li>Enter your email address.</li>
  <li>Enter your password.</li>
  <li>Click <strong>Sign in</strong>.</li>
</ol>
<p>You will land on the Dashboard.</p>

<h3>Default login credentials</h3>
<p>The system is seeded with three accounts for testing:</p>
<table>
  <thead><tr><th>Role</th><th>Email</th><th>Password</th></tr></thead>
  <tbody>
    <tr><td><span class="role-pill role-admin">Admin</span></td><td><code>admin@almtech.org</code></td><td><code>admin1234</code></td></tr>
    <tr><td><span class="role-pill role-sales">Sales</span></td><td><code>sales@almtech.org</code></td><td><code>sales1234</code></td></tr>
    <tr><td><span class="role-pill role-stock">Stock</span></td><td><code>stock@almtech.org</code></td><td><code>stock1234</code></td></tr>
  </tbody>
</table>
<div class="callout warn">
<strong>Important</strong>
<p>Change these passwords immediately when you start using the system for real business. Anyone with these defaults can sign in.</p>
</div>

<h3>What each role can do</h3>
<table>
  <thead><tr><th>Action</th><th>Admin</th><th>Sales</th><th>Stock</th></tr></thead>
  <tbody>
    <tr><td>Create sales / invoices</td><td>✓</td><td>✓</td><td>✗</td></tr>
    <tr><td>Record customer payments</td><td>✓</td><td>✓</td><td>✗</td></tr>
    <tr><td>Add or edit products</td><td>✓</td><td>✗</td><td>✓</td></tr>
    <tr><td>Create purchase orders</td><td>✓</td><td>✗</td><td>✓</td></tr>
    <tr><td>Receive stock from suppliers</td><td>✓</td><td>✗</td><td>✓</td></tr>
    <tr><td>Pay suppliers</td><td>✓</td><td>✗</td><td>✗</td></tr>
    <tr><td>Process returns</td><td>✓</td><td>✗</td><td>✗</td></tr>
    <tr><td>View P&amp;L &amp; financial reports</td><td>✓</td><td>✗</td><td>✗</td></tr>
    <tr><td>Manage users</td><td>✓</td><td>✗</td><td>✗</td></tr>
    <tr><td>Change system settings</td><td>✓</td><td>✗</td><td>✗</td></tr>
  </tbody>
</table>

<h1 id="dashboard">4 · Tour of the Dashboard</h1>
<p>The Dashboard is the home screen after you sign in. It shows the health of the business at a glance.</p>

<h3>Top row: 5 stat cards</h3>
<ul>
  <li><strong>Sales Today</strong> — revenue and number of invoices since midnight. Has a brand-coloured stripe.</li>
  <li><strong>Sales · 7 Days</strong> — total revenue in the last week.</li>
  <li><strong>Sales · This Month</strong> — total revenue this calendar month.</li>
  <li><strong>Receivables</strong> — total amount customers owe you. Amber stripe if greater than zero.</li>
  <li><strong>Payables</strong> — total amount you owe suppliers. Amber stripe if greater than zero.</li>
</ul>

<h3>Middle row: chart + top products</h3>
<ul>
  <li><strong>Revenue · last 30 days</strong> — daily revenue as a brand-gradient bar chart. Hover any bar to see the exact total for that date.</li>
  <li><strong>Top Products</strong> — five best-selling products this week, ranked by revenue.</li>
</ul>

<h3>Bottom row: alerts</h3>
<ul>
  <li><strong>Low Stock</strong> — products at or below their reorder threshold. Click any product to edit it.</li>
  <li><strong>Recent Invoices</strong> — last 8 sales. Click any to open the full invoice.</li>
</ul>

<div class="callout tip">
<strong>Tip</strong>
<p>You should glance at the Dashboard at the start of every working day. If "Sales Today" shows zero by mid-afternoon, you know something is off. If "Receivables" grows month-over-month, you have an aging-debt problem.</p>
</div>

<h1 id="sales-journey">5 · Daily sales journey (end-to-end)</h1>
<p>This is the most-used workflow. Here it is from start to finish.</p>

<h2>5.1 — Adding a customer (only once per customer)</h2>
<ol class="steps">
  <li>Sidebar → <strong>Customers</strong>.</li>
  <li>Click <strong>+ New Customer</strong>.</li>
  <li>Fill in: name, company, phone, email, address.</li>
  <li>Set the <strong>credit limit</strong> — the maximum amount this customer can owe before the system blocks new sales to them. For cash-only customers set it to <code>0</code>.</li>
  <li>Click <strong>Save</strong>.</li>
</ol>
<div class="callout">
<strong>Why credit limits matter</strong>
<p>If you set Bilal Khan's credit limit to PKR 500,000 and he already owes you PKR 480,000, the system will block any sale to him over PKR 20,000 until he pays down his balance. This stops you from accidentally extending too much credit.</p>
</div>

<h2>5.2 — Adding a product (only once per product)</h2>
<ol class="steps">
  <li>Sidebar → <strong>Inventory</strong>.</li>
  <li>Click <strong>+ New Product</strong>.</li>
  <li>Fill in: name, SKU, brand, model, category.</li>
  <li>Enter the <strong>purchase price</strong> (your cost) and <strong>selling price</strong>.</li>
  <li>Enter the opening <strong>stock quantity</strong> on hand.</li>
  <li>Set the <strong>low-stock threshold</strong> — the system will flag the product on the Dashboard when stock drops to this level.</li>
  <li>For laptops and other serialised items, tick <strong>Track serial numbers</strong>.</li>
  <li>Click <strong>Save</strong>.</li>
</ol>

<h2>5.3 — Making the sale</h2>
<ol class="steps">
  <li>Sidebar → <strong>New Sale</strong>. This opens the Point-of-Sale screen.</li>
  <li>In the top-left search box, type the product name, SKU, or brand. The matching products appear instantly.</li>
  <li>Click a product → it goes into the cart on the right. Click multiple products to build a multi-item sale.</li>
  <li>For each line in the cart, adjust the <strong>quantity</strong> if you are selling more than one.</li>
  <li>The <strong>unit price</strong> auto-fills from the catalogue. Edit it here if you are giving this customer a special price.</li>
  <li>Optionally add a per-line <strong>discount</strong>.</li>
  <li>On the right panel, pick the <strong>customer</strong> from the dropdown.</li>
  <li>Optionally apply an overall <strong>discount</strong> and a <strong>tax rate</strong>.</li>
  <li>If the customer is paying something now, enter <strong>Initial Payment</strong> amount and pick the <strong>method</strong> (cash, bank transfer, cheque, other).</li>
  <li>Click <strong>Save Invoice</strong>.</li>
</ol>
<p>The system creates the invoice, deducts stock, updates the customer balance, and takes you to the invoice detail page.</p>

<h2>5.4 — Recording a later payment</h2>
<p>When the customer pays the rest of their balance later (in person, by bank transfer, by cheque):</p>
<ol class="steps">
  <li>Sidebar → <strong>Invoices</strong>.</li>
  <li>Find the invoice. Filter by status "Partial" or "Open" to narrow it down quickly.</li>
  <li>Click the invoice number to open it.</li>
  <li>In the right panel "Record Payment", enter the <strong>amount</strong>, pick the <strong>method</strong>, and write a <strong>reference</strong> (e.g. cheque number).</li>
  <li>Click <strong>Save Payment</strong>.</li>
</ol>
<p>The invoice status flips to <strong>Paid</strong> automatically when the balance reaches zero. The customer's outstanding balance drops by the amount paid.</p>

<h2>5.5 — Printing or emailing the invoice</h2>
<ol class="steps">
  <li>Open the invoice detail page.</li>
  <li>Click <strong>View PDF</strong> in the top-right.</li>
  <li>The PDF opens in a new browser tab. From there you can print it, save it, or email it to the customer.</li>
</ol>

<h1 id="purchase-journey">6 · Purchasing journey (receiving stock from suppliers)</h1>

<h2>6.1 — Adding a supplier</h2>
<ol class="steps">
  <li>Sidebar → <strong>Suppliers</strong>.</li>
  <li>Click <strong>+ New Supplier</strong>.</li>
  <li>Fill in: company name, contact person, phone, email, address, tax number.</li>
  <li>Click <strong>Save</strong>.</li>
</ol>

<h2>6.2 — Creating a Purchase Order</h2>
<ol class="steps">
  <li>Sidebar → <strong>Purchase Orders</strong>.</li>
  <li>Click <strong>+ New PO</strong>.</li>
  <li>Pick the supplier from the dropdown.</li>
  <li>Search and add the products you are ordering, with quantities and unit costs.</li>
  <li>Set the expected delivery date and add any notes.</li>
  <li>Click <strong>Save Purchase Order</strong>.</li>
</ol>
<p>The PO is now marked <strong>Ordered</strong>. The supplier's "payable balance" (what you owe them) is increased by the PO total.</p>

<h2>6.3 — Receiving the stock</h2>
<p>When the truck arrives at the warehouse:</p>
<ol class="steps">
  <li>Open the PO from the Purchase Orders page.</li>
  <li>In the <strong>Receive Now</strong> column, type how many of each item actually arrived.</li>
  <li>Click <strong>Receive Selected</strong>.</li>
</ol>
<p>Stock counts for each received item increase immediately. If only part of the shipment arrived, the PO status flips to <strong>Partial</strong> — repeat the receive step when the rest arrives. Once everything is received, status becomes <strong>Received</strong>.</p>

<div class="callout tip">
<strong>Tip</strong>
<p>Always receive items <em>as you physically verify them</em>. If 10 laptops were ordered but only 9 arrived in good condition, receive 9. Mark the 10th as a separate dispute with the supplier — don't pretend you got 10 just to clear the PO.</p>
</div>

<h2>6.4 — Paying the supplier</h2>
<ol class="steps">
  <li>Open the PO.</li>
  <li>In the <strong>Record Payment</strong> panel on the right, enter the amount, pick the method, write the reference.</li>
  <li>Click <strong>Save Payment</strong>.</li>
</ol>
<p>The PO balance drops. The supplier's overall payable balance also drops.</p>

<h1 id="customer-journey">7 · Customer management journey</h1>

<h2>7.1 — Viewing a customer's full history</h2>
<ol class="steps">
  <li>Sidebar → <strong>Customers</strong>.</li>
  <li>Click the customer's name.</li>
</ol>
<p>You see a complete ledger: every invoice they have ever received, every payment they have made, in chronological order, with a running balance after each row. This is what the customer sees if you send them a statement.</p>

<h2>7.2 — Updating credit limit or contact details</h2>
<ol class="steps">
  <li>Go to the customer detail page.</li>
  <li>(UI for in-place edit coming next; for now use the API or the New Customer flow.)</li>
</ol>

<h1 id="quote-journey">8 · Quotations journey</h1>
<p>Wholesale buyers usually want a written quote before committing.</p>

<h2>8.1 — Creating a quotation</h2>
<ol class="steps">
  <li>Sidebar → <strong>Quotations</strong>.</li>
  <li>Click <strong>+ New Quotation</strong>.</li>
  <li>Pick the customer, add products, set validity date, add notes.</li>
  <li>Click <strong>Save Quotation</strong>.</li>
</ol>
<p>The quote does <strong>not</strong> deduct stock or affect the customer balance — it is just an offer document.</p>

<h2>8.2 — Converting a quote into a sale</h2>
<p>When the customer accepts:</p>
<ol class="steps">
  <li>Open the Quotations list.</li>
  <li>Click <strong>Convert to Invoice</strong> next to the quote.</li>
</ol>
<p>A real invoice is created. Stock is deducted. Customer balance updates. The quote is marked <strong>Converted</strong> and links to the new invoice.</p>

<h1 id="returns">9 · Processing a return</h1>
<p>If a customer returns goods (e.g. defective laptop), an admin can reverse the sale:</p>
<ol class="steps">
  <li>Open the invoice on which the goods were sold.</li>
  <li>Click <strong>Process Return</strong> in the top-right (admin only).</li>
  <li>Confirm.</li>
</ol>
<p>Stock is restored, the invoice is marked <strong>Returned</strong>, and the customer's outstanding balance is reduced by the amount that had not yet been paid. The original invoice stays in the system as historical record — nothing is deleted.</p>

<h1 id="reports">10 · Reading reports</h1>
<p>Sidebar → <strong>Reports</strong>. Pick a date range at the top, then click the tab for the report you want.</p>

<h3>P&amp;L Summary <span class="role-pill role-admin">Admin</span></h3>
<p>Four numbers for any date range:</p>
<ul>
  <li><strong>Revenue</strong> — total of all line-item sale values (after discount).</li>
  <li><strong>Cost</strong> — sum of <code>quantity × purchase price</code> for every line sold.</li>
  <li><strong>Gross Profit</strong> — Revenue minus Cost.</li>
  <li><strong>Margin %</strong> — Gross Profit as a percentage of Revenue.</li>
</ul>

<h3>Sales by Product</h3>
<p>For each product sold in the range: total quantity sold and total revenue. Sorted highest-revenue first.</p>

<h3>Sales by Customer</h3>
<p>For each customer who bought in the range: number of invoices and total revenue contribution.</p>

<h3>Receivables</h3>
<p>Every customer with an outstanding balance, largest first. Use this to chase payments.</p>

<h3>Payables</h3>
<p>Every supplier you owe, largest first. Use this to plan cash outflows.</p>

<h3>Monthly Trends <span class="role-pill role-admin">Admin</span></h3>
<p>A 12-month line chart showing revenue, cost, and gross profit per calendar month. Look for trends: is margin shrinking? Is one month weaker year after year?</p>

<h1 id="settings">11 · Settings &amp; customisation</h1>
<p>Sidebar → <strong>Settings</strong> (admin only). Every field on this page is used somewhere else in the app.</p>
<table>
  <thead><tr><th>Field</th><th>What it controls</th></tr></thead>
  <tbody>
    <tr><td>Business name, address, phone, email, tax number</td><td>Header of every PDF invoice</td></tr>
    <tr><td>Currency code</td><td>The text shown next to every money value across the whole app (e.g. <code>PKR</code>)</td></tr>
    <tr><td>Default tax rate</td><td>Pre-fills the tax % when creating an invoice</td></tr>
    <tr><td>Invoice prefix</td><td>The text before the number, e.g. <code>INV-</code></td></tr>
    <tr><td>Invoice next number</td><td>The number to use for the next sale (auto-incremented)</td></tr>
    <tr><td>Show tax on invoices</td><td>Whether the tax line appears on PDFs</td></tr>
    <tr><td>Logo URL</td><td>Used in headers and PDFs (already wired to the ALMTech logo)</td></tr>
  </tbody>
</table>

<h1 id="users">12 · Managing staff &amp; roles</h1>
<p>Sidebar → <strong>Users</strong> (admin only).</p>
<h3>Adding a staff account</h3>
<ol class="steps">
  <li>Click <strong>+ New User</strong>.</li>
  <li>Enter name, email, a temporary password.</li>
  <li>Pick the role: Admin, Sales, or Stock.</li>
  <li>Click <strong>Save</strong>.</li>
</ol>
<p>The new user can sign in immediately with the email and password you set. They should change their password from Settings on first login (feature to be wired in the UI).</p>

<h3>Disabling an account</h3>
<p>Click <strong>Disable</strong> next to a user. Their account stays in the system (so historical actions still show their name), but they can no longer sign in. You can re-enable them later by clicking <strong>Enable</strong>.</p>

<h1 id="activity">13 · Activity log &amp; audit trail</h1>
<p>Sidebar → <strong>Activity</strong> (admin only). Every meaningful action by any user is recorded with timestamp:</p>
<ul>
  <li>Logins and password changes</li>
  <li>Customer / supplier / product creation and edits</li>
  <li>Invoice creation, payments, returns</li>
  <li>Purchase orders, stock receipts, supplier payments</li>
  <li>Settings changes, user management actions</li>
</ul>
<p>The activity log <strong>cannot be edited or deleted</strong>. This is the audit trail used to investigate "who did what, when, and why" for any past transaction.</p>

<h1 id="auto">14 · What the system does automatically</h1>
<p>You take one action; the system updates everything else. Here is the full list:</p>
<table>
  <thead><tr><th>When you do this</th><th>The system also does this</th></tr></thead>
  <tbody>
    <tr><td>Save a new invoice</td><td>Deducts stock · raises customer balance · writes activity log · creates stock-movement records · makes PDF available</td></tr>
    <tr><td>Record a customer payment</td><td>Reduces invoice balance · reduces customer outstanding · flips status to "Paid" when zero · writes activity log</td></tr>
    <tr><td>Save a Purchase Order</td><td>Raises supplier payable · writes activity log</td></tr>
    <tr><td>Receive PO items</td><td>Increases stock · updates the product's purchase price · creates stock-movement records · sets PO status to Partial or Received</td></tr>
    <tr><td>Pay a supplier</td><td>Reduces PO balance · reduces supplier payable · writes activity log</td></tr>
    <tr><td>Process a return</td><td>Restores stock · reduces customer balance · marks invoice "Returned" · writes activity log</td></tr>
    <tr><td>Convert a quotation</td><td>Creates an invoice with all the side-effects above · marks quote "Converted"</td></tr>
    <tr><td>Adjust stock manually</td><td>Writes a stock-movement entry with your reason · stock count updates · writes activity log</td></tr>
  </tbody>
</table>

<h1 id="setup">15 · First-time setup checklist</h1>
<p>When you start using this for the real ALMTech business, do these steps in order:</p>
<ol class="steps">
  <li>Sign in as <strong>admin</strong> with the default credentials.</li>
  <li>Go to <strong>Settings</strong> and fill in the business profile (name, address, tax number, phone, email).</li>
  <li>Change the admin password by going to <strong>Settings</strong> (password change UI to be added) or via the API.</li>
  <li>Go to <strong>Users</strong> and create accounts for each staff member with the appropriate role.</li>
  <li>Go to <strong>Suppliers</strong> and add every supplier you regularly buy from.</li>
  <li>Go to <strong>Inventory</strong> and add every product you stock. For laptops, tick "track serial numbers". Set realistic low-stock thresholds.</li>
  <li>Go to <strong>Customers</strong> and add every wholesale client you currently serve, with their credit limits.</li>
  <li>If you want to back-fill recent inventory: go to <strong>Purchase Orders</strong> and log recent supplier deliveries to bring stock counts to current reality.</li>
  <li>Verify the Dashboard makes sense.</li>
  <li>Start using the system day-to-day.</li>
</ol>

<h1 id="tips">16 · Tips, troubleshooting &amp; FAQ</h1>

<h3>"I can't open the website"</h3>
<p>Make sure both servers are running. From the Terminal:</p>
<p><code>/Users/haroon/almtech-business-suite/start.sh</code></p>
<p>This starts the backend (on port 5050) and the web app (on port 5174). Then open <a href="http://localhost:5174">http://localhost:5174</a>.</p>

<h3>"The app says my credit limit is exceeded"</h3>
<p>This means the customer already owes more than their set credit limit. Either reduce the sale, collect a payment from them first, or increase their credit limit (Settings).</p>

<h3>"I can't see Reports / Settings / Users"</h3>
<p>You must be signed in as an <strong>admin</strong>. Sales and Stock roles cannot access these.</p>

<h3>"I made a mistake on an invoice"</h3>
<p>Currently the safest correction is to <strong>process a return</strong> on the wrong invoice (admin only) and create a new correct invoice. Both will appear in the activity log so the correction is auditable.</p>

<h3>"How do I export reports?"</h3>
<p>Export-to-PDF / Excel buttons are wired in the backend; the front-end button is to be added in the next iteration. For now you can take screenshots or print the reports page via Cmd+P.</p>

<h3>"Where are my files stored?"</h3>
<p>The database lives at <code>backend/data/</code> inside the app folder. Back up this folder regularly. In production it would be backed up automatically every night.</p>

<h3>"Can I use this from multiple computers at the same time?"</h3>
<p>Right now it runs only on your Mac. In production it would be hosted on a VPS — every staff member would log in from their own machine via the web.</p>

<h1 id="glossary">17 · Glossary</h1>
<table>
  <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
  <tbody>
    <tr><td><strong>SKU</strong></td><td>Stock Keeping Unit — the unique code for each product (e.g. <code>APL-MBP14-M3</code>).</td></tr>
    <tr><td><strong>Credit limit</strong></td><td>Max amount a customer can owe before new sales to them are blocked.</td></tr>
    <tr><td><strong>Outstanding balance</strong></td><td>What a customer owes (receivable) or what you owe a supplier (payable).</td></tr>
    <tr><td><strong>Stock movement</strong></td><td>An immutable log entry created every time stock changes (sale, purchase, return, adjustment).</td></tr>
    <tr><td><strong>Ledger</strong></td><td>A running record of every transaction with a customer or supplier, with the running balance after each row.</td></tr>
    <tr><td><strong>Quotation</strong></td><td>A non-binding offer document. Does not affect stock or balances until converted to an invoice.</td></tr>
    <tr><td><strong>PO</strong></td><td>Purchase Order — what you send to a supplier when you want to buy stock.</td></tr>
    <tr><td><strong>Partial payment</strong></td><td>A payment that doesn't cover the full invoice or PO. The system tracks the remaining balance until paid in full.</td></tr>
    <tr><td><strong>RBAC</strong></td><td>Role-Based Access Control — the rule system that decides which user role can see and do which action.</td></tr>
    <tr><td><strong>JWT</strong></td><td>JSON Web Token — the digital pass your browser receives after login that proves who you are for the next 12 hours.</td></tr>
    <tr><td><strong>Embedded database</strong></td><td>The current development setup. The database runs inside the app and stores data in a folder. In production it would run as a separate service.</td></tr>
  </tbody>
</table>

<footer>
  ALMTech Business Suite · User Guide v1.0 · Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
</footer>

</div>
</body>
</html>`;

fs.writeFileSync(OUT, html);
console.log(`Generated: ${OUT}`);
console.log(`Size: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
