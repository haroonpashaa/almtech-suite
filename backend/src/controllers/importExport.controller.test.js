import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import ExcelJS from 'exceljs';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import ImportBatch from '../models/ImportBatch.js';
import { parseImportFile, validateImport, commitImport } from './importExport.controller.js';

async function sheetBuffer(headerRow, dataRows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(headerRow);
  for (const row of dataRows) sheet.addRow(row);
  return wb.xlsx.writeBuffer();
}

function mockRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function fileReq({ buffer, originalname = 'sheet.xlsx', size = 100, user, params }) {
  return { file: { buffer, originalname, size }, body: {}, user, params };
}

function rowsReq({ rows, filename, unmappedColumns, user, params }) {
  return { file: undefined, body: { rows, filename, unmappedColumns }, user, params };
}

describe('edit-before-import flow (DB-backed)', () => {
  let mem;
  const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
  const sales = { _id: new mongoose.Types.ObjectId(), role: 'sales' };

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Product.deleteMany({});
    await Customer.deleteMany({});
    await ImportBatch.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('parseImportFile returns rows and columns but writes nothing to the database', async () => {
    const buffer = await sheetBuffer(
      ['Serial Number', 'Name', 'Selling Price'],
      [['SKU-1', 'Original Name', 900]]
    );
    const res = mockRes();
    await parseImportFile(fileReq({ buffer, user: admin, params: { type: 'products' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].sku).toBe('SKU-1');
    expect(res.body.rows[0].name).toBe('Original Name');
    expect(res.body.columns.some((c) => c.field === 'sku')).toBe(true);
    expect(await Product.countDocuments({})).toBe(0);
  });

  it('validateImport on edited JSON rows writes nothing to the database', async () => {
    const editedRows = [{ __row: 2, sku: 'SKU-EDIT', name: 'Edited Name', sellingPrice: 1200 }];
    const res = mockRes();
    await validateImport(rowsReq({ rows: editedRows, user: admin, params: { type: 'products' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.summary.valid).toBe(1);
    expect(await Product.countDocuments({})).toBe(0);
    expect(await ImportBatch.countDocuments({})).toBe(0);
  });

  it('commitImport on edited JSON rows performs the actual import', async () => {
    const editedRows = [{ __row: 2, sku: 'SKU-COMMIT', name: 'Committed Name', sellingPrice: 1500 }];
    const res = mockRes();
    await commitImport(rowsReq({ rows: editedRows, filename: 'my-sheet.xlsx', user: admin, params: { type: 'products' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result.created).toBe(1);
    const product = await Product.findOne({ sku: 'SKU-COMMIT' });
    expect(product).toBeTruthy();
    expect(product.name).toBe('Committed Name');
    expect(product.sellingPrice).toBe(1500);

    const batch = await ImportBatch.findById(res.body.batchId);
    expect(batch.filename).toBe('my-sheet.xlsx');
  });

  it('edited values — not the original uploaded file\'s values — are what gets imported', async () => {
    // The original file says "Original Name" / 900. The grid is edited before
    // commit to a different name and price, exactly like a user correcting a
    // typo in the preview table before confirming.
    const editedRows = [{ __row: 2, sku: 'SKU-ROUNDTRIP', name: 'Corrected Name', sellingPrice: 2000 }];
    const res = mockRes();
    await commitImport(rowsReq({ rows: editedRows, user: admin, params: { type: 'products' } }), res);

    const product = await Product.findOne({ sku: 'SKU-ROUNDTRIP' });
    expect(product.name).toBe('Corrected Name');
    expect(product.sellingPrice).toBe(2000);
  });

  it('a validation error is reported without writing, and correcting the row lets the retry succeed', async () => {
    const badRows = [{ __row: 2, sku: '', name: 'Missing Serial' }]; // Serial Number/sku is required
    const res1 = mockRes();
    await validateImport(rowsReq({ rows: badRows, user: admin, params: { type: 'products' } }), res1);
    expect(res1.body.summary.invalid).toBe(1);
    expect(res1.body.rows[0].errors.length).toBeGreaterThan(0);

    const commitAttempt = mockRes();
    await commitImport(rowsReq({ rows: badRows, user: admin, params: { type: 'products' } }), commitAttempt);
    expect(commitAttempt.body.result.created).toBe(0);
    expect(commitAttempt.body.result.failed).toBe(1);
    expect(await Product.countDocuments({})).toBe(0);

    // User returns to the editable grid and fixes the missing field, then retries.
    const fixedRows = [{ __row: 2, sku: 'SKU-FIXED', name: 'Missing Serial' }];
    const res2 = mockRes();
    await validateImport(rowsReq({ rows: fixedRows, user: admin, params: { type: 'products' } }), res2);
    expect(res2.body.summary.invalid).toBe(0);

    const commitFixed = mockRes();
    await commitImport(rowsReq({ rows: fixedRows, user: admin, params: { type: 'products' } }), commitFixed);
    expect(commitFixed.body.result.created).toBe(1);
    expect(await Product.findOne({ sku: 'SKU-FIXED' })).toBeTruthy();
  });

  it('sales (an existing Import/Export user for products) can parse and commit products via edited rows', async () => {
    const buffer = await sheetBuffer(['Serial Number', 'Name'], [['SKU-SALES', 'Sales Import']]);
    const parseRes = mockRes();
    await parseImportFile(fileReq({ buffer, user: sales, params: { type: 'products' } }), parseRes);
    expect(parseRes.statusCode).toBe(200);

    const editedRows = parseRes.body.rows.map((r) => ({ ...r, name: 'Sales Edited Name' }));
    const commitRes = mockRes();
    await commitImport(rowsReq({ rows: editedRows, user: sales, params: { type: 'products' } }), commitRes);
    expect(commitRes.body.result.created).toBe(1);
    expect((await Product.findOne({ sku: 'SKU-SALES' })).name).toBe('Sales Edited Name');
  });

  it('rejects more rows than the sanity cap without touching the database', async () => {
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({ __row: i + 2, sku: `SKU-${i}`, name: 'X' }));
    const res = mockRes();
    await expect(validateImport(rowsReq({ rows: tooMany, user: admin, params: { type: 'products' } }), res)).rejects.toThrow(/maximum is 5000/);
    expect(await Product.countDocuments({})).toBe(0);
  });

  it('rejects a row that is not a plain object', async () => {
    const res = mockRes();
    await expect(validateImport(rowsReq({ rows: ['not-an-object'], user: admin, params: { type: 'products' } }), res)).rejects.toThrow(/object of column values/);
  });

  it('rejects a request with neither a file nor rows', async () => {
    const res = mockRes();
    await expect(validateImport({ file: undefined, body: {}, user: admin, params: { type: 'products' } }, res)).rejects.toThrow(/No file uploaded and no rows/);
  });

  it('a sales user\'s cost column stays stripped on the edited-rows path exactly as on the file path', async () => {
    const editedRows = [{ __row: 2, sku: 'SKU-COST', name: 'Cost Test', purchasePrice: 999 }];
    const res = mockRes();
    await commitImport(rowsReq({ rows: editedRows, user: sales, params: { type: 'products' } }), res);
    const product = await Product.findOne({ sku: 'SKU-COST' });
    expect(product.purchasePrice).toBe(0); // stripped before prepare(), same as the file-upload path always did
  });

  // H2 regression: an invalid Condition must be visibly reported as an error
  // in BOTH the preview and the commit result, not silently imported.
  it('H2: an invalid Condition is reported as invalid in preview and is not committed', async () => {
    const rows = [{ __row: 2, sku: 'SKU-COND-H2', name: 'Condition Test', condition: 'mint' }];

    const previewRes = mockRes();
    await validateImport(rowsReq({ rows, user: admin, params: { type: 'products' } }), previewRes);
    expect(previewRes.body.summary.invalid).toBe(1);
    expect(previewRes.body.summary.create).toBe(0);
    expect(previewRes.body.rows[0].action).toBe('ERROR');
    expect(previewRes.body.rows[0].errors[0].field).toBe('Condition');

    const commitRes = mockRes();
    await commitImport(rowsReq({ rows, user: admin, params: { type: 'products' } }), commitRes);
    expect(commitRes.body.result.created).toBe(0);
    expect(commitRes.body.result.failed).toBe(1);
    expect(commitRes.body.errors).toHaveLength(1);
    expect(commitRes.body.errors[0].field).toBe('Condition');
    expect(await Product.findOne({ sku: 'SKU-COND-H2' })).toBeNull();
  });
});
