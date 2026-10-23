import { useEffect, useMemo, useRef, useState } from 'react';
import { filterPosModelOptions, MAX_POS_MODEL_FILTERS, togglePosModel } from '../lib/posProductSelection.js';
import { remainingPosStock } from '../lib/posStockSelection.js';
import { clampQuantity } from '../lib/quantity.js';

function takenSerials(cart, productId) {
  return new Set(cart.filter((line) => line.product === productId).flatMap((line) => line.serials || []).filter(Boolean));
}

export default function POSProductPicker({
  filters,
  models,
  modelsLoading = false,
  modelsError = false,
  onFiltersChange,
  products,
  loading,
  error,
  total,
  page,
  limit,
  onPageChange,
  cart,
  selectedSerials,
  onSerialChange,
  onAdd,
  currency,
  formatMoney,
  bulkSelection = null,
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const modelRoot = useRef(null);
  const visibleModels = filterPosModelOptions(models, modelSearch);
  const hasFilters = Boolean(filters.q || filters.models.length || filters.brand || filters.ram || filters.processor || filters.storage || filters.serial);
  const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
  const resultLabel = useMemo(() => `${total ?? 0} matching product${total === 1 ? '' : 's'}`, [total]);
  const selected = Object.values(bulkSelection?.items || {});
  const selectedUnits = selected.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

  const updateFilter = (key, value) => onFiltersChange({ ...filters, [key]: value });
  const toggleModel = (model) => updateFilter('models', togglePosModel(filters.models, model));

  useEffect(() => {
    if (!modelOpen) return undefined;
    const closeOutside = (event) => {
      if (modelRoot.current && !modelRoot.current.contains(event.target)) setModelOpen(false);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setModelOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [modelOpen]);

  return (
    <section className="card p-4" aria-label="Product selection">
      <div className="flex flex-wrap items-center gap-2">
        <div className="field-search min-w-[14rem] flex-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            className="input"
            aria-label="Search products"
            placeholder="Search name, SKU, model, specs or serial…"
            value={filters.q}
            onChange={(event) => updateFilter('q', event.target.value)}
          />
        </div>
        <div className="relative" ref={modelRoot}>
          <button
            type="button"
            className={`btn-sm border ${filters.models.length ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-ink-200 text-ink-600'}`}
            aria-haspopup="dialog"
            aria-expanded={modelOpen}
            onClick={() => setModelOpen((open) => !open)}
          >
            Model{filters.models.length ? ` (${filters.models.length})` : ''}
          </button>
          {modelOpen && (
            <div role="dialog" aria-label="Filter products by model" className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-ink-200 bg-white p-3 shadow-lg sm:left-0 sm:right-auto">
              <label className="sr-only" htmlFor="pos-model-search">Search model names</label>
              <input id="pos-model-search" className="input mb-2" type="search" placeholder="Search model names…" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} />
              {modelsLoading ? <p className="p-2 text-sm text-ink-400">Loading models…</p> : modelsError ? <p className="p-2 text-sm text-red-600">Model filter unavailable.</p> : visibleModels.length ? (
                <div className="max-h-56 overflow-y-auto" role="group" aria-label="Available models">
                  {visibleModels.map((model) => (
                    <label key={model} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-50">
                      <input type="checkbox" checked={filters.models.includes(model)} onChange={() => toggleModel(model)} aria-label={model} disabled={!filters.models.includes(model) && filters.models.length >= MAX_POS_MODEL_FILTERS} />
                      <span className="truncate">{model}</span>
                    </label>
                  ))}
                </div>
              ) : <p className="p-2 text-sm text-ink-400">No matching models</p>}
              {filters.models.length >= MAX_POS_MODEL_FILTERS && <p role="status" className="mt-2 text-sm text-amber-700">Maximum of 100 models selected.</p>}
              {filters.models.length > 0 && <button type="button" className="mt-2 text-sm font-medium text-brand-700 hover:underline" onClick={() => updateFilter('models', [])}>Clear model selection</button>}
            </div>
          )}
        </div>
        <span className="ml-auto text-sm text-ink-500" aria-live="polite">{resultLabel}</span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-600">More filters</summary>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ['brand', 'Brand'], ['ram', 'RAM'], ['processor', 'Processor'], ['storage', 'Storage'], ['serial', 'Serial number'],
          ].map(([key, label]) => (
            <label key={key} className="text-xs text-ink-500">
              {label}
              <input className="input input-sm mt-1 w-full" aria-label={`Filter by ${label}`} value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)} />
            </label>
          ))}
        </div>
      </details>
      {hasFilters && (
        <button type="button" className="mt-3 text-sm font-medium text-brand-700 hover:underline" onClick={() => { onFiltersChange({ q: '', models: [], brand: '', ram: '', processor: '', storage: '', serial: '' }); setModelSearch(''); setModelOpen(false); }}>
          Clear filters
        </button>
      )}

      {bulkSelection && (
        <div className="mt-3 space-y-2" aria-label="Batch stock selection">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-sm" disabled={loading || error || bulkSelection.loading || total === 0} onClick={bulkSelection.onSelectAll}>
              {bulkSelection.loading ? 'Selecting products…' : 'Select all matching products'}
            </button>
            <button type="button" className="btn-secondary btn-sm" disabled={!selected.length && !bulkSelection.loading} onClick={bulkSelection.onClear}>Deselect all</button>
            <button type="button" className="btn-primary btn-sm" disabled={!selected.length || bulkSelection.loading || !!bulkSelection.error} onClick={bulkSelection.onAdd}>Add selected to cart</button>
          </div>
          <p className="text-xs text-ink-500" role="status">{selected.length} {selected.length === 1 ? 'product' : 'products'} selected · {selectedUnits} {selectedUnits === 1 ? 'unit' : 'units'}. Selections stay across pages and filters.</p>
          <p className="text-xs text-ink-500">Select All covers every matching page. Quantities start at remaining stock; adjust them before adding. Serial-tracked units use available serials. Stock changes only when the invoice is saved.</p>
          {bulkSelection.error && <p role="alert" className="text-xs text-red-600">{bulkSelection.error}</p>}
        </div>
      )}
      <div className="mt-3 overflow-x-auto rounded-lg border border-ink-100">
        <table className="min-w-[1050px] w-full text-sm">
          <thead>
            <tr>
              {bulkSelection && <th scope="col" className="th">Select</th>}
              <th scope="col" className="th">Product model</th>
              <th scope="col" className="th">Brand</th>
              <th scope="col" className="th min-w-44">Serial number</th>
              <th scope="col" className="th">RAM</th>
              <th scope="col" className="th">Processor</th>
              <th scope="col" className="th">Storage</th>
              <th scope="col" className="th">Condition / comments</th>
              <th scope="col" className="th text-right">Available</th>
              {bulkSelection && <th scope="col" className="th text-right">To add</th>}
              <th scope="col" className="th text-right">Price</th>
              <th scope="col" className="th text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={bulkSelection ? 12 : 10} className="p-6 text-center text-ink-400">Loading products…</td></tr>
            ) : error ? (
              <tr><td colSpan={bulkSelection ? 12 : 10} className="p-6 text-center text-red-600">Could not load products. Please try again.</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={bulkSelection ? 12 : 10} className="p-6 text-center text-ink-400">No products match these filters.</td></tr>
            ) : products.map((product) => {
              const line = cart.find((item) => item.product === product._id);
              const quantityInCart = Number(line?.quantity || 0);
              const outOfStock = Number(product.stock) <= 0;
              const stockLimitReached = !outOfStock && Number(product.stock) <= quantityInCart;
              const canAdd = product.active !== false && !outOfStock && !stockLimitReached;
              const taken = takenSerials(cart, product._id);
              const selectedSerial = selectedSerials[product._id] || '';
              const availableSerials = (product.serials || []).filter((unit) => unit.status === 'in_stock').map((unit) => unit.serial).filter(Boolean);
              const serialOptions = availableSerials.filter((serial) => !taken.has(serial) || serial === selectedSerial);
              const selectedSerialAvailable = !selectedSerial || serialOptions.includes(selectedSerial);
              const stockEntry = bulkSelection?.items[product._id];
              const remaining = remainingPosStock(product, cart);
              return (
                <tr key={product._id} className="tr">
                  {bulkSelection && <td className="td"><input type="checkbox" aria-label={`Select ${product.name} (${product.sku})`} checked={!!stockEntry} disabled={bulkSelection.loading || (!stockEntry && !canAdd)} onChange={() => bulkSelection.onToggle(product)} /></td>}
                  <td className="td min-w-48">
                    <div className="font-medium text-ink-900">{product.model || '—'}</div>
                    <div className="t-meta">{product.name} · <span className="font-mono">{product.sku}</span></div>
                  </td>
                  <td className="td">{product.brand || '—'}</td>
                  <td className="td">
                    {availableSerials.length > 0 ? (
                      <div className="space-y-1">
                        <div className="font-mono text-xs break-words" aria-label={`Available serial numbers for ${product.model || product.name}`}>
                          {availableSerials.join(', ')}
                        </div>
                        {product.tracksSerials && (
                          <select className="select input-sm min-w-40" aria-label={`Serial number for ${product.model || product.name}`} value={selectedSerial} onChange={(event) => onSerialChange(product._id, event.target.value)}>
                            <option value="">— optional —</option>
                            {serialOptions.map((serial) => <option key={serial} value={serial}>{serial}</option>)}
                          </select>
                        )}
                      </div>
                    ) : product.tracksSerials ? (
                      <select className="select input-sm min-w-40" aria-label={`Serial number for ${product.model || product.name}`} value={selectedSerial} onChange={(event) => onSerialChange(product._id, event.target.value)}>
                        <option value="">— optional —</option>
                      </select>
                    ) : '—'}
                  </td>
                  <td className="td">{product.ram || '—'}</td>
                  <td className="td">{product.processor || '—'}</td>
                  <td className="td">{product.storage || '—'}</td>
                  <td className="td max-w-56"><span>{product.comments || product.condition || '—'}</span></td>
                  <td className="td text-right whitespace-nowrap">{Math.max(0, Number(product.stock) - quantityInCart)} <span className="t-meta">/ {product.stock}</span></td>
                  {bulkSelection && <td className="td"><input type="number" min="1" max={remaining} step="1" className="input input-sm w-24 text-right num" aria-label={`Quantity to add for ${product.name} (${product.sku})`} value={stockEntry?.quantity ?? ''} disabled={!stockEntry || bulkSelection.loading || remaining < 1} onChange={(event) => bulkSelection.onQuantityChange(product, clampQuantity(event.target.value, remaining))} /></td>}
                  <td className="td text-right whitespace-nowrap num">{formatMoney(product.sellingPrice, currency)}</td>
                  <td className="td text-right">
                    <button type="button" className="btn-sm btn-primary" disabled={!canAdd || !selectedSerialAvailable} onClick={() => onAdd(product, selectedSerial)}>
                      {product.active === false ? 'Inactive' : outOfStock ? 'Out of stock' : stockLimitReached ? 'In cart' : 'Add'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            <button type="button" className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </section>
  );
}
