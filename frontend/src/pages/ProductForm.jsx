import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

const empty = {
  name: '',
  sku: '',
  brand: '',
  model: '',
  category: 'Laptops',
  description: '',
  purchasePrice: 0,
  sellingPrice: 0,
  stock: 0,
  lowStockThreshold: 5,
  tracksSerials: false,
  barcode: '',
};

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
      if (id) await api.patch(`/products/${id}`, payload);
      else await api.post('/products', payload);
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(id ? 'Updated' : 'Created');
      navigate('/products');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title={id ? 'Edit Product' : 'New Product'} />
      <form onSubmit={submit} className="p-6 max-w-3xl space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">SKU *</label>
            <input className="input" required value={form.sku} onChange={(e) => set('sku', e.target.value)} />
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
            <input className="input" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
          </div>
          <div>
            <label className="label">Purchase Price</label>
            <input className="input" type="number" step="0.01" value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} />
          </div>
          <div>
            <label className="label">Selling Price</label>
            <input className="input" type="number" step="0.01" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} />
          </div>
          <div>
            <label className="label">Stock</label>
            <input className="input" type="number" value={form.stock} onChange={(e) => set('stock', e.target.value)} />
          </div>
          <div>
            <label className="label">Low Stock Threshold</label>
            <input className="input" type="number" value={form.lowStockThreshold} onChange={(e) => set('lowStockThreshold', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows="3" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.tracksSerials}
            onChange={(e) => set('tracksSerials', e.target.checked)}
          />
          Track serial numbers / IMEI for this product
        </label>
        <div className="flex gap-2 pt-2">
          <button className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
