import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Account from '../models/Account.js';
import Expense, { EXPENSE_CATEGORIES } from '../models/Expense.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { postPaymentAtomically } from '../utils/ledger.js';
import { applyInvoicePayment } from '../controllers/invoice.controller.js';
import { str, num, date as toDate, bool } from '../utils/excel.js';

// ---------------------------------------------------------------------------
// Row classification used by preview and commit alike.
//   CREATE — a new record will be inserted
//   UPDATE — an existing record will be amended (never silently: the preview says so)
//   SKIP   — already present and identical enough to leave alone
//   ERROR  — will not be written at all
// ---------------------------------------------------------------------------
const R = { CREATE: 'CREATE', UPDATE: 'UPDATE', SKIP: 'SKIP', ERROR: 'ERROR' };

function mkRow(raw) {
  return { excelRow: raw.__row, action: null, errors: [], data: {}, note: null, key: null };
}
const err = (row, field, value, message) => {
  row.errors.push({ field, value: value == null ? '' : String(value).slice(0, 60), message });
  row.action = R.ERROR;
};

const money = (row, field, label, v, { required = false, min = 0 } = {}) => {
  const n = num(v);
  if (n === null) {
    if (required) err(row, field, v, `${label} is required`);
    return required ? null : 0;
  }
  if (Number.isNaN(n)) {
    err(row, field, v, `${label} is not a valid number`);
    return null;
  }
  if (min != null && n < min) {
    err(row, field, v, `${label} cannot be less than ${min}`);
    return null;
  }
  return n;
};

// ===========================================================================
// PRODUCTS
// ===========================================================================

// "N/A" (any case, with or without the dot/slash) is a placeholder for "no value",
// not text to store. Real stock-intake spreadsheets use this constantly for columns
// like Media Serial or Media Mfg when a unit has no drive fitted.
function cleanText(v) {
  const s = str(v);
  return /^n\.?\/?a\.?$/i.test(s) ? '' : s;
}

// Grade, Battery, cosmetic-condition columns, the drive's own serial, and a secondary
// Notes column all describe the same physical unit COMMENTS already describes — none
// of them get a database field of their own (none exists), so they are folded into one
// deterministic Comments value. Order is fixed and nothing here is ever dropped: a
// value that IS supplied always produces its line, and the original Comments text is
// always included verbatim, never rewritten.
export function composeComments({ grade, comments, battery, usageSigns, casingCondition, screenCondition, notes, mediaSerial }) {
  const lines = [];
  if (grade) lines.push(`Grade: ${grade}`);
  if (comments) lines.push(comments);
  if (battery) lines.push(`Battery: ${battery}`);
  if (usageSigns) lines.push(`Usage signs: ${usageSigns}`);
  if (casingCondition) lines.push(`Casing: ${casingCondition}`);
  if (screenCondition) lines.push(`Screen: ${screenCondition}`);
  if (notes) lines.push(`Notes: ${notes}`);
  if (mediaSerial) lines.push(`Media serial: ${mediaSerial}`);
  return lines.join('\n');
}

// The storage drive's make and model, exactly as supplied — never a guess at capacity.
// A model number like "MZVLB256HBHQ" may have a capacity buried in it, but parsing
// that out is inference, not data the sheet actually states, so it is never attempted.
export function composeStorageDescription({ mediaMfg, mediaModel }) {
  return [mediaMfg, mediaModel].filter(Boolean).join(' — ');
}

