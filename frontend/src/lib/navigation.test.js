import { describe, expect, it } from 'vitest';
import { navigationSections, visibleNavigationSections } from './navigation.js';

const visibleItems = (role) => visibleNavigationSections(role).flatMap((section) => section.items);

describe('sidebar navigation', () => {
  it('adds Deal Accounts as a separate Admin-only top-level item and preserves Transactions', () => {
    const dealAccounts = navigationSections.find((section) => section.items.some((item) => item.to === '/deal-accounts'));
    expect(dealAccounts?.title).toBeNull();
    expect(dealAccounts?.items).toContainEqual(expect.objectContaining({
      to: '/deal-accounts', label: 'Deal Accounts', roles: ['admin'],
    }));

    const finance = navigationSections.find((section) => section.title === 'Finance');
    expect(finance?.items).toContainEqual(expect.objectContaining({ to: '/deals', label: 'Transactions' }));
  });

  it('shows Deal Accounts to Admin and hides it from Sales and Stock', () => {
    expect(visibleItems('admin').some((item) => item.to === '/deal-accounts')).toBe(true);
    expect(visibleItems('sales').some((item) => item.to === '/deal-accounts')).toBe(false);
    expect(visibleItems('stock').some((item) => item.to === '/deal-accounts')).toBe(false);
  });
});
