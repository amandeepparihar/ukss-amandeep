import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import axios from 'axios';
import { api, getApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { LoginInput } from '@admin/shared';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export function useAuth() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    user,
    isAuthenticated,
    isLoading,
    hasHydrated,
    setAuth,
    setLoading,
    logout: storeLogout,
    getAccessToken,
  } = useAuthStore();

  // Check auth on mount - but ONLY after zustand has hydrated from localStorage.
  // Uses AbortController so that if the component remounts (e.g. GoogleAuthWrapper
  // tree change, React StrictMode, or navigation) the stale async checkAuth is
  // cancelled and won't modify state after unmount.
  useEffect(() => {
    if (!hasHydrated) return;

    const abortController = new AbortController();
    const signal = abortController.signal;

    const checkAuth = async () => {
      const token = getAccessToken();

      // Ticket ID: 164781 - SSO fallback: try shared session cookie (CakePHP → Node.js)
      // NOTE: Must use GET because SameSite=Lax cookies are not sent with cross-origin POST
      const trySharedSessionLogin = async (): Promise<boolean> => {
        try {
          const response = await axios.get(
            `${API_URL}/auth/shared-session-login`,
            { withCredentials: true, signal }
          );
          if (signal.aborted) return false;
          const { accessToken, user: userData } = response.data.data;
          setAuth(userData, accessToken);
          return true;
        } catch {
          return false;
        }
      };

      if (token) {
        // Token exists in memory, verify it's still valid
        try {
          const response = await api.get('/auth/me', { signal });
          if (signal.aborted) return;
          setAuth(response.data.data, token);
        } catch {
          if (signal.aborted) return;
          storeLogout();
        }
      } else if (isAuthenticated && user) {
        // User in localStorage but no token (page refresh) - try to refresh token
        try {
          const response = await axios.post(
            `${API_URL}/auth/refresh`,
            {},
            { withCredentials: true, signal }
          );
          if (signal.aborted) return;
          const { accessToken, user: userData } = response.data.data;
          setAuth(userData, accessToken);
        } catch {
          if (signal.aborted) return;
          // Refresh failed — try SSO before giving up.
          // This handles the case where a user logged into CakePHP (has
          // shared_admin_session cookie) but has no refresh token yet.
          const ssoSucceeded = await trySharedSessionLogin();
          if (signal.aborted) return;
          if (!ssoSucceeded) {
            storeLogout();
          }
        }
      } else {
        // No localStorage state — try SSO as last resort
        const ssoSucceeded = await trySharedSessionLogin();
        if (signal.aborted) return;
        if (!ssoSucceeded) {
          setLoading(false);
        }
      }
    };

    checkAuth();

    return () => {
      abortController.abort();
    };
  }, [hasHydrated]);

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (data: LoginInput) => {
      const response = await api.post('/auth/login', data);
      return response.data.data;
    },
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      toast.success('Welcome back!');
      navigate('/');
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error(apiError.message);
    },
  });

  // Google login mutation
  const googleLoginMutation = useMutation({
    mutationFn: async (credential: string) => {
      const response = await api.post('/auth/google-login', { credential });
      return response.data.data;
    },
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      toast.success('Welcome back!');
      navigate('/');
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error(apiError.message);
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      await api.post('/auth/logout');
    },
    onSuccess: () => {
      storeLogout();
      queryClient.clear();
      navigate('/login');
    },
    onError: () => {
      // Logout even if API fails
      storeLogout();
      queryClient.clear();
      navigate('/login');
    },
  });

  return {
    user,
    isAuthenticated,
    isLoading,
    login: loginMutation.mutate,
    googleLogin: googleLoginMutation.mutate,
    logout: logoutMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    isGoogleLoggingIn: googleLoginMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
  };
}

export function useCurrentUser() {
  const { user } = useAuthStore();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const response = await api.get('/auth/me');
      return response.data.data;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    user: data || user,
    isLoading,
    refetch,
  };
}

export function usePermission() {
  const { hasPermission, hasAnyPermission } = useAuthStore();

  return {
    can: hasPermission,
    canAny: hasAnyPermission,
  };
}
