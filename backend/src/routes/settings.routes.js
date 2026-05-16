import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { getSettings, updateSettings } from '../controllers/settings.controller.js';

const r = Router();
r.use(protect);
r.get('/', getSettings);
r.patch('/', requireRole('admin'), updateSettings);
export default r;
