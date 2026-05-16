export function computeItemTotals(items) {
  const enriched = items.map((it) => {
    const lineTotal = Math.max(0, it.quantity * it.unitPrice - (it.discount || 0));
    return { ...it, lineTotal };
  });
  const subtotal = enriched.reduce((s, it) => s + it.lineTotal, 0);
  return { items: enriched, subtotal };
}

export function applyTax({ subtotal, discount = 0, taxRate = 0 }) {
  const afterDiscount = Math.max(0, subtotal - discount);
  const taxAmount = Math.round(afterDiscount * (taxRate / 100) * 100) / 100;
  const total = Math.round((afterDiscount + taxAmount) * 100) / 100;
  return { taxAmount, total };
}
