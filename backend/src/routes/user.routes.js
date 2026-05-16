import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, deactivateUser } from '../controllers/user.controller.js';

const r = Router();
r.use(protect, requireRole('admin'));
r.get('/', listUsers);
r.post('/', createUser);
r.patch('/:id', updateUser);
r.delete('/:id', deactivateUser);
export default r;
