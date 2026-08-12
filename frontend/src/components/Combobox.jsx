import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Spinner } from './ui.jsx';

/* ---------------------------------------------------------------------------
   A searchable picker backed by the server.

   Measured before this existed: the POS customer field rendered 521 <option>
   elements in a single native <select>, and the quotation form did the same. On a
   phone that is a scroll wheel with five hundred entries and no way to search it.

   Every query goes to the API with `?q=` and a small `limit`, so the DOM holds a
   handful of rows regardless of how many records exist. Server-side search already
   existed on /customers, /suppliers and /products — no API change was needed.

   Standard combobox semantics: role=combobox with aria-expanded/-controls, a
   listbox of options with aria-selected, and aria-activedescendant tracking the
   highlighted row so a screen reader follows the keyboard.
   --------------------------------------------------------------------------- */
export default function Combobox({
  value,                     // selected id, or ''
  onChange,                  // (id, record) => void
  path,                      // '/customers' | '/suppliers' | '/products'
  params = {},               // extra query params
  label,
  id: idProp,
  placeholder = 'Search…',
  required = false,
  disabled = false,
  limit = 20,
  getLabel = (r) => r?.name || '',
  getHint = () => '',
  emptyHint = 'No matches',
  allowClear = true,
}) {
  const autoId = useId();
  const id = idProp || `cb-${autoId}`;
  const listId = `${id}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Debounced so typing does not fire a request per keystroke.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    enabled: open && !disabled,
    queryKey: ['combobox', path, debounced, limit, params],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api.get(path, { params: { ...params, q: debounced || undefined, limit } });
      // /products answers { items, total }; the others answer a bare array.
      return Array.isArray(res.data) ? res.data : res.data.items || [];
    },
  });

  // Resolve the label for a value chosen elsewhere (an edit form, a restored draft)
  // so the field never shows a bare id.
  useEffect(() => {
    let cancelled = false;
    if (!value) { setSelected(null); return undefined; }
    if (selected && selected._id === value) return undefined;
    api.get(`${path}/${value}`)
      .then((r) => { if (!cancelled) setSelected(r.data?.supplier || r.data?.customer || r.data); })
      .catch(() => { /* a deleted or inaccessible record simply shows as unset */ });
    return () => { cancelled = true; };
  }, [value, path]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => search.data || [], [search.data]);
  useEffect(() => { setActive(0); }, [debounced, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(row) {
    setSelected(row);
    onChange(row?._id || '', row || null);
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (!open && ['ArrowDown', 'Enter'].includes(e.key)) { setOpen(true); e.preventDefault(); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(rows.length - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) choose(rows[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery(''); }
  }

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const display = selected ? getLabel(selected) : '';

  return (
    <div className="relative" ref={rootRef}>
      {label && (
        <label htmlFor={id} className="label">
          {label}{required && <span className="req" aria-hidden>*</span>}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-required={required || undefined}
          aria-activedescendant={open && rows[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          className="input pr-16"
          placeholder={selected ? '' : placeholder}
          // While closed the field shows the selection; typing switches to searching.
          value={open ? query : display}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
        />

        <span className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
          {search.isFetching && open && <Spinner className="w-3.5 h-3.5 text-ink-300" />}
          {allowClear && selected && !disabled && (
            <button
              type="button"
              className="btn-icon text-ink-300 hover:text-ink-700"
              aria-label={`Clear ${label || 'selection'}`}
              onClick={() => { setSelected(null); onChange('', null); setQuery(''); inputRef.current?.focus(); }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
          <button
            type="button" tabIndex={-1} disabled={disabled}
            className="btn-icon text-ink-400"
            aria-label={open ? 'Close list' : 'Open list'}
            onClick={() => { setOpen((o) => !o); inputRef.current?.focus(); }}
          >
            <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </span>
      </div>

      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label || 'Results'}
          className="absolute z-40 mt-1 w-full max-h-64 overflow-y-auto overscroll-contain bg-white rounded-[10px] border border-ink-200 shadow-pop py-1"
        >
          {search.isLoading ? (
            <li className="px-3 py-3 t-meta flex items-center gap-2" role="status"><Spinner className="w-4 h-4" /> Searching…</li>
          ) : search.isError ? (
            <li className="px-3 py-3 text-[13px] text-red-600" role="alert">
              The list could not be loaded.{' '}
              <button type="button" className="underline" onClick={() => search.refetch()}>Try again</button>
            </li>
          ) : rows.length === 0 ? (
            <li className="px-3 py-3 t-meta" role="status">
              {debounced ? `${emptyHint} for “${debounced}”` : emptyHint}
            </li>
          ) : (
            rows.map((row, i) => {
              const isSel = String(row._id) === String(value);
              return (
                <li key={row._id} id={`${id}-opt-${i}`} data-idx={i} role="option" aria-selected={isSel}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(row)}
                    className={`w-full text-left px-3 py-2.5 min-h-[44px] flex items-center gap-2 transition-colors ${
                      i === active ? 'bg-brand-50' : ''
                    } ${isSel ? 'font-medium text-brand-700' : 'text-ink-700'}`}
                  >
                    <span className="min-w-0 flex-1">
                      {/* Long names wrap rather than being cut off. */}
                      <span className="block text-[13px] leading-snug break-words">{getLabel(row)}</span>
                      {getHint(row) && <span className="block t-meta truncate">{getHint(row)}</span>}
                    </span>
                    {isSel && (
                      <svg className="w-4 h-4 shrink-0 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
