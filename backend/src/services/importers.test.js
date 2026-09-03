import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import ExcelJS from 'exceljs';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { IMPORTERS, ACTIONS } from './importers.js';
import { EXPORTERS } from './exporters.js';
import { readSheet } from '../utils/excel.js';

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});

afterEach(async () => {
  await Product.deleteMany({});
  await Customer.deleteMany({});
  await Supplier.deleteMany({});
  await OpeningBalance.deleteMany({});
});

function ctx() {
  return { user: { _id: new mongoose.Types.ObjectId() }, batchId: new mongoose.Types.ObjectId() };
}

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

async function sheetBuffer(headerRow, dataRows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(headerRow);
  for (const row of dataRows) sheet.addRow(row);
  return wb.xlsx.writeBuffer();
}

const PRODUCTS_ALIASES = IMPORTERS.products.aliases;
const PRODUCTS_REQUIRED = IMPORTERS.products.required;

async function readProductsSheet(headerRow, dataRows) {
  const buffer = await sheetBuffer(headerRow, dataRows);
  return readSheet(buffer, { requiredHeaders: PRODUCTS_REQUIRED, aliases: PRODUCTS_ALIASES });
}

describe('products importer — comments (pre-existing)', () => {
  it('sets comments on a newly created product', async () => {
    const prepared = await IMPORTERS.products.prepare([
      { sku: 'SN001', name: 'Intel Core i5-1135G7', comments: 'Screen scratch' },
    ]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'SN001' });
    expect(product.comments).toBe('Screen scratch');
  });

  it('updates comments on an existing product when the sheet supplies a new value', async () => {
    await Product.create({ sku: 'SN002', name: 'Old name', comments: 'Old comment' });
    const prepared = await IMPORTERS.products.prepare([
      { sku: 'SN002', name: 'Old name', comments: 'Battery health issue' },
    ]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'SN002' });
    expect(product.comments).toBe('Battery health issue');
  });

  it('leaves existing comments untouched when the sheet has no Comments column', async () => {
    await Product.create({ sku: 'SN003', name: 'Existing laptop', comments: 'Missing charger' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'SN003', name: 'Existing laptop' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'SN003' });
    expect(product.comments).toBe('Missing charger');
  });

  it('does not require Comments for an otherwise-valid row', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'SN004', name: 'No comments here' }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    expect(prepared[0].errors).toHaveLength(0);
  });
});

// ===========================================================================
// Stock spreadsheet importer — header/alias recognition (real spreadsheet spellings)
// ===========================================================================
describe('products importer — automatic column detection', () => {
  it('recognizes SERIAL as the Serial Number/SKU column', async () => {
    const { rows } = await readProductsSheet(['SERIAL', 'MODEL'], [['5CG0246J0S', 'EliteBook 745 G6']]);
    expect(rows[0].sku).toBe('5CG0246J0S');
  });

  it('recognizes "Serial Number" as the Serial Number/SKU column', async () => {
    const { rows } = await readProductsSheet(['Serial Number', 'Model'], [['ABC123', 'X1 Carbon']]);
    expect(rows[0].sku).toBe('ABC123');
  });

  it('still recognizes plain SKU (backward compatibility)', async () => {
    const { rows } = await readProductsSheet(['SKU', 'Name'], [['OLD-SKU-1', 'Old Style Product']]);
    expect(rows[0].sku).toBe('OLD-SKU-1');
  });

  it('recognizes MFG and MAKE as Brand', async () => {
    const a = await readProductsSheet(['SERIAL', 'MFG'], [['S1', 'HP']]);
    expect(a.rows[0].brand).toBe('HP');
    const b = await readProductsSheet(['SERIAL', 'MAKE'], [['S2', 'Dell']]);
    expect(b.rows[0].brand).toBe('Dell');
  });

  it('recognizes CPU and "CPU ( IF APPLICABLE )" as Processor', async () => {
    const a = await readProductsSheet(['SERIAL', 'CPU'], [['S1', 'INTEL I5.']]);
    expect(a.rows[0].processor).toBe('INTEL I5.');
    const b = await readProductsSheet(['SERIAL', 'CPU ( IF APPLICABLE )'], [['S2', 'AMD Ryzen 5 PRO 3500U']]);
    expect(b.rows[0].processor).toBe('AMD Ryzen 5 PRO 3500U');
  });

  it('recognizes MEMORY and RAM as the same field', async () => {
    const a = await readProductsSheet(['SERIAL', 'MEMORY'], [['S1', 8]]);
    expect(a.rows[0].ram).toBe(8);
    const b = await readProductsSheet(['SERIAL', 'RAM'], [['S2', '16 GB']]);
    expect(b.rows[0].ram).toBe('16 GB');
  });

  it('reports DESCRIPTION as an unmapped column — genuinely unrecognized columns are still reported', async () => {
    const { unmappedColumns } = await readProductsSheet(
      ['SERIAL', 'MODEL', 'DESCRIPTION'],
      [['S1', 'EliteBook', 60]]
    );
    expect(unmappedColumns).toContain('DESCRIPTION');
  });

  it('does not report a recognized column as unmapped', async () => {
    const { unmappedColumns } = await readProductsSheet(['SERIAL', 'MODEL', 'Grade', 'BATTERY'], [['S1', 'X1', 'B', '85%']]);
    expect(unmappedColumns).not.toContain('MODEL');
    expect(unmappedColumns).not.toContain('Grade');
    expect(unmappedColumns).not.toContain('BATTERY');
  });
});

