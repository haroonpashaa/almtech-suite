import asyncHandler from 'express-async-handler';
import Activity from '../models/Activity.js';
import { safeFilterValue } from '../utils/safeFilterValue.js';

export const listActivity = asyncHandler(async (req, res) => {
  const { limit = 100, entity, user } = req.query;
  const filter = {};
  if (entity) filter.entity = safeFilterValue(entity);
  if (user) filter.user = user;
  const items = await Activity.find(filter).sort('-createdAt').limit(Number(limit));
  res.json(items);
});
