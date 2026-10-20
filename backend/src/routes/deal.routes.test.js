import { describe, expect, it } from 'vitest';
import routes from './deal.routes.js';

function routeIndex(path, method) {
  const index = routes.stack.findIndex((layer) => layer.route?.path === path && layer.route.methods[method]);
  if (index < 0) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  return index;
}

describe('deal-account route permissions', () => {
  it('keeps the deal selector before the Admin-only financial routes', () => {
    const selectorIndex = routeIndex('/records/options', 'get');
    const adminGuardIndex = routes.stack.findIndex((layer, index) => index > selectorIndex && !layer.route);
    expect(adminGuardIndex).toBeGreaterThan(selectorIndex);

    for (const [path, method] of [
      ['/records', 'get'], ['/records', 'post'], ['/records/:id', 'get'],
      ['/records/:id/link', 'post'], ['/records/:id/links/:type/:recordId', 'delete'],
      ['/sales', 'get'], ['/sales/:id', 'get'], ['/purchases', 'get'], ['/purchases/:id', 'get'],
    ]) {
      expect(routeIndex(path, method)).toBeGreaterThan(adminGuardIndex);
    }
  });

  it('allows Admin and rejects Sales and Stock at the deal-account guard', () => {
    const selectorIndex = routeIndex('/records/options', 'get');
    const guard = routes.stack.find((layer, index) => index > selectorIndex && !layer.route)?.handle;
    expect(typeof guard).toBe('function');

    const run = (role) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; } };
      let error;
      guard({ user: { role } }, res, (nextError) => { error = nextError; });
      return { statusCode: res.statusCode, error };
    };

    expect(run('admin').error).toBeUndefined();
    expect(run('sales')).toMatchObject({ statusCode: 403 });
    expect(run('stock')).toMatchObject({ statusCode: 403 });
  });
});