// ===========================================================================
// Name derivation
// ===========================================================================
describe('products importer — Name derivation from Model', () => {
  it('uses Model as Name when Name is absent', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', model: 'HP EliteBook 745 G6' }]);
    expect(prepared[0].errors).toHaveLength(0);
    expect(prepared[0].data.name).toBe('HP EliteBook 745 G6');
  });

  it('prefers an explicit Name over Model when both are present', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'Custom Name', model: 'X1 Carbon' }]);
    expect(prepared[0].data.name).toBe('Custom Name');
  });

  it('rejects a row with neither Name nor Model', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1' }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.field === 'Name')).toBe(true);
  });

  it('leaves an existing product unaffected when the sheet still supplies its Name', async () => {
    await Product.create({ sku: 'S1', name: 'Original Name' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'Original Name' }]);
    expect(prepared[0].data.name).toBe('Original Name');
  });
});

// ===========================================================================
// Serial requirement, duplicates, numeric safety
// ===========================================================================
describe('products importer — Serial Number rules', () => {
  it('rejects a row with a missing Serial Number', async () => {
    const prepared = await IMPORTERS.products.prepare([{ name: 'No serial here' }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.field === 'Serial Number' && e.message.includes('required'))).toBe(true);
  });

  it('detects a duplicate Serial Number within the file, case-insensitively', async () => {
    const prepared = await IMPORTERS.products.prepare([
      { sku: 'abc123', name: 'First' },
      { sku: 'ABC123', name: 'Second' },
    ]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    expect(prepared[1].action).toBe(ACTIONS.ERROR);
    expect(prepared[1].errors.some((e) => e.message.includes('duplicate'))).toBe(true);
  });

  it('allows a numeric-but-safe Serial Number with a warning, not an error', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 170777421705, name: 'Drive-like serial' }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    expect(prepared[0].data.sku).toBe('170777421705');
    expect(prepared[0].note).toMatch(/stored as a number/i);
  });

  it('rejects a Serial Number that exceeds a JS-safe integer', async () => {
    const unsafe = Number.MAX_SAFE_INTEGER * 100;
    const prepared = await IMPORTERS.products.prepare([{ sku: unsafe, name: 'Too big' }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.message.includes('too large'))).toBe(true);
  });
});

// ===========================================================================
// N/A handling
// ===========================================================================
describe('products importer — N/A handling', () => {
  it('treats "N/A" as empty rather than storing it literally', async () => {
    const prepared = await IMPORTERS.products.prepare([
      { sku: 'S1', name: 'Laptop', warranty: 'N/A', mediaSerial: 'n/a' },
    ]);
    expect(prepared[0].data.warranty).toBeUndefined();
    expect(prepared[0].data.comments).toBeUndefined();
  });
});

// ===========================================================================
// RAM normalization
// ===========================================================================
describe('products importer — RAM normalization', () => {
  it('appends "GB" to a bare number', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', ram: '8' }]);
    expect(prepared[0].data.ram).toBe('8 GB');
  });

  it('keeps an already-unit-suffixed value as-is', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', ram: '16 GB' }]);
    expect(prepared[0].data.ram).toBe('16 GB');
  });

  it('preserves a non-numeric descriptive value like BUILT IN', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', ram: 'BUILT IN' }]);
    expect(prepared[0].data.ram).toBe('BUILT IN');
  });
});

