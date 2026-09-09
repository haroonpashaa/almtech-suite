import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { runProductionCleanup } from './productionCleanup.controller.js';

function mockRes() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function req(body) {
  return { body };
}

// Snapshot/restore every env var this controller or runCleanup() reads, so no
// test here can leak into any other test file.
const ENV_KEYS = ['NODE_ENV', 'ALLOW_PRODUCTION_CLEANUP', 'PRODUCTION_CLEANUP_TOKEN', 'MONGO_URI', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD'];
let envSnapshot;
beforeEach(() => { envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
});

describe('productionCleanup gates (no database needed — every case here fails before connecting)', () => {
  it('rejects a missing/invalid mode', async () => {
    const res = mockRes();
    await expect(runProductionCleanup(req({}), res)).rejects.toThrow(/mode must be/);
  });

  it('rejects when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    const res = mockRes();
    await expect(runProductionCleanup(req({ mode: 'dry-run' }), res)).rejects.toThrow(/NODE_ENV=production/);
  });

  it('rejects when ALLOW_PRODUCTION_CLEANUP is not "true"', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PRODUCTION_CLEANUP;
    const res = mockRes();
    await expect(runProductionCleanup(req({ mode: 'dry-run' }), res)).rejects.toThrow(/not enabled/);
  });

  it('rejects when PRODUCTION_CLEANUP_TOKEN is not configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    delete process.env.PRODUCTION_CLEANUP_TOKEN;
    const res = mockRes();
    await expect(runProductionCleanup(req({ mode: 'dry-run', token: 'anything' }), res)).rejects.toThrow(/token is not configured/);
  });

  it('rejects a missing token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    process.env.PRODUCTION_CLEANUP_TOKEN = 'the-real-token';
    const res = mockRes();
    await expect(runProductionCleanup(req({ mode: 'dry-run' }), res)).rejects.toThrow(/Invalid or missing token/);
  });

  it('rejects a wrong token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    process.env.PRODUCTION_CLEANUP_TOKEN = 'the-real-token';
    const res = mockRes();
    await expect(runProductionCleanup(req({ mode: 'dry-run', token: 'wrong-token' }), res)).rejects.toThrow(/Invalid or missing token/);
  });

  it('never echoes the token back in a rejection', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    process.env.PRODUCTION_CLEANUP_TOKEN = 'super-secret-token-value';
    const res = mockRes();
    try {
      await runProductionCleanup(req({ mode: 'dry-run', token: 'wrong-guess' }), res);
    } catch (e) {
      expect(e.message).not.toContain('super-secret-token-value');
      expect(e.message).not.toContain('wrong-guess');
    }
  });

  it('rejects execute mode without the exact confirmation phrase, even with a correct token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    process.env.PRODUCTION_CLEANUP_TOKEN = 'the-real-token';
    const res = mockRes();
    await expect(runProductionCleanup(req({ mode: 'execute', token: 'the-real-token', confirmationPhrase: 'close but not exact' }), res))
      .rejects.toThrow(/Confirmation phrase/);
  });

  it('dry-run mode does not require a confirmation phrase at all', async () => {
    // Distinguishes dry-run from execute: this should get PAST the phrase gate
    // (it will still fail later trying to actually connect, which is fine —
    // this test only proves the phrase isn't required for dry-run).
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    process.env.PRODUCTION_CLEANUP_TOKEN = 'the-real-token';
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    process.env.MONGO_URI = 'mongodb://127.0.0.1:1/does-not-matter'; // never actually reached
    const res = mockRes();
    // Should NOT throw "Confirmation phrase" — it fails on the pre-flight
    // admin-email check instead, proving the phrase gate was never hit.
    await runProductionCleanup(req({ mode: 'dry-run', token: 'the-real-token' }), res);
    expect(res.body.reason).toMatch(/BOOTSTRAP_ADMIN_EMAIL/);
  });
});

describe('productionCleanup full success path (DB-backed, isolated temporary instance)', () => {
  let mem;
  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
  });
  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mem.stop();
  });

  it('a fully-configured dry-run request reaches runCleanup() and returns sanitized counts', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRODUCTION_CLEANUP = 'true';
    process.env.PRODUCTION_CLEANUP_TOKEN = 'the-real-token';
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'a-genuinely-long-test-password';
    process.env.MONGO_URI = mem.getUri();

    const res = mockRes();
    await runProductionCleanup(req({ mode: 'dry-run', token: 'the-real-token' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('dry-run');
    expect(res.body.before).toBeTruthy();
    expect(res.body.after).toBeUndefined(); // dry-run never reports an "after" — nothing was written
    // Sanitization: no secret values anywhere in the JSON response.
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/the-real-token/);
    expect(json).not.toMatch(/mongodb:\/\//i);
    expect(json).not.toMatch(/a-genuinely-long-test-password/);
  });
});
