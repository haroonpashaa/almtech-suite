import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { recentPayments } from '../controllers/payment.controller.js';

const r = Router();
r.use(protect);
r.get('/', recentPayments);
export default r;