// ===========================================================================
// Grade / comments composition
// ===========================================================================
describe('products importer — Grade and comments composition', () => {
  it('folds Grade into Comments with a labeled line, never as a new field', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', grade: 'B' }]);
    expect(prepared[0].data.comments).toBe('Grade: B');
    expect(prepared[0].data.grade).toBeUndefined();
  });

  it('composes Grade + Comments + Usage Signs + Casing + Screen + Notes + Media Serial in the fixed order', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L',
      grade: 'B',
      comments: 'MODERATE USAGE SIGNS ALL OVER, GRADE B',
      usageSigns: 'MODERATE',
      casingCondition: 'MODERATE',
      screenCondition: 'OK',
      notes: 'NO MEDIA UPON PHYSICAL INSPECTION',
      mediaSerial: '60HA11Q0KN21',
    }]);
    expect(prepared[0].data.comments).toBe(
      'Grade: B\n' +
      'MODERATE USAGE SIGNS ALL OVER, GRADE B\n' +
      'Usage signs: MODERATE\n' +
      'Casing: MODERATE\n' +
      'Screen: OK\n' +
      'Notes: NO MEDIA UPON PHYSICAL INSPECTION\n' +
      'Media serial: 60HA11Q0KN21'
    );
  });

  it('never discards the original Comments value even when composed with other columns', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L', comments: 'Original defect note', grade: 'C',
    }]);
    expect(prepared[0].data.comments).toContain('Original defect note');
  });

  it('preserves BIOS-lock narrative from Comments verbatim alongside Grade', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L', grade: 'B',
      comments: 'BIOS LOCKED, UNABLE TO ACCESS BIOS, MEDIA EXTERNALLY WIPED',
    }]);
    expect(prepared[0].data.comments).toBe('Grade: B\nBIOS LOCKED, UNABLE TO ACCESS BIOS, MEDIA EXTERNALLY WIPED');
    expect(prepared[0].data.active).toBe(true);
    expect(prepared[0].data.condition).toBe('used');
  });

  it('leaves existing comments untouched when the sheet supplies none of the composition columns', async () => {
    await Product.create({ sku: 'S1', name: 'L', comments: 'Existing note' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    expect(prepared[0].data.comments).toBeUndefined();
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.comments).toBe('Existing note');
  });
});

// ===========================================================================
// BATTERY — folded into Comments, same mechanism as Grade/Usage Signs/etc.
// ===========================================================================
describe('products importer — Battery composition', () => {
  it('folds Battery into Comments with a labeled line, never as a new field', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', battery: '85%' }]);
    expect(prepared[0].data.comments).toBe('Battery: 85%');
    expect(prepared[0].data.battery).toBeUndefined();
  });

  it('preserves existing Comments text and folds Battery alongside it', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L', comments: 'Minor scratch on lid', battery: '85%',
    }]);
    expect(prepared[0].data.comments).toBe('Minor scratch on lid\nBattery: 85%');
  });

  it('composes Grade + Comments + Battery + Usage Signs + Casing + Screen + Notes + Media Serial in the fixed order', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L',
      grade: 'B',
      comments: 'MODERATE USAGE SIGNS ALL OVER, GRADE B',
      battery: '85%',
      usageSigns: 'MODERATE',
      casingCondition: 'MODERATE',
      screenCondition: 'OK',
      notes: 'NO MEDIA UPON PHYSICAL INSPECTION',
      mediaSerial: '60HA11Q0KN21',
    }]);
    expect(prepared[0].data.comments).toBe(
      'Grade: B\n' +
      'MODERATE USAGE SIGNS ALL OVER, GRADE B\n' +
      'Battery: 85%\n' +
      'Usage signs: MODERATE\n' +
      'Casing: MODERATE\n' +
      'Screen: OK\n' +
      'Notes: NO MEDIA UPON PHYSICAL INSPECTION\n' +
      'Media serial: 60HA11Q0KN21'
    );
  });

  it('treats a blank Battery as empty — no "Battery:" line, existing comments untouched', async () => {
    await Product.create({ sku: 'S1', name: 'L', comments: 'Existing note' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', battery: '' }]);
    expect(prepared[0].data.comments).toBeUndefined();
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.comments).toBe('Existing note');
  });

  it('treats "N/A" Battery as empty, same as any other N/A column', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', battery: 'n/a' }]);
    expect(prepared[0].data.comments).toBeUndefined();
  });

  it('re-importing the same Battery value does not duplicate it in Comments', async () => {
    const first = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', comments: 'Minor scratch on lid', battery: '85%' }]);
    await IMPORTERS.products.commit(first);
    let product = await Product.findOne({ sku: 'S1' });
    expect(product.comments).toBe('Minor scratch on lid\nBattery: 85%');

    const second = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', comments: 'Minor scratch on lid', battery: '85%' }]);
    await IMPORTERS.products.commit(second);
    product = await Product.findOne({ sku: 'S1' });
    expect(product.comments).toBe('Minor scratch on lid\nBattery: 85%');
    expect((product.comments.match(/Battery: 85%/g) || []).length).toBe(1);
  });

  it('a later re-import without a Battery column recomposes from what that sheet currently states', async () => {
    // Same rule that already applies to Grade/Usage Signs/etc — each import recomposes
    // Comments from what THAT sheet currently supplies, it does not merge with a prior
    // import's columns.
    const first = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', comments: 'Minor scratch on lid', battery: '85%' }]);
    await IMPORTERS.products.commit(first);

    const second = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', comments: 'Minor scratch on lid' }]);
    await IMPORTERS.products.commit(second);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.comments).toBe('Minor scratch on lid');
  });

  it('leaves Battery-derived comments untouched when a later sheet supplies no comment-related columns at all', async () => {
    await Product.create({ sku: 'S1', name: 'L', comments: 'Minor scratch on lid\nBattery: 85%' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    expect(prepared[0].data.comments).toBeUndefined();
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.comments).toBe('Minor scratch on lid\nBattery: 85%');
  });
});

