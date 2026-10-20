import { resizeSerials } from './cartSerials.js';

export const MAX_POS_MODEL_FILTERS = 100;

export function filterPosModelOptions(models, query = '') {
  const search = String(query).trim().toLocaleLowerCase();
  return (models || []).filter((model) => String(model).toLocaleLowerCase().includes(search));
}

export function togglePosModel(models, model) {
  if (models.includes(model)) return models.filter((value) => value !== model);
  if (models.length >= MAX_POS_MODEL_FILTERS) return models;
  return [...models, model];
}

export function buildPosProductParams(filters = {}) {
  return {
    q: filters.q?.trim() || undefined,
    models: filters.models?.length ? JSON.stringify(filters.models) : undefined,
    brand: filters.brand?.trim() || undefined,
    ram: filters.ram?.trim() || undefined,
    processor: filters.processor?.trim() || undefined,
    storage: filters.storage?.trim() || undefined,
    serial: filters.serial?.trim() || undefined,
  };
}

export function emptyPosProductFilters() {
  return { q: '', models: [], brand: '', ram: '', processor: '', storage: '', serial: '' };
}

export function addPosCartItem(cart, product, serial = '') {
  const quantityInCart = Number(cart.find((line) => line.product === product._id)?.quantity || 0);
  if (product.active === false) return { cart, error: `${product.name} is inactive and cannot be sold` };
  if (Number(product.stock) <= quantityInCart) return { cart, error: `Only ${product.stock} of ${product.name} in stock` };

  if (serial) {
    const available = (product.serials || []).some((unit) => unit.serial === serial && unit.status === 'in_stock');
    const alreadySelected = cart.some((line) => line.product === product._id && line.serials?.includes(serial));
    if (!product.tracksSerials || !available || alreadySelected) {
      return { cart, error: `${serial} is not available to add` };
    }
  }

  const tracksSerials = !!product.tracksSerials;
  const existing = cart.some((line) => line.product === product._id);
  if (existing) {
    return {
      cart: cart.map((line) => {
        if (line.product !== product._id) return line;
        const quantity = quantityInCart + 1;
        const serials = tracksSerials ? resizeSerials(line.serials, quantity) : line.serials;
        if (tracksSerials && serial) serials[quantity - 1] = serial;
        return { ...line, quantity, serials: tracksSerials ? serials : line.serials };
      }),
      error: null,
    };
  }

  return {
    cart: [...cart, {
      product: product._id,
      name: product.name,
      sku: product.sku,
      unitPrice: product.sellingPrice || '',
      model: product.model || '',
      ram: product.ram || '',
      processor: product.processor || '',
      storage: product.storage || '',
      quantity: 1,
      discount: '',
      stock: product.stock,
      comments: '',
      tracksSerials,
      availableSerials: tracksSerials ? (product.serials || []).filter((unit) => unit.status === 'in_stock').map((unit) => unit.serial) : [],
      serials: tracksSerials ? [serial || ''] : [],
    }],
    error: null,
  };
}

export function removePosCartItem(cart, index) {
  return cart.filter((_, itemIndex) => itemIndex !== index);
}

export function calculatePosTotals(cart, discount = 0, taxRate = 0) {
  const subtotal = cart.reduce(
    (sum, line) => sum + Math.max(0, (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0)),
    0,
  );
  const afterDiscount = Math.max(0, subtotal - Number(discount || 0));
  const tax = Math.round(afterDiscount * (Number(taxRate || 0) / 100) * 100) / 100;
  return { subtotal, tax, total: Math.round((afterDiscount + tax) * 100) / 100 };
}
