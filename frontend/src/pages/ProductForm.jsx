import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { Spinner } from '../components/ui.jsx';

const empty = {
  name: '', sku: '', brand: '', model: '', category: 'Laptops', description: '',
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
      <form onSubmit={submit} className="p-6 sm:p-8 max-w-3xl space-y-5">
        <Section title="Basics" description="How this product is identified across the suite">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Name <span className="text-red-500">*</span></label>
              <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label">SKU <span className="text-red-500">*</span></label>
              <input className="input font-mono" required value={form.sku} onChange={(e) => set('sku', e.target.value)} />
            </div>
            <div>
              <label className="label">Brand</label>
              <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            </div>
            <div>
              <label className="label">Model</label>
              <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} />
            </div>
            <div>
              <label className="label">Category</label>
              <input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} />
            </div>
            <div>
              <label className="label">Barcode</label>
              <input
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
            <label className="label">Description</label>
            <textarea className="input" rows="3" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
        </Section>

        <Section title="Pricing & Stock" description="Cost, sell price, and reorder levels">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Purchase Price</label>
              <input className="input num" type="number" step="0.01" value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} />
            </div>
            <div>
              <label className="label">Selling Price</label>
              <input className="input num" type="number" step="0.01" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
            </div>
            <div>
              <label className="label">Stock</label>
              <input className="input num" type="number" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
            </div>
            <div>
              <label className="label">Low Stock Threshold</label>
              <input className="input num" type="number" value={form.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} />
            </div>
          </div>
          {form.sellingPrice > 0 && (
            <div className="mt-3 text-xs text-ink-500">
              Margin per unit:{' '}
              <span className={`font-medium num ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {margin >= 0 ? '+' : ''}{margin.toLocaleString()}
              </span>
            </div>
          )}
        </Section>

        <Section title="Options">
          <label className="flex items-center gap-2.5 text-sm text-ink-700 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded accent-brand-600" checked={form.tracksSerials} onChange={(e) => set('tracksSerials', e.target.checked)} />
            Track serial numbers / IMEI for this product
          </label>
        </Section>

        <div className="flex gap-2 pt-1">
          <button className="btn-primary-gradient" disabled={saving}>
            {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : id ? 'Save changes' : 'Create product'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
