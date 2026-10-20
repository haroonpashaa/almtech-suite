import { useEffect, useRef, useState } from 'react';
import { filterModelOptions, MAX_SELECTED_MODELS, toggleModelSelection } from '../lib/inventoryModels.js';

export default function ModelFilter({ models = [], selected = [], onChange, loading = false, error = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef(null);
  const visibleModels = filterModelOptions(models, query);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className={`btn-sm border ${selected.length ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-ink-200 text-ink-600 hover:bg-ink-50'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Model{selected.length ? ` (${selected.length})` : ''}
      </button>
      {open && (
        <div role="dialog" aria-label="Filter inventory by model" className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-ink-200 bg-white p-3 shadow-lg">
          <label className="sr-only" htmlFor="inventory-model-search">Search model names</label>
          <input
            id="inventory-model-search"
            className="input mb-2"
            type="search"
            placeholder="Search model names…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {loading ? (
            <p className="p-2 text-sm text-ink-400">Loading models…</p>
          ) : error ? (
            <p className="p-2 text-sm text-red-600">Could not load models.</p>
          ) : visibleModels.length ? (
            <div className="max-h-56 overflow-y-auto" role="group" aria-label="Inventory models">
              {visibleModels.map((model) => (
                <label key={model} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(model)}
                    disabled={!selected.includes(model) && selected.length >= MAX_SELECTED_MODELS}
                    onChange={() => onChange(toggleModelSelection(selected, model))}
                    aria-label={model}
                  />
                  <span className="truncate">{model}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="p-2 text-sm text-ink-400">No matching models</p>
          )}
          {selected.length >= MAX_SELECTED_MODELS && (
            <p className="mt-2 text-sm text-amber-700" role="status">
              Maximum of {MAX_SELECTED_MODELS} models selected. Remove a selection to add another.
            </p>
          )}
          {selected.length > 0 && (
            <button type="button" className="mt-2 text-sm font-medium text-brand-700 hover:underline" onClick={() => onChange([])}>
              Clear model selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
