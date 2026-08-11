import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Account from '../models/Account.js';
import Expense from '../models/Expense.js';
import FinancialTransaction from '../models/FinancialTransaction.js';

// ---------------------------------------------------------------------------
// Every export names its columns explicitly — no raw Mongo document is ever written to
// a sheet, and no _id leaks unless it is genuinely useful. Amounts declare type
// 'money'/'number' and dates declare 'date'/'datetime' so ExcelJS writes real numeric
// and date cells the owner can sum and sort in Excel.
//
// Exports read from the same endpoints/aggregations the screens use, so a sheet can
// never disagree with what the app shows.
// ---------------------------------------------------------------------------

const dateRange = (from, to, field) => {
  if (!from && !to) return null;
  const r = {};
  if (from) r.$gte = new Date(from);
  if (to) r.$lte = new Date(to);
  return { [field]: r };
};

const TYPE_LABELS = {
  customer_payment: 'Customer payment', sale_payment: 'Sale payment', other_income: 'Other income',
  transfer_in: 'Transfer in', expense_reversal: 'Expense reversal', payment_reversal: 'Payment reversal', expense: 'Expense',
  supplier_payment: 'Supplier payment', purchase_payment: 'Purchase payment',
  other_payment: 'Other payment', transfer_out: 'Transfer out',
};

function dealStatus(d) {
  if (d.status === 'cancelled') return 'CANCELLED';
  if (d.status === 'returned') return 'RETURNED';
  if (d.status === 'draft') return 'DRAFT';
  if (d.balance <= 0) return 'PAID';
  if (d.paid > 0) return 'PARTIAL';
  return 'CREDIT';
}

