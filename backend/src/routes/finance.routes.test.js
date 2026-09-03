import { describe, it, expect } from 'vitest';
import financeRoutes from './finance.routes.js';

// ===========================================================================
// Route-level RBAC for the finance router (DB-free).
//
// finance.controller.js has no role logic of its own — every controller test
// elsewhere in this codebase calls controller functions directly, which is fine
// for business-rule tests but proves nothing about who is *allowed* to reach
// them, because that enforcement lives entirely in requireRole() on the route.
// This file tests that real, wired-up middleware directly (the actual
// `requireRole(...)` instance attached to each route by finance.routes.js),
// rather than re-declaring what the roles "should" be — a route that silently
// lost its requireRole call would fail these tests.
// ===========================================================================

function mockRes() {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
  return res;
}

// Finds the authorization middleware Express actually attached to `GET path` —
// index 0 because every route below is declared as `r.get(path, requireRole(...), controller)`,
// i.e. exactly one middleware before the controller.
function authMiddlewareFor(path) {
  const layer = financeRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods.get);
  if (!layer) throw new Error(`No GET route registered for ${path}`);
  return layer.route.stack[0].handle;
}

function check(path, role) {
  const mid = authMiddlewareFor(path);
  const res = mockRes();
  let nextArg;
  mid({ user: role ? { role } : undefined }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

function postAuthMiddlewareFor(path) {
  const layer = financeRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`No POST route registered for ${path}`);
  return layer.route.stack[0].handle;
}

function checkPost(path, role) {
  const mid = postAuthMiddlewareFor(path);
  const res = mockRes();
  let nextArg;
  mid({ user: role ? { role } : undefined }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

describe('finance router RBAC (real middleware, DB-free)', () => {
  it('GET /receivables allows admin and sales, blocks stock and unauthenticated', () => {
    expect(check('/receivables', 'admin').blocked).toBe(false);
    expect(check('/receivables', 'sales').blocked).toBe(false);
    const stock = check('/receivables', 'stock');
    expect(stock.blocked).toBe(true);
    expect(stock.statusCode).toBe(403);
    const none = check('/receivables', undefined);
    expect(none.blocked).toBe(true);
    expect(none.statusCode).toBe(403);
  });

  it('GET /receivables/:id allows admin and sales, blocks stock', () => {
    expect(check('/receivables/:id', 'admin').blocked).toBe(false);
    expect(check('/receivables/:id', 'sales').blocked).toBe(false);
    expect(check('/receivables/:id', 'stock').blocked).toBe(true);
  });

  it('GET /payables stays admin-only — sales and stock are blocked', () => {
    expect(check('/payables', 'admin').blocked).toBe(false);
    const sales = check('/payables', 'sales');
    expect(sales.blocked).toBe(true);
    expect(sales.statusCode).toBe(403);
    expect(check('/payables', 'stock').blocked).toBe(true);
  });

  it('GET /payables/:id stays admin-only — sales is blocked', () => {
    expect(check('/payables/:id', 'admin').blocked).toBe(false);
    expect(check('/payables/:id', 'sales').blocked).toBe(true);
  });

  it('GET /position (combined financial position) stays admin-only — sales is blocked', () => {
    expect(check('/position', 'admin').blocked).toBe(false);
    const sales = check('/position', 'sales');
    expect(sales.blocked).toBe(true);
    expect(sales.statusCode).toBe(403);
    expect(check('/position', 'stock').blocked).toBe(true);
  });

  it('POST /payables/:id/adjust stays admin-only — sales, stock and unauthenticated are blocked', () => {
    expect(checkPost('/payables/:id/adjust', 'admin').blocked).toBe(false);
    const sales = checkPost('/payables/:id/adjust', 'sales');
    expect(sales.blocked).toBe(true);
    expect(sales.statusCode).toBe(403);
    expect(checkPost('/payables/:id/adjust', 'stock').blocked).toBe(true);
    const none = checkPost('/payables/:id/adjust', undefined);
    expect(none.blocked).toBe(true);
    expect(none.statusCode).toBe(403);
  });
});
