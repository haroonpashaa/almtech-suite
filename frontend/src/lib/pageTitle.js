/* ---------------------------------------------------------------------------
   Every screen used to report the same browser-tab title, which makes tab
   switching, history and screen-reader page announcements useless.

   The mapping lives here as a pure function rather than as a call in each of the
   31 pages: one place to keep correct, and it can be tested directly in node
   without a DOM. Patterns are ordered most-specific first, because "/products/new"
   must not be answered by the "/products/:id" rule.
   --------------------------------------------------------------------------- */

export const APP_NAME = 'ALM Business Suite';

// [pattern, title]. `:seg` matches one path segment.
const ROUTES = [
  ['/', 'Dashboard'],
  ['/login', 'Sign in'],

  ['/products/new', 'New Product'],
  ['/products/:id/edit', 'Edit Product'],
  ['/products', 'Products'],

  ['/customers/:id', 'Customer'],
  ['/customers', 'Customers'],

  ['/pos', 'Point of Sale'],

  ['/invoices/:id', 'Invoice'],
  ['/invoices', 'Invoices'],

  ['/quotations/new', 'New Quotation'],
  ['/quotations', 'Quotations'],

  ['/purchase-orders/new', 'New Purchase Order'],
  ['/purchase-orders/:id', 'Purchase Order'],
  ['/purchase-orders', 'Purchase Orders'],

  ['/suppliers/:id', 'Supplier'],
  ['/suppliers', 'Suppliers'],

  ['/accounts/:id', 'Account Ledger'],
  ['/accounts', 'Accounts'],

  ['/deals/:kind/:id', 'Transaction'],
  ['/deals', 'Transactions'],

  ['/receivables/:id', 'Receivable'],
  ['/receivables', 'Receivables'],

  ['/payables/:id', 'Payable'],
  ['/payables', 'Payables'],

  ['/expense-reports', 'Expense Reports'],
  ['/expenses', 'Expenses'],

  ['/reports', 'Reports'],
  ['/data', 'Import / Export'],
  ['/users', 'Users'],
  ['/activity', 'Activity'],
  ['/settings', 'Settings'],
];

function toRegex(pattern) {
  if (pattern === '/') return /^\/$/;
  const body = pattern
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^/${body}/?$`);
}

const COMPILED = ROUTES.map(([pattern, title]) => [toRegex(pattern), title]);

/** The page name for a pathname, or null when nothing matches. */
export function pageNameFor(pathname) {
  for (const [re, title] of COMPILED) {
    if (re.test(pathname)) return title;
  }
  return null;
}

/** The full document title for a pathname. Always ends with the product name. */
export function documentTitleFor(pathname) {
  const name = pageNameFor(pathname);
  return name ? `${name} · ${APP_NAME}` : APP_NAME;
}
