import asyncHandler from 'express-async-handler';
import Settings from '../models/Settings.js';
import { logActivity } from '../utils/activity.js';

export const getSettings = asyncHandler(async (_req, res) => {
  res.json(await Settings.getSingleton());
});

export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton();
  Object.assign(settings, req.body);
  await settings.save();
  await logActivity(req, 'settings_updated');
  res.json(settings);
});
