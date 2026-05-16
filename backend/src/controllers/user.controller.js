import asyncHandler from 'express-async-handler';
import User, { ROLES } from '../models/User.js';
import { logActivity } from '../utils/activity.js';

export const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().select('-password').sort('-createdAt');
  res.json(users);
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!ROLES.includes(role)) {
    res.status(400);
    throw new Error('Invalid role');
  }
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) {
    res.status(409);
    throw new Error('Email already in use');
  }
  const user = await User.create({ name, email, password, role });
  await logActivity(req, 'user_created', { entity: 'User', entityId: user._id, meta: { email, role } });
  const { password: _p, ...safe } = user.toObject();
  res.status(201).json(safe);
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  const { name, role, active, password } = req.body;
  if (name !== undefined) user.name = name;
  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      res.status(400);
      throw new Error('Invalid role');
    }
    user.role = role;
  }
  if (active !== undefined) user.active = active;
  if (password) user.password = password;
  await user.save();
  await logActivity(req, 'user_updated', { entity: 'User', entityId: user._id });
  const { password: _p, ...safe } = user.toObject();
  res.json(safe);
});

export const deactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).select('-password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  await logActivity(req, 'user_deactivated', { entity: 'User', entityId: user._id });
  res.json(user);
});