const products = {
  label: 'Products',
  sheetName: 'Products',
  aliases: {
    sku: ['Serial Number', 'SKU', 'Serial', 'Serial No'],
    name: ['Name', 'Product Name'],
    category: ['Category'],
    brand: ['Brand', 'MFG', 'MAKE'],
    model: ['Model'],
    processor: ['Processor', 'CPU', 'CPU ( IF APPLICABLE )'],
    ram: ['RAM', 'Memory'],
    storage: ['Storage', 'ROM', 'SSD', 'Hard Disk', 'HDD'],
    mediaMfg: ['Media Mfg', 'Media Make'],
    mediaModel: ['Media Model', 'Media Model Number'],
    mediaSerial: ['Media Serial', 'Media Serial No'],
    graphics: ['Graphics', 'GPU'],
    screen: ['Screen', 'Display'],
    condition: ['Condition'],
    warranty: ['Warranty'],
    comments: ['Comments', 'Condition Notes'],
    battery: ['Battery'],
    notes: ['Notes'],
    grade: ['Grade'],
    usageSigns: ['Usage Signs'],
    casingCondition: ['Casing Condition'],
    screenCondition: ['Screen Condition'],
    sellingPrice: ['Selling Price', 'Price'],
    purchasePrice: ['Purchase Price', 'Cost'],
    stock: ['Stock', 'Quantity'],
    lowStockThreshold: ['Low Stock Threshold'],
    barcode: ['Barcode'],
    active: ['Active'],
  },
  required: ['sku'],
  instructions: [
    'Serial Number is required and uniquely identifies each physical unit — SKU is accepted as an alternative header for the same column. Re-importing the same Serial Number updates that unit.',
    'Name is optional. If absent, it is taken from Model. If both Name and Model are missing, the row is rejected.',
    'Barcode is optional but must be unique across all products when supplied (Change 2 rule).',
    'Specification columns (Processor, RAM, Storage/ROM, Graphics, Screen, Condition, Warranty) are optional. Leave a column out entirely and existing products keep what they already have.',
    'Condition accepts new, used or refurbished. A row with none supplied defaults to used when creating a new product; an existing product keeps its condition unless the sheet supplies a valid one.',
    'Comments is free text for defects, cosmetic condition, or missing accessories. Grade, Battery, Usage Signs, Casing Condition, Screen Condition, Notes and Media Serial — when present — are automatically folded into Comments alongside the original Comments text; nothing is discarded.',
    'Media Mfg/Make and Media Model/Model Number (the storage drive\'s own make and model) are combined into Storage as descriptive text. Capacity is never guessed from a model number.',
    '"N/A" (any case) in any column is treated as empty, not stored as text.',
    'Columns this importer does not recognize are never guessed at — they are reported as not imported rather than mapped to the wrong field.',
    '"Description" is not currently imported to any field — a real stock spreadsheet\'s Description column has ambiguous, unconfirmed meaning and is deliberately left unmapped rather than guessed at.',
    'Delete the example row before importing.',
  ],
  example: {
    sku: 'EXAMPLE-001', name: 'Example Laptop',
    category: 'Laptops', brand: 'Acme', model: 'X1',
    processor: 'Intel Core i7-1355U', ram: '16GB DDR5', storage: '512GB NVMe SSD',
    graphics: 'Intel Iris Xe', screen: '14\" FHD', condition: 'new', warranty: '1 year',
    comments: 'Minor scratch on lid',
    sellingPrice: 150000, purchasePrice: 120000,
    stock: 10, lowStockThreshold: 5, barcode: '', active: 'Yes',
  },

  async prepare(rows) {
    const skus = rows.map((r) => cleanText(r.sku).toUpperCase()).filter(Boolean);
    const barcodes = rows.map((r) => cleanText(r.barcode)).filter(Boolean);
    const existing = await Product.find({ $or: [{ sku: { $in: skus } }, { barcode: { $in: barcodes } }] })
      .select('sku barcode name');
    const bySku = new Map(existing.map((p) => [p.sku, p]));
    const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode, p]));

    // Whether Stock/Quantity has a column in this file at all. readSheet() only ever
    // puts a key in every row record when a header actually matched it, so its
    // presence on one row means it is present on all of them — this is a fact about
    // the file, not about any single row.
    const hasStockColumn = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], 'stock');

    const seenSku = new Map();
    const seenBarcode = new Map();
    const out = [];

    for (const raw of rows) {
      const row = mkRow(raw);
      const warnings = [];

      const skuRaw = raw.sku;
      const skuIsNumeric = typeof skuRaw === 'number';
      const sku = cleanText(skuRaw).toUpperCase();
      const name = cleanText(raw.name);
      const model = cleanText(raw.model);
      const barcode = cleanText(raw.barcode);

      if (!sku) {
        err(row, 'Serial Number', raw.sku, 'Serial Number is required');
      } else if (skuIsNumeric) {
        // Excel storing a serial as a number can silently drop leading zeros before
        // this code ever sees the value — that loss already happened and cannot be
        // recovered. What CAN be prevented is trusting a value large enough that
        // JavaScript's own number type can no longer represent it exactly.
        if (Math.abs(skuRaw) > Number.MAX_SAFE_INTEGER) {
          err(
            row, 'Serial Number', sku,
            'This Serial Number is too large to be stored safely as a number in the spreadsheet — ' +
              'format the Serial column as Text in Excel and re-upload.'
          );
        } else {
          warnings.push('Serial Number was stored as a number in the spreadsheet — verify no leading zeros were lost.');
        }
      }

      if (!name && !model) err(row, 'Name', raw.name, 'Name or Model is required');

      if (sku && seenSku.has(sku)) err(row, 'Serial Number', sku, `duplicate Serial Number — already used on row ${seenSku.get(sku)} of this file`);
      else if (sku) seenSku.set(sku, raw.__row);

      if (barcode) {
        if (seenBarcode.has(barcode)) err(row, 'Barcode', barcode, `duplicate barcode — already used on row ${seenBarcode.get(barcode)} of this file`);
        else seenBarcode.set(barcode, raw.__row);
        const owner = byBarcode.get(barcode);
        if (owner && owner.sku !== sku) err(row, 'Barcode', barcode, `barcode already belongs to ${owner.name} (SKU ${owner.sku})`);
      }

      // money() answers 0 for an absent column, so ask the sheet directly instead.
      const sellingPriceSupplied = raw.sellingPrice !== undefined && raw.sellingPrice !== null && String(raw.sellingPrice).trim() !== '';
      const sellingPrice = money(row, 'Selling Price', 'Selling price', raw.sellingPrice);
      const costSupplied = raw.purchasePrice !== undefined && raw.purchasePrice !== null && String(raw.purchasePrice).trim() !== '';
      const purchasePrice = money(row, 'Purchase Price', 'Purchase price', raw.purchasePrice);
      const stock = money(row, 'Stock', 'Stock', raw.stock);
      const lowStockThreshold = money(row, 'Low Stock Threshold', 'Low stock threshold', raw.lowStockThreshold);

      if (row.action !== R.ERROR) {
        row.key = sku;
        const isUpdate = bySku.has(sku);
        row.data = {
          sku,
          name: name || model, // Model substitutes for a missing Name — never the reverse.
          category: cleanText(raw.category) || undefined,
          brand: cleanText(raw.brand) || undefined,
          model: model || undefined,
          lowStockThreshold: lowStockThreshold ?? 5,
          barcode: barcode || undefined,
          active: bool(raw.active, true),
        };

        // Selling price follows the same rule as cost, for the same reason: these
        // stock-intake sheets never carry a price at all, so re-importing one must
        // never zero out a price a staff member set by hand after the first import.
        if (sellingPriceSupplied) row.data.sellingPrice = sellingPrice ?? 0;
        else if (!isUpdate) row.data.sellingPrice = 0;

        // Stock/Quantity: a genuine Stock or Quantity column keeps behaving exactly as
        // it always has. These real stock-intake sheets carry no such column — QTY is
        // not one of its aliases — and every row on them is one physical laptop, so a
        // newly created product from a sheet with no Stock column starts at 1, not 0.
        // An existing product with no Stock column supplied is never touched.
        if (hasStockColumn) row.data.stock = stock ?? 0;
        else if (!isUpdate) row.data.stock = 1;

        // Cost is only written when the sheet actually carries it. It used to be set to
        // `purchasePrice ?? 0`, so re-importing a catalogue whose sheet had no Purchase
        // Price column silently zeroed the cost of every existing product — and with it
        // every margin and profit figure derived from it. A new product with no cost
        // still starts at zero; an existing one keeps what it has.
        if (costSupplied) row.data.purchasePrice = purchasePrice ?? 0;
        else if (!isUpdate) row.data.purchasePrice = 0;

        // Specifications follow the same rule as cost: a column the sheet does not
        // carry leaves the stored value alone, so a partial catalogue upload cannot
        // blank out the specs of everything it touches.
        for (const f of ['processor', 'graphics', 'screen', 'warranty']) {
          const v = cleanText(raw[f]);
          if (v) row.data[f] = v;
        }

        // RAM: a bare number ("8", "16") means gigabytes; anything already carrying
        // its own unit or description ("16 GB", "BUILT IN") is kept exactly as given.
        const ramRaw = cleanText(raw.ram);
        if (ramRaw) row.data.ram = /^\d+$/.test(ramRaw) ? `${ramRaw} GB` : ramRaw;

        // Storage: a direct Storage/ROM/SSD column wins if the sheet has one. Failing
        // that, the drive's own make + model (Media Mfg/Make + Media Model/Model
        // Number) becomes the descriptive text — never a capacity guess.
        const directStorage = cleanText(raw.storage);
        const mediaMfg = cleanText(raw.mediaMfg);
        const mediaModel = cleanText(raw.mediaModel);
        const composedStorage = composeStorageDescription({ mediaMfg, mediaModel });
        if (directStorage) row.data.storage = directStorage;
        else if (composedStorage) row.data.storage = composedStorage;

        // Comments: the original value is never lost, only ever extended with Grade,
        // the cosmetic-condition columns, a secondary Notes column, and the drive's
        // own serial — whichever of those the sheet actually supplies.
        const composedComments = composeComments({
          grade: cleanText(raw.grade),
          comments: cleanText(raw.comments),
          battery: cleanText(raw.battery),
          usageSigns: cleanText(raw.usageSigns),
          casingCondition: cleanText(raw.casingCondition),
          screenCondition: cleanText(raw.screenCondition),
          notes: cleanText(raw.notes),
          mediaSerial: cleanText(raw.mediaSerial),
        });
        if (composedComments) row.data.comments = composedComments;

        const cond = cleanText(raw.condition);
        if (cond) {
          const normalised = cond.toLowerCase();
          if (['new', 'used', 'refurbished'].includes(normalised)) row.data.condition = normalised;
          else err(row, 'Condition', cond, 'Condition must be new, used or refurbished');
        } else if (!isUpdate) {
          // These sheets describe physical units that have already been received and
          // graded — never new-in-box stock — so a newly created product with no
          // Condition column defaults to used rather than the schema's own "new".
          row.data.condition = 'used';
        }

        row.action = isUpdate ? R.UPDATE : R.CREATE;
        row.note = isUpdate ? `updates existing product ${sku}` : null;
      }

      if (warnings.length) {
        row.note = row.note ? `${row.note} — ⚠ ${warnings.join('; ')}` : `⚠ ${warnings.join('; ')}`;
      }

      out.push(row);
    }
    return out;
  },

  async commit(prepared) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      try {
        const { sku, barcode, ...rest } = row.data;
        const update = { $set: { ...rest, sku } };
        if (barcode) update.$set.barcode = barcode;
        else update.$unset = { barcode: '' };
        const existed = await Product.findOne({ sku }).select('_id');
        await Product.updateOne({ sku }, update, { upsert: true, runValidators: true });
        existed ? res.updated++ : res.created++;
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'Serial Number', value: row.key, message: friendly(e) });
      }
    }
    return res;
  },
};

