import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@admin/shared';

// In-memory token storage (not persisted to localStorage for security)
let inMemoryAccessToken: string | null = null;

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasHydrated: boolean;
  setAuth: (user: AuthUser, accessToken: string) => void;
  setUser: (user: AuthUser) => void;
  setLoading: (loading: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
  logout: () => void;
  getAccessToken: () => string | null;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      hasHydrated: false,

      setAuth: (user, accessToken) => {
        // Store token in memory only (not in state/localStorage)
        inMemoryAccessToken = accessToken;
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      },

      setUser: (user) => {
        set({ user });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setHasHydrated: (hydrated) => {
        set({ hasHydrated: hydrated });
      },

      logout: () => {
        // Clear in-memory token
        inMemoryAccessToken = null;
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },

      getAccessToken: () => {
        return inMemoryAccessToken;
      },

      hasPermission: (permission) => {
        const { user } = get();
        if (!user) return false;
        return user.permissions.includes(permission);
      },

      hasAnyPermission: (permissions) => {
        const { user } = get();
        if (!user) return false;
        return permissions.some((p) => user.permissions.includes(p));
      },
    }),
    {
      name: 'auth-storage',
      // Only persist user info, NOT the access token (security fix)
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Called after rehydration is complete
        state?.setHasHydrated(true);
      },
    }
  )
);
