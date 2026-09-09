// ---------------------------------------------------------------------------
// TEMPORARY — one-time production data cleanup trigger, for the ALM Suite
// delivery handover only. Delete this file, its route
// (routes/productionCleanup.routes.js), and the app.js mount line for it
// once the cleanup has been run and confirmed. See
// scripts/cleanForDelivery.mjs for the actual cleanup logic — this file only
// adds the extra authorization gates needed to trigger it safely over HTTP.
//
// Required before ANYTHING here does anything (dry-run or execute):
//   - a valid, authenticated Admin session (protect + requireRole('admin')
//     on the route — enforced before this file's code ever runs)
//   - NODE_ENV=production
//   - ALLOW_PRODUCTION_CLEANUP=true
//   - PRODUCTION_CLEANUP_TOKEN set, and the request's token matching it exactly
// Execute mode additionally requires the exact confirmation phrase.
//
// Never logs or returns: MONGO_URI, database credentials, PRODUCTION_CLEANUP_TOKEN,
// JWT_SECRET, or any other secret. Only sanitized collection names/counts are
// ever included in the response — see cleanForDelivery.mjs's own
// sanitizedTargetReport(), reused here unchanged.
// ---------------------------------------------------------------------------
import asyncHandler from 'express-async-handler';
import { runCleanup } from '../scripts/cleanForDelivery.mjs';

const CONFIRMATION_PHRASE = 'CLEAN ALMTECH PRODUCTION DATA';

export const runProductionCleanup = asyncHandler(async (req, res) => {
  const { mode, token, confirmationPhrase } = req.body || {};

  if (mode !== 'dry-run' && mode !== 'execute') {
    res.status(400);
    throw new Error('mode must be "dry-run" or "execute".');
  }

  // ---- Gate 1: production only. Mirrors the same check runCleanup() makes
  // internally for execute, but checked here first so a misconfigured
  // request never even reaches a database call.
  if (process.env.NODE_ENV !== 'production') {
    res.status(403);
    throw new Error('This endpoint only operates when NODE_ENV=production.');
  }

  // ---- Gate 2: must be explicitly enabled. Absent by default; only present
  // at all during the deliberate window this mechanism is deployed for.
  if (process.env.ALLOW_PRODUCTION_CLEANUP !== 'true') {
    res.status(403);
    throw new Error('Production cleanup is not enabled on this server.');
  }

  // ---- Gate 3: possession of a separate one-time secret, independent of the
  // admin's login credentials. Never echoes the submitted or expected value
  // back in any response, success or failure.
  const expectedToken = process.env.PRODUCTION_CLEANUP_TOKEN;
  if (!expectedToken) {
    res.status(403);
    throw new Error('Production cleanup token is not configured on this server.');
  }
  if (typeof token !== 'string' || token.length === 0 || token !== expectedToken) {
    res.status(403);
    throw new Error('Invalid or missing token.');
  }

  // ---- Gate 4 (execute only): the exact typed confirmation phrase.
  if (mode === 'execute' && confirmationPhrase !== CONFIRMATION_PHRASE) {
    res.status(400);
    throw new Error('Confirmation phrase does not match exactly.');
  }

  // Collected log lines are returned in the response instead of only going to
  // stdout, so the admin sees the same sanitized detail on the page that the
  // CLI would print to a terminal.
  const logLines = [];
  const result = await runCleanup({
    execute: mode === 'execute',
    log: (line) => logLines.push(String(line)),
    // This runs inside the long-lived Express server, not a one-shot CLI —
    // must not close the app's shared database connection when it finishes.
    disconnectWhenDone: false,
  });

  res.status(result.ok ? 200 : 500).json({ ...result, log: logLines });
});
