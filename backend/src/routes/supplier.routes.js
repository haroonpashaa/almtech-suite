import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { listSuppliers } from '../controllers/supplier.controller.js';

// Read-only lookup kept for the Purchase Order module (supplier dropdown).
// Create/update/detail/ledger routes were removed with the standalone Supplier UI.
const r = Router();
r.use(protect);
r.get('/', listSuppliers);
export default r;
