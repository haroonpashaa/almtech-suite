import { Link } from 'react-router-dom';

export default function PageHeader({ title, subtitle, actions, breadcrumb, icon }) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-1">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-ink-400 mb-2">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-300">/</span>}
              {b.to ? (
                <Link to={b.to} className="hover:text-ink-700 transition">{b.label}</Link>
              ) : (
                <span className="text-ink-600">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex items-center gap-3.5">
          {icon && (
            <div className="hidden sm:flex w-10 h-10 rounded-md bg-brand-50 text-brand-700 items-center justify-center shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="t-page">{title}</h1>
            {subtitle && <p className="t-sub mt-1">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">{actions}</div>}
      </div>
    </div>
  );
}
