import { createHash } from 'node:crypto';
import InventoryOperation from '../models/InventoryOperation.js';
import { runAtomically, transactionsSupported } from './ledger.js';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function operationError(message, statusCode = 409) { return Object.assign(new Error(message), { statusCode }); }
export async function inventoryOperation({ owner, kind, key, input }, work) {
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw operationError('A valid operation key is required', 400);
  if (!(await transactionsSupported())) throw operationError('This operation requires database transaction support; nothing was changed', 503);
  await InventoryOperation.init();
  const filter = { owner, kind, key };
  const hash = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  const replay = receipt => {
    if (receipt.hash !== hash) throw operationError('This operation key was already used with different details. Reopen the saved record before starting another operation.');
    return receipt.result;
  };
  try {
    return await runAtomically(async session => {
      const previous = await InventoryOperation.findOne(filter).session(session);
      if (previous) return replay(previous);
      const [receipt] = await InventoryOperation.create([{ ...filter, hash }], { session });
      const result = await work(session);
      await InventoryOperation.updateOne({ _id: receipt._id }, { $set: { result } }, { session });
      return result;
    });
  } catch (error) {
    if (error.code === 11000) {
      const previous = await InventoryOperation.findOne(filter);
      if (previous) return replay(previous);
    }
    throw error;
  }
}
