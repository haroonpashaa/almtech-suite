import { Router } from 'express';
import { login, me, changePassword } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';

const r = Router();
r.post('/login', login);
r.get('/me', protect, me);
r.post('/change-password', protect, changePassword);
export default r;
