import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Navigating back to a list no longer re-hits the network for data that is
      // seconds old. Short enough that money on screen stays current, long enough
      // that moving between screens feels instant.
      staleTime: 30 * 1000,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Last-resort boundary: catches failures in the shell itself, including
        anything thrown before a route renders. */}
    <ErrorBoundary scope="app">
      <BrowserRouter>
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <App />
            {/* The toast container is unconstrained by default and rendered as a
                direct child of #root, so on a 320px screen it measured 373px wide
                and extended the page — every screen picked up a horizontal
                scrollbar from an element that is usually invisible. Toasts are
                also capped so a long error message cannot do the same. */}
            <Toaster
              position="top-right"
              containerStyle={{ inset: 12, maxWidth: 'calc(100vw - 24px)' }}
              toastOptions={{ style: { maxWidth: 'calc(100vw - 24px)' } }}
            />
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
