import { describe, expect, it } from 'vitest';
import purchaseOrderRoutes from './purchaseOrder.routes.js';

const getRoute = (path) => purchaseOrderRoutes.stack.find((layer) => layer.route?.path === path && layer.route.methods.get)?.route;

describe('purchase order router permissions', () => {
  it.each(['/', '/:id', '/:id/pdf'])('allows only admin and stock to access GET %s', (path) => {
    const route = getRoute(path);
    expect(route).toBeTruthy();
    const roleCheck = route.stack[0].handle;
    for (const role of ['admin', 'stock']) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      let nextCalled = false;
      roleCheck({ user: { role } }, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    }
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
    let nextError;
    roleCheck({ user: { role: 'sales' } }, res, (error) => { nextError = error; });
    expect(res.statusCode).toBe(403);
    expect(nextError).toBeInstanceOf(Error);
  });

  it('keeps every purchase order endpoint behind authentication', async () => {
    const protect = purchaseOrderRoutes.stack[0].handle;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
    let nextError;
    await protect({ headers: {} }, res, (error) => { nextError = error; });
    expect(res.statusCode).toBe(401);
    expect(nextError).toBeInstanceOf(Error);
  });

  it('registers the summary route behind the purchasing finance role check', () => {
    const route = getRoute('/summary');
    expect(route).toBeTruthy();
    const roleCheck = route.stack[0].handle;
    for (const role of ['admin', 'stock']) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      let nextCalled = false;
      roleCheck({ user: { role } }, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
    let nextError;
    roleCheck({ user: { role: 'sales' } }, res, (error) => { nextError = error; });
    expect(res.statusCode).toBe(403);
    expect(nextError).toBeInstanceOf(Error);
  });
});
