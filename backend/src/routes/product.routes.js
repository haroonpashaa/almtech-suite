import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  stockLedger,
  importProducts,
  lookupByBarcode,
} from '../controllers/product.controller.js';

const r = Router();
r.use(protect);
r.get('/', listProducts);
// Must be declared before '/:id', otherwise "barcode" is swallowed as an id.
r.get('/barcode', lookupByBarcode);
r.get('/:id', getProduct);
r.get('/:id/ledger', stockLedger);
r.post('/', requireRole('admin', 'stock'), createProduct);
// Editing product information (including the barcode) is admin-only.
r.patch('/:id', requireRole('admin'), updateProduct);
r.delete('/:id', requireRole('admin'), deleteProduct);
r.post('/:id/adjust', requireRole('admin', 'stock'), adjustStock);
r.post('/import', requireRole('admin'), importProducts);
export default r;
