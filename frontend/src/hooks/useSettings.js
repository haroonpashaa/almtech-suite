import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// Settings are effectively static for a session, so every screen shares one cached
// query instead of issuing its own request. This replaced 24 independent /settings
// fetches — the data is identical, only the number of round-trips changed.
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

// The overwhelmingly common use: "what currency am I formatting in?"
export function useCurrency() {
  const { data } = useSettings();
  return data?.currency || 'PKR';
}
