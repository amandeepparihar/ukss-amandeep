import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Refresh token queue — ensures only ONE refresh call happens at a time.
// When multiple requests get 401 concurrently, they all wait for the same
// refresh promise instead of each firing their own (which would fail because
// the server rotates refresh tokens on use).
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = axios
    .post(`${API_URL}/auth/refresh`, {}, { withCredentials: true })
    .then((response) => {
      const { accessToken, user } = response.data.data;
      useAuthStore.getState().setAuth(user, accessToken);
      return accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // If 401 and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();

        // Retry the original request with the new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed — only logout if no other refresh succeeded in the meantime
        if (!useAuthStore.getState().getAccessToken()) {
          useAuthStore.getState().logout();
        }
        return Promise.reject(refreshError);
      }
    }

    // Replace axios's generic "Request failed with status code 400" with the
    // server-provided human-readable error whenever the backend returned a
    // structured `{ ok: false, error, code }` envelope.
    //
    // Without this rewrite every UI toast for a non-2xx response shows the
    // raw axios message — operators see "Request failed with status code 400"
    // instead of the actual reason like "No mapped products found. Map the
    // product first." All deliveries write routes already return this shape
    // (see handleServiceError in deliveries.write.routes and handleError in
    // grid-actions.routes), so callers no longer need to unwrap manually.
    const data = error.response?.data as
      | { ok?: boolean; error?: unknown; code?: unknown }
      | undefined;
    if (data && data.ok === false && typeof data.error === 'string' && data.error) {
      error.message = data.error;
      if (typeof data.code === 'string') {
        (error as AxiosError & { code?: string }).code = data.code;
      }
    }

    return Promise.reject(error);
  }
);

export interface ApiError {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
}

export function getApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error) && error.response?.data?.error) {
    return error.response.data.error;
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'An unexpected error occurred',
  };
}
