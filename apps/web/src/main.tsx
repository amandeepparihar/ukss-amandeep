import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { api } from './lib/api';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Prefetches Google OAuth config into the query cache so LoginPage can
 * read it synchronously. Does NOT wrap children with GoogleOAuthProvider —
 * that's done locally in LoginPage to avoid remounting the entire App tree
 * when the config query resolves (which caused useAuth race conditions).
 */
function GoogleConfigPrefetch({ children }: { children: React.ReactNode }) {
  useQuery({
    queryKey: ['google-config'],
    queryFn: async () => {
      const response = await api.get('/auth/google-config');
      return response.data.data as { clientId: string | null };
    },
    staleTime: Infinity,
    retry: false,
  });

  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ConfirmProvider>
              <GoogleConfigPrefetch>
                <App />
              </GoogleConfigPrefetch>
              <Toaster position="top-right" richColors />
            </ConfirmProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>
);
