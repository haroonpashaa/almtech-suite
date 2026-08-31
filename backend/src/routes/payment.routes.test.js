import { describe, it, expect } from 'vitest';
import paymentRoutes from './payment.routes.js';

// ===========================================================================
// GET /payments (recentPayments) returns every posted financial transaction —
// customer and supplier side alike — company-wide financial history that was
// already admin-only in every frontend caller (Dashboard, Ledger Reports'
// Payment History tab) but had no server-side role check at all. This tests
// the real, wired-up middleware directly, the same way finance.routes.test.js
// verifies the Receivables/Payables split.
// ===========================================================================

function mockRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; } };
}

function authMiddlewareFor(path) {
  const layer = paymentRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`No GET route registered for ${path}`);
  return layer.route.stack[0].handle;
}

function check(role) {
  const mid = authMiddlewareFor('/');
  const res = mockRes();
  let nextArg;
  mid({ user: role ? { role } : undefined }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

describe('payment router RBAC (real middleware, DB-free)', () => {
  it('allows admin', () => {
    expect(check('admin').blocked).toBe(false);
  });

  it('blocks sales', () => {
    const result = check('sales');
    expect(result.blocked).toBe(true);
    expect(result.statusCode).toBe(403);
  });

  it('blocks stock', () => {
    expect(check('stock').blocked).toBe(true);
  });

  it('blocks an unauthenticated request', () => {
    expect(check(undefined).blocked).toBe(true);
  });
});
