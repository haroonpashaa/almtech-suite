import mongoose from 'mongoose';

const serialSchema = new mongoose.Schema(
  {
    serial: { type: String, required: true, trim: true },
    status: { type: String, enum: ['in_stock', 'sold', 'returned'], default: 'in_stock' },
    soldInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    description: String,

    // Hardware specification. This is a computer business: a laptop is identified by
    // what is inside it, not by its name alone, and staff need those figures at the
    // counter and on the invoice. Every field is optional free text, because the same
    // catalogue holds laptops, monitors, RAM sticks and cables — an accessory simply
    // leaves them blank. `storage` is what a customer usually calls ROM.
    processor: { type: String, trim: true },
    ram: { type: String, trim: true },
    storage: { type: String, trim: true },
    graphics: { type: String, trim: true },
    screen: { type: String, trim: true },
    condition: { type: String, enum: ['new', 'used', 'refurbished'], default: 'new' },
    warranty: { type: String, trim: true },
    // Free-text condition notes — screen scratch, battery health, missing charger, etc.
    // Distinct from `condition` (new/used/refurbished): this is the specific detail a
    // customer or salesperson needs about THIS unit, not a category.
    comments: { type: String, trim: true, default: '' },
    image: String,
    purchasePrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    tracksSerials: { type: Boolean, default: false },
    serials: [serialSchema],
    barcode: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Specifications are searchable: staff look for "16GB" or "i7" far more often than
// they look for a product's formal name.
productSchema.index({ name: 'text', sku: 'text', brand: 'text', model: 'text', processor: 'text', ram: 'text', storage: 'text' });

// Barcodes are optional, but must be unique when present.
// The partial filter `{ $gt: '' }` is type-bracketed, so it indexes only documents
// whose barcode is a non-empty string — products with a missing, null, or empty
// barcode are left out of the index entirely and can therefore coexist freely.
productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $gt: '' } }, name: 'barcode_unique_when_present' }
);

// A serial number identifies one physical unit, so it can never belong to two
// products at once — same reasoning as barcode above. This is a multikey index
// (serials is an array), so MongoDB enforces the uniqueness across every
// product's serials array, not just within one document. `serial` is required
// on the subdocument, so a bare `sparse: true` (skip documents with no serials
// at all) is enough — there's no empty-string case to carve out like barcode has.
productSchema.index(
  { 'serials.serial': 1 },
  { unique: true, sparse: true, name: 'serials_serial_unique' }
);

productSchema.virtual('isLowStock').get(function () {
  return this.stock <= this.lowStockThreshold;
});

productSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Product', productSchema);
