import { describe, it, expect } from 'vitest';
import importExportRoutes from './importExport.routes.js';

// ===========================================================================
// Route-level RBAC for the new /parse step (DB-free), same technique as the
// other *.routes.test.js files: extract the real middleware Express attached
// to the route and invoke it directly.
//
// Unlike a single requireRole(...) layer, this route stacks TWO gates —
// requireRole('admin', 'sales') then allowType (dataset-specific) — both
// declared per-route (`r.post(path, requireRole(...), allowType, uploadSingle,
// handler)`), so route.stack[0] and route.stack[1] are exactly those two, in
// that order; uploadSingle and the handler come after and are not exercised
// here (that's what the DB-backed controller test covers).
// ===========================================================================

function mockRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; } };
}

function middlewareFor(path, index) {
  const layer = importExportRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
  if (!layer) throw new Error(`No POST route registered for ${path}`);
  return layer.route.stack[index].handle;
}

function checkRole(path, role) {
  const mid = middlewareFor(path, 0);
  const res = mockRes();
  let nextArg;
  mid({ user: role ? { role } : undefined }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

function checkType(path, role, type) {
  const mid = middlewareFor(path, 1);
  const res = mockRes();
  let nextArg;
  mid({ user: { role }, params: { type } }, res, (err) => { nextArg = err; });
  return { blocked: !!nextArg, statusCode: res.statusCode };
}

describe('POST /import/:type/parse — role gate (real middleware, DB-free)', () => {
  it('admin and sales pass the role gate; stock and unauthenticated are blocked', () => {
    expect(checkRole('/import/:type/parse', 'admin').blocked).toBe(false);
    expect(checkRole('/import/:type/parse', 'sales').blocked).toBe(false);
    const stock = checkRole('/import/:type/parse', 'stock');
    expect(stock.blocked).toBe(true);
    expect(stock.statusCode).toBe(403);
    const none = checkRole('/import/:type/parse', undefined);
    expect(none.blocked).toBe(true);
    expect(none.statusCode).toBe(403);
  });

  it('sales may parse products (their one authorized dataset) but not customers', () => {
    expect(checkType('/import/:type/parse', 'sales', 'products').blocked).toBe(false);
    const blocked = checkType('/import/:type/parse', 'sales', 'customers');
    expect(blocked.blocked).toBe(true);
    expect(blocked.statusCode).toBe(403);
  });

  it('admin may parse any dataset', () => {
    expect(checkType('/import/:type/parse', 'admin', 'products').blocked).toBe(false);
    expect(checkType('/import/:type/parse', 'admin', 'customers').blocked).toBe(false);
    expect(checkType('/import/:type/parse', 'admin', 'purchase-orders').blocked).toBe(false);
  });
});

describe('POST /import/:type/validate and /commit keep the same gates as before', () => {
  for (const path of ['/import/:type/validate', '/import/:type/commit']) {
    it(`${path}: admin/sales pass, stock is blocked`, () => {
      expect(checkRole(path, 'admin').blocked).toBe(false);
      expect(checkRole(path, 'sales').blocked).toBe(false);
      expect(checkRole(path, 'stock').blocked).toBe(true);
    });

    it(`${path}: sales is confined to products`, () => {
      expect(checkType(path, 'sales', 'products').blocked).toBe(false);
      expect(checkType(path, 'sales', 'suppliers').blocked).toBe(true);
    });
  }
});
