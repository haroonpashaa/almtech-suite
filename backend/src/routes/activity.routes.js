import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listActivity } from '../controllers/activity.controller.js';

const r = Router();
r.use(protect, requireRole('admin'));
r.get('/', listActivity);
export default r;
