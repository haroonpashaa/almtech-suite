import { Router } from 'express';
import multer from 'multer';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listTypes,
  parseImportFile,
  validateImport,
  commitImport,
  errorsWorkbook,
  downloadTemplate,
  runExport,
  importHistory,
  importBatchDetail,
} from '../controllers/importExport.controller.js';

// Uploads are held in memory, parsed, and discarded — nothing is written to disk and
// the workbook never reaches the database.
const MAX_BYTES = 10 * 1024 * 1024;
const XLSX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/octet-stream', // some browsers send this for .xlsx
  '',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      return cb(new Error('Only .xlsx files are accepted. Save your spreadsheet as .xlsx and try again.'));
    }
    if (file.mimetype && !XLSX_MIME.has(file.mimetype)) {
      return cb(new Error(`Unexpected file type "${file.mimetype}". Upload an .xlsx spreadsheet.`));
    }
    cb(null, true);
  },
});

// Multer rejections (size, extension, MIME) must surface as clean 400s rather than
// generic 500s, and must not leak internal detail.
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (e) => {
    if (!e) return next();
    res.status(400);
    if (e.code === 'LIMIT_FILE_SIZE') return next(new Error('File is too large — the maximum upload size is 10 MB.'));
    if (e.code === 'LIMIT_FILE_COUNT') return next(new Error('Upload one file at a time.'));
    return next(new Error(e.message || 'The uploaded file was rejected.'));
  });
}

// Administrators reach every dataset here. Sales reaches exactly one: products, so a
// salesperson can load the catalogue from a spreadsheet. Everything else on this
// screen — invoices, purchase orders, expenses, opening balances — moves money or
// creates financial history and stays with the administrator.
//
// Enforced at the API, not by hiding a button: a sales user who calls
// /data/import/invoices/commit directly is refused.
const SALES_TYPES = new Set(['products']);

function allowType(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (req.user?.role === 'sales' && SALES_TYPES.has(req.params.type)) return next();
  res.status(403);
  return next(new Error('You do not have access to this dataset'));
}

const r = Router();
r.use(protect);

// Listing is open to sales; listTypes itself returns only what the caller may use.
r.get('/types', requireRole('admin', 'sales'), listTypes);
r.get('/templates/:type', requireRole('admin', 'sales'), allowType, downloadTemplate);
r.get('/export/:type', requireRole('admin', 'sales'), allowType, runExport);
// Parse is the first step of the edit-before-import flow: it only reads the
// uploaded file into rows for the editable preview grid, nothing else — same
// role/dataset gate as validate/commit below.
r.post('/import/:type/parse', requireRole('admin', 'sales'), allowType, uploadSingle, parseImportFile);
// validate/commit accept either a re-uploaded file (uploadSingle passes JSON
// requests through untouched — see resolveRows in the controller) or the
// edited rows from that preview grid as JSON.
r.post('/import/:type/validate', requireRole('admin', 'sales'), allowType, uploadSingle, validateImport);
r.post('/import/:type/commit', requireRole('admin', 'sales'), allowType, uploadSingle, commitImport);
r.post('/import/:type/errors-file', requireRole('admin', 'sales'), allowType, errorsWorkbook);

// Import history spans every dataset, so it stays with the administrator.
r.get('/history', requireRole('admin'), importHistory);
r.get('/history/:id', requireRole('admin'), importBatchDetail);

export default r;
