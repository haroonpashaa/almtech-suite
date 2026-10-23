// Builds the payload the product create/edit form sends to the API.
//
// purchasePrice is never set from this form — receiving a purchase order already
// writes it automatically (see purchaseOrder.controller.js receiveItems), so a
// manual entry point here would just be a second, driftable source of truth.
//
// sellingPrice has no equivalent automatic mechanism anywhere in the system (POS
// only reads it as a cart default, it's never written back), so it's the one price
// this form still accepts — but only at creation (isNew), never on an edit, so
// editing an existing product's comments/specs can never zero it out.
const EDIT_FIELDS = [
  'name', 'sku', 'brand', 'model', 'category', 'description',
  'processor', 'ram', 'storage', 'graphics', 'screen', 'condition', 'warranty', 'comments',
  'image', 'lowStockThreshold', 'barcode', 'active',
];

export function buildProductPayload(form, { isNew = false } = {}) {
  const payload = {};
  const fields = isNew ? [...EDIT_FIELDS, 'stock', 'tracksSerials', 'sellingPrice'] : EDIT_FIELDS;
  for (const field of fields) {
    if (Object.hasOwn(form, field)) payload[field] = form[field];
  }
  if (isNew) payload.stock = Number(payload.stock);
  payload.lowStockThreshold = Number(payload.lowStockThreshold);
  if (isNew) payload.sellingPrice = Number(payload.sellingPrice) || 0;
  payload.barcode = (payload.barcode || '').trim();
  return payload;
}
