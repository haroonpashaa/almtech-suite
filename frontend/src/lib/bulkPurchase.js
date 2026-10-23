import { allocateBulkPrice } from './bulkPricing.js';

// Allocate only the payable. Never substitute this for inventory unit costs.
// Reuse the existing integer-penny allocator; the last line absorbs rounding.
export function allocateBulkPurchase(items, amount) {
  try {
    const allocation = allocateBulkPrice(items, amount);
    return {
      subtotal: allocation.subtotal,
      items: items.map((item, index) => ({ ...item, bulkAllocatedTotal: allocation.items[index].lineTotal })),
    };
  } catch (error) {
    error.message = error.message.replaceAll('selling', 'purchase').replaceAll('sale', 'purchase').replace('stock to the cart', 'items to the purchase order');
    throw error;
  }
}
