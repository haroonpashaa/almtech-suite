import { Link } from 'react-router-dom';

export default function PageHeader({ title, subtitle, actions, breadcrumb, icon }) {
  return (
    <div className="px-6 sm:px-8 pt-7 pb-1">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1.5 text-[13px] text-ink-400 mb-2">
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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex items-center gap-3.5">
          {icon && (
            <div className="hidden sm:flex w-11 h-11 rounded-xl bg-brand-gradient-br text-white items-center justify-center shadow-lift shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold text-ink-900 tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-ink-500 mt-1">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
