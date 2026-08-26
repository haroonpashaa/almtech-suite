import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readSheet, ExcelError } from './excel.js';

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
