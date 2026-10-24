import PartyEntry, { PartyEntryEvent } from '../models/PartyEntry.js';

export async function partyEntryTotals(entityType, entity, currency = 'PKR') {
  const [row] = await PartyEntry.aggregate([
    { $match: { entityType, entity, currency, status: 'active' } },
    { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paid' }, outstanding: { $sum: '$balance' }, openCount: { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } } } },
  ]);
  return row || { total: 0, paid: 0, outstanding: 0, openCount: 0 };
}
export async function partyEntryDetail(entityType, entity, currency, admin) {
  const totals = await partyEntryTotals(entityType, entity, currency);
  if (!admin) return { entryTotals: totals };
  const [entries, history] = await Promise.all([
    PartyEntry.find({ entityType, entity, currency }).populate('payments.account', 'name currency').sort({ date: -1, _id: -1 }),
    PartyEntryEvent.find({ entityType, entity, currency }).populate('createdBy', 'name').sort({ createdAt: -1, _id: -1 }),
  ]);
  return { entryTotals: totals, manualEntries: entries, entryHistory: history };
}

// List views are open-item views, matching the existing invoice/PO filters.
// Standalone entries never increment an invoice or PO count.
export async function mergeOpenPartyEntries(rows, entityType, Model, query, now, currency = 'PKR', entity = null) {
  if (query.status && !['open', 'ordered', 'partial'].includes(query.status)) return rows;
  const match = { entityType, currency, status: 'active', balance: { $gt: 0 } };
  if (entity) match.entity = entity;
  if (query.status === 'partial') match.paid = { $gt: 0 };
  else if (query.status) match.paid = 0;
  if (query.from || query.to) {
    match.date = {};
    if (query.from) match.date.$gte = new Date(query.from);
    if (query.to) match.date.$lte = new Date(query.to);
  }
  const entries = await PartyEntry.find(match).select('entity total paid balance date').lean();
  const parties = await Model.find({ _id: { $in: entries.map(e => e.entity) } }).select('name company contactPerson phone balance payable payableGBP');
  const partyMap = new Map(parties.map(p => [String(p._id), p]));
  const rx = query.q ? new RegExp(String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const idKey = entityType === 'customer' ? 'customerId' : 'supplierId';
  const countKey = entityType === 'customer' ? 'invoiceCount' : 'poCount';
  const balanceKey = entityType === 'customer' ? 'storedBalance' : 'storedPayable';
  for (const entry of entries) {
    const party = partyMap.get(String(entry.entity));
    if (!party || (rx && ![party.name, party.company, party.contactPerson, party.phone].some(v => rx.test(String(v || ''))))) continue;
    let row = rows.find(r => String(r[idKey]) === String(entry.entity));
    if (!row) {
      row = { [idKey]: party._id, name: party.name, company: party.company, contactPerson: party.contactPerson, phone: party.phone, [balanceKey]: entityType === 'customer' ? party.balance : party[currency === 'GBP' ? 'payableGBP' : 'payable'], total: 0, paid: 0, outstanding: 0, [countKey]: 0, oldestDate: null, oldestAgeDays: 0, aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 } };
      rows.push(row);
    }
    const age = Math.floor((now - entry.date) / 86400000);
    const bucket = age <= 0 ? 'current' : age <= 30 ? 'd1_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90_plus';
    row.total += entry.total; row.paid += entry.paid; row.outstanding += entry.balance;
    row.manualEntryCount = (row.manualEntryCount || 0) + 1;
    row.aging[bucket] += entry.balance;
    row.oldestAgeDays = Math.max(row.oldestAgeDays, age);
    if (!row.oldestDate || entry.date < row.oldestDate) row.oldestDate = entry.date;
  }
  return rows;
}

// One canonical stream for statements and party ledgers. Cash is already in the
// account ledger; these events represent its matching obligation-side movement.
export async function partyEntryLedgerEvents(entityType, entity, currency = 'PKR', admin = true) {
  const events = await PartyEntryEvent.find({ entityType, entity, currency }).sort({ date: 1, createdAt: 1, _id: 1 }).lean();
  return events.map(e => ({
    date: e.date, type: `standalone_${e.action}`, typeLabel: `Standalone ${e.action.replaceAll('_', ' ')}`,
    reference: e.reference || null, description: admin ? e.reason : `Standalone ${e.action.replaceAll('_', ' ')}`,
    credit: Math.max(0, e.delta), debit: Math.max(0, -e.delta), currency, partyEntry: e.entry,
  }));
}
