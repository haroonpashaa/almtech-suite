export const navigationSections = [
  {
    title: null,
    items: [{ to: '/', label: 'Dashboard', exact: true, icon: 'home' }],
  },
  {
    title: 'Sales',
    items: [
      { to: '/pos', label: 'New Sale', roles: ['admin', 'sales'], icon: 'cart' },
      { to: '/invoices', label: 'Invoices', icon: 'invoice' },
      { to: '/quotations', label: 'Quotations', icon: 'quote' },
    ],
  },
  {
    title: 'Purchasing',
    items: [
      { to: '/purchase-orders', label: 'Purchase Orders', icon: 'truck' },
      // Sales never raises a purchase order, so it has no reason to browse suppliers.
      { to: '/suppliers', label: 'Suppliers', roles: ['admin', 'stock'], icon: 'warehouse' },
    ],
  },
  {
    title: 'Customers',
    items: [{ to: '/customers', label: 'Customers', icon: 'users' }],
  },
  {
    title: 'Inventory',
    items: [{ to: '/products', label: 'Products', icon: 'box' }],
  },
  {
    title: 'Finance',
    items: [
      { to: '/accounts', label: 'Accounts', roles: ['admin'], icon: 'wallet' },
      { to: '/deals', label: 'Transactions', roles: ['admin'], icon: 'ledgerList' },
      { to: '/expenses', label: 'Expenses', roles: ['admin', 'sales'], icon: 'receipt' },
      { to: '/receivables', label: 'Receivables', roles: ['admin', 'sales'], icon: 'receivable' },
      { to: '/payables', label: 'Payables', roles: ['admin'], icon: 'payable' },
    ],
  },
  {
    // Deal Accounts is intentionally a separate top-level navigation item from
    // Finance > Transactions; it opens the existing Admin-only deal workspace.
    title: null,
    items: [{ to: '/deal-accounts', label: 'Deal Accounts', roles: ['admin'], icon: 'ledgerList' }],
  },
  {
    title: 'Reports',
    items: [
      { to: '/reports', label: 'Ledger Reports', icon: 'chart' },
      { to: '/expense-reports', label: 'Expense Reports', roles: ['admin', 'sales'], icon: 'chartBar' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/data', label: 'Import / Export', roles: ['admin', 'sales'], icon: 'exchange' },
      { to: '/users', label: 'Users', roles: ['admin'], icon: 'shield' },
      { to: '/activity', label: 'Activity', roles: ['admin'], icon: 'clock' },
      { to: '/system-health', label: 'System Health', roles: ['admin'], icon: 'pulse' },
      { to: '/settings', label: 'Settings', roles: ['admin'], icon: 'cog' },
    ],
  },
];

export function visibleNavigationSections(role) {
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);
}
