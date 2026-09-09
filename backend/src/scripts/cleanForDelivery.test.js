import { describe, it, expect, vi } from 'vitest';

// ===========================================================================
// Requirement: importing this module must never execute the cleanup, never
// touch the database, and never call process.exit — a future caller that
// imports runCleanup() from something other than this CLI (e.g. a request
// handler) must never risk process.exit() killing an entire running server
// over one call. Only running the file directly as `node cleanForDelivery.mjs`
// should invoke anything.
// ===========================================================================
describe('cleanForDelivery.mjs is import-safe', () => {
  it('importing the module produces no console output and calls nothing on its own', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit was called'); });

    const mod = await import('./cleanForDelivery.mjs');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(typeof mod.runCleanup).toBe('function');
    expect(Array.isArray(mod.CLEAR_MODELS)).toBe(true);
    expect(Array.isArray(mod.ALL_MODELS)).toBe(true);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('runCleanup() never calls process.exit, even on a validation failure', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit was called'); });
    const { runCleanup } = await import('./cleanForDelivery.mjs');

    const originalEnv = { NODE_ENV: process.env.NODE_ENV, BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD };
    try {
      // execute=true with NODE_ENV not production is the exact failure path a
      // careless caller might hit — must return {ok:false}, not exit the process.
      process.env.NODE_ENV = 'test';
      const result = await runCleanup({ execute: true, log: () => {} });
      expect(result.ok).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
      if (originalEnv.BOOTSTRAP_ADMIN_EMAIL === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL; else process.env.BOOTSTRAP_ADMIN_EMAIL = originalEnv.BOOTSTRAP_ADMIN_EMAIL;
      if (originalEnv.BOOTSTRAP_ADMIN_PASSWORD === undefined) delete process.env.BOOTSTRAP_ADMIN_PASSWORD; else process.env.BOOTSTRAP_ADMIN_PASSWORD = originalEnv.BOOTSTRAP_ADMIN_PASSWORD;
      exitSpy.mockRestore();
    }
  });
});