// ===========================================================================
// Storage / media composition
// ===========================================================================
describe('products importer — storage/media composition', () => {
  it('combines Media Mfg + Media Model into Storage', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L', mediaMfg: 'Samsung Electronics Co., Memory Division', mediaModel: 'SAMSUNG MZVLB256HBHQ-000H1',
    }]);
    expect(prepared[0].data.storage).toBe('Samsung Electronics Co., Memory Division — SAMSUNG MZVLB256HBHQ-000H1');
  });

  it('sends the drive serial to Comments, not Storage', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', mediaSerial: 'S4GNNF2N460360' }]);
    expect(prepared[0].data.comments).toBe('Media serial: S4GNNF2N460360');
    expect(prepared[0].data.storage).toBeUndefined();
  });

  it('never guesses a capacity from the media model string', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', mediaModel: 'MZVLB256HBHQ-000H1' }]);
    expect(prepared[0].data.storage).toBe('MZVLB256HBHQ-000H1');
    expect(prepared[0].data.storage).not.toMatch(/256\s*GB/i);
  });

  it('prefers a direct Storage column over composed media fields when both are present', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'S1', name: 'L', storage: '512GB NVMe SSD', mediaMfg: 'Kioxia', mediaModel: 'KXG60ZNV256G',
    }]);
    expect(prepared[0].data.storage).toBe('512GB NVMe SSD');
  });
});

// ===========================================================================
// DESCRIPTION — hard rule: never imported anywhere
// ===========================================================================
describe('products importer — DESCRIPTION is never imported', () => {
  it('DESCRIPTION never reaches description, purchasePrice, sellingPrice, or any other field', async () => {
    // DESCRIPTION has no alias at all, so readSheet() never extracts it into a row —
    // this proves the column simply cannot reach prepare(), let alone a Product field.
    const { rows, unmappedColumns } = await readProductsSheet(
      ['SERIAL', 'MODEL', 'DESCRIPTION'],
      [['S1', 'EliteBook', 60]]
    );
    expect(rows[0]).not.toHaveProperty('description');
    expect(rows[0]).not.toHaveProperty('purchasePrice');
    expect(rows[0]).not.toHaveProperty('sellingPrice');
    expect(unmappedColumns).toContain('DESCRIPTION');

    const prepared = await IMPORTERS.products.prepare(rows);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.description).toBeFalsy();
    expect(product.purchasePrice).toBe(0);
    expect(product.sellingPrice).toBe(0);
  });
});