// ===========================================================================
// CUSTOMERS
// ===========================================================================
// Identity: email, else phone, else name+company. Name alone is never enough to treat
// two rows as the same business, so a name-only match is imported as a new customer.
const customers = {
  label: 'Customers',
  sheetName: 'Customers',
  aliases: {
    name: ['Name', 'Customer Name'],
    company: ['Company'],
    phone: ['Phone'],
    email: ['Email'],
    cnicNtn: ['CNIC/NTN', 'CNIC', 'NTN'],
    address: ['Address'],
    creditLimit: ['Credit Limit'],
    notes: ['Notes'],
    active: ['Active'],
    // Read only so it can be refused with a clear message — never written.
    balance: ['Balance', 'Opening Balance', 'Outstanding'],
  },
  required: ['name'],
  instructions: [
    'Name is required. A customer is matched on Email, then Phone, then Name + Company.',
    'Opening receivable balances are NOT imported here — use the Opening Balances import.',
    'Delete the example row before importing.',
  ],
  example: {
    name: 'Example Traders', company: 'Example Co', phone: '+92 300 0000000',
    email: 'example@delete-this-row.com', cnicNtn: '', address: 'Lahore', creditLimit: 0,
    notes: 'Delete this row before importing', active: 'Yes',
  },

  async prepare(rows) {
    const emails = rows.map((r) => str(r.email).toLowerCase()).filter(Boolean);
    const phones = rows.map((r) => str(r.phone)).filter(Boolean);
    const existing = await Customer.find({ $or: [{ email: { $in: emails } }, { phone: { $in: phones } }] })
      .select('name company phone email');
    const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));
    const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [c.phone, c]));

    const seen = new Set();
    const out = [];
    for (const raw of rows) {
      const row = mkRow(raw);
      const name = str(raw.name);
      const email = str(raw.email).toLowerCase();
      const phone = str(raw.phone);
      if (!name) err(row, 'Name', raw.name, 'Name is required');

      // Reject any attempt to set a receivable through this sheet.
      if (raw.balance != null && str(raw.balance) !== '') {
        err(row, 'Balance', raw.balance, 'customer balances cannot be set here — use the Opening Balances import');
      }
      const creditLimit = money(row, 'Credit Limit', 'Credit limit', raw.creditLimit);

      const identity = email || phone || `${name.toLowerCase()}|${str(raw.company).toLowerCase()}`;
      if (seen.has(identity)) err(row, 'Name', name, 'duplicate customer within this file');
      else seen.add(identity);

      if (row.action !== R.ERROR) {
        const match = (email && byEmail.get(email)) || (phone && byPhone.get(phone)) || null;
        row.key = identity;
        row.matchId = match?._id || null;
        row.data = {
          name,
          company: str(raw.company) || undefined,
          phone: phone || undefined,
          email: email || undefined,
          cnicNtn: str(raw.cnicNtn) || undefined,
          address: str(raw.address) || undefined,
          creditLimit: creditLimit ?? 0,
          notes: str(raw.notes) || undefined,
          active: bool(raw.active, true),
        };
        row.action = match ? R.UPDATE : R.CREATE;
        if (match) row.note = `updates existing customer ${match.name} (matched on ${email && byEmail.get(email) ? 'email' : 'phone'})`;
      }
      out.push(row);
    }
    return out;
  },

  async commit(prepared) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      try {
        if (row.matchId) {
          // balance is never in row.data, so an import can never move a receivable.
          await Customer.updateOne({ _id: row.matchId }, { $set: row.data }, { runValidators: true });
          res.updated++;
        } else {
          await Customer.create(row.data);
          res.created++;
        }
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'Name', value: row.data.name, message: friendly(e) });
      }
    }
    return res;
  },
};

