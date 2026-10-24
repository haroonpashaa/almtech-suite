import { expect, it, vi } from 'vitest';
vi.mock('./ledger.js',()=>({transactionsSupported:vi.fn().mockResolvedValue(false),runAtomically:vi.fn()}));
import { inventoryOperation } from './inventoryOperation.js';
import InventoryOperation from '../models/InventoryOperation.js';
it('fails closed before business writes if transactions are unavailable',async()=>{
 const init=vi.spyOn(InventoryOperation,'init');const work=vi.fn();
 await expect(inventoryOperation({owner:'test',kind:'sale',key:'request',input:{}},work)).rejects.toMatchObject({statusCode:503});
 expect(init).not.toHaveBeenCalled();expect(work).not.toHaveBeenCalled();vi.restoreAllMocks();
});
