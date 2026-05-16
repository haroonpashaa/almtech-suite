import Activity from '../models/Activity.js';

export async function logActivity(req, action, { entity, entityId, meta } = {}) {
  try {
    await Activity.create({
      user: req.user?._id,
      userName: req.user?.name,
      action,
      entity,
      entityId: entityId?.toString(),
      meta,
    });
  } catch (e) {
    console.warn('Failed to log activity:', e.message);
  }
}
