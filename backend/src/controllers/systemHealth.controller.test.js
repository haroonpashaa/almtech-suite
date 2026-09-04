import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getSystemHealth } from './systemHealth.controller.js';

describe('getSystemHealth (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  }

  it('returns the full expected top-level structure with a 200', async () => {
    const res = mockRes();
    await getSystemHealth({}, res);

    expect(res.statusCode).toBe(200);
    expect(['healthy', 'warning', 'critical']).toContain(res.body.status);
    expect(res.body.checkedAt).toBeTruthy();
    for (const key of ['application', 'disk', 'memory', 'cpu', 'database', 'recordCounts', 'pm2', 'backups', 'warnings']) {
      expect(res.body).toHaveProperty(key);
    }
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it('database connectivity is reported as connected against the test database', async () => {
    const res = mockRes();
    await getSystemHealth({}, res);
    expect(res.body.database.connected).toBe(true);
  });

  it('record counts are numeric', async () => {
    const res = mockRes();
    await getSystemHealth({}, res);
    for (const v of Object.values(res.body.recordCounts)) {
      expect(v === null || typeof v === 'number').toBe(true);
    }
  });

  it('never includes sensitive configuration in the response', async () => {
    const res = mockRes();
    await getSystemHealth({}, res);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/JWT_SECRET/i);
    expect(json).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(json).not.toMatch(/password/i);
    expect(json).not.toMatch(/\bapi[_-]?key\b/i);
    expect(json).not.toMatch(/\.env\b/);
    expect(json).not.toMatch(/\/Users\/|\/home\/|\/var\/www/);
  });

  it('still returns a full response even if the database becomes unreachable mid-request', async () => {
    await mongoose.disconnect();
    const res = mockRes();
    await getSystemHealth({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.database.connected).toBe(false);
    expect(res.body.status).toBe('critical');
    // Every other section still has to be present — one failing subsystem must
    // not take down the whole response.
    expect(res.body.disk).toBeTruthy();
    expect(res.body.memory).toBeTruthy();
    await mongoose.connect(mem.getUri());
  });
});
