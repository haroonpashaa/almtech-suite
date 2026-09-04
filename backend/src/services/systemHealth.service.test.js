import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import {
  THRESHOLDS,
  getApplicationInfo, getDiskInfo, getMemoryInfo, getCpuInfo,
  getDatabaseInfo, getRecordCounts, getPm2Info, getBackupInfo,
  evaluateWarnings, overallStatus,
} from './systemHealth.service.js';

describe('getApplicationInfo', () => {
  it('reports a status and never throws, even with git/version detection best-effort', () => {
    const info = getApplicationInfo();
    expect(info.status).toBe('up');
    expect(typeof info.processUptimeSeconds).toBe('number');
    expect(info.processUptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof info.nodeVersion).toBe('string');
    // version/commit are best-effort — either a string or explicitly null, never undefined/throw.
    expect(info.version === null || typeof info.version === 'string').toBe(true);
    expect(info.commit === null || typeof info.commit === 'string').toBe(true);
  });

  it('never includes raw environment variables or secrets', () => {
    const info = getApplicationInfo();
    const json = JSON.stringify(info);
    expect(json).not.toMatch(/JWT_SECRET/i);
    expect(json).not.toMatch(/mongodb(\+srv)?:\/\//i);
  });
});

describe('getDiskInfo', () => {
  it('returns usable numeric fields or a clearly-marked unavailable shape, never throws', () => {
    const disk = getDiskInfo();
    if (disk.available) {
      expect(disk.totalBytes).toBeGreaterThan(0);
      expect(disk.usedBytes).toBeGreaterThanOrEqual(0);
      expect(disk.freeBytes).toBeGreaterThanOrEqual(0);
      expect(disk.usagePercent).toBeGreaterThanOrEqual(0);
      expect(disk.usagePercent).toBeLessThanOrEqual(100);
    } else {
      expect(disk.reason).toBeTruthy();
    }
  });

  it('never includes an absolute filesystem path in its output', () => {
    const disk = getDiskInfo();
    expect(JSON.stringify(disk)).not.toMatch(/\/Users\/|\/home\/|\/var\/www/);
  });
});

describe('getMemoryInfo', () => {
  it('returns consistent totals and a process memory breakdown', () => {
    const mem = getMemoryInfo();
    expect(mem.totalBytes).toBeGreaterThan(0);
    expect(mem.usedBytes + mem.freeBytes).toBe(mem.totalBytes);
    expect(mem.usagePercent).toBeGreaterThanOrEqual(0);
    expect(mem.usagePercent).toBeLessThanOrEqual(100);
    expect(mem.process.rss).toBeGreaterThan(0);
  });
});

describe('getCpuInfo', () => {
  it('returns a CPU count and load average without sampling', () => {
    const cpu = getCpuInfo();
    expect(cpu.count).toBeGreaterThan(0);
    expect(cpu.loadAverage).toHaveProperty('1m');
    expect(cpu.loadAverage).toHaveProperty('5m');
    expect(cpu.loadAverage).toHaveProperty('15m');
    expect(cpu.processCpuTimeMs.user).toBeGreaterThanOrEqual(0);
  });
});

describe('getPm2Info', () => {
  it('reports not managed by PM2 when pm_id is unset, without throwing', () => {
    const original = process.env.pm_id;
    delete process.env.pm_id;
    const info = getPm2Info();
    expect(info.managedByPm2).toBe(false);
    expect(info.available).toBe(false);
    if (original !== undefined) process.env.pm_id = original;
  });

  it('reports managed-by-PM2 with restart/status explicitly unavailable rather than guessed', () => {
    const original = process.env.pm_id;
    process.env.pm_id = '3';
    const info = getPm2Info();
    expect(info.managedByPm2).toBe(true);
    expect(info.available).toBe(false);
    expect(info).not.toHaveProperty('restarts');
    if (original === undefined) delete process.env.pm_id;
    else process.env.pm_id = original;
  });
});

describe('getBackupInfo', () => {
  it('reports not_configured rather than inventing a backup system', () => {
    const info = getBackupInfo();
    expect(info.backupStatus).toBe('not_configured');
  });
});

describe('evaluateWarnings / overallStatus', () => {
  it('classifies healthy when nothing crosses a threshold and the database is connected', () => {
    const warnings = evaluateWarnings({
      disk: { available: true, usagePercent: 10 },
      memory: { usagePercent: 10 },
      database: { connected: true },
    });
    expect(warnings).toHaveLength(0);
    expect(overallStatus(warnings)).toBe('healthy');
  });

  it('classifies warning at the disk warning threshold', () => {
    const warnings = evaluateWarnings({
      disk: { available: true, usagePercent: THRESHOLDS.diskWarningPercent },
      memory: { usagePercent: 10 },
      database: { connected: true },
    });
    expect(warnings.some((w) => w.type === 'disk' && w.severity === 'warning')).toBe(true);
    expect(overallStatus(warnings)).toBe('warning');
  });

  it('classifies critical at the disk critical threshold', () => {
    const warnings = evaluateWarnings({
      disk: { available: true, usagePercent: THRESHOLDS.diskCriticalPercent },
      memory: { usagePercent: 10 },
      database: { connected: true },
    });
    expect(warnings.some((w) => w.type === 'disk' && w.severity === 'critical')).toBe(true);
    expect(overallStatus(warnings)).toBe('critical');
  });

  it('classifies warning and critical for RAM at its own thresholds', () => {
    const warn = evaluateWarnings({ disk: { available: true, usagePercent: 0 }, memory: { usagePercent: THRESHOLDS.ramWarningPercent }, database: { connected: true } });
    expect(warn.some((w) => w.type === 'memory' && w.severity === 'warning')).toBe(true);

    const crit = evaluateWarnings({ disk: { available: true, usagePercent: 0 }, memory: { usagePercent: THRESHOLDS.ramCriticalPercent }, database: { connected: true } });
    expect(crit.some((w) => w.type === 'memory' && w.severity === 'critical')).toBe(true);
  });

  it('a disconnected database is always critical, overriding any other status', () => {
    const warnings = evaluateWarnings({
      disk: { available: true, usagePercent: 0 },
      memory: { usagePercent: 0 },
      database: { connected: false },
    });
    expect(warnings.some((w) => w.type === 'database' && w.severity === 'critical')).toBe(true);
    expect(overallStatus(warnings)).toBe('critical');
  });

  it('critical outranks warning when both are present', () => {
    const warnings = [
      { type: 'disk', severity: 'warning', message: 'x' },
      { type: 'database', severity: 'critical', message: 'y' },
    ];
    expect(overallStatus(warnings)).toBe('critical');
  });
});

describe('getDatabaseInfo and getRecordCounts (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Product.deleteMany({});
    await Customer.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('reports connected: true with a database name but never a connection string/host', async () => {
    const info = await getDatabaseInfo();
    expect(info.connected).toBe(true);
    expect(info.state).toBe('connected');
    const json = JSON.stringify(info);
    expect(json).not.toMatch(/mongodb(\+srv)?:\/\//i);
    expect(json).not.toMatch(/password/i);
  });

  it('measures a non-negative ping latency', async () => {
    const info = await getDatabaseInfo();
    expect(info.latencyMs === null || info.latencyMs >= 0).toBe(true);
  });

  it('returns numeric counts for every counted business model, and 0 for an empty collection', async () => {
    const counts = await getRecordCounts();
    expect(counts.products).toBe(0);
    expect(counts.customers).toBe(0);
    for (const key of ['products', 'customers', 'suppliers', 'invoices', 'purchaseOrders', 'expenses', 'financialTransactions']) {
      expect(counts).toHaveProperty(key);
      expect(counts[key] === null || typeof counts[key] === 'number').toBe(true);
    }
  });

  it('record counts reflect real documents without loading them', async () => {
    await Product.create({ sku: 'HEALTH-1', name: 'Test' });
    await Product.create({ sku: 'HEALTH-2', name: 'Test 2' });
    await Customer.create({ name: 'Health Test Customer' });
    const counts = await getRecordCounts();
    expect(counts.products).toBe(2);
    expect(counts.customers).toBe(1);
  });

  it('reports disconnected when the connection is down', async () => {
    await mongoose.disconnect();
    const info = await getDatabaseInfo();
    expect(info.connected).toBe(false);
    expect(info.state).toBe('disconnected');
    expect(info).not.toHaveProperty('latencyMs');
    // Reconnect for any subsequent test in this file/run.
    await mongoose.connect(mem.getUri());
  });
});
