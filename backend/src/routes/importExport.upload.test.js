import express from 'express';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import importExportRoutes from './importExport.routes.js';
import { errorHandler } from '../middleware/error.js';

vi.mock('../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Authentication is isolated for this route test; the real requireRole and
    // dataset middleware still run, and no user/database fixture is needed.
    protect(req, res, next) {
      const role = req.headers.authorization?.replace(/^Bearer\s+/, '');
      if (!role) {
        res.status(401);
        return next(new Error('Not authenticated'));
      }
      req.user = { role };
      next();
    },
  };
});

const app = express();
app.use('/api/data', importExportRoutes);
app.use(errorHandler);
let server;
let baseUrl;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/data`;
});

afterAll(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

async function workbook(filename = 'products.xlsx', type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Products');
  sheet.addRow(['Serial Number', 'Name', 'Selling Price']);
  sheet.addRow(['UPLOAD-1', 'Upload fixture', 100]);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await book.xlsx.writeBuffer())], { type }), filename);
  return form;
}

async function post(path, role, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: role ? { authorization: `Bearer ${role}`, ...headers } : headers,
    body,
  });
  return { status: response.status, body: await response.json() };
}

describe('Multer upload route compatibility and safety', () => {
  it('accepts one authorized product workbook in memory', async () => {
    const result = await post('/import/products/parse', 'sales', await workbook());
    expect(result.status).toBe(200);
    expect(result.body.rows).toHaveLength(1);
    expect(result.body.rows[0].sku).toBe('UPLOAD-1');
    expect(result.body.rows[0].name).toBe('Upload fixture');
  });

  it('blocks unauthorized roles and datasets before the upload handler', async () => {
    const deniedRole = await post('/import/products/parse', 'stock', await workbook());
    expect(deniedRole.status).toBe(403);
    const deniedDataset = await post('/import/invoices/parse', 'sales', await workbook());
    expect(deniedDataset.status).toBe(403);
  });

  it('rejects unsupported file extensions and oversized workbooks with controlled 400s', async () => {
    const unsupported = await post('/import/products/parse', 'admin', await workbook('products.csv', 'text/csv'));
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.message).toMatch(/Only \.xlsx files are accepted/);

    const tooLarge = new FormData();
    tooLarge.append('file', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), 'large.xlsx');
    const oversized = await post('/import/products/parse', 'admin', tooLarge);
    expect(oversized.status).toBe(400);
    expect(oversized.body.message).toMatch(/maximum upload size is 10 MB/);
  });

  it('returns controlled errors for missing files and malformed multipart bodies', async () => {
    const noFile = new FormData();
    noFile.append('note', 'no file attached');
    const missing = await post('/import/products/parse', 'admin', noFile);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/No file uploaded/);

    const malformed = await post('/import/products/parse', 'admin', 'not a multipart body', {
      'content-type': 'multipart/form-data; boundary=missing-ending-boundary',
    });
    expect(malformed.status).toBe(400);
    expect(typeof malformed.body.message).toBe('string');
    expect(malformed.body.message.length).toBeGreaterThan(0);
  });

  it('keeps export routes reachable for authorized users', async () => {
    const response = await fetch(`${baseUrl}/templates/products`, {
      headers: { authorization: 'Bearer admin' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/spreadsheetml/);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
