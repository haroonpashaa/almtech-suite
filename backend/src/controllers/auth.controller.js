import asyncHandler from 'express-async-handler';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { logActivity } from '../utils/activity.js';

// ALM-SEC-003: every token carries the user's *current* tokenVersion at the
// moment it's issued — see models/User.js for why a version counter, not a
// timestamp, is what makes this unambiguous.
const sign = (id, tokenVersion) =>
  jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });

// Surfaces a missing signing key as an explicit configuration error rather than an
// opaque driver message from jsonwebtoken.
function assertJwtConfigured(res) {
  if (!process.env.JWT_SECRET) {
    res.status(500);
    throw new Error('Authentication is not configured on this server (JWT_SECRET is not set)');
  }
}

// ALM-SEC-001: a nonexistent-user login used to short-circuit before any
// bcrypt comparison ran at all (~1-4ms), while an existing user with a
// wrong password paid the full deliberately-slow bcrypt cost (~80-100ms) —
// a 20x+ timing gap an attacker can use to enumerate valid emails without
// ever seeing a different response body. Comparing against this fixed
// dummy hash whenever no matching user exists means every login attempt
// pays the same bcrypt cost regardless of whether the email exists, closing
// the gap without weakening the real comparison for a real user. The hash
// is meaningless (no real password will ever match it) and is never logged
// or exposed.
const DUMMY_HASH = bcrypt.hashSync('alm-suite-timing-safety-placeholder', 10);

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  // ALM-SEC-006: a non-string field (e.g. a NoSQL-operator-shaped object
  // like {"$gt":""}) used to crash `.toLowerCase()`/bcrypt with an
  // unhandled 500. Reject it as a controlled validation error instead —
  // this never reaches a database query either way, so it was never an
  // injection path, only a robustness gap.
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400);
    throw new Error('Email and password are required');
  }
  const user = await User.findOne({ email: email.toLowerCase() });
  // Always exactly one bcrypt comparison per request — a real one against
  // the found user's hash, or a dummy one when no user matches — so the
  // two cases cost the same regardless of which branch of `||` below ends
  // up failing.
  const passwordMatches = user ? await user.comparePassword(password) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !user.active || !passwordMatches) {
    // ALM-SEC-021: record the attempt for the (admin-only) audit trail —
    // the attempted email is useful forensic context, never the password.
    // Rate-limited upstream (ALM-SEC-002), so this can't itself become a
    // log-flooding vector under a brute-force burst.
    await logActivity(req, 'login_failed', { entity: 'User', entityId: user?._id, meta: { email: email.toLowerCase() } });
    res.status(401);
    throw new Error('Invalid email or password');
  }
  assertJwtConfigured(res);
  await logActivity(req, 'login_succeeded', {
    entity: 'User',
    entityId: user._id,
    actor: user,
    meta: { email: user.email },
  });
  res.json({
    token: sign(user._id, user.tokenVersion),
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
