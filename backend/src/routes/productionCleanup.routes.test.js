import { describe, it, expect } from 'vitest';
import productionCleanupRoutes from './productionCleanup.routes.js';

// Same real-middleware-extraction technique as admin.routes.test.js — this
// router applies its guard via `r.use(protect, requireRole('admin'))` before
// the route, so the two layers are told apart by arity (protect is
// asyncHandler-wrapped, .length === 0; requireRole(...) is a plain
// (req,res,next) function, .length === 3), not a hardcoded stack index.

function mockRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; } };
}

function findRequireRoleMiddleware() {
  const candidates = productionCleanupRoutes.stack.filter((l) => !l.route && typeof l.handle === 'function' && l.handle.length === 3);
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one router-level requireRole(...) middleware, found ${candidates.length}`);
  }
  return candidates[0].handle;
}

function check(role) {
  const mid = findRequireRoleMiddleware();
  const res = mockRes();
  let nextArg;
  mid({ user: role ? { role } : undefined }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

describe('production-cleanup router RBAC (real middleware, DB-free)', () => {
  it('admin passes the role guard', () => {
    expect(check('admin').blocked).toBe(false);
  });

  it('sales is blocked with 403', () => {
    const result = check('sales');
    expect(result.blocked).toBe(true);
    expect(result.statusCode).toBe(403);
  });

  it('stock is blocked with 403', () => {
    const result = check('stock');
    expect(result.blocked).toBe(true);
    expect(result.statusCode).toBe(403);
  });

  it('an unauthenticated request is blocked with 403', () => {
    const result = check(undefined);
    expect(result.blocked).toBe(true);
    expect(result.statusCode).toBe(403);
  });

  it('POST / is registered on this router', () => {
    const layer = productionCleanupRoutes.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.post);
    expect(layer).toBeTruthy();
  });
});
