import ModelFilter from './ModelFilter.jsx';

export default function InventoryFilters({
  q,
  lowStock,
  selectedModels,
  models,
  onQueryChange,
  onLowStockChange,
  onModelsChange,
  onClearFilters,
  loading,
  error,
  total,
}) {
  const hasFilters = Boolean(q || lowStock || selectedModels.length);

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="field-search max-w-xs w-full">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          className="input"
          placeholder="Search by processor, serial number, brand…"
          aria-label="Search inventory"
          value={q}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <button
        type="button"
        onClick={onLowStockChange}
        aria-pressed={lowStock}
        className={`btn-sm border ${lowStock ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-ink-200 text-ink-600 hover:bg-ink-50'}`}
      >
        <span className={`dot ${lowStock ? 'bg-amber-500' : 'bg-ink-300'}`} />
        Low stock only
      </button>
      <ModelFilter
        models={models}
        selected={selectedModels}
        onChange={onModelsChange}
        loading={loading}
        error={error}
      />
      {hasFilters && (
        <button type="button" className="btn-sm text-ink-500 hover:text-ink-800" onClick={onClearFilters}>
          Clear filters
        </button>
      )}
      <span className="text-sm text-ink-400 ml-auto">{total ?? 0} products</span>
    </div>
  );
}
