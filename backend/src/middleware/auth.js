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
