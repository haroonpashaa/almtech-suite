function productId(value) {
  return String(value?._id ?? value);
}

function lineFromProduct(product) {
  return {
    product: productId(product),
    name: product.name,
    sku: product.sku,
    unitCost: product.purchasePrice || '',
    quantity: 1,
    received: 0,
  };
}

export function addProductToPurchaseOrder(cart, product) {
  if (cart.some((line) => productId(line.product) === productId(product))) return cart;
  return [...cart, lineFromProduct(product)];
}

export function toggleProductInPurchaseOrder(cart, product) {
  const index = cart.findIndex((line) => productId(line.product) === productId(product));
  if (index < 0) return addProductToPurchaseOrder(cart, product);
  if (Number(cart[index].received) > 0) return cart;
  return cart.filter((_, lineIndex) => lineIndex !== index);
}

export function hasEligibleDisplayedSelection(cart, products) {
  return products.some((product) =>
    cart.some((line) => productId(line.product) === productId(product) && Number(line.received || 0) <= 0)
  );
}

export function toggleDisplayedProductsInPurchaseOrder(cart, products) {
  if (!products.length) return cart;
  const visibleIds = new Set(products.map(productId));
  if (hasEligibleDisplayedSelection(cart, products)) {
    // Received lines are immutable in the existing PO workflow.
    return cart.filter((line) => !visibleIds.has(productId(line.product)) || Number(line.received) > 0);
  }
  return products.reduce(addProductToPurchaseOrder, cart);
}
