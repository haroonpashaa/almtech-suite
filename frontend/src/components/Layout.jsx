import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import clsx from 'clsx';

const sections = [
  {
    title: null,
    items: [{ to: '/', label: 'Dashboard', exact: true, icon: 'home' }],
  },
  {
    title: 'Sales',
    items: [
      { to: '/pos', label: 'New Sale', roles: ['admin', 'sales'], icon: 'cart' },
      { to: '/invoices', label: 'Invoices', icon: 'invoice' },
      { to: '/quotations', label: 'Quotations', icon: 'quote' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/products', label: 'Inventory', icon: 'box' },
      { to: '/purchase-orders', label: 'Purchase Orders', icon: 'truck' },
    ],
  },
  {
    title: 'Contacts',
    items: [
      { to: '/customers', label: 'Customers', icon: 'users' },
      { to: '/suppliers', label: 'Suppliers', icon: 'building' },
    ],
  },
  {
    title: 'Insights',
    items: [{ to: '/reports', label: 'Reports', icon: 'chart' }],
  },
  {
    title: 'Admin',
    items: [
      { to: '/users', label: 'Users', roles: ['admin'], icon: 'shield' },
      { to: '/activity', label: 'Activity', roles: ['admin'], icon: 'clock' },
      { to: '/settings', label: 'Settings', roles: ['admin'], icon: 'cog' },
    ],
  },
];

function Icon({ name, className = 'w-4 h-4' }) {
  const paths = {
    home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-4v-7h-8v7H4a1 1 0 0 1-1-1z',
    cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2m4 18a1 1 0 1 1 0-2 1 1 0 0 1 0 2m12 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2',
    invoice: 'M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h4',
    quote: 'M8 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    box: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
    truck: 'M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4m11 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4',
    users: 'M16 14a4 4 0 1 0-8 0M12 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM2 21v-1a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v1',
    building: 'M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 9h2m4 0h1M9 13h2m4 0h1M10 21v-4h4v4',
    chart: 'M3 21h18M6 17v-7m5 7v-11m5 11v-5m5 5v-9',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-ink-50">
      <aside className="w-64 bg-white border-r border-ink-100 flex flex-col">
        <div className="relative overflow-hidden px-5 py-6 bg-brand-gradient">
          {/* subtle radial highlight to give depth */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/15 pointer-events-none" />
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          <img
            src="/almtech-logo-white.png"
            alt="ALMTech"
            className="relative h-6 object-contain object-left drop-shadow"
            style={{ maxWidth: '180px' }}
          />
          <div className="relative mt-2 text-[10px] tracking-[0.25em] font-semibold uppercase text-white/80">
            Business Suite
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
          {sections.map((section, si) => {
            const visible = section.items.filter((i) => !i.roles || i.roles.includes(user?.role));
            if (!visible.length) return null;
            return (
              <div key={si}>
                {section.title && (
                  <div className="text-[10px] font-semibold text-ink-400 uppercase tracking-wider px-3 mb-1.5">
                    {section.title}
                  </div>
                )}
                {visible.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.exact}
                    className={({ isActive }) =>
                      clsx('nav-link', isActive && 'nav-link-active')
                    }
                  >
                    <Icon name={i.icon} />
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-ink-100 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-gradient text-white text-sm font-semibold flex items-center justify-center">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink-900 truncate">{user?.name}</div>
              <div className="text-xs text-ink-400 capitalize">{user?.role}</div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="mt-3 w-full text-xs text-ink-500 hover:text-ink-900 hover:bg-ink-50 py-1.5 rounded-md transition"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