// ===========================================================================
// SUPPLIERS
// ===========================================================================
// Migration only — this exists so historical purchase orders and payables have their
// vendor records. It adds no supplier management UI; Change 1's removal stands.
const suppliers = {
  label: 'Suppliers',
  sheetName: 'Suppliers',
  aliases: {
    name: ['Name', 'Supplier Name'],
    contactPerson: ['Contact Person', 'Contact'],
    phone: ['Phone'],
    email: ['Email'],
    address: ['Address'],
    taxNumber: ['Tax Number'],
    notes: ['Notes'],
    active: ['Active'],
    // Read only so it can be refused with a clear message — never written.
    payable: ['Payable', 'Opening Balance', 'Outstanding'],
  },
  required: ['name'],
  instructions: [
    'Name is required. Suppliers are matched on Email, then Name.',
    'This is migration only — supplier records exist so historical purchase orders and payables work.',
    'Opening payable balances are NOT imported here — use the Opening Balances import.',
    'Delete the example row before importing.',
  ],
  example: {
    name: 'Example Distribution', contactPerson: 'Mr. Example', phone: '+92 42 0000000',
    email: 'example@delete-this-row.com', address: 'Lahore', taxNumber: '',
    notes: 'Delete this row before importing', active: 'Yes',
  },

  async prepare(rows) {
    const emails = rows.map((r) => str(r.email).toLowerCase()).filter(Boolean);
    const names = rows.map((r) => str(r.name)).filter(Boolean);
    const existing = await Supplier.find({ $or: [{ email: { $in: emails } }, { name: { $in: names } }] })
      .select('name email');
    const byEmail = new Map(existing.filter((s) => s.email).map((s) => [s.email.toLowerCase(), s]));
    const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));

    const seen = new Set();
    const out = [];
    for (const raw of rows) {
      const row = mkRow(raw);
      const name = str(raw.name);
      const email = str(raw.email).toLowerCase();
      if (!name) err(row, 'Name', raw.name, 'Name is required');
      if (raw.payable != null && str(raw.payable) !== '') {
        err(row, 'Payable', raw.payable, 'supplier payables cannot be set here — use the Opening Balances import');
      }
      const identity = email || name.toLowerCase();
      if (seen.has(identity)) err(row, 'Name', name, 'duplicate supplier within this file');
      else seen.add(identity);

      if (row.action !== R.ERROR) {
        const match = (email && byEmail.get(email)) || byName.get(name.toLowerCase()) || null;
        row.key = identity;
        row.matchId = match?._id || null;
        row.data = {
          name,
          contactPerson: str(raw.contactPerson) || undefined,
          phone: str(raw.phone) || undefined,
          email: email || undefined,
          address: str(raw.address) || undefined,
          taxNumber: str(raw.taxNumber) || undefined,
          notes: str(raw.notes) || undefined,
          active: bool(raw.active, true),
        };
        row.action = match ? R.UPDATE : R.CREATE;
        if (match) row.note = `updates existing supplier ${match.name}`;
      }
      out.push(row);
    }
    return out;
  },

  async commit(prepared) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      try {
        if (row.matchId) {
          await Supplier.updateOne({ _id: row.matchId }, { $set: row.data }, { runValidators: true });
          res.updated++;
        } else {
          await Supplier.create(row.data);
          res.created++;
        }
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'Name', value: row.data.name, message: friendly(e) });
      }
    }
    return res;
  },
};

// ===========================================================================
// Shared helpers for the two document importers
// ===========================================================================
async function resolveParty(Model, fields, value) {
  const v = str(value);
  if (!v) return null;
  const or = fields.map((f) => ({ [f]: f === 'email' ? v.toLowerCase() : v }));
  return Model.findOne({ $or: or });
}

// A payment is only attributed to an account — and therefore only produces a ledger
// entry — when the sheet actually names an account. Otherwise it is recorded as a
// legacy, unattributed payment exactly like payments that predate Change 3. No account
// is ever guessed and no FinancialTransaction is ever fabricated.
function readPayment(row, raw, accountsByName) {
  const amount = num(raw.paymentAmount ?? raw.paidAmount);
  if (amount === null || amount === 0) return null;
  if (Number.isNaN(amount)) { err(row, 'Paid Amount', raw.paymentAmount ?? raw.paidAmount, 'paid amount is not a valid number'); return null; }
  if (amount < 0) { err(row, 'Paid Amount', amount, 'paid amount cannot be negative'); return null; }

  const accountName = str(raw.paymentAccount);
  let account = null;
  if (accountName) {
    account = accountsByName.get(accountName.toLowerCase()) || null;
    if (!account) { err(row, 'Payment Account', accountName, `account "${accountName}" not found`); return null; }
    if (!account.active) { err(row, 'Payment Account', accountName, `account "${accountName}" is inactive`); return null; }
  }

  const pdate = raw.paymentDate ? toDate(raw.paymentDate) : null;
  if (pdate !== null && Number.isNaN(pdate)) { err(row, 'Payment Date', raw.paymentDate, 'payment date is not a valid date'); return null; }

  const method = str(raw.paymentMethod).toLowerCase();
  return {
    amount,
    account,
    date: pdate || null,
    method: ['cash', 'bank', 'cheque', 'other'].includes(method) ? method : account?.type === 'cash' ? 'cash' : 'bank',
    reference: str(raw.paymentReference) || undefined,
    attributed: !!account,
  };
}

