import asyncHandler from 'express-async-handler';
import ImportBatch from '../models/ImportBatch.js';
import { IMPORTERS, ACTIONS } from '../services/importers.js';
import { EXPORTERS } from '../services/exporters.js';
import { readSheet, buildWorkbook, buildMultiSheetWorkbook, ExcelError } from '../utils/excel.js';
import { logActivity } from '../utils/activity.js';
import { receivables as financeReceivables, payables as financePayables } from './finance.controller.js';
import { profitAndLoss } from './report.controller.js';
import { dailyExpenses, monthlyExpenses } from './expense.controller.js';

// Reuses an existing express handler as a data source by invoking it with a captured
// response. This is deliberate: the Receivables, P&L and expense-report exports return
// byte-for-byte what those screens show, because they run the very same code — no
// second implementation of any financial calculation exists for exports.
function callHandler(handler, { query = {}, user }) {
  return new Promise((resolve, reject) => {
    const req = { query, params: {}, user, headers: {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve(payload); },
    };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

const exportContext = (user) => ({
  // Exposed directly (not just captured in the closures below) so an exporter that
  // needs to adapt its own output to the caller's role — e.g. products dropping the
  // Comments column for Sales — can do so without a second, role-aware code path.
  user,
  financeReceivables: (q) => callHandler(financeReceivables, { query: q || {}, user }),
  financePayables: (q) => callHandler(financePayables, { query: q || {}, user }),
  profitAndLoss: (q) => callHandler(profitAndLoss, { query: q || {}, user }),
  dailyExpenses: (q) => callHandler(dailyExpenses, { query: q || {}, user }),
  monthlyExpenses: (q) => callHandler(monthlyExpenses, { query: q || {}, user }),
});

const importer = (res, type) => {
  const def = IMPORTERS[type];
  if (!def) {
    res.status(404);
    throw new Error(`Unknown import type "${type}"`);
  }
  return def;
};

function requireFile(res, req) {
  if (!req.file) {
    res.status(400);
    throw new Error('No file uploaded. Attach an .xlsx file.');
  }
  return req.file;
}

// Turns prepared rows into the preview the admin confirms against.
function summarise(prepared) {
  const s = { totalRows: prepared.length, valid: 0, invalid: 0, create: 0, update: 0, skip: 0 };
  for (const r of prepared) {
    if (r.action === ACTIONS.ERROR) s.invalid++;
    else {
      s.valid++;
      if (r.action === ACTIONS.CREATE) s.create++;
      else if (r.action === ACTIONS.UPDATE) s.update++;
      else if (r.action === ACTIONS.SKIP) s.skip++;
    }
  }
  s.duplicates = s.update + s.skip;
  return s;
}

const publicRows = (prepared) =>
  prepared.map((r) => ({
    excelRow: r.excelRow,
    excelRows: r.excelRows,
    action: r.action,
    key: r.key,
    note: r.note,
    errors: r.errors,
  }));

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
// Sales loads the product catalogue and nothing else, so the screen is told about
// products alone rather than being shown datasets every attempt at which would 403.
const SALES_TYPES = new Set(['products']);
const visibleTo = (role) => (key) => role === 'admin' || (role === 'sales' && SALES_TYPES.has(key));

// A sales user may load the catalogue but not price the business's purchases, so any
// cost column in their sheet is discarded before the rows are prepared. The importer
// then treats it as "not supplied" and leaves the stored cost untouched.
// readSheet maps every header spelling onto the importer's field name before rows
// reach us, so the field to remove is the mapped one, not the sheet's heading.
const COST_ALIASES = ['purchasePrice'];
function dropCostColumns(req, rows) {
  if (req.user?.role === 'admin' || req.user?.role === 'stock') return rows;
  return rows.map((row) => {
    const clean = { ...row };
    for (const a of COST_ALIASES) delete clean[a];
    return clean;
  });
}

export const listTypes = asyncHandler(async (req, res) => {
  const allowed = visibleTo(req.user?.role);
  res.json({
    imports: Object.entries(IMPORTERS).filter(([key]) => allowed(key)).map(([key, d]) => ({
      key, label: d.label,
      requiredColumns: d.required.map((f) => d.aliases[f][0]),
      allColumns: Object.values(d.aliases).map((a) => a[0]),
      instructions: d.instructions,
    })),
    exports: Object.entries(EXPORTERS).filter(([key]) => allowed(key)).map(([key, d]) => ({ key, label: d.label })),
  });
});

// ---------------------------------------------------------------------------
// Validate — parse and classify every row. Performs ZERO database writes.
// ---------------------------------------------------------------------------
export const validateImport = asyncHandler(async (req, res) => {
  const def = importer(res, req.params.type);
  const file = requireFile(res, req);
  let prepared;
  let unmappedColumns = [];
  try {
    const sheet = await readSheet(file.buffer, { requiredHeaders: def.required, aliases: def.aliases });
    unmappedColumns = sheet.unmappedColumns;
    prepared = await def.prepare(dropCostColumns(req, sheet.rows), { user: req.user });
  } catch (e) {
    if (e instanceof ExcelError) {
      res.status(400);
      throw new Error(e.message);
    }
    throw e;
  }
  res.json({
    type: req.params.type,
    label: def.label,
    filename: file.originalname,
    summary: summarise(prepared),
    rows: publicRows(prepared),
    unmappedColumns,
  });
});

// ---------------------------------------------------------------------------
// Commit — re-parses and re-validates the uploaded file from scratch, then writes only
// the rows that pass. The client never sends back parsed data, so nothing it could
// tamper with can reach the database, and validation always precedes any write.
// ---------------------------------------------------------------------------
export const commitImport = asyncHandler(async (req, res) => {
  const def = importer(res, req.params.type);
  const file = requireFile(res, req);
  const started = Date.now();

  let prepared;
  let unmappedColumns = [];
  try {
    const sheet = await readSheet(file.buffer, { requiredHeaders: def.required, aliases: def.aliases });
    unmappedColumns = sheet.unmappedColumns;
    prepared = await def.prepare(dropCostColumns(req, sheet.rows), { user: req.user });
  } catch (e) {
    if (e instanceof ExcelError) {
      res.status(400);
      throw new Error(e.message);
    }
    throw e;
  }

  const summary = summarise(prepared);
  const batchId = new (await import('mongoose')).default.Types.ObjectId();
  const result = await def.commit(prepared, { user: req.user, batchId });

  // Validation failures never reach commit(), so they are counted, not written.
  const validationErrors = prepared
    .filter((r) => r.action === ACTIONS.ERROR)
    .flatMap((r) => r.errors.map((e) => ({ row: r.excelRow, field: e.field, value: e.value, message: e.message })));
  const allErrors = [...validationErrors, ...result.errors];

  const batch = await ImportBatch.create({
    _id: batchId,
    type: req.params.type,
    filename: file.originalname,
    fileSize: file.size,
    status: allErrors.length === 0 ? 'completed' : result.created + result.updated > 0 ? 'completed_with_errors' : 'failed',
    totalRows: summary.totalRows,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    failed: result.failed,
    rowErrors: allErrors.slice(0, 200),
    durationMs: Date.now() - started,
    importedBy: req.user._id,
  });

  await logActivity(req, 'data_imported', {
    entity: 'ImportBatch',
    entityId: batch._id,
    meta: { type: req.params.type, created: result.created, updated: result.updated, failed: result.failed },
  });

  res.json({
    batchId: batch._id,
    type: req.params.type,
    filename: file.originalname,
    summary,
    result: {
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
    },
    errors: allErrors,
    status: batch.status,
    unmappedColumns,
  });
});

// Failed rows as a spreadsheet the admin can correct and re-upload.
export const errorsWorkbook = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body?.errors) ? req.body.errors : [];
  const buffer = await buildWorkbook({
    sheetName: 'Errors',
    title: `Import errors — ${req.body?.label || req.params.type || ''}`,
    notes: ['Fix these rows in your original file, then re-upload. Row numbers refer to the original spreadsheet.'],
    columns: [
      { header: 'Excel Row', type: 'number', key: 'row' },
      { header: 'Field', key: 'field', width: 22 },
      { header: 'Value', key: 'value', width: 28 },
      { header: 'Reason', key: 'message', width: 60 },
    ],
    rows,
  });
  send(res, buffer, `import-errors-${req.params.type || 'rows'}.xlsx`);
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export const downloadTemplate = asyncHandler(async (req, res) => {
  const def = importer(res, req.params.type);
  const columns = Object.entries(def.aliases).map(([field, names]) => ({
    header: names[0],
    key: field,
    // Numeric-looking template fields still write as text in the example row so the
    // marker text stays legible; real imports coerce values on read.
    width: Math.max(14, names[0].length + 4),
  }));
  const example = { ...def.example };

  const buffer = await buildWorkbook({
    sheetName: def.sheetName,
    title: `${def.label} import template`,
    notes: [
      '*** THE ROW BELOW THE HEADERS IS AN EXAMPLE — DELETE IT BEFORE IMPORTING ***',
      ...def.instructions,
    ],
    columns,
    rows: [example],
  });
  send(res, buffer, `almtech-template-${req.params.type}.xlsx`);
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const runExport = asyncHandler(async (req, res) => {
  const def = EXPORTERS[req.params.type];
  if (!def) {
    res.status(404);
    throw new Error(`Unknown export type "${req.params.type}"`);
  }
  const ctx = exportContext(req.user);
  const built = await def.build(req.query, ctx);
  const buffer = def.multiSheet ? await buildMultiSheetWorkbook(built) : await buildWorkbook(built);
  const stamp = new Date().toISOString().slice(0, 10);
  send(res, buffer, `almtech-${req.params.type}-${stamp}.xlsx`);
});

function send(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.byteLength ?? buffer.length);
  res.end(Buffer.from(buffer));
}

// ---------------------------------------------------------------------------
// History — metadata only; the uploaded workbook is never persisted.
// ---------------------------------------------------------------------------
export const importHistory = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  const batches = await ImportBatch.find(filter)
    .populate('importedBy', 'name')
    .sort('-createdAt')
    .limit(Math.min(Number(req.query.limit) || 50, 200));
  res.json(
    batches.map((b) => ({
      _id: b._id,
      type: b.type,
      label: IMPORTERS[b.type]?.label || b.type,
      filename: b.filename,
      fileSize: b.fileSize,
      status: b.status,
      totalRows: b.totalRows,
      created: b.created,
      updated: b.updated,
      skipped: b.skipped,
      failed: b.failed,
      errorCount: b.rowErrors.length,
      durationMs: b.durationMs,
      importedBy: b.importedBy?.name || null,
      createdAt: b.createdAt,
    }))
  );
});

export const importBatchDetail = asyncHandler(async (req, res) => {
  const batch = await ImportBatch.findById(req.params.id).populate('importedBy', 'name');
  if (!batch) {
    res.status(404);
    throw new Error('Import record not found');
  }
  res.json(batch);
});
