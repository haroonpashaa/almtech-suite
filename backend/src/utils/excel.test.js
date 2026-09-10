import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readSheet, readSheetRaw, ExcelError } from './excel.js';

async function sheetBuffer(headerRow, dataRows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(headerRow);
  for (const row of dataRows) sheet.addRow(row);
  return wb.xlsx.writeBuffer();
}

describe('readSheet — backward compatibility', () => {
  it('returns { rows, unmappedColumns } and still maps declared aliases correctly', async () => {
    const buffer = await sheetBuffer(['Name', 'SKU'], [['Widget', 'W-1']]);
    const result = await readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'], name: ['Name'] } });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sku).toBe('W-1');
    expect(result.rows[0].name).toBe('Widget');
    expect(result.unmappedColumns).toEqual([]);
  });

  it('still throws when a required column is missing (existing behavior preserved)', async () => {
    const buffer = await sheetBuffer(['Name'], [['Widget']]);
    await expect(
      readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'], name: ['Name'] } })
    ).rejects.toThrow(ExcelError);
  });

  it('still skips a fully blank spacer row for the declared fields', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(['Name', 'SKU']);
    sheet.addRow(['Widget', 'W-1']);
    sheet.addRow([null, null]);
    const buffer = await wb.xlsx.writeBuffer();
    const { rows } = await readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'], name: ['Name'] } });
    expect(rows).toHaveLength(1);
  });
});

describe('readSheet — unmapped column detection', () => {
  it('lists a header that matches no alias, using its original text', async () => {
    const buffer = await sheetBuffer(['SKU', 'DESCRIPTION'], [['W-1', 60]]);
    const { unmappedColumns } = await readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'] } });
    expect(unmappedColumns).toEqual(['DESCRIPTION']);
  });

  it('lists multiple unrecognized columns', async () => {
    const buffer = await sheetBuffer(['SKU', 'DESCRIPTION', 'BATTERY'], [['W-1', 60, 'Y']]);
    const { unmappedColumns } = await readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'] } });
    expect(unmappedColumns).toEqual(['DESCRIPTION', 'BATTERY']);
  });

  it('does not list a blank header cell as unmapped', async () => {
    const buffer = await sheetBuffer(['SKU', ''], [['W-1', '']]);
    const { unmappedColumns } = await readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'] } });
    expect(unmappedColumns).toEqual([]);
  });

  it('is purely informational — an unmapped column never blocks an otherwise valid import', async () => {
    const buffer = await sheetBuffer(['SKU', 'DESCRIPTION'], [['W-1', 60]]);
    const result = await readSheet(buffer, { requiredHeaders: ['sku'], aliases: { sku: ['SKU'] } });
    expect(result.rows).toHaveLength(1);
    expect(result.unmappedColumns).toEqual(['DESCRIPTION']);
  });
});

// ===========================================================================
// readSheetRaw — the upload-time reader behind parseImportFile. The whole
// point of this function is that it NEVER rejects a sheet for not matching
// what an importer expects: no required-column check exists at all, and
// nothing recognized or not is ever dropped.
// ===========================================================================
describe('readSheetRaw — never rejects for ERP-shape reasons', () => {
  const productAliases = { sku: ['Serial Number', 'SKU'], name: ['Name', 'Product Name'], stock: ['Stock', 'Quantity'], sellingPrice: ['Selling Price', 'Price'] };

  it('opens a sheet missing every required column instead of throwing', async () => {
    // The example from the spec: Product/Qty/Price, none of which is "Serial
    // Number" — a real ERP importer would require sku (Serial Number).
    const buffer = await sheetBuffer(['Product', 'Qty', 'Amount'], [['Laptop', 5, 50000]]);
    const { rows, columns, unmappedColumns } = await readSheetRaw(buffer, { aliases: productAliases });
    expect(rows).toHaveLength(1);
    expect(columns.map((c) => c.label)).toEqual(['Product', 'Qty', 'Amount']);
    // None of these headers match a known alias, so none is dropped — all
    // three are simply reported as not yet recognized.
    expect(unmappedColumns.sort()).toEqual(['Amount', 'Product', 'Qty'].sort());
  });

  it('preserves the actual cell data of unrecognized columns instead of discarding it', async () => {
    const buffer = await sheetBuffer(['Product', 'Qty'], [['Laptop', 5]]);
    const { rows, columns } = await readSheetRaw(buffer, { aliases: productAliases });
    const productCol = columns.find((c) => c.label === 'Product');
    const qtyCol = columns.find((c) => c.label === 'Qty');
    expect(rows[0][productCol.field]).toBe('Laptop');
    expect(rows[0][qtyCol.field]).toBe(5);
  });

  it('still maps a recognized header to its canonical field, exactly like readSheet', async () => {
    const buffer = await sheetBuffer(['Serial Number', 'Name'], [['SKU-1', 'Widget']]);
    const { rows, columns, unmappedColumns } = await readSheetRaw(buffer, { aliases: productAliases });
    expect(rows[0].sku).toBe('SKU-1');
    expect(rows[0].name).toBe('Widget');
    expect(columns).toEqual([{ field: 'sku', label: 'Serial Number' }, { field: 'name', label: 'Name' }]);
    expect(unmappedColumns).toEqual([]);
  });

  it('handles a mix of recognized and unrecognized columns in one sheet', async () => {
    const buffer = await sheetBuffer(['Product', 'Serial Number', 'Notes'], [['Laptop', 'SKU-1', 'Minor scratch']]);
    const { rows, columns, unmappedColumns } = await readSheetRaw(buffer, { aliases: productAliases });
    expect(rows[0].sku).toBe('SKU-1');
    const productCol = columns.find((c) => c.label === 'Product');
    const notesCol = columns.find((c) => c.label === 'Notes');
    expect(rows[0][productCol.field]).toBe('Laptop');
    expect(rows[0][notesCol.field]).toBe('Minor scratch');
    expect(unmappedColumns.sort()).toEqual(['Notes', 'Product'].sort());
  });

  it('tolerates blank cells and partially completed rows', async () => {
    const buffer = await sheetBuffer(['Serial Number', 'Name', 'Stock'], [['SKU-1', '', null], ['SKU-2', 'Widget', 3]]);
    const { rows } = await readSheetRaw(buffer, { aliases: productAliases });
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('');
    expect(rows[0].stock).toBeNull();
  });

  it('opens a sheet with headers but zero data rows instead of throwing', async () => {
    const buffer = await sheetBuffer(['Serial Number', 'Name'], []);
    const { rows, columns } = await readSheetRaw(buffer, { aliases: productAliases });
    expect(rows).toEqual([]);
    expect(columns).toHaveLength(2);
  });

  it('still throws for a genuinely unreadable file', async () => {
    await expect(readSheetRaw(Buffer.from('not an excel file'), { aliases: productAliases })).rejects.toThrow(ExcelError);
  });

  it('still throws for a sheet with no header row at all', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1');
    const buffer = await wb.xlsx.writeBuffer();
    await expect(readSheetRaw(buffer, { aliases: productAliases })).rejects.toThrow(ExcelError);
  });

  it('deduplicates two unrecognized headers that would otherwise collide', async () => {
    const buffer = await sheetBuffer(['Notes', 'Notes'], [['A', 'B']]);
    const { columns, rows } = await readSheetRaw(buffer, { aliases: {} });
    expect(columns.map((c) => c.field)).toEqual(['notes', 'notes_2']);
    expect(rows[0].notes).toBe('A');
    expect(rows[0].notes_2).toBe('B');
  });
});
