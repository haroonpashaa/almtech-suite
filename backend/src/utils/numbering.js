import Settings from '../models/Settings.js';

const FIELDS = {
  invoice: { prefix: 'invoicePrefix', counter: 'invoiceNextNumber' },
  quotation: { prefix: 'quotationPrefix', counter: 'quotationNextNumber' },
  po: { prefix: 'poPrefix', counter: 'poNextNumber' },
};

export async function nextNumber(kind) {
  const fields = FIELDS[kind];
  if (!fields) throw new Error(`Unknown numbering kind: ${kind}`);
  const updated = await Settings.findOneAndUpdate(
    {},
    { $inc: { [fields.counter]: 1 } },
    { new: true, upsert: true }
  );
  const n = updated[fields.counter] - 1;
  const prefix = updated[fields.prefix] ?? '';
  return `${prefix}${String(n).padStart(4, '0')}`;
}
