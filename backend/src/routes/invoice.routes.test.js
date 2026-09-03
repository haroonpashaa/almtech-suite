import { describe, it, expect } from 'vitest';
import invoiceRoutes from './invoice.routes.js';

// ===========================================================================
// Route-level RBAC for the invoice router (DB-free) — same technique as
// finance.routes.test.js: extract the real requireRole(...) middleware Express
// attached to each route and invoke it directly, so a route that silently lost
// its guard fails these tests instead of a re-declared expectation passing anyway.
// ===========================================================================

function mockRes() {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
  return res;
}

function authMiddlewareFor(method, path) {
  const layer = invoiceRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`No ${method.toUpperCase()} route registered for ${path}`);
  return layer.route.stack[0].handle;
}

function check(method, path, role) {
  const mid = authMiddlewareFor(method, path);
  const res = mockRes();
  let nextArg;
  mid({ user: role ? { role } : undefined }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

describe('invoice router RBAC (real middleware, DB-free)', () => {
  it('POST /:id/payments allows admin and sales, blocks stock and unauthenticated', () => {
    expect(check('post', '/:id/payments', 'admin').blocked).toBe(false);
    expect(check('post', '/:id/payments', 'sales').blocked).toBe(false);
    expect(check('post', '/:id/payments', 'stock').blocked).toBe(true);
    expect(check('post', '/:id/payments', undefined).blocked).toBe(true);
  });

  it('POST /:id/payments/:paymentId/reverse stays admin-only — sales is blocked', () => {
    expect(check('post', '/:id/payments/:paymentId/reverse', 'admin').blocked).toBe(false);
    const sales = check('post', '/:id/payments/:paymentId/reverse', 'sales');
    expect(sales.blocked).toBe(true);
    expect(sales.statusCode).toBe(403);
    expect(check('post', '/:id/payments/:paymentId/reverse', 'stock').blocked).toBe(true);
  });

  it('PATCH /:id (notes correction) stays admin-only — sales and stock are blocked', () => {
    expect(check('patch', '/:id', 'admin').blocked).toBe(false);
    const sales = check('patch', '/:id', 'sales');
    expect(sales.blocked).toBe(true);
    expect(sales.statusCode).toBe(403);
    expect(check('patch', '/:id', 'stock').blocked).toBe(true);
    expect(check('patch', '/:id', undefined).blocked).toBe(true);
  });

  it('POST /:id/return stays admin-only — sales and stock are blocked', () => {
    expect(check('post', '/:id/return', 'admin').blocked).toBe(false);
    expect(check('post', '/:id/return', 'sales').blocked).toBe(true);
    expect(check('post', '/:id/return', 'stock').blocked).toBe(true);
  });
});