// ===========================================================================
// INVOICES  (one spreadsheet row per line item; rows share an invoice number)
// ===========================================================================
const invoices = {
  label: 'Sales / Invoices',
  sheetName: 'Invoices',
  aliases: {
    number: ['Invoice Number', 'Invoice No', 'Invoice #'],
    customer: ['Customer', 'Customer Name'],
    date: ['Date', 'Invoice Date'],
    sku: ['SKU', 'Product SKU'],
    quantity: ['Quantity', 'Qty'],
    unitPrice: ['Unit Price', 'Price'],
    lineDiscount: ['Line Discount'],
    taxRate: ['Tax Rate', 'Tax %'],
    invoiceDiscount: ['Invoice Discount', 'Discount'],
    paidAmount: ['Paid Amount', 'Paid'],
    paymentAmount: ['Payment Amount'],
    paymentDate: ['Payment Date'],
    paymentAccount: ['Payment Account'],
    paymentMethod: ['Payment Method'],
    paymentReference: ['Payment Reference'],
    notes: ['Notes'],
  },
  required: ['number', 'customer', 'sku', 'quantity', 'unitPrice'],
  instructions: [
    'One row per product line. Repeat the Invoice Number to add more lines to the same invoice.',
    'Invoice-level values (Date, Tax Rate, Invoice Discount, payment columns, Notes) are read from the FIRST row of each invoice.',
    'Customer is matched on name, phone or email and must already exist — import Customers first.',
    'HISTORICAL IMPORT: stock is NOT deducted and no stock movements are created, because these goods already left your shelves.',
    'Payment Account is optional. If given, a real ledger entry is created against that account. If left blank, the payment is recorded as legacy/unattributed and NO ledger entry is created.',
    'Delete the example row before importing.',
  ],
  example: {
    number: 'EXAMPLE-INV-001', customer: 'Example Traders', date: '2026-08-01', sku: 'EXAMPLE-001',
    quantity: 2, unitPrice: 150000, lineDiscount: 0, taxRate: 0, invoiceDiscount: 0,
    paidAmount: 100000, paymentAmount: '', paymentDate: '2026-08-01', paymentAccount: 'Cash',
    paymentMethod: 'cash', paymentReference: 'DELETE THIS ROW', notes: 'Delete this row before importing',
  },

  async prepare(rows) {
    const accounts = await Account.find().select('name type active');
    const accountsByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));

    // Group line rows by invoice number, preserving the first row for header fields.
    const groups = new Map();
    for (const raw of rows) {
      const number = str(raw.number);
      if (!groups.has(number)) groups.set(number, []);
      groups.get(number).push(raw);
    }

    const numbers = [...groups.keys()].filter(Boolean);
    const existing = await Invoice.find({ number: { $in: numbers } }).select('number');
    const existingNumbers = new Set(existing.map((i) => i.number));

    const skus = [...new Set(rows.map((r) => str(r.sku).toUpperCase()).filter(Boolean))];
    const prods = await Product.find({ sku: { $in: skus } }).select('sku name purchasePrice');
    const bySku = new Map(prods.map((p) => [p.sku, p]));

    const out = [];
    for (const [number, lines] of groups) {
      const head = lines[0];
      const row = mkRow(head);
      row.excelRows = lines.map((l) => l.__row);

      if (!number) { err(row, 'Invoice Number', '', 'Invoice Number is required'); out.push(row); continue; }
      if (existingNumbers.has(number)) {
        row.action = R.SKIP;
        row.key = number;
        row.note = `invoice ${number} already exists — left untouched`;
        out.push(row);
        continue;
      }

      const customer = await resolveParty(Customer, ['name', 'phone', 'email'], head.customer);
      if (!customer) err(row, 'Customer', head.customer, `customer "${str(head.customer)}" not found — import customers first`);

      const idate = head.date ? toDate(head.date) : new Date();
      if (Number.isNaN(idate)) err(row, 'Date', head.date, 'invoice date is not a valid date');

      const items = [];
      let subtotal = 0;
      for (const l of lines) {
        const sku = str(l.sku).toUpperCase();
        const product = bySku.get(sku);
        if (!product) { err(row, 'SKU', l.sku, `product "${sku}" not found (row ${l.__row})`); continue; }
        const qty = num(l.quantity);
        const price = num(l.unitPrice);
        const disc = num(l.lineDiscount) || 0;
        if (qty === null || Number.isNaN(qty) || qty <= 0) { err(row, 'Quantity', l.quantity, `quantity must be greater than zero (row ${l.__row})`); continue; }
        if (price === null || Number.isNaN(price) || price < 0) { err(row, 'Unit Price', l.unitPrice, `unit price cannot be negative (row ${l.__row})`); continue; }
        const lineTotal = Math.max(0, qty * price - disc);
        subtotal += lineTotal;
        items.push({
          product: product._id, name: product.name, sku: product.sku,
          quantity: qty, unitPrice: price, unitCost: product.purchasePrice || 0,
          discount: disc, serials: [], lineTotal,
        });
      }
      if (!items.length && row.action !== R.ERROR) err(row, 'SKU', '', 'invoice has no valid product lines');

      const invoiceDiscount = num(head.invoiceDiscount) || 0;
      const taxRate = num(head.taxRate) || 0;
      const afterDisc = Math.max(0, subtotal - invoiceDiscount);
      const taxAmount = Math.round(afterDisc * (taxRate / 100) * 100) / 100;
      const total = Math.round((afterDisc + taxAmount) * 100) / 100;

      const payment = readPayment(row, head, accountsByName);
      if (payment && payment.amount > total) {
        err(row, 'Paid Amount', payment.amount, `paid amount ${payment.amount} exceeds invoice total ${total}`);
      }

      if (row.action !== R.ERROR) {
        row.action = R.CREATE;
        row.key = number;
        const paid = payment?.amount || 0;
        row.data = {
          number, customer: customer._id, customerName: customer.name,
          items, subtotal, discount: invoiceDiscount, taxRate, taxAmount, total,
          issuedAt: idate, notes: str(head.notes) || undefined, payment,
        };
        row.note = payment
          ? payment.attributed
            ? `${items.length} line(s) · payment ${paid} into ${payment.account.name} (ledger entry will be created)`
            : `${items.length} line(s) · payment ${paid} with no account — recorded as legacy, no ledger entry`
          : `${items.length} line(s) · unpaid`;
      }
      out.push(row);
    }
    return out;
  },

  async commit(prepared, ctx) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      if (row.action === R.SKIP) { res.skipped++; continue; }
      const d = row.data;
      let invoice = null;
      try {
        // Historical import: no stock deduction and no StockMovement rows — the goods
        // left inventory before ALM Suite existed, so touching stock now would corrupt
        // present-day quantities.
        invoice = await Invoice.create({
          number: d.number, customer: d.customer, items: d.items,
          subtotal: d.subtotal, discount: d.discount, taxRate: d.taxRate, taxAmount: d.taxAmount,
          total: d.total, paid: 0, balance: d.total, payments: [], status: 'open',
          notes: d.notes, createdBy: ctx.user._id, issuedAt: d.issuedAt,
        });
        // Receivable moves exactly as it does for a normal sale.
        await Customer.updateOne({ _id: d.customer }, { $inc: { balance: d.total } });

        if (d.payment) {
          if (d.payment.attributed) {
            // Real money into a real account — routed through the existing ledger path.
            await applyInvoicePayment({
              invoice,
              account: d.payment.account,
              amount: d.payment.amount,
              method: d.payment.method,
              reference: d.payment.reference,
              user: ctx.user,
              type: 'customer_payment',
              idempotencyKey: `import:inv:${d.number}:1`,
            });
          } else {
            // Unattributed legacy payment: recorded on the invoice so paid/balance and
            // the receivable are right, but deliberately NO account and NO ledger row.
            const amt = Math.min(d.payment.amount, invoice.balance);
            invoice.payments.push({
              date: d.payment.date || d.issuedAt,
              method: d.payment.method,
              amount: amt,
              reference: d.payment.reference,
              recordedBy: ctx.user._id,
            });
            invoice.paid += amt;
            invoice.balance = Math.max(0, invoice.total - invoice.paid);
            invoice.status = invoice.balance === 0 ? 'paid' : 'partial';
            await invoice.save();
            await Customer.updateOne({ _id: d.customer }, [
              { $set: { balance: { $max: [0, { $subtract: ['$balance', amt] }] } } },
            ]);
          }
        }
        res.created++;
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'Invoice Number', value: d?.number, message: friendly(e) });
        // Compensate: no replica set means no transaction, so undo what was written.
        if (invoice) {
          await Customer.updateOne({ _id: d.customer }, [
            { $set: { balance: { $max: [0, { $subtract: ['$balance', d.total] }] } } },
          ]).catch(() => {});
          await Invoice.deleteOne({ _id: invoice._id }).catch(() => {});
        }
      }
    }
    return res;
  },
};

