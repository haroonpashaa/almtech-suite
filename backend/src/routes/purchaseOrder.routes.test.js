import { describe, expect, it } from 'vitest';
import purchaseOrderRoutes from './purchaseOrder.routes.js';

const route = purchaseOrderRoutes.stack.find((layer) => layer.route?.path === '/summary' && layer.route.methods.get)?.route;

describe('purchase summary router permissions', () => {
  it('registers the summary route behind the purchasing finance role check', () => {
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
