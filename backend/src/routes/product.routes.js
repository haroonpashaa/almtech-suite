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
// Sales adjusts stock too: recording that goods arrived is counter work, not an
// administrative act. Every adjustment writes a StockMovement naming the user, so it
// stays auditable. Creating and editing products, and bulk import, are unchanged.
r.post('/:id/adjust', requireRole('admin', 'stock', 'sales'), adjustStock);
r.post('/import', requireRole('admin'), importProducts);
export default r;
