import { describe, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import routes from './deal.routes.js';
import Deal from '../models/Deal.js';
import User from '../models/User.js';
import { errorHandler } from '../middleware/error.js';

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
      ['/records', 'get'], ['/records', 'post'], ['/records/:id', 'get'], ['/records/:id', 'delete'],
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

  it('enforces Admin-only deletion through direct authenticated API requests', async () => {
    const memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'isolated-route-test-secret';
    await mongoose.connect(memory.getUri());
    const app = express();
    app.use('/api/deals', routes);
    app.use(errorHandler);
    const server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const [admin, sales, stock] = await User.create([
        { name: 'Test Admin', email: 'admin@example.test', password: 'test-password-123', role: 'admin' },
        { name: 'Test Sales', email: 'sales@example.test', password: 'test-password-123', role: 'sales' },
        { name: 'Test Stock', email: 'stock@example.test', password: 'test-password-123', role: 'stock' },
      ]);
      const deal = await Deal.create({ identifier: 'API-DELETE' });
      const tokenFor = (user) => jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
      const remove = (user) => fetch(`${baseUrl}/api/deals/records/${deal._id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${tokenFor(user)}` },
      });

      expect((await remove(sales)).status).toBe(403);
      expect((await remove(stock)).status).toBe(403);
      expect(await Deal.findById(deal._id)).not.toBeNull();
      expect((await remove(admin)).status).toBe(200);
      expect(await Deal.findById(deal._id)).toBeNull();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await memory.stop();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  }, 20000);
});
