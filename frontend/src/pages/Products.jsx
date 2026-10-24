import { invalidateInventory } from '../lib/invalidateInventory.js';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePagedList } from '../hooks/usePagedList.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Spinner } from '../components/ui.jsx';
import InventoryFilters from '../components/InventoryFilters.jsx';
import { inventoryListParams } from '../lib/inventoryModels.js';

/** "16GB · 512GB NVMe SSD · i7-1355U" — blank for anything with no specification. */
export function specLine(p) {
  return [p.ram, p.storage, p.processor].filter(Boolean).join(' · ');
}

export default function Products() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [selectedModels, setSelectedModels] = useState([]);
  // Recording that stock arrived. The endpoint has always existed and writes an
  // audited StockMovement; until now nothing in the interface reached it, so stock
  // could only move by creating a product, receiving a purchase order or selling.
  const [adjusting, setAdjusting] = useState(null);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const canAdjustStock = has('admin', 'stock', 'sales');

  function openAdjust(product) {
    setAdjusting(product);
    setDelta('');
    setNote('');
  }

  async function saveAdjustment() {
    const quantity = Number(delta);
    if (!Number.isFinite(quantity) || quantity === 0) return;
    setSaving(true);
    try {
      await api.post(`/products/${adjusting._id}/adjust`, { quantity, note });
      toast.success(`${adjusting.name}: stock ${quantity > 0 ? 'increased' : 'reduced'} by ${Math.abs(quantity)}`);
      setAdjusting(null);
      invalidateInventory(qc);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Same paged-list architecture as Invoices/Customers/Suppliers — resets to page 1
  // whenever a filter changes, and reads the true total so paging never silently
  // hides records the way the old unpaginated call did past its first 50.
  const modelOptions = useQuery({
    queryKey: ['product-models'],
    queryFn: async () => (await api.get('/products/models')).data,
  });
  const listParams = inventoryListParams({ q, lowStock, models: selectedModels });
  const list = usePagedList({
    key: ['products', q, lowStock, selectedModels],
    path: '/products',
    params: listParams,
    limit: 50,
  });
  // If the current page no longer exists (e.g. the result set shrank), land on the
  // last real page instead of showing an empty page for no visible reason.
  const totalPages = list.total != null ? Math.max(1, Math.ceil(list.total / list.limit)) : null;
  if (!list.isLoading && totalPages != null && list.page > totalPages) {
    list.setPage(totalPages);
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Products and stock levels"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10" /></svg>}
        actions={has('admin', 'stock', 'sales') && (
          <Link to="/products/new" className="btn-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Product
          </Link>
        )}
      />
      <div className="page page-w">
        <InventoryFilters
          q={q}
          lowStock={lowStock}
          selectedModels={selectedModels}
          models={modelOptions.data || []}
          onQueryChange={setQ}
          onLowStockChange={() => setLowStock((value) => !value)}
          onModelsChange={setSelectedModels}
          onClearFilters={() => { setQ(''); setLowStock(false); setSelectedModels([]); }}
          loading={modelOptions.isLoading}
          error={modelOptions.isError}
          total={list.total}
        />
        <Table
          {...list.tableProps}
          empty="No products match your filters"
          columns={[
            { key: 'name', label: 'Product Name', render: (p) => (
              <span className="block">
                {has('admin', 'stock', 'sales') ? (
                  <Link to={`/products/${p._id}`} className="text-ink-900 hover:text-brand-700 font-medium">{p.name}</Link>
                ) : (
                  <span className="text-ink-900 font-medium">{p.name}</span>
                )}
                {/* What is actually inside the machine, under its name — the figures
                    staff are asked for across the counter. */}
                {specLine(p) && <span className="block t-meta truncate">{specLine(p)}</span>}
              </span>
            ) },
            { key: 'sku', label: 'Serial Number', render: (p) => <span className="font-mono text-[12px] text-ink-400">{p.sku}</span> },
            { key: 'brand', label: 'Brand', render: (p) => p.brand || <span className="text-ink-300">—</span> },
            // The API never sends comments to a sales user (product.controller.js
            // withoutComments), so this column would just render blanks for them —
            // dropped entirely instead.
            ...(has('sales') ? [] : [{ key: 'comments', label: 'Comments', render: (p) => (
                p.comments ? <span className="t-meta truncate block max-w-[16rem]" title={p.comments}>{p.comments}</span> : <span className="text-ink-300">—</span>
              ) }]),
            { key: 'stock', label: 'Stock', className: 'text-right', render: (p) => (
                <span className="num">
                  {p.stock <= p.lowStockThreshold ? (
                    <Badge tone={p.stock === 0 ? 'danger' : 'warning'} dot>{p.stock}</Badge>
                  ) : p.stock}
                </span>
              ) },
            // Pricing is deliberately absent from this screen — cost and selling price
            // are entered at the appropriate sales/financial stage (New Sale, invoices,
            // purchase orders), not while browsing or editing the laptop catalogue.
            ...(canAdjustStock ? [{
              key: 'adjust',
              label: 'Stock in/out',
              className: 'text-right',
              render: (p) => (
                <button type="button" className="btn-sm border border-ink-200 bg-white text-ink-600 hover:bg-ink-50" onClick={() => openAdjust(p)}>
                  Adjust
                </button>
              ),
            }] : []),
          ]}
        />
      </div>

      <Modal
        open={!!adjusting}
        onClose={() => setAdjusting(null)}
        title="Adjust stock"
        subtitle={adjusting ? `${adjusting.name} · currently ${adjusting.stock} in stock` : ''}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAdjusting(null)}>Cancel</button>
            <button className="btn-primary" onClick={saveAdjustment} disabled={!Number(delta) || saving}>
              {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save adjustment'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="products-adjust-qty" className="label">Quantity</label>
            <input
              id="products-adjust-qty"
              className="input"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 25 to add, -5 to remove"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
            <p className="t-meta mt-1">
              A positive number adds stock, a negative number removes it.
              {Number(delta) && adjusting
                ? ` ${adjusting.stock} → ${Math.max(0, adjusting.stock + Number(delta))}`
                : ''}
            </p>
          </div>
          <div>
            <label htmlFor="products-adjust-note" className="label">Reason</label>
            <input
              id="products-adjust-note"
              className="input"
              placeholder="Delivery received, stock count correction…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
