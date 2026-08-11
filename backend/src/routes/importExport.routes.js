import { Router } from 'express';
import multer from 'multer';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listTypes,
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

// The whole module is admin-only, enforced here at the API rather than by hiding a
// route in the frontend. Sales and stock receive 403 on every endpoint below.
const r = Router();
r.use(protect);
r.use(requireRole('admin'));

r.get('/types', listTypes);
r.get('/history', importHistory);
r.get('/history/:id', importBatchDetail);
r.get('/templates/:type', downloadTemplate);
r.get('/export/:type', runExport);

r.post('/import/:type/validate', uploadSingle, validateImport);
r.post('/import/:type/commit', uploadSingle, commitImport);
r.post('/import/:type/errors-file', errorsWorkbook);

export default r;
