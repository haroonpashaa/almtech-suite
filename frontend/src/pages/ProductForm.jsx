import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui.jsx';

const empty = {
  name: '', sku: '', brand: '', model: '', description: '',
  processor: '', ram: '', storage: '', graphics: '', screen: '', condition: 'new', warranty: '', comments: '',
  purchasePrice: 0, sellingPrice: 0, stock: 0, lowStockThreshold: 5,
  tracksSerials: false, barcode: '',
};

function Section({ title, description, children }) {
  return (
    <div className="card p-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {description && <p className="text-xs text-ink-400 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default function ProductForm() {
  const { has } = useAuth();
  // Cost is administrator/stock information; sales maintains the catalogue without it.
  const seesCost = has('admin', 'stock');
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    enabled: !!id,
    queryKey: ['product', id],
    queryFn: async () => (await api.get(`/products/${id}`)).data,
  });

  useEffect(() => {
    if (data) setForm({ ...empty, ...data });
  }, [data]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      ['purchasePrice', 'sellingPrice', 'stock', 'lowStockThreshold'].forEach((k) => {
        payload[k] = Number(payload[k]);
      });
      // Never post a cost the user was not shown. Without this, a sales user editing a
      // product would send the form's default of 0 and, but for the server also
      // stripping it, would wipe the real purchase price.
      if (!seesCost) delete payload.purchasePrice;
      payload.barcode = (payload.barcode || '').trim();
      if (id) await api.patch(`/products/${id}`, payload);
      else await api.post('/products', payload);
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(id ? 'Product updated' : 'Product created');
      navigate('/products');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const margin = Number(form.sellingPrice) - Number(form.purchasePrice);

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Inventory', to: '/products' }, { label: id ? 'Edit' : 'New' }]}
        title={id ? 'Edit Product' : 'New Product'}
        subtitle="Define product details, pricing, and stock"
      />
      <form onSubmit={submit} className="page page-narrow space-y-5">
        <Section title="Basics" description="How this product is identified across the suite">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="productform-name-40" className="label">Product Name <span className="text-red-500">*</span></label>
              <input id="productform-name-40" className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-sku-41" className="label">Serial Number <span className="text-red-500">*</span></label>
              <input id="productform-sku-41" className="input font-mono" required value={form.sku} onChange={(e) => set('sku', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-brand-42" className="label">Brand</label>
              <input id="productform-brand-42" className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-model-43" className="label">Model</label>
              <input id="productform-model-43" className="input" value={form.model} onChange={(e) => set('model', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-barcode-45" className="label">Barcode</label>
              <input id="productform-barcode-45"
                className="input font-mono"
                value={form.barcode}
                onChange={(e) => set('barcode', e.target.value)}
                placeholder="Scan or type…"
                autoComplete="off"
              />
              <p className="text-xs text-ink-400 mt-1">Optional. Must be unique — leave blank if this product has none.</p>
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="productform-description-46" className="label">Description</label>
            <textarea id="productform-description-46" className="input" rows="3" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
        </Section>

        <Section title="Pricing & Stock" description={seesCost ? 'Cost, sell price, and reorder levels' : 'Sell price and reorder levels'}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {seesCost && (
            <div>
              <label htmlFor="productform-purchase-price-47" className="label">Purchase Price</label>
              <input id="productform-purchase-price-47" className="input num" type="number" step="0.01" value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} />
            </div>
            )}
            <div>
              <label htmlFor="productform-selling-price-48" className="label">Selling Price</label>
              <input id="productform-selling-price-48" className="input num" type="number" step="0.01" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-stock-49" className="label">Stock</label>
              <input id="productform-stock-49" className="input num" type="number" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-low-stock-threshold-50" className="label">Low Stock Threshold</label>
              <input id="productform-low-stock-threshold-50" className="input num" type="number" value={form.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} />
            </div>
          </div>
          {seesCost && form.sellingPrice > 0 && (
            <div className="mt-3 text-xs text-ink-500">
              Margin per unit:{' '}
              <span className={`font-medium num ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {margin >= 0 ? '+' : ''}{margin.toLocaleString()}
              </span>
            </div>
          )}
        </Section>

        {/* A laptop is identified by what is inside it. Every field here is optional,
            because the same catalogue holds monitors, RAM sticks and cables — an
            accessory simply leaves them blank. */}
        <Section title="Specification" description="Leave blank for anything that is not a computer">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="productform-processor" className="label">Processor</label>
              <input id="productform-processor" className="input" placeholder="Intel Core i7-1355U" value={form.processor} onChange={(e) => set('processor', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-ram" className="label">RAM</label>
              <input id="productform-ram" className="input" placeholder="16GB DDR5" value={form.ram} onChange={(e) => set('ram', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-storage" className="label">Storage (ROM)</label>
              <input id="productform-storage" className="input" placeholder="512GB NVMe SSD" value={form.storage} onChange={(e) => set('storage', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-graphics" className="label">Graphics</label>
              <input id="productform-graphics" className="input" placeholder="Intel Iris Xe" value={form.graphics} onChange={(e) => set('graphics', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-screen" className="label">Screen</label>
              <input id="productform-screen" className="input" placeholder={'14" FHD 1920x1080'} value={form.screen} onChange={(e) => set('screen', e.target.value)} />
            </div>
            <div>
              <label htmlFor="productform-condition" className="label">Condition</label>
              <select id="productform-condition" className="select" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                <option value="new">New</option>
                <option value="used">Used</option>
                <option value="refurbished">Refurbished</option>
              </select>
            </div>
            <div>
              <label htmlFor="productform-warranty" className="label">Warranty</label>
              <input id="productform-warranty" className="input" placeholder="1 year" value={form.warranty} onChange={(e) => set('warranty', e.target.value)} />
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="productform-comments" className="label">Comments</label>
            <textarea
              id="productform-comments"
              className="input"
              rows="2"
              placeholder="Screen scratch, battery health issue, missing charger…"
              value={form.comments}
              onChange={(e) => set('comments', e.target.value)}
            />
            <p className="text-xs text-ink-400 mt-1">Defects, cosmetic condition, or missing accessories for this specific unit.</p>
          </div>
        </Section>

        <Section title="Options">
          <label className="flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded accent-brand-600" checked={form.tracksSerials} onChange={(e) => set('tracksSerials', e.target.checked)} />
            Track serial numbers / IMEI for this product
          </label>
        </Section>

        <div className="flex gap-2 pt-1">
          <button className="btn-primary" disabled={saving}>
            {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : id ? 'Save changes' : 'Create product'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
