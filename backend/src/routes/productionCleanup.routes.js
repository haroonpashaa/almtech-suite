// TEMPORARY — see controllers/productionCleanup.controller.js for the full
// removal note. Delete this file and its app.js mount line together with
// that controller once the cleanup is complete and confirmed.
import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { runProductionCleanup } from '../controllers/productionCleanup.controller.js';

const r = Router();
// Authentication and Admin role are enforced here, before any of the
// controller's own gates (NODE_ENV, ALLOW_PRODUCTION_CLEANUP, token) run —
// an unauthenticated or non-admin request never reaches that code at all.
r.use(protect, requireRole('admin'));
r.post('/', runProductionCleanup);
export default r;
