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
} from '../controllers/product.controller.js';

const r = Router();
r.use(protect);
r.get('/', listProducts);
r.get('/:id', getProduct);
r.get('/:id/ledger', stockLedger);
r.post('/', requireRole('admin', 'stock'), createProduct);
r.patch('/:id', requireRole('admin', 'stock'), updateProduct);
r.delete('/:id', requireRole('admin'), deleteProduct);
r.post('/:id/adjust', requireRole('admin', 'stock'), adjustStock);
r.post('/import', requireRole('admin'), importProducts);
export default r;
