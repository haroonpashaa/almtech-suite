// Kept identical in frontend/src/lib and backend/src/utils: Hostinger deploys
// the backend as a self-contained root. Contract tests check both implementations.
// Every selected unit gets an equal share of the batch price. Integer pennies
// and cumulative allocation prevent lost pennies, even for 450 units or tiny totals.
export function allocateBulkPrice(items, amount) {
  const fail = (message) => { const error = new Error(message); error.statusCode = 400; throw error; };
  if (!['string', 'number'].includes(typeof amount) || String(amount).trim() === '') fail('Enter a bulk selling amount greater than zero');
  const numeric = Number(amount);
  const pennies = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isSafeInteger(pennies) || pennies < 1 || Math.abs(numeric * 100 - pennies) > 0.000001) {
    fail('Bulk selling amount must be positive, with at most two decimal places');
  }
  if (!Array.isArray(items) || !items.length) fail('Add stock to the cart before setting a bulk selling amount');
  let quantity = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) fail('Enter valid whole quantities for the bulk sale');
    quantity += item.quantity;
  }
  if (!Number.isSafeInteger(quantity)) fail('Bulk sale quantity is too large');
  const unitPennies = Math.ceil(pennies / quantity);
  let selected = 0;
  let allocated = 0;
  const priced = items.map(item => {
    selected += item.quantity;
    const cumulative = Number(BigInt(pennies) * BigInt(selected) / BigInt(quantity));
    const linePennies = cumulative - allocated;
    allocated = cumulative;
    const grossPennies = unitPennies * item.quantity;
    if (!Number.isSafeInteger(grossPennies)) fail('Bulk selling amount is too large');
    return { ...item, unitPrice: unitPennies / 100, discount: (grossPennies - linePennies) / 100, lineTotal: linePennies / 100 };
  });
  return { items: priced, subtotal: pennies / 100 };
}
