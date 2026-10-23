import { describe, it, expect } from 'vitest';
import { buildProductPayload } from './productPayload.js';

describe('buildProductPayload', () => {
  it('strips purchasePrice on both create and edit', () => {
    const created = buildProductPayload({ name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, purchasePrice: 500, barcode: '' }, { isNew: true });
    const edited = buildProductPayload({ name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, purchasePrice: 500, barcode: '' }, { isNew: false });
    expect(created).not.toHaveProperty('purchasePrice');
    expect(edited).not.toHaveProperty('purchasePrice');
  });

  it('strips sellingPrice on edit, even when present in form state', () => {
    const payload = buildProductPayload({
      name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, sellingPrice: 900, barcode: '',
    }, { isNew: false });
    expect(payload).not.toHaveProperty('sellingPrice');
  });

  it('defaults to edit behaviour (strips sellingPrice) when isNew is omitted', () => {
    const payload = buildProductPayload({ name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, sellingPrice: 900, barcode: '' });
    expect(payload).not.toHaveProperty('sellingPrice');
  });

  it('keeps and numeric-coerces sellingPrice on create', () => {
    const payload = buildProductPayload({
      name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, sellingPrice: '900', barcode: '',
    }, { isNew: true });
    expect(payload.sellingPrice).toBe(900);
  });

  it('defaults sellingPrice to 0 on create when blank or missing', () => {
    const blank = buildProductPayload({ name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, sellingPrice: '', barcode: '' }, { isNew: true });
    const missing = buildProductPayload({ name: 'X1', sku: 'SN1', stock: 5, lowStockThreshold: 2, barcode: '' }, { isNew: true });
    expect(blank.sellingPrice).toBe(0);
    expect(missing.sellingPrice).toBe(0);
  });

  it('coerces initial stock and lowStockThreshold to numbers on create', () => {
    const payload = buildProductPayload({ name: 'X1', sku: 'SN1', stock: '7', lowStockThreshold: '3', barcode: '' }, { isNew: true });
    expect(payload.stock).toBe(7);
    expect(payload.lowStockThreshold).toBe(3);
  });

  it('does not submit stale inventory or server metadata loaded into an edit form', () => {
    const form = {
      _id: 'product-1', name: 'X1 updated', sku: 'SN1', stock: 7, tracksSerials: true,
      serials: [{ serial: 'SN-1', status: 'in_stock' }], __v: 0,
      createdAt: '2026-01-01', updatedAt: '2026-01-02', isLowStock: false,
      purchasePrice: 500, sellingPrice: 900, lowStockThreshold: '3', barcode: ' 123 ',
    };
    expect(buildProductPayload(form)).toEqual({ name: 'X1 updated', sku: 'SN1', lowStockThreshold: 3, barcode: '123' });
    expect(form.stock).toBe(7);
    expect(form.serials).toEqual([{ serial: 'SN-1', status: 'in_stock' }]);
  });

  it('keeps initial stock and serial tracking on create without accepting serial records', () => {
    const payload = buildProductPayload({
      name: 'X1', sku: 'SN1', stock: '2', tracksSerials: true,
      serials: [{ serial: 'SN-1', status: 'sold' }], lowStockThreshold: '1',
    }, { isNew: true });
    expect(payload).toMatchObject({ stock: 2, tracksSerials: true, sellingPrice: 0 });
    expect(payload).not.toHaveProperty('serials');
  });

  it('trims the barcode', () => {
    const payload = buildProductPayload({ name: 'X1', sku: 'SN1', stock: 1, lowStockThreshold: 1, barcode: '  123  ' });
    expect(payload.barcode).toBe('123');
  });

  it('leaves non-price fields untouched', () => {
    const payload = buildProductPayload({
      name: 'X1', sku: 'SN1', brand: 'HP', processor: 'i5', comments: 'scratch',
      stock: 1, lowStockThreshold: 1, barcode: '',
    });
    expect(payload.name).toBe('X1');
    expect(payload.brand).toBe('HP');
    expect(payload.processor).toBe('i5');
    expect(payload.comments).toBe('scratch');
  });
});
