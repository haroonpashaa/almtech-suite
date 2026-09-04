import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { getSystemHealth } from '../controllers/systemHealth.controller.js';

// Admin-only operational endpoints. Same pattern as activity.routes.js: the
// whole router is gated once, not per-route.
const r = Router();
r.use(protect, requireRole('admin'));
r.get('/system-health', getSystemHealth);
export default r;
