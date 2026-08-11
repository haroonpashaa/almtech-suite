import { useEffect } from 'react';

export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'lg' }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={`relative w-full ${widths[size]} mt-[6vh] mb-12 bg-white rounded-2xl border border-ink-100 shadow-pop animate-scale-in`}>
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-ink-100">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {subtitle && <p className="text-sm text-ink-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-icon -mr-2 text-ink-400 hover:text-ink-700 hover:bg-ink-100" aria-label="Close">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-ink-100 bg-ink-25 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}