export const EXPORTERS = {
  products: {
    label: 'Products',
    async build() {
      const rows = await Product.find().sort('sku').lean();
      return {
        sheetName: 'Products',
        title: 'Products',
        columns: [
          { header: 'SKU', key: 'sku' },
          { header: 'Name', key: 'name', width: 30 },
          { header: 'Barcode', key: 'barcode' },
          { header: 'Category', key: 'category' },
          { header: 'Brand', key: 'brand' },
          { header: 'Model', key: 'model' },
          { header: 'Purchase Price', type: 'money', key: 'purchasePrice' },
          { header: 'Selling Price', type: 'money', key: 'sellingPrice' },
          { header: 'Stock', type: 'number', key: 'stock' },
          { header: 'Low Stock Threshold', type: 'number', key: 'lowStockThreshold' },
          { header: 'Active', value: (r) => (r.active ? 'Yes' : 'No') },
          { header: 'Description', key: 'description', width: 40 },
        ],
        rows,
      };
    },
  },

  customers: {
    label: 'Customers',
    async build() {
      const rows = await Customer.find().sort('name').lean();
      return {
        sheetName: 'Customers',
        title: 'Customers',
        columns: [
          { header: 'Name', key: 'name', width: 28 },
          { header: 'Company', key: 'company', width: 24 },
          { header: 'Phone', key: 'phone' },
          { header: 'Email', key: 'email', width: 26 },
          { header: 'CNIC/NTN', key: 'cnicNtn' },
          { header: 'Address', key: 'address', width: 30 },
          { header: 'Credit Limit', type: 'money', key: 'creditLimit' },
          { header: 'Outstanding Receivable', type: 'money', key: 'balance' },
          { header: 'Active', value: (r) => (r.active ? 'Yes' : 'No') },
        ],
        rows,
      };
    },
  },

  suppliers: {
    label: 'Suppliers',
    async build() {
      const rows = await Supplier.find().sort('name').lean();
      return {
        sheetName: 'Suppliers',
        title: 'Suppliers',
        notes: ['Supplier records support purchase orders and payables. There is no supplier management screen.'],
        columns: [
          { header: 'Name', key: 'name', width: 28 },
          { header: 'Contact Person', key: 'contactPerson', width: 22 },
          { header: 'Phone', key: 'phone' },
          { header: 'Email', key: 'email', width: 26 },
          { header: 'Address', key: 'address', width: 30 },
          { header: 'Tax Number', key: 'taxNumber' },
          { header: 'Outstanding Payable', type: 'money', key: 'payable' },
          { header: 'Active', value: (r) => (r.active ? 'Yes' : 'No') },
        ],
        rows,
      };
    },
  },

  sales: {
    label: 'Sales',
    async build({ from, to } = {}) {
      const filter = dateRange(from, to, 'issuedAt') || {};
      const rows = await Invoice.find(filter).populate('customer', 'name company').sort('-issuedAt').lean();
      return {
        sheetName: 'Sales',
        title: 'Sales / Invoices',
        columns: [
          { header: 'Date', type: 'date', key: 'issuedAt' },
          { header: 'Invoice Number', key: 'number' },
          { header: 'Customer', value: (r) => r.customer?.name || '' , width: 26 },
          { header: 'Company', value: (r) => r.customer?.company || '' },
          { header: 'Subtotal', type: 'money', key: 'subtotal' },
          { header: 'Discount', type: 'money', key: 'discount' },
          { header: 'Tax', type: 'money', key: 'taxAmount' },
          { header: 'Total', type: 'money', key: 'total' },
          { header: 'Paid', type: 'money', key: 'paid' },
          { header: 'Outstanding', type: 'money', key: 'balance' },
          { header: 'Status', value: (r) => dealStatus(r) },
          { header: 'Settlement', value: (r) => (['cancelled', 'returned', 'draft'].includes(r.status) ? '' : r.balance <= 0 ? 'Cash' : 'Credit') },
          { header: 'Payments', type: 'number', value: (r) => (r.payments || []).length },
          { header: 'Items', type: 'number', value: (r) => (r.items || []).length },
        ],
        rows,
      };
    },
  },

  purchases: {
    label: 'Purchases',
    async build({ from, to } = {}) {
      const filter = dateRange(from, to, 'orderedAt') || {};
      const rows = await PurchaseOrder.find(filter).populate('supplier', 'name').sort('-orderedAt').lean();
      return {
        sheetName: 'Purchases',
        title: 'Purchase Orders',
        columns: [
          { header: 'Date', type: 'date', key: 'orderedAt' },
          { header: 'PO Number', key: 'number' },
          { header: 'Supplier', value: (r) => r.supplier?.name || '', width: 26 },
          { header: 'Expected Date', type: 'date', key: 'expectedAt' },
          { header: 'Subtotal', type: 'money', key: 'subtotal' },
          { header: 'Tax', type: 'money', key: 'taxAmount' },
          { header: 'Total', type: 'money', key: 'total' },
          { header: 'Paid', type: 'money', key: 'paid' },
          { header: 'Outstanding', type: 'money', key: 'balance' },
          { header: 'Status', value: (r) => dealStatus(r) },
          { header: 'Payments', type: 'number', value: (r) => (r.payments || []).length },
          { header: 'Items', type: 'number', value: (r) => (r.items || []).length },
        ],
        rows,
      };
    },
  },

  payments: {
    label: 'Payments',
    async build({ from, to, account, type } = {}) {
      const filter = dateRange(from, to, 'date') || {};
      if (account) filter.account = account;
      if (type) filter.type = type;
      const rows = await FinancialTransaction.find(filter)
        .populate('account', 'name')
        .populate('customer', 'name')
        .populate('supplier', 'name')
        .populate('invoice', 'number')
        .populate('purchaseOrder', 'number')
        .populate('createdBy', 'name')
        .sort('-date')
        .lean();
      return {
        sheetName: 'Payments',
        title: 'Payment History',
        notes: ['Payments recorded before the financial-accounts module have no account attribution and are not listed here.'],
        columns: [
          { header: 'Date', type: 'datetime', key: 'date' },
          { header: 'Type', value: (r) => TYPE_LABELS[r.type] || r.type },
          { header: 'Direction', value: (r) => (r.direction === 'in' ? 'In' : 'Out') },
          { header: 'Account', value: (r) => r.account?.name || '' },
          { header: 'Method', key: 'method' },
          { header: 'Customer', value: (r) => r.customer?.name || '' },
          { header: 'Supplier', value: (r) => r.supplier?.name || '' },
          { header: 'Invoice', value: (r) => r.invoice?.number || '' },
          { header: 'Purchase Order', value: (r) => r.purchaseOrder?.number || '' },
          { header: 'Reference', key: 'reference' },
          { header: 'Description', key: 'description', width: 34 },
          { header: 'Recorded By', value: (r) => r.createdBy?.name || '' },
          { header: 'Amount', type: 'money', key: 'amount' },
        ],
        rows,
      };
    },
  },

  expenses: {
    label: 'Expenses',
    async build({ from, to, category, account, status = 'posted' } = {}) {
      const filter = dateRange(from, to, 'date') || {};
      if (status !== 'all') filter.status = status;
      if (category) filter.category = category;
      if (account) filter.account = account;
      const rows = await Expense.find(filter).populate('account', 'name').populate('createdBy', 'name').sort('-date').lean();
      return {
        sheetName: 'Expenses',
        title: 'Expenses',
        columns: [
          { header: 'Date', type: 'date', key: 'date' },
          { header: 'Category', key: 'category' },
          { header: 'Description', key: 'description', width: 34 },
          { header: 'Account', value: (r) => r.account?.name || '' },
          { header: 'Reference', key: 'reference' },
          { header: 'Status', key: 'status' },
          { header: 'Recorded By', value: (r) => r.createdBy?.name || '' },
          { header: 'Notes', key: 'notes', width: 30 },
          { header: 'Amount', type: 'money', key: 'amount' },
        ],
        rows,
      };
    },
  },

  receivables: {
    label: 'Receivables',
    async build(params, ctx) {
      const data = await ctx.financeReceivables(params);
      return {
        sheetName: 'Receivables',
        title: 'Receivables — money customers owe',
        notes: ['Aging is measured from the invoice date; the system has no payment due-date field.'],
        columns: [
          { header: 'Customer', key: 'name', width: 28 },
          { header: 'Company', key: 'company', width: 22 },
          { header: 'Phone', key: 'phone' },
          { header: 'Invoices', type: 'number', key: 'invoiceCount' },
          { header: 'Oldest Invoice', type: 'date', key: 'oldestDate' },
          { header: 'Days Outstanding', type: 'number', key: 'oldestAgeDays' },
          { header: 'Total', type: 'money', key: 'total' },
          { header: 'Paid', type: 'money', key: 'paid' },
          { header: 'Outstanding', type: 'money', key: 'outstanding' },
          { header: 'Current', type: 'money', value: (r) => r.aging?.current },
          { header: '1-30 Days', type: 'money', value: (r) => r.aging?.d1_30 },
          { header: '31-60 Days', type: 'money', value: (r) => r.aging?.d31_60 },
          { header: '61-90 Days', type: 'money', value: (r) => r.aging?.d61_90 },
          { header: '90+ Days', type: 'money', value: (r) => r.aging?.d90_plus },
        ],
        rows: data.rows,
      };
    },
  },

  payables: {
    label: 'Payables',
    async build(params, ctx) {
      const data = await ctx.financePayables(params);
      return {
        sheetName: 'Payables',
        title: 'Payables — money the business owes',
        notes: ['Aging is measured from the purchase-order date; the system has no payment due-date field.'],
        columns: [
          { header: 'Supplier', key: 'name', width: 28 },
          { header: 'Contact', key: 'contactPerson', width: 22 },
          { header: 'Phone', key: 'phone' },
          { header: 'Purchase Orders', type: 'number', key: 'poCount' },
          { header: 'Oldest PO', type: 'date', key: 'oldestDate' },
          { header: 'Days Outstanding', type: 'number', key: 'oldestAgeDays' },
          { header: 'Total', type: 'money', key: 'total' },
          { header: 'Paid', type: 'money', key: 'paid' },
          { header: 'Outstanding', type: 'money', key: 'outstanding' },
          { header: 'Current', type: 'money', value: (r) => r.aging?.current },
          { header: '1-30 Days', type: 'money', value: (r) => r.aging?.d1_30 },
          { header: '31-60 Days', type: 'money', value: (r) => r.aging?.d31_60 },
          { header: '61-90 Days', type: 'money', value: (r) => r.aging?.d61_90 },
          { header: '90+ Days', type: 'money', value: (r) => r.aging?.d90_plus },
        ],
        rows: data.rows,
      };
    },
  },

  'account-ledgers': {
    label: 'Account Ledgers',
    multiSheet: true,
    async build({ from, to } = {}) {
      const accounts = await Account.find().sort('sortOrder name').lean();
      const sheets = [
        {
          sheetName: 'Summary',
          columns: [
            { header: 'Account', key: 'name', width: 24 },
            { header: 'Type', key: 'type' },
            { header: 'Opening Balance', type: 'money', key: 'openingBalance' },
            { header: 'Current Balance', type: 'money', key: 'currentBalance' },
            { header: 'Active', value: (r) => (r.active ? 'Yes' : 'No') },
          ],
          rows: accounts,
        },
      ];
      for (const a of accounts) {
        const filter = { account: a._id, ...(dateRange(from, to, 'date') || {}) };
        const txns = await FinancialTransaction.find(filter)
          .populate('customer', 'name').populate('supplier', 'name')
          .populate('invoice', 'number').populate('purchaseOrder', 'number')
          .sort('date').lean();
        let running = a.openingBalance;
        const rows = txns.map((t) => {
          running += t.direction === 'in' ? t.amount : -t.amount;
          return {
            date: t.date,
            type: TYPE_LABELS[t.type] || t.type,
            party: t.customer?.name || t.supplier?.name || '',
            ref: t.invoice?.number || t.purchaseOrder?.number || t.reference || '',
            description: t.description || '',
            moneyIn: t.direction === 'in' ? t.amount : null,
            moneyOut: t.direction === 'out' ? t.amount : null,
            balance: running,
          };
        });
        sheets.push({
          sheetName: a.name,
          columns: [
            { header: 'Date', type: 'date', key: 'date' },
            { header: 'Type', key: 'type', width: 20 },
            { header: 'Customer / Supplier', key: 'party', width: 24 },
            { header: 'Reference', key: 'ref' },
            { header: 'Description', key: 'description', width: 34 },
            { header: 'Money In', type: 'money', key: 'moneyIn' },
            { header: 'Money Out', type: 'money', key: 'moneyOut' },
            { header: 'Balance', type: 'money', key: 'balance' },
          ],
          rows,
        });
      }
      return sheets;
    },
  },

  deals: {
    label: 'Deals',
    multiSheet: true,
    async build({ from, to } = {}) {
      const invFilter = dateRange(from, to, 'issuedAt') || {};
      const poFilter = dateRange(from, to, 'orderedAt') || {};
      const [invs, pos] = await Promise.all([
        Invoice.find(invFilter).populate('customer', 'name company').sort('-issuedAt').lean(),
        PurchaseOrder.find(poFilter).populate('supplier', 'name').sort('-orderedAt').lean(),
      ]);
      return [
        {
          sheetName: 'Sales Deals',
          columns: [
            { header: 'Date', type: 'date', key: 'issuedAt' },
            { header: 'Deal #', key: 'number' },
            { header: 'Customer', value: (r) => r.customer?.name || '', width: 26 },
            { header: 'Total', type: 'money', key: 'total' },
            { header: 'Paid', type: 'money', key: 'paid' },
            { header: 'Outstanding', type: 'money', key: 'balance' },
            { header: 'Status', value: (r) => dealStatus(r) },
            { header: 'Settlement', value: (r) => (['cancelled', 'returned', 'draft'].includes(r.status) ? '' : r.balance <= 0 ? 'Cash' : 'Credit') },
            { header: 'Payment Count', type: 'number', value: (r) => (r.payments || []).length },
          ],
          rows: invs,
        },
        {
          sheetName: 'Purchase Deals',
          columns: [
            { header: 'Date', type: 'date', key: 'orderedAt' },
            { header: 'Deal #', key: 'number' },
            { header: 'Supplier', value: (r) => r.supplier?.name || '', width: 26 },
            { header: 'Total', type: 'money', key: 'total' },
            { header: 'Paid', type: 'money', key: 'paid' },
            { header: 'Outstanding', type: 'money', key: 'balance' },
            { header: 'Status', value: (r) => dealStatus(r) },
            { header: 'Settlement', value: (r) => (['cancelled', 'draft'].includes(r.status) ? '' : r.balance <= 0 ? 'Cash' : 'Credit') },
            { header: 'Payment Count', type: 'number', value: (r) => (r.payments || []).length },
          ],
          rows: pos,
        },
      ];
    },
  },

  'profit-loss': {
    label: 'Profit & Loss',
    multiSheet: true,
    async build(params, ctx) {
      const pl = await ctx.profitAndLoss(params);
      const summary = [
        { line: 'Revenue', amount: pl.revenue },
        { line: 'Cost of Goods Sold', amount: -pl.cost },
        { line: 'Gross Profit', amount: pl.grossProfit },
        { line: 'Operating Expenses', amount: -pl.expenses },
        { line: 'Net Profit', amount: pl.netProfit },
      ];
      return [
        {
          sheetName: 'P&L Summary',
          columns: [
            { header: 'Line', key: 'line', width: 26 },
            { header: 'Amount', type: 'money', key: 'amount' },
          ],
          rows: summary,
        },
        {
          sheetName: 'Expenses by Category',
          columns: [
            { header: 'Category', key: 'category', width: 26 },
            { header: 'Amount', type: 'money', key: 'total' },
          ],
          rows: pl.expensesByCategory || [],
        },
      ];
    },
  },

  'expenses-daily': {
    label: 'Daily Expense Report',
    async build({ date } = {}, ctx) {
      const data = await ctx.dailyExpenses({ date });
      return {
        sheetName: 'Daily Expenses',
        title: `Daily Expenses — ${new Date(data.date).toDateString()}`,
        columns: [
          { header: 'Category', key: 'category', width: 26 },
          { header: 'Entries', type: 'number', key: 'count' },
          { header: 'Total', type: 'money', key: 'total' },
        ],
        rows: data.byCategory,
      };
    },
  },

  'expenses-monthly': {
    label: 'Monthly Expense Report',
    multiSheet: true,
    async build({ month } = {}, ctx) {
      const data = await ctx.monthlyExpenses({ month });
      return [
        {
          sheetName: 'By Category',
          columns: [
            { header: 'Category', key: 'category', width: 26 },
            { header: 'Entries', type: 'number', key: 'count' },
            { header: 'Total', type: 'money', key: 'total' },
          ],
          rows: data.byCategory,
        },
        {
          sheetName: 'By Day',
          columns: [
            { header: 'Date', type: 'date', key: 'date' },
            { header: 'Entries', type: 'number', key: 'count' },
            { header: 'Total', type: 'money', key: 'total' },
          ],
          rows: data.byDay,
        },
        {
          sheetName: 'By Account',
          columns: [
            { header: 'Account', key: 'account', width: 26 },
            { header: 'Total', type: 'money', key: 'total' },
          ],
          rows: data.byAccount,
        },
      ];
    },
  },
};
