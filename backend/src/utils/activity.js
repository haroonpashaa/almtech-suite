import Activity from '../models/Activity.js';

// `actor` lets a caller record who an event belongs to when `req.user` isn't
// populated on the request itself — e.g. a login event, which happens
// before `protect` would ever set `req.user`. Omit it (the default) to keep
// attributing to `req.user`, as every existing call site already does.
export async function logActivity(req, action, { entity, entityId, meta, actor } = {}) {
  try {
    const user = actor !== undefined ? actor : req.user;
    await Activity.create({
      user: user?._id,
      userName: user?.name,
      action,
      entity,
      entityId: entityId?.toString(),
      meta,
    });
  } catch (e) {
    console.warn('Failed to log activity:', e.message);
  }
}

// ALM-SEC-022: a small, explicit before/after diff for a fixed allowlist of
// fields, so an update's audit entry records what actually changed, not
// just that something did. Deliberately scoped to whatever allowlist each
// call site passes in — callers must never include passwords, tokens, or
// other credentials in `fields`.
export function diffFields(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const from = before?.[f] ?? null;
    const to = after?.[f] ?? null;
    if (from !== to) changes[f] = { from, to };
  }
  return changes;
}
