import asyncHandler from 'express-async-handler';
import Settings from '../models/Settings.js';
import { logActivity } from '../utils/activity.js';

export const getSettings = asyncHandler(async (_req, res) => {
  const settings = await Settings.getSingleton();
  // Older deployments may still have a GBP global setting. Currency-less
  // receivables and legacy reports mean frontend defaults must present as PKR.
  res.json({ ...settings.toObject(), currency: 'PKR' });
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
  // Customer receivables, invoice costs and several historic reports still have
  // one PKR balance. GBP is supported on payable/account records only until those
  // older ledgers gain currency buckets.
  if (settings.currency !== 'PKR') {
    res.status(400);
    throw new Error('Application currency must remain PKR while customer balances and legacy reports use a single currency. GBP is available for supported payable and matching account workflows.');
  }
  await settings.save();
  await logActivity(req, 'settings_updated');
  res.json(settings);
});