// ===========================================================================
// Footer/summary rows
// ===========================================================================
describe('products importer — footer/summary rows', () => {
  it('silently ignores a row that only carries an unmapped-column value (e.g. a SUM() total row)', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(['SERIAL', 'MODEL', 'DESCRIPTION']);
    sheet.addRow(['S1', 'EliteBook 745', 60]);
    sheet.addRow(['S2', 'EliteBook 745', 60]);
    // Footer row: blank Serial/Model, only a formula result in DESCRIPTION — exactly
    // like row 645 of the real "643 x HP NB.xlsx" file.
    const footerRow = sheet.addRow([null, null, { formula: 'SUM(C2:C3)', result: 120 }]);
    const buffer = await wb.xlsx.writeBuffer();
    const { rows } = await readSheet(buffer, { requiredHeaders: PRODUCTS_REQUIRED, aliases: PRODUCTS_ALIASES });
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.__row === footerRow.number)).toBe(false);
  });

  it('still rejects a genuinely partial row that has some data but no Serial Number', async () => {
    const prepared = await IMPORTERS.products.prepare([{ model: 'EliteBook 745 G6', brand: 'HP' }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.field === 'Serial Number')).toBe(true);
  });
});

// ===========================================================================
// Existing values preserved when columns are absent (regression: pre-existing rule)
// ===========================================================================
describe('products importer — existing values preserved when columns are absent', () => {
  it('does not overwrite existing processor/ram/storage when the sheet omits them', async () => {
    await Product.create({ sku: 'S1', name: 'L', processor: 'Old CPU', ram: '8 GB', storage: 'Old drive' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.processor).toBe('Old CPU');
    expect(product.ram).toBe('8 GB');
    expect(product.storage).toBe('Old drive');
  });

  it('does not overwrite existing condition on update when the sheet omits Condition', async () => {
    await Product.create({ sku: 'S1', name: 'L', condition: 'refurbished' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.condition).toBe('refurbished');
  });

  it('does not overwrite existing stock on update when the sheet has no Stock/Quantity column', async () => {
    await Product.create({ sku: 'S1', name: 'L', stock: 42 });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.stock).toBe(42);
  });

  it('defaults a newly created product with no Stock/Quantity column to stock = 1', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.stock).toBe(1);
  });

  it('honors an explicit Stock column exactly as before when the file has one', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', stock: 25 }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.stock).toBe(25);
  });

  // Regression: found via the real-file verification pass. Re-importing a stock
  // sheet with no Selling Price column used to unconditionally reset sellingPrice
  // to 0 on every existing product — the exact bug purchasePrice was already fixed
  // for, but sellingPrice was missed.
  it('does not zero out an existing sellingPrice when the sheet has no Selling Price column', async () => {
    await Product.create({ sku: 'S1', name: 'L', sellingPrice: 1500 });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.sellingPrice).toBe(1500);
  });

  it('still honors an explicit Selling Price column exactly as before', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'S1', name: 'L', sellingPrice: 999 }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'S1' });
    expect(product.sellingPrice).toBe(999);
  });
});

// ===========================================================================
// Create/update by Serial Number
// ===========================================================================
describe('products importer — create/update by Serial Number', () => {
  it('creates a new product for an unseen Serial Number', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'NEW-1', name: 'L' }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
  });

  it('updates the existing product for a known Serial Number, case-insensitively', async () => {
    await Product.create({ sku: 'EXIST-1', name: 'L' });
    const prepared = await IMPORTERS.products.prepare([{ sku: 'exist-1', name: 'L Updated' }]);
    expect(prepared[0].action).toBe(ACTIONS.UPDATE);
    await IMPORTERS.products.commit(prepared);
    const all = await Product.find({});
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('L Updated');
  });
});