// ===========================================================================
// PURCHASE ORDERS
// ===========================================================================
const purchaseOrders = {
  label: 'Purchase Orders',
  sheetName: 'PurchaseOrders',
  aliases: {
    number: ['PO Number', 'PO No', 'PO #'],
    supplier: ['Supplier', 'Supplier Name'],
    date: ['Date', 'Order Date'],
    expectedAt: ['Expected Date'],
    sku: ['SKU', 'Product SKU'],
    quantity: ['Quantity', 'Qty'],
    unitCost: ['Unit Cost', 'Cost'],
    taxRate: ['Tax Rate', 'Tax %'],
    paidAmount: ['Paid Amount', 'Paid'],
    paymentAmount: ['Payment Amount'],
    paymentDate: ['Payment Date'],
    paymentAccount: ['Payment Account'],
    paymentMethod: ['Payment Method'],
    paymentReference: ['Payment Reference'],
    notes: ['Notes'],
  },
  required: ['number', 'supplier', 'sku', 'quantity', 'unitCost'],
  instructions: [
    'One row per product line. Repeat the PO Number to add more lines to the same purchase order.',
    'PO-level values (Date, Tax Rate, payment columns, Notes) are read from the FIRST row of each PO.',
    'Supplier is matched on name, phone or email and must already exist — import Suppliers first.',
    'HISTORICAL IMPORT: stock is NOT increased and no stock movements are created.',
    'Payment Account is optional. If given a real ledger entry is created; if blank the payment is legacy/unattributed with no ledger entry.',
    'Delete the example row before importing.',
  ],
  example: {
    number: 'EXAMPLE-PO-001', supplier: 'Example Distribution', date: '2026-08-01', expectedAt: '',
    sku: 'EXAMPLE-001', quantity: 10, unitCost: 120000, taxRate: 0,
    paidAmount: 500000, paymentAmount: '', paymentDate: '2026-08-01', paymentAccount: 'Bank of Punjab',
    paymentMethod: 'bank', paymentReference: 'DELETE THIS ROW', notes: 'Delete this row before importing',
  },

  async prepare(rows) {
    const accounts = await Account.find().select('name type active');
    const accountsByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));

    const groups = new Map();
    for (const raw of rows) {
      const number = str(raw.number);
      if (!groups.has(number)) groups.set(number, []);
      groups.get(number).push(raw);
    }
    const existing = await PurchaseOrder.find({ number: { $in: [...groups.keys()].filter(Boolean) } }).select('number');
    const existingNumbers = new Set(existing.map((p) => p.number));

    const skus = [...new Set(rows.map((r) => str(r.sku).toUpperCase()).filter(Boolean))];
    const prods = await Product.find({ sku: { $in: skus } }).select('sku name');
    const bySku = new Map(prods.map((p) => [p.sku, p]));

    const out = [];
    for (const [number, lines] of groups) {
      const head = lines[0];
      const row = mkRow(head);
      row.excelRows = lines.map((l) => l.__row);

      if (!number) { err(row, 'PO Number', '', 'PO Number is required'); out.push(row); continue; }
      if (existingNumbers.has(number)) {
        row.action = R.SKIP; row.key = number;
        row.note = `purchase order ${number} already exists — left untouched`;
        out.push(row); continue;
      }

      const supplier = await resolveParty(Supplier, ['name', 'phone', 'email'], head.supplier);
      if (!supplier) err(row, 'Supplier', head.supplier, `supplier "${str(head.supplier)}" not found — import suppliers first`);

      const odate = head.date ? toDate(head.date) : new Date();
      if (Number.isNaN(odate)) err(row, 'Date', head.date, 'order date is not a valid date');

      const items = [];
      let subtotal = 0;
      for (const l of lines) {
        const sku = str(l.sku).toUpperCase();
        const product = bySku.get(sku);
        if (!product) { err(row, 'SKU', l.sku, `product "${sku}" not found (row ${l.__row})`); continue; }
        const qty = num(l.quantity);
        const cost = num(l.unitCost);
        if (qty === null || Number.isNaN(qty) || qty <= 0) { err(row, 'Quantity', l.quantity, `quantity must be greater than zero (row ${l.__row})`); continue; }
        if (cost === null || Number.isNaN(cost) || cost < 0) { err(row, 'Unit Cost', l.unitCost, `unit cost cannot be negative (row ${l.__row})`); continue; }
        const lineTotal = qty * cost;
        subtotal += lineTotal;
        items.push({ product: product._id, name: product.name, sku: product.sku, quantity: qty, received: 0, unitCost: cost, serials: [], lineTotal });
      }
      if (!items.length && row.action !== R.ERROR) err(row, 'SKU', '', 'purchase order has no valid product lines');

      const taxRate = num(head.taxRate) || 0;
      const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = Math.round((subtotal + taxAmount) * 100) / 100;

      const payment = readPayment(row, head, accountsByName);
      if (payment && payment.amount > total) {
        err(row, 'Paid Amount', payment.amount, `paid amount ${payment.amount} exceeds purchase total ${total}`);
      }

      if (row.action !== R.ERROR) {
        row.action = R.CREATE; row.key = number;
        row.data = {
          number, supplier: supplier._id, supplierName: supplier.name, items,
          subtotal, taxRate, taxAmount, total, orderedAt: odate,
          expectedAt: head.expectedAt ? toDate(head.expectedAt) : undefined,
          notes: str(head.notes) || undefined, payment,
        };
        row.note = payment
          ? payment.attributed
            ? `${items.length} line(s) · payment ${payment.amount} from ${payment.account.name} (ledger entry will be created)`
            : `${items.length} line(s) · payment ${payment.amount} with no account — legacy, no ledger entry`
          : `${items.length} line(s) · unpaid`;
      }
      out.push(row);
    }
    return out;
  },

  async commit(prepared, ctx) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      if (row.action === R.SKIP) { res.skipped++; continue; }
      const d = row.data;
      let po = null;
      try {
        po = await PurchaseOrder.create({
          number: d.number, supplier: d.supplier, items: d.items,
          subtotal: d.subtotal, taxRate: d.taxRate, taxAmount: d.taxAmount, total: d.total,
          paid: 0, balance: d.total, payments: [], status: 'ordered',
          notes: d.notes, createdBy: ctx.user._id, orderedAt: d.orderedAt,
          expectedAt: d.expectedAt && !Number.isNaN(d.expectedAt) ? d.expectedAt : undefined,
        });
        await Supplier.updateOne({ _id: d.supplier }, { $inc: { payable: d.total } });

        if (d.payment) {
          const amt = Math.min(d.payment.amount, po.balance);
          if (d.payment.attributed) {
            // Same ledger mechanism recordSupplierPayment uses — one posting, one row.
            await postPaymentAtomically(
              {
                account: d.payment.account._id, amount: amt, direction: 'out', type: 'supplier_payment',
                method: d.payment.method, reference: d.payment.reference,
                description: `Imported payment on purchase order ${d.number}`,
                purchaseOrder: po._id, supplier: d.supplier, createdBy: ctx.user._id,
                date: d.payment.date || d.orderedAt,
                idempotencyKey: `import:po:${d.number}:1`,
              },
              async (session, posted) => {
                po.payments.push({
                  date: d.payment.date || d.orderedAt, method: d.payment.method, amount: amt,
                  reference: d.payment.reference, recordedBy: ctx.user._id,
                  account: d.payment.account._id, transaction: posted._id,
                });
                po.paid += amt;
                po.balance = Math.max(0, po.total - po.paid);
                await po.save({ session });
                await Supplier.updateOne(
                  { _id: d.supplier },
                  [{ $set: { payable: { $max: [0, { $subtract: ['$payable', amt] }] } } }],
                  session ? { session } : {}
                );
              }
            );
          } else {
            po.payments.push({
              date: d.payment.date || d.orderedAt, method: d.payment.method, amount: amt,
              reference: d.payment.reference, recordedBy: ctx.user._id,
            });
            po.paid += amt;
            po.balance = Math.max(0, po.total - po.paid);
            await po.save();
            await Supplier.updateOne({ _id: d.supplier }, [
              { $set: { payable: { $max: [0, { $subtract: ['$payable', amt] }] } } },
            ]);
          }
        }
        res.created++;
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'PO Number', value: d?.number, message: friendly(e) });
        if (po) {
          await Supplier.updateOne({ _id: d.supplier }, [
            { $set: { payable: { $max: [0, { $subtract: ['$payable', d.total] }] } } },
          ]).catch(() => {});
          await PurchaseOrder.deleteOne({ _id: po._id }).catch(() => {});
        }
      }
    }
    return res;
  },
};

