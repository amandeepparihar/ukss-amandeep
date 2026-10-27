import { toast } from 'sonner';
import { useNotificationStore, NotificationType } from '@/stores/notificationStore';

interface NotifyOptions {
  title: string;
  message?: string;
  type?: NotificationType;
  duration?: number;
  link?: string;
  persist?: boolean;
  metadata?: Record<string, unknown>;
}

export function useNotifications() {
  const { addNotification } = useNotificationStore();

  const notify = ({
    title,
    message = '',
    type = 'info',
    duration = 4000,
    link,
    persist = false,
    metadata,
  }: NotifyOptions) => {
    // Show toast notification
    const toastOptions = {
      duration,
      description: message || undefined,
    };

    switch (type) {
      case 'success':
        toast.success(title, toastOptions);
        break;
      case 'error':
        toast.error(title, toastOptions);
        break;
      case 'warning':
        toast.warning(title, toastOptions);
        break;
      case 'info':
      default:
        toast.info(title, toastOptions);
    }

    // Persist to notification center if requested
    if (persist) {
      addNotification({
        title,
        message,
        type,
        link,
        metadata,
      });
    }
  };

  const success = (title: string, options?: Omit<NotifyOptions, 'title' | 'type'>) => {
    notify({ title, type: 'success', ...options });
  };

  const error = (title: string, options?: Omit<NotifyOptions, 'title' | 'type'>) => {
    notify({ title, type: 'error', ...options });
  };

  const warning = (title: string, options?: Omit<NotifyOptions, 'title' | 'type'>) => {
    notify({ title, type: 'warning', ...options });
  };

  const info = (title: string, options?: Omit<NotifyOptions, 'title' | 'type'>) => {
    notify({ title, type: 'info', ...options });
  };

  // Helper to show API errors
  const apiError = (err: unknown, fallbackMessage = 'An error occurred') => {
    const message = err instanceof Error ? err.message : fallbackMessage;
    error(message);
  };

  return {
    notify,
    success,
    error,
    warning,
    info,
    apiError,
    // Direct store access
    addNotification,
  };
}