// ===========================================================================
// Customers importer — opening receivable balance
// ===========================================================================
describe('customers importer — opening balance', () => {
  it('imports a new customer\'s opening receivable through OpeningBalance, not by writing balance directly', async () => {
    const prepared = await IMPORTERS.customers.prepare([{ name: 'Acme Traders', email: 'acme@example.com', balance: 5000 }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    expect(prepared[0].note).toMatch(/opening receivable balance of 5000/);
    await IMPORTERS.customers.commit(prepared, ctx());

    const customer = await Customer.findOne({ email: 'acme@example.com' });
    expect(customer.balance).toBe(5000);

    const obs = await OpeningBalance.find({ entityType: 'customer', entity: customer._id });
    expect(obs).toHaveLength(1);
    expect(obs[0].amount).toBe(5000);
    expect(obs[0].reference).toBe('import:opening-balance');
  });

  it('does not double-post the balance when the same customer is imported again', async () => {
    const row1 = { name: 'Acme Traders', email: 'acme@example.com', balance: 5000 };
    await IMPORTERS.customers.commit(await IMPORTERS.customers.prepare([row1]), ctx());

    // Re-import — same file (or a corrected re-upload) supplying the same balance again.
    const prepared2 = await IMPORTERS.customers.prepare([row1]);
    expect(prepared2[0].action).toBe(ACTIONS.UPDATE);
    expect(prepared2[0].note).toMatch(/already recorded.*will not be applied again/);
    await IMPORTERS.customers.commit(prepared2, ctx());

    const customer = await Customer.findOne({ email: 'acme@example.com' });
    expect(customer.balance).toBe(5000); // unchanged — not 10000
    expect(await OpeningBalance.countDocuments({ entityType: 'customer', entity: customer._id })).toBe(1);
  });

  it('rejects the whole row for a negative balance instead of silently dropping it', async () => {
    const prepared = await IMPORTERS.customers.prepare([{ name: 'Bad Row', email: 'bad@example.com', balance: -100 }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.field === 'Balance')).toBe(true);
    await IMPORTERS.customers.commit(prepared, ctx());
    expect(await Customer.findOne({ email: 'bad@example.com' })).toBeNull();
  });

  it('rejects the whole row for a non-numeric balance instead of silently dropping it', async () => {
    const prepared = await IMPORTERS.customers.prepare([{ name: 'Bad Row', email: 'bad2@example.com', balance: 'not-a-number' }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.field === 'Balance')).toBe(true);
  });

  it('treats an explicit 0 balance as nothing to record — no OpeningBalance is created', async () => {
    const prepared = await IMPORTERS.customers.prepare([{ name: 'Zero Co', email: 'zero@example.com', balance: 0 }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    await IMPORTERS.customers.commit(prepared, ctx());
    const customer = await Customer.findOne({ email: 'zero@example.com' });
    expect(customer.balance).toBe(0);
    expect(await OpeningBalance.countDocuments({ entityType: 'customer', entity: customer._id })).toBe(0);
  });

  it('still imports a customer with no Balance column at all, exactly as before', async () => {
    const prepared = await IMPORTERS.customers.prepare([{ name: 'No Balance Co', email: 'nobalance@example.com' }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    await IMPORTERS.customers.commit(prepared, ctx());
    const customer = await Customer.findOne({ email: 'nobalance@example.com' });
    expect(customer.balance).toBe(0);
  });
});

// ===========================================================================
// Suppliers importer — opening payable balance
// ===========================================================================
describe('suppliers importer — opening balance', () => {
  it('imports a new supplier\'s opening payable through OpeningBalance, not by writing payable directly', async () => {
    const prepared = await IMPORTERS.suppliers.prepare([{ name: 'Global Parts', email: 'global@example.com', payable: 7500 }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    expect(prepared[0].note).toMatch(/opening payable balance of 7500/);
    await IMPORTERS.suppliers.commit(prepared, ctx());

    const supplier = await Supplier.findOne({ email: 'global@example.com' });
    expect(supplier.payable).toBe(7500);

    const obs = await OpeningBalance.find({ entityType: 'supplier', entity: supplier._id });
    expect(obs).toHaveLength(1);
    expect(obs[0].amount).toBe(7500);
    expect(obs[0].reference).toBe('import:opening-balance');
  });

  it('does not double-post the payable when the same supplier is imported again', async () => {
    const row1 = { name: 'Global Parts', email: 'global@example.com', payable: 7500 };
    await IMPORTERS.suppliers.commit(await IMPORTERS.suppliers.prepare([row1]), ctx());

    const prepared2 = await IMPORTERS.suppliers.prepare([row1]);
    expect(prepared2[0].action).toBe(ACTIONS.UPDATE);
    expect(prepared2[0].note).toMatch(/already recorded.*will not be applied again/);
    await IMPORTERS.suppliers.commit(prepared2, ctx());

    const supplier = await Supplier.findOne({ email: 'global@example.com' });
    expect(supplier.payable).toBe(7500); // unchanged — not 15000
    expect(await OpeningBalance.countDocuments({ entityType: 'supplier', entity: supplier._id })).toBe(1);
  });

  it('rejects the whole row for a negative payable instead of silently dropping it', async () => {
    const prepared = await IMPORTERS.suppliers.prepare([{ name: 'Bad Row', email: 'bad-sup@example.com', payable: -50 }]);
    expect(prepared[0].action).toBe(ACTIONS.ERROR);
    expect(prepared[0].errors.some((e) => e.field === 'Payable')).toBe(true);
    await IMPORTERS.suppliers.commit(prepared, ctx());
    expect(await Supplier.findOne({ email: 'bad-sup@example.com' })).toBeNull();
  });

  it('treats an explicit 0 payable as nothing to record — no OpeningBalance is created', async () => {
    const prepared = await IMPORTERS.suppliers.prepare([{ name: 'Zero Supplier', email: 'zero-sup@example.com', payable: 0 }]);
    await IMPORTERS.suppliers.commit(prepared, ctx());
    const supplier = await Supplier.findOne({ email: 'zero-sup@example.com' });
    expect(supplier.payable).toBe(0);
    expect(await OpeningBalance.countDocuments({ entityType: 'supplier', entity: supplier._id })).toBe(0);
  });
});

// ===========================================================================
// Products importer — Grade/Battery/Condition/Comments round-trip integrity
//
// There is no dedicated schema field for Grade/Battery/Usage Signs/Casing
// Condition/Screen Condition/Media Serial — Product only has `comments` (free
// text) and a separate, genuinely dedicated `condition` enum field. Rather than
// add schema fields the rest of the app has no use for, composeComments folds
// the cosmetic-condition columns into `comments` losslessly (nothing dropped,
// original text always kept verbatim) and `condition` is left untouched as its
// own field. These tests prove that round-tripping through the actual export
// column definitions and back through the importer does not lose or mutate
// what was originally supplied.
// ===========================================================================
describe('products importer — Grade/Battery/Condition/Comments round-trip', () => {
  it('re-importing the exact exported Comments cell leaves stored comments unchanged', async () => {
    const prepared = await IMPORTERS.products.prepare([{
      sku: 'RT-1', name: 'Laptop', grade: 'A', comments: 'Minor scratch on lid',
      battery: '92%', condition: 'used',
    }]);
    await IMPORTERS.products.commit(prepared);
    const first = await Product.findOne({ sku: 'RT-1' });
    expect(first.comments).toBe('Grade: A\nMinor scratch on lid\nBattery: 92%');
    expect(first.condition).toBe('used');

    // Build the real export column definitions and read the exact cell value they
    // would write for this product's Comments column.
    const built = await EXPORTERS.products.build({}, { user: { role: 'admin' } });
    const commentsCol = built.columns.find((c) => c.header === 'Comments');
    const exportedRow = built.rows.find((r) => r.sku === 'RT-1');
    const exportedComments = commentsCol.value ? commentsCol.value(exportedRow) : exportedRow[commentsCol.key];
    expect(exportedComments).toBe(first.comments);

    // Re-import that exact cell value as the sole Comments input (no separate
    // Grade/Battery columns this time, exactly like a real re-upload of the
    // exported file) — the stored value must not gain a second "Grade: A" line
    // or otherwise change.
    const reprepared = await IMPORTERS.products.prepare([{ sku: 'RT-1', name: 'Laptop', comments: exportedComments }]);
    await IMPORTERS.products.commit(reprepared);
    const second = await Product.findOne({ sku: 'RT-1' });
    expect(second.comments).toBe(first.comments);
  });

  it('Condition round-trips through export and re-import as its own field, never folded into Comments', async () => {
    await IMPORTERS.products.commit(await IMPORTERS.products.prepare([
      { sku: 'RT-2', name: 'Laptop', condition: 'refurbished', comments: 'Keyboard replaced' },
    ]));
    const built = await EXPORTERS.products.build({}, { user: { role: 'admin' } });
    const conditionCol = built.columns.find((c) => c.header === 'Condition');
    const exportedRow = built.rows.find((r) => r.sku === 'RT-2');
    const exportedCondition = conditionCol.value ? conditionCol.value(exportedRow) : exportedRow[conditionCol.key];
    expect(exportedCondition).toBe('refurbished');

    const reprepared = await IMPORTERS.products.prepare([
      { sku: 'RT-2', name: 'Laptop', condition: exportedCondition, comments: 'Keyboard replaced' },
    ]);
    await IMPORTERS.products.commit(reprepared);
    const product = await Product.findOne({ sku: 'RT-2' });
    expect(product.condition).toBe('refurbished');
    expect(product.comments).toBe('Keyboard replaced'); // never merged with Condition
  });
});