// ===========================================================================
// EXPENSES
// ===========================================================================
const expenses = {
  label: 'Expenses',
  sheetName: 'Expenses',
  aliases: {
    date: ['Date'],
    category: ['Category'],
    amount: ['Amount'],
    account: ['Account', 'Payment Account'],
    description: ['Description'],
    notes: ['Notes'],
    reference: ['Reference'],
  },
  required: ['date', 'category', 'amount', 'account'],
  instructions: [
    `Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}.`,
    'Account must match an existing financial account name exactly (e.g. Cash, Bank of Punjab).',
    'Every imported expense creates exactly one outgoing ledger entry against that account.',
    'Reference makes re-imports safe: a row with the same reference will not post twice.',
    'Delete the example row before importing.',
  ],
  example: {
    date: '2026-08-11', category: 'Electricity', amount: 50000, account: 'Bank of Punjab',
    description: 'Monthly electricity bill', notes: 'Delete this row before importing', reference: 'EXAMPLE-BILL-001',
  },

  async prepare(rows) {
    const accounts = await Account.find().select('name type active');
    const byName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));

    const keys = rows.map((r) => expenseKey(r)).filter(Boolean);
    const existing = await mongoose.model('FinancialTransaction')
      .find({ idempotencyKey: { $in: keys } }).select('idempotencyKey');
    const existingKeys = new Set(existing.map((t) => t.idempotencyKey));

    const seen = new Set();
    const out = [];
    for (const raw of rows) {
      const row = mkRow(raw);
      const d = toDate(raw.date);
      if (d === null) err(row, 'Date', raw.date, 'Date is required');
      else if (Number.isNaN(d)) err(row, 'Date', raw.date, 'date is not valid');

      const category = str(raw.category);
      if (!category) err(row, 'Category', raw.category, 'Category is required');
      else if (!EXPENSE_CATEGORIES.includes(category)) err(row, 'Category', category, `"${category}" is not a valid category`);

      const amount = money(row, 'Amount', 'Amount', raw.amount, { required: true });
      if (amount !== null && amount <= 0) err(row, 'Amount', raw.amount, 'amount must be greater than zero');

      const accName = str(raw.account);
      let account = null;
      if (!accName) err(row, 'Account', raw.account, 'Account is required');
      else {
        account = byName.get(accName.toLowerCase());
        if (!account) err(row, 'Account', accName, `account "${accName}" not found`);
        else if (!account.active) err(row, 'Account', accName, `account "${accName}" is inactive`);
      }

      const key = expenseKey(raw);
      if (row.action !== R.ERROR) {
        if (existingKeys.has(key) || seen.has(key)) {
          row.action = R.SKIP;
          row.key = key;
          row.note = 'already imported previously — will not post again';
        } else {
          seen.add(key);
          row.action = R.CREATE;
          row.key = key;
          row.data = {
            amount, category, account, date: d,
            description: str(raw.description) || undefined,
            notes: str(raw.notes) || undefined,
            reference: str(raw.reference) || undefined,
            idempotencyKey: key,
          };
          row.note = `${category} ${amount} from ${account.name}`;
        }
      }
      out.push(row);
    }
    return out;
  },

  async commit(prepared, ctx) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      if (row.action === R.SKIP) { res.skipped++; continue; }
      const d = row.data;
      try {
        // Identical mechanism to createExpense: the ledger posting and the Expense
        // record are written together, so Account.currentBalance is never touched
        // directly and exactly one FinancialTransaction exists per expense.
        const expenseId = new mongoose.Types.ObjectId();
        await postPaymentAtomically(
          {
            account: d.account._id, amount: d.amount, direction: 'out', type: 'expense',
            method: d.account.type === 'cash' ? 'cash' : 'bank',
            reference: d.reference, description: d.description || `${d.category} expense`,
            expense: expenseId, date: d.date, createdBy: ctx.user._id, idempotencyKey: d.idempotencyKey,
          },
          async (session, posted) => {
            await Expense.create(
              [{
                _id: expenseId, amount: d.amount, category: d.category, account: d.account._id,
                date: d.date, description: d.description, notes: d.notes, reference: d.reference,
                status: 'posted', financialTransaction: posted._id, createdBy: ctx.user._id,
              }],
              session ? { session } : {}
            );
          }
        );
        res.created++;
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'Amount', value: d?.amount, message: friendly(e) });
      }
    }
    return res;
  },
};

