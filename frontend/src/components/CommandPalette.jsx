import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// A lightweight, real command palette: fuzzy-filter the nav destinations and
// jump to them. Opens on ⌘K / Ctrl+K, navigable by keyboard.
export default function CommandPalette({ open, onClose, commands }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.section?.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.includes(q))
    );
  }, [query, commands]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  function run(cmd) {
    if (!cmd) return;
    navigate(cmd.to);
    onClose();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4">
      <div
        className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl bg-white rounded-2xl border border-ink-100 shadow-pop animate-scale-in overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-ink-100">
          <svg className="w-4.5 h-4.5 text-ink-300 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages and actions…"
            className="flex-1 py-3.5 text-sm bg-transparent outline-none placeholder:text-ink-300"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-ink-400">No matches</div>
          ) : (
            results.map((c, i) => (
              <button
                key={c.to}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition ${
                  i === active ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-50'
                }`}
              >
                <span
                  className={`shrink-0 ${i === active ? 'text-brand-600' : 'text-ink-400'}`}
                >
                  {c.icon}
                </span>
                <span className="flex-1 text-sm font-medium">{c.label}</span>
                {c.section && (
                  <span className="text-[11px] text-ink-400">{c.section}</span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-ink-100 bg-ink-25 text-[11px] text-ink-400">
          <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
          <span className="flex items-center gap-1"><span className="kbd">↵</span> open</span>
        </div>
      </div>
    </div>
  );
}
