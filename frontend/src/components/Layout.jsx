import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import CommandPalette from './CommandPalette.jsx';
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
    items: [{ to: '/customers', label: 'Customers', icon: 'users' }],
  },
  {
    title: 'Finance',
    items: [
      { to: '/deals', label: 'Transactions', roles: ['admin'], icon: 'ledgerList' },
      { to: '/accounts', label: 'Accounts', roles: ['admin'], icon: 'wallet' },
      { to: '/receivables', label: 'Receivables', roles: ['admin'], icon: 'receivable' },
      { to: '/payables', label: 'Payables', roles: ['admin'], icon: 'payable' },
      { to: '/expenses', label: 'Expenses', roles: ['admin'], icon: 'receipt' },
      { to: '/expense-reports', label: 'Expense Reports', roles: ['admin'], icon: 'chart' },
      { to: '/reports', label: 'Reports', icon: 'chart' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/users', label: 'Users', roles: ['admin'], icon: 'shield' },
      { to: '/activity', label: 'Activity', roles: ['admin'], icon: 'clock' },
      { to: '/data', label: 'Import / Export', roles: ['admin'], icon: 'exchange' },
      { to: '/settings', label: 'Settings', roles: ['admin'], icon: 'cog' },
    ],
  },
];

const paths = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-4v-7h-8v7H4a1 1 0 0 1-1-1z',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2m4 18a1 1 0 1 1 0-2 1 1 0 0 1 0 2m12 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2',
  invoice: 'M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h4',
  quote: 'M8 5h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  box: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
  truck: 'M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4m11 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4',
  users: 'M16 14a4 4 0 1 0-8 0M12 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM2 21v-1a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v1',
  ledgerList: 'M3 6h18M3 12h18M3 18h12M17 15l3 3-3 3',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h3v-4z',
  receivable: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  payable: 'M3 7h18M3 12h18M3 17h18',
  receipt: 'M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h4',
  chart: 'M3 21h18M6 17v-7m5 7v-11m5 11v-5m5 5v-9',
  exchange: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

function Icon({ name, className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={paths[name] || paths.home} />
    </svg>
  );
}

function SidebarContent({ user, onNavigate }) {
  return (
    <>
      <div className="relative overflow-hidden px-5 py-6 bg-brand-gradient">
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
                <div className="section-title px-3 mb-1.5">{section.title}</div>
              )}
              <div className="space-y-0.5">
                {visible.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.exact}
                    onClick={onNavigate}
                    className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
                  >
                    <Icon name={i.icon} />
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-ink-100">
        <div className="text-[11px] text-ink-400 flex items-center gap-1.5">
          <span className="dot bg-emerald-500" />
          All systems operational
        </div>
      </div>
    </>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // ⌘K / Ctrl+K opens the command palette
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the user menu on outside click
  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const commands = sections.flatMap((s) =>
    s.items
      .filter((i) => !i.roles || i.roles.includes(user?.role))
      .map((i) => ({
        to: i.to,
        label: i.label,
        section: s.title || 'General',
        icon: <Icon name={i.icon} className="w-4 h-4" />,
        keywords: [i.label.toLowerCase()],
      }))
  );

  function signOut() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex bg-app">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-white border-r border-ink-100 flex-col sticky top-0 h-screen">
        <SidebarContent user={user} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white border-r border-ink-100 flex flex-col animate-fade-up">
            <SidebarContent user={user} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-14 bg-white/80 backdrop-blur-md border-b border-ink-100 flex items-center gap-3 px-4 sm:px-6">
          <button
            className="lg:hidden btn-icon text-ink-500 hover:bg-ink-100 -ml-1"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className="group flex items-center gap-2 h-9 pl-3 pr-2 rounded-lg border border-ink-200 bg-white text-ink-400 hover:border-ink-300 hover:text-ink-500 transition w-full max-w-xs shadow-xs"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <span className="text-[13px] flex-1 text-left">Search…</span>
            <span className="hidden sm:flex items-center gap-0.5">
              <span className="kbd">⌘</span><span className="kbd">K</span>
            </span>
          </button>

          <div className="flex-1" />

          <a
            href="https://github.com/haroonpashaa/almtech-suite"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex btn-icon text-ink-400 hover:text-ink-700 hover:bg-ink-100"
            aria-label="Help"
            title="Help & docs"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.2" /><path d="M12 17h.01" /></svg>
          </a>

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-lg hover:bg-ink-100 transition"
            >
              <div className="w-8 h-8 rounded-full bg-brand-gradient text-white text-sm font-semibold flex items-center justify-center shadow-soft">
                {user?.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden md:block text-left leading-tight">
                <div className="text-[13px] font-medium text-ink-900 truncate max-w-[120px]">{user?.name}</div>
                <div className="text-[11px] text-ink-400 capitalize">{user?.role}</div>
              </div>
              <svg className="hidden md:block w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 menu">
                <div className="px-2.5 py-2 mb-1 border-b border-ink-100">
                  <div className="text-sm font-medium text-ink-900 truncate">{user?.name}</div>
                  <div className="text-xs text-ink-400 truncate">{user?.email}</div>
                </div>
                <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/settings'); }}>
                  <Icon name="cog" className="w-4 h-4 text-ink-400" /> Settings
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); navigate('/activity'); }}>
                  <Icon name="clock" className="w-4 h-4 text-ink-400" /> Activity
                </button>
                <div className="my-1 divider" />
                <button className="menu-item text-red-600 hover:bg-red-50 hover:text-red-700" onClick={signOut}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
