import asyncHandler from 'express-async-handler';
import {
  getApplicationInfo, getDiskInfo, getMemoryInfo, getCpuInfo,
  getDatabaseInfo, getRecordCounts, getPm2Info, getBackupInfo,
  evaluateWarnings, overallStatus,
} from '../services/systemHealth.service.js';

// Wraps one section so a failure in it degrades to an "unavailable" shape
// instead of failing the whole request — only a failure in this handler itself
// (not one subsystem) should ever produce a non-200 response.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    return { available: false, error: `${label} check failed: ${String(e?.message || e).slice(0, 160)}` };
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/system-health — Admin-only, read-only operational snapshot.
// Nothing here writes to the database or the filesystem, executes a shell
// command, or echoes environment variables/secrets. See systemHealth.service.js
// for how each section is gathered.
// ---------------------------------------------------------------------------
export const getSystemHealth = asyncHandler(async (_req, res) => {
  const [application, disk, memory, cpu, database, recordCounts, pm2, backups] = await Promise.all([
    safe('application', () => getApplicationInfo()),
    safe('disk', () => getDiskInfo()),
    safe('memory', () => getMemoryInfo()),
    safe('cpu', () => getCpuInfo()),
    safe('database', () => getDatabaseInfo()),
    safe('recordCounts', () => getRecordCounts()),
    safe('pm2', () => getPm2Info()),
    safe('backups', () => getBackupInfo()),
  ]);

  const warnings = evaluateWarnings({ disk, memory, database });
  // A section that failed outright is itself an infrastructure warning, distinct
  // from the threshold-based ones above.
  for (const [label, section] of [['application', application], ['disk', disk], ['memory', memory], ['cpu', cpu], ['database', database]]) {
    if (section?.error) warnings.push({ type: label, severity: 'warning', message: section.error });
  }

  res.json({
    status: overallStatus(warnings),
    checkedAt: new Date().toISOString(),
    application,
    disk,
    memory,
    cpu,
    database,
    recordCounts,
    pm2,
    backups,
    warnings,
  });
});
