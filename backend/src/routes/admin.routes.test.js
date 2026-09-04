import { describe, it, expect } from 'vitest';
import adminRoutes from './admin.routes.js';

// ===========================================================================
// Route-level RBAC for the admin router (DB-free).
//
// Unlike finance/invoice routes.js, this router applies its guard once via
// `r.use(protect, requireRole('admin'))` rather than per-route, so there is no
// single `route.stack[0]` to grab. `protect` and `requireRole(...)` are told
// apart by arity rather than a hardcoded stack index — `protect` is wrapped by
// asyncHandler's rest-parameter signature (`.length === 0`), while
// `requireRole(...)` returns a plain `(req, res, next)` function (`.length ===
// 3`) — so a future reordering of the `.use()` call does not silently break
// this test the way an index would.
// ===========================================================================

function mockRes() {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
  return res;
}

function findRequireRoleMiddleware() {
  const candidates = adminRoutes.stack.filter((l) => !l.route && typeof l.handle === 'function' && l.handle.length === 3);
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

describe('admin router RBAC (real middleware, DB-free)', () => {
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

  it('GET /system-health is registered on this router', () => {
    const layer = adminRoutes.stack.find((l) => l.route && l.route.path === '/system-health' && l.route.methods.get);
    expect(layer).toBeTruthy();
  });
});