// Deterministic key so the same spreadsheet row can never post twice, even across runs.
function expenseKey(raw) {
  const ref = str(raw.reference);
  const d = toDate(raw.date);
  const day = d instanceof Date && !Number.isNaN(d) ? d.toISOString().slice(0, 10) : 'nodate';
  const base = ref || `${day}|${str(raw.category)}|${num(raw.amount)}|${str(raw.account)}`;
  return `import:expense:${base}`;
}

// ===========================================================================
// OPENING BALANCES
// ===========================================================================
const openingBalances = {
  label: 'Opening Balances',
  sheetName: 'OpeningBalances',
  aliases: {
    type: ['Type'],
    name: ['Name', 'Account/Customer/Supplier'],
    amount: ['Amount', 'Opening Balance'],
    asOf: ['As Of', 'Date'],
    reference: ['Reference'],
    note: ['Note', 'Notes'],
  },
  required: ['type', 'name', 'amount'],
  instructions: [
    'Type must be Account, Customer or Supplier.',
    'Account   → sets the starting balance of a financial account (Cash, Bank of Punjab, …).',
    'Customer  → the receivable that customer already owed you before using ALM Suite.',
    'Supplier  → the payable you already owed that supplier.',
    'Opening balances are a starting position, NOT transactions: no revenue, no expense and no ledger entries are created.',
    'Reference makes re-imports safe — the same Type + Name + Reference is only applied once.',
    'Delete the example row before importing.',
  ],
  example: {
    type: 'Account', name: 'Cash', amount: 500000, asOf: '2026-08-01',
    reference: 'OPENING-2026', note: 'Delete this row before importing',
  },

  async prepare(rows) {
    const [accounts, custs, supps] = await Promise.all([
      Account.find().select('name active openingBalance currentBalance'),
      Customer.find().select('name phone email balance'),
      Supplier.find().select('name phone email payable'),
    ]);
    const maps = {
      account: new Map(accounts.map((a) => [a.name.toLowerCase(), a])),
      customer: new Map(custs.map((c) => [c.name.toLowerCase(), c])),
      supplier: new Map(supps.map((s) => [s.name.toLowerCase(), s])),
    };
    const existing = await OpeningBalance.find().select('entityType entity reference');
    const existingKeys = new Set(existing.map((o) => `${o.entityType}|${o.entity}|${o.reference || ''}`));

    const seen = new Set();
    const out = [];
    for (const raw of rows) {
      const row = mkRow(raw);
      const type = str(raw.type).toLowerCase();
      if (!['account', 'customer', 'supplier'].includes(type)) {
        err(row, 'Type', raw.type, 'Type must be Account, Customer or Supplier');
      }
      const name = str(raw.name);
      if (!name) err(row, 'Name', raw.name, 'Name is required');

      let entity = null;
      if (type && name && maps[type]) {
        entity = maps[type].get(name.toLowerCase());
        if (!entity) err(row, 'Name', name, `${type} "${name}" not found`);
        else if (type === 'account' && !entity.active) err(row, 'Name', name, `account "${name}" is inactive`);
      }

      const amount = money(row, 'Amount', 'Amount', raw.amount, { required: true, min: null });
      if (amount !== null && type !== 'account' && amount < 0) {
        err(row, 'Amount', amount, 'receivable/payable opening balance cannot be negative');
      }

      const asOf = raw.asOf ? toDate(raw.asOf) : new Date();
      if (Number.isNaN(asOf)) err(row, 'As Of', raw.asOf, 'as-of date is not valid');

      if (row.action !== R.ERROR) {
        const reference = str(raw.reference);
        const key = `${type}|${entity._id}|${reference}`;
        if (existingKeys.has(key) || seen.has(key)) {
          row.action = R.SKIP;
          row.note = 'this opening balance was already applied — will not be applied again';
        } else {
          seen.add(key);
          row.action = R.CREATE;
          row.data = { entityType: type, entity: entity._id, entityName: entity.name, amount, asOf, reference: reference || undefined, note: str(raw.note) || undefined };
          row.note =
            type === 'account'
              ? `sets ${entity.name} opening balance to ${amount}`
              : type === 'customer'
                ? `adds ${amount} to ${entity.name}'s receivable`
                : `adds ${amount} to ${entity.name}'s payable`;
        }
        row.key = key;
      }
      out.push(row);
    }
    return out;
  },

  async commit(prepared, ctx) {
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of prepared) {
      if (row.action === R.ERROR) { res.failed++; continue; }
      if (row.action === R.SKIP) { res.skipped++; continue; }
      const d = row.data;
      let record = null;
      try {
        record = await OpeningBalance.create({ ...d, importBatch: ctx.batchId, createdBy: ctx.user._id });
        if (d.entityType === 'account') {
          // Same adjustment PATCH /accounts/:id performs: opening balance moves and
          // currentBalance shifts by the identical delta, so the ledger invariant
          // openingBalance + sum(transactions) === currentBalance still holds.
          const acct = await Account.findById(d.entity);
          const delta = d.amount - acct.openingBalance;
          acct.openingBalance = d.amount;
          acct.currentBalance += delta;
          await acct.save();
        } else if (d.entityType === 'customer') {
          await Customer.updateOne({ _id: d.entity }, { $inc: { balance: d.amount } });
        } else {
          await Supplier.updateOne({ _id: d.entity }, { $inc: { payable: d.amount } });
        }
        res.created++;
      } catch (e) {
        res.failed++;
        res.errors.push({ row: row.excelRow, field: 'Name', value: d?.entityName, message: friendly(e) });
        if (record) await OpeningBalance.deleteOne({ _id: record._id }).catch(() => {});
      }
    }
    return res;
  },
};

// Never surface a raw driver/Mongoose error to the user.
function friendly(e) {
  if (e?.code === 11000) {
    const field = Object.keys(e.keyPattern || {})[0] || 'value';
    return `a record with this ${field} already exists`;
  }
  if (e?.name === 'ValidationError') {
    return Object.values(e.errors || {}).map((x) => x.message).join('; ') || 'validation failed';
  }
  const m = String(e?.message || 'could not be saved');
  return m.length > 200 ? 'could not be saved' : m;
}

export const IMPORTERS = {
  products,
  customers,
  suppliers,
  invoices,
  'purchase-orders': purchaseOrders,
  expenses,
  'opening-balances': openingBalances,
};

export const ACTIONS = R;
