import asyncHandler from 'express-async-handler';
import Settings from '../models/Settings.js';
import { logActivity } from '../utils/activity.js';

export const getSettings = asyncHandler(async (_req, res) => {
  res.json(await Settings.getSingleton());
});

// Every field the Settings page actually exposes as an input (business profile,
// numbering prefixes, tax defaults, invoice display). `invoiceNextNumber`,
// `quotationNextNumber` and `poNextNumber` are deliberately excluded — they are
// system-maintained counters incremented atomically by nextNumber() (see
// utils/numbering.js) whenever a document is issued, never edited by hand; accepting
// them here would let a client reset a counter and produce duplicate document numbers.
const SETTINGS_WRITABLE_FIELDS = [
  'businessName', 'address', 'phone', 'email', 'taxNumber', 'logoUrl',
  'currency', 'defaultTaxRate', 'showTaxOnInvoices',
  'invoicePrefix', 'quotationPrefix', 'poPrefix',
];

export function pickWritableSettingsFields(body) {
  const clean = {};
  for (const f of SETTINGS_WRITABLE_FIELDS) {
    if (body[f] !== undefined) clean[f] = body[f];
  }
  return clean;
}

export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton();
  Object.assign(settings, pickWritableSettingsFields(req.body));
  await settings.save();
  await logActivity(req, 'settings_updated');
  res.json(settings);
});
