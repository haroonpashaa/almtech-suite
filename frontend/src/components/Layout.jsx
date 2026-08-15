import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import CommandPalette from './CommandPalette.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { documentTitleFor } from '../lib/pageTitle.js';
import clsx from 'clsx';

// Navigation mirrors how the business actually operates rather than how the code is
// organised: what you sell, what you buy, who you deal with, what you hold, and the
// money behind all of it. Role filtering is unchanged — items simply moved groups.
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
    title: 'Purchasing',
    items: [
      { to: '/purchase-orders', label: 'Purchase Orders', icon: 'truck' },
      // Sales never raises a purchase order, so it has no reason to browse suppliers.
      { to: '/suppliers', label: 'Suppliers', roles: ['admin', 'stock'], icon: 'warehouse' },
    ],
  },
  {
    title: 'Customers',
    items: [{ to: '/customers', label: 'Customers', icon: 'users' }],
  },
  {
    title: 'Inventory',
    items: [{ to: '/products', label: 'Products', icon: 'box' }],
  },
  {
    title: 'Finance',
    items: [
      { to: '/accounts', label: 'Accounts', roles: ['admin'], icon: 'wallet' },
      { to: '/deals', label: 'Transactions', roles: ['admin'], icon: 'ledgerList' },
      { to: '/expenses', label: 'Expenses', roles: ['admin', 'sales'], icon: 'receipt' },
      { to: '/receivables', label: 'Receivables', roles: ['admin'], icon: 'receivable' },
      { to: '/payables', label: 'Payables', roles: ['admin'], icon: 'payable' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/reports', label: 'Reports', icon: 'chart' },
      { to: '/expense-reports', label: 'Expense Reports', roles: ['admin', 'sales'], icon: 'chartBar' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/data', label: 'Import / Export', roles: ['admin', 'sales'], icon: 'exchange' },
      { to: '/users', label: 'Users', roles: ['admin'], icon: 'shield' },
      { to: '/activity', label: 'Activity', roles: ['admin'], icon: 'clock' },
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
  warehouse: 'M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 9h2m4 0h1M9 13h2m4 0h1M10 21v-4h4v4',
  ledgerList: 'M3 6h18M3 12h18M3 18h12M17 15l3 3-3 3',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h3v-4z',
  receivable: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  payable: 'M3 7h18M3 12h18M3 17h18',
  receipt: 'M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h4',
  chart: 'M3 21h18M6 17v-7m5 7v-11m5 11v-5m5 5v-9',
  chartBar: 'M4 20h16M7 20v-6M12 20V8M17 20v-9',
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

function SidebarContent({ user, onNavigate, collapsed = false }) {
  return (
    <>
      {/* The brand mark is the one place the gradient survives — it is identity,
          not an action, so it reads as a logotype rather than a call to action. */}
      <div className={`relative overflow-hidden bg-brand-gradient ${collapsed ? 'px-3 py-4' : 'px-5 py-5'}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/15 pointer-events-none" />
        {collapsed ? (
          <div className="relative w-8 h-8 rounded-md bg-white/15 text-white font-semibold text-sm flex items-center justify-center">A</div>
        ) : (
          <>
            <img
              src="/almtech-logo-white.png"
              alt="ALMTech"
              className="relative h-5 object-contain object-left"
              style={{ maxWidth: '170px' }}
            />
            <div className="relative mt-1.5 text-[9.5px] tracking-[0.22em] font-semibold uppercase text-white/70">
              Business Suite
            </div>
          </>
        )}
      </div>
      <nav aria-label="Main" className={`flex-1 overflow-y-auto py-3 space-y-4 ${collapsed ? 'px-2' : 'px-2.5'}`}>
        {sections.map((section, si) => {
          const visible = section.items.filter((i) => !i.roles || i.roles.includes(user?.role));
          if (!visible.length) return null;
          return (
            <div key={si}>
              {section.title && !collapsed && <div className="nav-group">{section.title}</div>}
              {section.title && collapsed && <div className="mx-2 my-2 divider" />}
              <div className="space-y-0.5">
                {visible.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.exact}
                    onClick={onNavigate}
                    title={collapsed ? i.label : undefined}
                    className={({ isActive }) =>
                      clsx('nav-link group', collapsed && 'justify-center px-0', isActive && 'nav-link-active')
                    }
                  >
                    <Icon name={i.icon} />
                    {!collapsed && <span className="truncate">{i.label}</span>}
                    {collapsed && <span className="tip">{i.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="px-4 py-2.5 border-t border-ink-100">
          <div className="t-meta flex items-center gap-1.5">
            <span className="dot bg-emerald-500" />
            All systems operational
          </div>
        </div>
      )}
    </>
  );
}

// The user menu offers only what this role can actually open. Previously it
// listed Settings and Activity to everyone, but both routes are admin-only, so a
// sales user clicking either was bounced to the dashboard with no explanation.
const MENU_ITEMS = [
  { to: '/settings', label: 'Settings', icon: 'cog', roles: ['admin'] },
  { to: '/activity', label: 'Activity', icon: 'clock', roles: ['admin'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Persisted so the operator's chosen density survives a reload.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');
  useEffect(() => { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); }, [collapsed]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const drawerRef = useRef(null);

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

  // Each screen gets its own browser-tab title, so tabs, history and screen-reader
  // page announcements are distinguishable.
  useEffect(() => {
    document.title = documentTitleFor(pathname);
  }, [pathname]);

  // The mobile drawer is a dialog, so it behaves like one: Escape closes it, the
  // page behind it does not scroll, and focus is kept inside while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const panel = drawerRef.current;
    const prevOverflow = document.body.style.overflow;
    const restore = document.activeElement;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])') || []
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      restore?.focus?.();
    };
  }, [drawerOpen]);

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
      {/* First stop for a keyboard user: jump past the whole navigation tree. */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex shrink-0 bg-white border-r border-ink-100 flex-col sticky top-0 h-screen transition-[width] duration-200 ease-smooth ${
          collapsed ? 'w-[60px]' : 'w-60'
        }`}
      >
        <SidebarContent user={user} collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="hidden lg:flex items-center justify-center h-9 border-t border-ink-100 text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className={`w-4 h-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" onClick={() => setDrawerOpen(false)} />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute left-0 top-0 h-full w-[270px] bg-white border-r border-ink-100 flex flex-col animate-fade-up"
          >
            <SidebarContent user={user} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-14 bg-white/85 backdrop-blur border-b border-ink-100 flex items-center gap-3 px-3 sm:px-5">
          <button
            className="lg:hidden btn-icon text-ink-500 hover:bg-ink-100 -ml-1"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className="group flex items-center gap-2 h-9 pl-3 pr-2 rounded-md border border-ink-200 bg-white text-ink-400 hover:border-ink-300 hover:text-ink-600 transition w-full max-w-xs"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <span className="text-[13px] flex-1 text-left">Search or jump to…</span>
            <span className="hidden sm:flex items-center gap-0.5">
              <span className="kbd">⌘</span><span className="kbd">K</span>
            </span>
          </button>

          <div className="flex-1" />

          {/* A "Help & docs" button used to sit here pointing at the project's GitHub
              repository. On a client installation that is the wrong destination — the
              repository is not theirs and may not even be readable to them, so the
              button led to a GitHub sign-in page. The user guide in docs/USER_GUIDE.md
              is not published anywhere yet; when it is, restore a link to it here. */}

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-lg hover:bg-ink-100 transition"
            >
              <div className="w-8 h-8 rounded-full bg-brand-700 text-white text-sm font-semibold flex items-center justify-center">
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
                {MENU_ITEMS.filter((m) => !m.roles || m.roles.includes(user?.role)).map((m) => (
                  <button key={m.to} className="menu-item" onClick={() => { setMenuOpen(false); navigate(m.to); }}>
                    <Icon name={m.icon} className="w-4 h-4 text-ink-400" /> {m.label}
                  </button>
                ))}
                <div className="my-1 divider" />
                <button className="menu-item text-red-600 hover:bg-red-50 hover:text-red-700" onClick={signOut}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Route-level boundary: when one screen fails, the sidebar, topbar and
            navigation survive so the operator can carry on somewhere else. The
            reset key clears a stuck error as soon as they navigate away. */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
