import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Workbook reading
// ---------------------------------------------------------------------------
// Spreadsheet content is untrusted input. Only the header names declared in a type's
// column map are ever read; anything else in the file is ignored, so a spreadsheet can
// never reach a field the importer did not explicitly expose. Formulas are read as
// their cached result, never evaluated, and macros are never executed — ExcelJS parses
// the XML parts, it does not run anything.

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/[\s_]+/g, ' ');

export class ExcelError extends Error {}

export async function readSheet(buffer, { requiredHeaders = [], aliases = {} } = {}) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ExcelError('The file could not be read as an Excel workbook (.xlsx). Re-save it and try again.');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 1) throw new ExcelError('The workbook is empty — no sheet or no rows found.');

  const headerRow = ws.getRow(1);
  const headers = [];
  const rawHeaders = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const text = cellText(cell);
    headers[col] = norm(text);
    rawHeaders[col] = text.trim();
  });
  if (!headers.filter(Boolean).length) throw new ExcelError('The first row must contain column headers.');

  // Map each declared field to whichever header spelling the sheet used.
  const index = {};
  for (const [field, names] of Object.entries(aliases)) {
    for (const n of names) {
      const col = headers.findIndex((h) => h === norm(n));
      if (col > 0) {
        index[field] = col;
        break;
      }
    }
  }

  const missing = requiredHeaders.filter((f) => !index[f]);
  if (missing.length) {
    throw new ExcelError(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.map((m) => aliases[m]?.[0] || m).join(', ')}. ` +
        'Download the template to see the expected headers.'
    );
  }

  // Columns present in the file that no alias recognised. Never guessed at, never
  // silently dropped without a trace — surfaced to the caller so it can tell the
  // admin exactly what was not imported.
  const mappedCols = new Set(Object.values(index));
  const unmappedColumns = [];
  headers.forEach((h, col) => {
    if (!h || mappedCols.has(col)) return;
    unmappedColumns.push(rawHeaders[col]);
  });

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const record = {};
    let blank = true;
    for (const [field, col] of Object.entries(index)) {
      const v = cellValue(row.getCell(col));
      record[field] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') blank = false;
    }
    if (blank) continue; // skip spacer rows
    record.__row = r; // Excel's own row number, for error messages
    rows.push(record);
  }
  if (!rows.length) throw new ExcelError('The workbook contains headers but no data rows.');
  return { rows, unmappedColumns };
}

// ---------------------------------------------------------------------------
// Raw, upload-time reading for the edit-before-import draft. Unlike
// readSheet() above, this NEVER rejects a workbook for not matching what an
// importer expects — no required-column check, and no column is dropped for
// being unrecognized. A header that matches a known alias is still mapped to
// that field's canonical key (so a well-formed sheet behaves exactly as
// before), but a header that matches nothing gets a synthetic field key
// derived from its own text instead of being discarded — its data reaches
// the editable draft either way. The only things that still fail here are
// genuinely unreadable input (not a valid .xlsx) or a sheet with no header
// row at all — there is nothing to show in either case, not merely something
// that doesn't yet satisfy an importer's requirements.
export async function readSheetRaw(buffer, { aliases = {} } = {}) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ExcelError('The file could not be read as an Excel workbook (.xlsx). Re-save it and try again.');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 1) throw new ExcelError('The workbook is empty — no sheet or no rows found.');

  const headerRow = ws.getRow(1);
  const headers = [];
  const rawHeaders = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const text = cellText(cell);
    headers[col] = norm(text);
    rawHeaders[col] = text.trim();
  });
  if (!headers.filter(Boolean).length) throw new ExcelError('The first row must contain column headers.');

  // Map each declared field to whichever header spelling the sheet used —
  // identical to readSheet()'s own matching, so a well-formed sheet ends up
  // with exactly the same field keys either way.
  const index = {};
  for (const [field, names] of Object.entries(aliases)) {
    for (const n of names) {
      const col = headers.findIndex((h) => h === norm(n));
      if (col > 0) {
        index[field] = col;
        break;
      }
    }
  }

  // Every remaining non-blank header column — recognized or not — gets its
  // own field key and a place in the draft, rather than being silently
  // dropped. Unrecognized headers get a synthetic key derived from their own
  // text (deduplicated against collisions), so their data is never lost.
  const usedKeys = new Set(Object.keys(index));
  const columns = [];
  const colToField = {};
  headers.forEach((h, col) => {
    if (!h) return;
    const mappedField = Object.entries(index).find(([, c]) => c === col)?.[0];
    if (mappedField) {
      colToField[col] = mappedField;
      columns.push({ field: mappedField, label: aliases[mappedField]?.[0] || mappedField });
      return;
    }
    let key = norm(rawHeaders[col]).replace(/\s+/g, '_') || `column_${col}`;
    let unique = key;
    let n = 2;
    while (usedKeys.has(unique)) unique = `${key}_${n++}`;
    usedKeys.add(unique);
    colToField[col] = unique;
    columns.push({ field: unique, label: rawHeaders[col] });
  });

  const unmappedColumns = columns.filter((c) => !(c.field in index)).map((c) => c.label);

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const record = {};
    let blank = true;
    for (const [col, field] of Object.entries(colToField)) {
      const v = cellValue(row.getCell(Number(col)));
      record[field] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') blank = false;
    }
    if (blank) continue; // skip spacer rows
    record.__row = r; // Excel's own row number, for error messages
    rows.push(record);
  }
  // A sheet with headers but no data rows still opens as an editable draft —
  // the user can add rows by hand. There is simply nothing to prefill.
  return { rows, columns, unmappedColumns };
}

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') return String(v.richText?.map((t) => t.text).join('') ?? v.text ?? v.result ?? '');
  return String(v);
}

// Returns primitives only. A formula cell yields its cached result, never the formula.
function cellValue(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if (v.hyperlink) return v.text ?? v.hyperlink;
    return null;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Coercion helpers — used by validators so bad cells become clear messages
// ---------------------------------------------------------------------------
export const str = (v) => (v == null ? '' : String(v).trim());

// ALM-SEC-011 fix: the previous version stripped every character that wasn't
// a digit/dot/minus, which silently mangled two very different inputs into
// plausible-but-wrong numbers instead of rejecting them: "1.5e3" (scientific
// notation for 1500 — a format Excel auto-applies to large/small numbers)
// lost its "e" and became "1.53"; "abc123" (a stray label or paste error)
// had its letters stripped and became "123", as if someone had deliberately
// typed that price. Neither was flagged as invalid.
//
// A recognized number — including scientific notation — is now tried first,
// with no destructive stripping, so "1.5e3" parses to the mathematically
// correct 1500. Only if that fails is a narrow, explicit set of hand-typed
// currency formatting (a specific currency word/symbol, and thousands-
// separating commas) removed and the result re-checked — never an
// unrestricted "delete anything non-numeric" pass. If what's left still
// isn't a clean number (as with "abc123", where "abc" matches no known
// currency marker), this returns NaN — an explicit validation error at
// commit time — rather than a fabricated value.
const NUMERIC_PATTERN = /^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/;
const CURRENCY_TOKENS = /\b(rs|pkr|usd|inr)\b\.?|[$£€₹]/gi;

export function num(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;

  const raw = String(v).trim();
  if (NUMERIC_PATTERN.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  // Tolerate "1,234.50" and "Rs. 1,234" as typed by hand — but only a
  // recognized currency marker and thousands-separating commas are removed;
  // anything else left over (like the letters in "abc123") means this was
  // never actually a formatted number, and it stays rejected.
  const withoutFormatting = raw.replace(CURRENCY_TOKENS, '').replace(/,/g, '').trim();
  if (NUMERIC_PATTERN.test(withoutFormatting)) {
    const n = Number(withoutFormatting);
    return Number.isFinite(n) ? n : NaN;
  }

  return NaN;
}

export function date(v) {
  if (v == null || String(v).trim() === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? NaN : v;
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? NaN : d;
  }
  const d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? NaN : d;
}

export function bool(v, dflt = true) {
  const s = str(v).toLowerCase();
  if (!s) return dflt;
  if (['true', 'yes', 'y', '1', 'active'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'inactive'].includes(s)) return false;
  return dflt;
}

// ---------------------------------------------------------------------------
// Workbook writing
// ---------------------------------------------------------------------------
// Columns declare a type so amounts land as real numeric cells and dates as real date
// cells — never as pre-formatted strings. Nothing here emits a raw Mongo document:
// every export names its columns explicitly.
export async function buildWorkbook({ sheetName = 'Sheet1', columns, rows, title, notes = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALMTech Business Suite';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  let offset = 0;
  if (title) {
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 13 };
    offset += 1;
  }
  for (const n of notes) {
    offset += 1;
    ws.getCell(offset, 1).value = n;
    ws.getCell(offset, 1).font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  }
  if (offset) offset += 1; // blank spacer row

  const headerRowIdx = offset + 1;
  const header = ws.getRow(headerRowIdx);
  columns.forEach((c, i) => {
    header.getCell(i + 1).value = c.header;
  });
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } };
  header.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };

  rows.forEach((r, ri) => {
    const row = ws.getRow(headerRowIdx + 1 + ri);
    columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const raw = typeof c.value === 'function' ? c.value(r) : r[c.key];
      if (raw === null || raw === undefined) {
        cell.value = null;
        return;
      }
      if (c.type === 'number' || c.type === 'money') {
        const n = typeof raw === 'number' ? raw : Number(raw);
        cell.value = Number.isFinite(n) ? n : null;
        cell.numFmt = c.type === 'money' ? '#,##0.00' : '#,##0';
      } else if (c.type === 'date') {
        const d = raw instanceof Date ? raw : new Date(raw);
        cell.value = Number.isNaN(d.getTime()) ? null : d;
        cell.numFmt = 'dd mmm yyyy';
      } else if (c.type === 'datetime') {
        const d = raw instanceof Date ? raw : new Date(raw);
        cell.value = Number.isNaN(d.getTime()) ? null : d;
        cell.numFmt = 'dd mmm yyyy hh:mm';
      } else {
        cell.value = String(raw);
      }
    });
  });

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width || Math.min(40, Math.max(12, String(c.header).length + 4));
  });
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];

  return wb.xlsx.writeBuffer();
}

export async function buildMultiSheetWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALMTech Business Suite';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.sheetName.slice(0, 31));
    const header = ws.getRow(1);
    s.columns.forEach((c, i) => (header.getCell(i + 1).value = c.header));
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } };
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(2 + ri);
      s.columns.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        const raw = typeof c.value === 'function' ? c.value(r) : r[c.key];
        if (raw == null) return;
        if (c.type === 'number' || c.type === 'money') {
          const n = Number(raw);
          cell.value = Number.isFinite(n) ? n : null;
          cell.numFmt = c.type === 'money' ? '#,##0.00' : '#,##0';
        } else if (c.type === 'date') {
          const d = raw instanceof Date ? raw : new Date(raw);
          cell.value = Number.isNaN(d.getTime()) ? null : d;
          cell.numFmt = 'dd mmm yyyy';
        } else cell.value = String(raw);
      });
    });
    s.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width || 18));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return wb.xlsx.writeBuffer();
}
