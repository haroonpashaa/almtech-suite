import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Expense from '../models/Expense.js';
import FinancialTransaction from '../models/FinancialTransaction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// backend/src/services -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Centralized warning thresholds — the one place to adjust them.
// ---------------------------------------------------------------------------
export const THRESHOLDS = {
  diskWarningPercent: 80,
  diskCriticalPercent: 90,
  ramWarningPercent: 85,
  ramCriticalPercent: 95,
};

const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Application / backend
// ---------------------------------------------------------------------------

// Reads the deployed version straight from backend/package.json rather than a
// hardcoded string, so it can never drift from what's actually running.
function readAppVersion() {
  try {
    const raw = fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8');
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

// Reads the current commit straight from .git, with no shell-out — just the same
// two files `git rev-parse HEAD` itself ultimately reads. Returns null (never
// throws) if this isn't a git checkout, HEAD is unreadable, or the ref is packed
// in a form this doesn't handle — a missing commit hash is not worth failing the
// whole health check over.
function readGitCommit() {
  try {
    const gitDir = path.join(REPO_ROOT, '.git');
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (!head.startsWith('ref:')) {
      // Detached HEAD — the file content IS the commit hash.
      return /^[0-9a-f]{40}$/i.test(head) ? head.slice(0, 12) : null;
    }
    const ref = head.slice(4).trim();
    const refPath = path.join(gitDir, ref);
    if (fs.existsSync(refPath)) {
      const hash = fs.readFileSync(refPath, 'utf8').trim();
      return /^[0-9a-f]{40}$/i.test(hash) ? hash.slice(0, 12) : null;
    }
    // Ref not loose — check packed-refs (common after `git gc`).
    const packedPath = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packedPath)) {
      const line = fs.readFileSync(packedPath, 'utf8').split('\n').find((l) => l.endsWith(' ' + ref));
      if (line) return line.split(' ')[0].slice(0, 12);
    }
    return null;
  } catch {
    return null;
  }
}

export function getApplicationInfo() {
  const uptimeSeconds = process.uptime();
  return {
    status: 'up',
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    pid: process.pid,
    processUptimeSeconds: Math.floor(uptimeSeconds),
    osUptimeSeconds: Math.floor(os.uptime()),
    startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
    version: readAppVersion(),
    commit: readGitCommit(),
  };
}

// ---------------------------------------------------------------------------
// Disk — fs.statfsSync is a builtin, constant-time filesystem metadata call
// (Node 18.15+/20+), never a directory scan. Scoped to the project's own volume,
// not an arbitrary path, and the path itself is never included in the response.
// ---------------------------------------------------------------------------
export function getDiskInfo() {
  try {
    const stats = fs.statfsSync(REPO_ROOT);
    const totalBytes = stats.blocks * stats.bsize;
    // bavail (available to an unprivileged user), not bfree, so the percentage
    // matches what `df` reports for this process's own user.
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      available: true,
      totalBytes,
      usedBytes,
      freeBytes,
      usagePercent: totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : null,
    };
  } catch (e) {
    return { available: false, reason: 'disk statistics are not available on this platform/runtime', error: String(e?.message || e).slice(0, 160) };
  }
}

// ---------------------------------------------------------------------------
// RAM
// ---------------------------------------------------------------------------
export function getMemoryInfo() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const proc = process.memoryUsage();
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usagePercent: totalBytes > 0 ? round1((usedBytes / totalBytes) * 100) : null,
    process: { rss: proc.rss, heapTotal: proc.heapTotal, heapUsed: proc.heapUsed, external: proc.external },
  };
}

// ---------------------------------------------------------------------------
// CPU — os.loadavg() and os.cpus() are cheap, already-maintained kernel counters,
// not sampled here. No busy-loop or repeated measurement is performed.
// loadavg is Unix-only; it returns [0, 0, 0] on Windows, which is reported as-is
// rather than guessed at.
// ---------------------------------------------------------------------------
export function getCpuInfo() {
  const cpus = os.cpus() || [];
  const [load1, load5, load15] = os.loadavg();
  const cpu = process.cpuUsage(); // cumulative microseconds since process start — no sampling delay
  return {
    count: cpus.length,
    model: cpus[0]?.model || null,
    loadAverage: { '1m': load1, '5m': load5, '15m': load15 },
    // Cumulative, not instantaneous — measuring a real percentage would require
    // sampling over an interval, which this deliberately avoids.
    processCpuTimeMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
  };
}

