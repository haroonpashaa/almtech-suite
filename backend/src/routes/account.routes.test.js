import { describe, expect, it } from 'vitest';
import routes from './account.routes.js';

function middlewareFor(path, method) {
  const layer = routes.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

describe('account ledger adjustment and transfer route permissions', () => {
  it('permits only admins to post manual account adjustments', () => {
    const middleware = middlewareFor('/:id/adjustments', 'post');
    const result = (role) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      let error;
      middleware({ user: role ? { role } : undefined }, res, (nextError) => { error = nextError; });
      return { blocked: !!error, statusCode: res.statusCode };
    };
    expect(result('admin').blocked).toBe(false);
    expect(result('sales')).toMatchObject({ blocked: true, statusCode: 403 });
    expect(result('stock')).toMatchObject({ blocked: true, statusCode: 403 });
  });

  it('permits only admins to transfer between accounts', () => {
    const middleware = middlewareFor('/transfers', 'post');
    const result = (role) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      let error;
      middleware({ user: role ? { role } : undefined }, res, (nextError) => { error = nextError; });
      return { blocked: !!error, statusCode: res.statusCode };
    };
    expect(result('admin').blocked).toBe(false);
    expect(result('sales')).toMatchObject({ blocked: true, statusCode: 403 });
    expect(result('stock')).toMatchObject({ blocked: true, statusCode: 403 });
    expect(result(undefined)).toMatchObject({ blocked: true, statusCode: 403 });
  });

  it('keeps account edits, including deactivation, Admin-only', () => {
    const middleware = middlewareFor('/:id', 'patch');
    const result = (role) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      let error;
      middleware({ user: role ? { role } : undefined }, res, (nextError) => { error = nextError; });
      return { blocked: !!error, statusCode: res.statusCode };
    };
    expect(result('admin').blocked).toBe(false);
    expect(result('sales')).toMatchObject({ blocked: true, statusCode: 403 });
    expect(result('stock')).toMatchObject({ blocked: true, statusCode: 403 });
  });
});
