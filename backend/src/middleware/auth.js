import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/User.js';

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401);
    throw new Error('Not authenticated');
  }
  const token = header.split(' ')[1];

  // A missing signing key is a server misconfiguration, not a bad credential — it must
  // not masquerade as "your session expired", or a broken deployment looks like every
  // user simply being logged out.
  if (!process.env.JWT_SECRET) {
    res.status(500);
    throw new Error('Authentication is not configured on this server (JWT_SECRET is not set)');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // Malformed, tampered, wrongly-signed or expired tokens are all authentication
    // failures. Previously these escaped as unhandled errors and surfaced as 500s.
    res.status(401);
    throw new Error('Session is invalid or has expired — please sign in again');
  }

  const user = await User.findById(decoded.id).select('-password');
  if (!user || !user.active) {
    res.status(401);
    throw new Error('User disabled or missing');
  }

  // ALM-SEC-003: a token issued before the user's most recent password
  // change is a stale credential — reject it exactly like an expired one,
  // rather than letting it keep working until its normal expiry. A version
  // counter (not a timestamp) is used because JWT `iat` only has
  // whole-second resolution — a token issued in the very same wall-clock
  // second as the password change would be indistinguishable from one
  // issued a moment earlier under a timestamp comparison (see models/User.js
  // for the full rationale). Tokens signed before this claim existed carry
  // no `tokenVersion`, so they're treated as version 0 — matching the
  // schema's default — rather than being rejected outright on deploy.
  const tokenVersion = decoded.tokenVersion ?? 0;
  if (tokenVersion !== (user.tokenVersion || 0)) {
    res.status(401);
    throw new Error('Session is invalid or has expired — please sign in again');
  }

  req.user = user;
  next();
});

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403);
    return next(new Error('Forbidden'));
  }
  next();
};