// ---------------------------------------------------------------------------
// Database — a ping (documented by MongoDB as requiring no special access) for
// connectivity/latency, and the standard dbStats command for size. Never reads
// or exposes the connection string, host, or credentials.
// ---------------------------------------------------------------------------
export async function getDatabaseInfo() {
  const conn = mongoose.connection;
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const readyState = conn?.readyState ?? 0;
  const connected = readyState === 1;
  const result = { connected, state: states[readyState] ?? 'unknown', name: connected ? conn.name : null };
  if (!connected) return result;

  try {
    const start = process.hrtime.bigint();
    await conn.db.admin().ping();
    result.latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
  } catch {
    result.latencyMs = null;
  }

  try {
    const stats = await conn.db.stats();
    result.sizeBytes = typeof stats.dataSize === 'number' ? stats.dataSize : null;
    result.storageSizeBytes = typeof stats.storageSize === 'number' ? stats.storageSize : null;
    result.collections = typeof stats.collections === 'number' ? stats.collections : null;
  } catch {
    // Some managed tiers restrict dbStats — degrade rather than invent a value.
    result.sizeBytes = null;
    result.sizeUnavailableReason = 'the dbStats command was not available on this database deployment';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Business record counts — estimatedDocumentCount() reads collection metadata,
// never scans or loads documents. Receivables/Payables have no dedicated
// collection of their own (finance.controller.js aggregates them from Invoice/
// PurchaseOrder), so they are intentionally not listed here — that would be a
// duplicate of the invoices/purchaseOrders counts already returned.
// ---------------------------------------------------------------------------
const COUNTED_MODELS = [
  ['products', Product],
  ['customers', Customer],
  ['suppliers', Supplier],
  ['invoices', Invoice],
  ['purchaseOrders', PurchaseOrder],
  ['expenses', Expense],
  ['financialTransactions', FinancialTransaction],
];

export async function getRecordCounts() {
  const counts = {};
  // Mongoose buffers commands by default while disconnected rather than
  // rejecting immediately, which would hang this request until the buffer
  // timeout instead of degrading gracefully — so this is checked up front
  // rather than relying on a query to fail fast.
  if (mongoose.connection?.readyState !== 1) {
    for (const [key] of COUNTED_MODELS) counts[key] = null;
    return counts;
  }
  for (const [key, Model] of COUNTED_MODELS) {
    try {
      counts[key] = await Model.estimatedDocumentCount();
    } catch {
      counts[key] = null;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// PM2 — detected only via the pm_id environment variable PM2 itself sets on a
// process it manages (not user input, not a shell call). Restart count/status/
// memory live in the PM2 daemon, which this process cannot reach without either
// shelling out or adding the `pm2` package as an IPC client — both out of scope
// here, so those fields are explicitly marked unavailable rather than guessed.
// ---------------------------------------------------------------------------
export function getPm2Info() {
  const pmId = process.env.pm_id;
  if (pmId === undefined) {
    return { managedByPm2: false, available: false, reason: 'this process is not running under PM2' };
  }
  return {
    managedByPm2: true,
    pmId,
    available: false,
    reason: 'running under PM2, but restart count/status/memory require the PM2 daemon API, which this process does not query',
  };
}

// ---------------------------------------------------------------------------
// Backups — there is no application-managed backup system. HOSTINGER_DEPLOY.md
// documents a manual/cron `mongodump` to a path on the VPS outside this
// project's own directory tree; that path is deployment-specific (depends on
// the server user and cron setup chosen at deploy time), so it is not something
// this code can safely or portably locate, and hardcoding one operator's path
// would be misleading for anyone else running this project. Per the spec, no
// backup system is built here — this simply reports the true current state.
// ---------------------------------------------------------------------------
export function getBackupInfo() {
  return {
    backupStatus: 'not_configured',
    note: 'No backup system is tracked by the application. A manual scheduled mongodump is documented in HOSTINGER_DEPLOY.md but runs outside this project and is not verifiable from here.',
  };
}

// ---------------------------------------------------------------------------
// Warnings + overall status
// ---------------------------------------------------------------------------
export function evaluateWarnings({ disk, memory, database }) {
  const warnings = [];

  if (disk?.available && disk.usagePercent != null) {
    if (disk.usagePercent >= THRESHOLDS.diskCriticalPercent) {
      warnings.push({ type: 'disk', severity: 'critical', message: `Disk usage is ${disk.usagePercent}%, at or above the ${THRESHOLDS.diskCriticalPercent}% critical threshold.` });
    } else if (disk.usagePercent >= THRESHOLDS.diskWarningPercent) {
      warnings.push({ type: 'disk', severity: 'warning', message: `Disk usage is ${disk.usagePercent}%, at or above the ${THRESHOLDS.diskWarningPercent}% warning threshold.` });
    }
  }

  if (memory && memory.usagePercent != null) {
    if (memory.usagePercent >= THRESHOLDS.ramCriticalPercent) {
      warnings.push({ type: 'memory', severity: 'critical', message: `RAM usage is ${memory.usagePercent}%, at or above the ${THRESHOLDS.ramCriticalPercent}% critical threshold.` });
    } else if (memory.usagePercent >= THRESHOLDS.ramWarningPercent) {
      warnings.push({ type: 'memory', severity: 'warning', message: `RAM usage is ${memory.usagePercent}%, at or above the ${THRESHOLDS.ramWarningPercent}% warning threshold.` });
    }
  }

  if (database && !database.connected) {
    warnings.push({ type: 'database', severity: 'critical', message: 'Database is not connected.' });
  }

  return warnings;
}

export function overallStatus(warnings) {
  if (warnings.some((w) => w.severity === 'critical')) return 'critical';
  if (warnings.some((w) => w.severity === 'warning')) return 'warning';
  return 'healthy';
}
