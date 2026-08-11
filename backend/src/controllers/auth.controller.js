import asyncHandler from 'express-async-handler';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { logActivity } from '../utils/activity.js';

const sign = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });

// Surfaces a missing signing key as an explicit configuration error rather than an
// opaque driver message from jsonwebtoken.
function assertJwtConfigured(res) {
  if (!process.env.JWT_SECRET) {
    res.status(500);
    throw new Error('Authentication is not configured on this server (JWT_SECRET is not set)');
  }
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || !user.active || !(await user.comparePassword(password))) {
    res.status(401);
    throw new Error('Invalid email or password');
  }
  assertJwtConfigured(res);
  res.json({
    token: sign(user._id),
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
});

export const me = asyncHandler(async (req, res) => {
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);
  if (!(await user.comparePassword(currentPassword))) {
    res.status(400);
    throw new Error('Current password is incorrect');
  }
  user.password = newPassword;
  await user.save();
  await logActivity(req, 'password_changed');
  res.json({ ok: true });
});
