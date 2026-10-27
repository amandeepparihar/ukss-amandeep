import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Info, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';
  dismissable: boolean;
  priority: number;
}

const typeConfig = {
  INFO: {
    icon: Info,
    bgClass: 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-800 dark:text-blue-200',
    iconClass: 'text-blue-500',
  },
  WARNING: {
    icon: AlertTriangle,
    bgClass: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800',
    textClass: 'text-yellow-800 dark:text-yellow-200',
    iconClass: 'text-yellow-500',
  },
  SUCCESS: {
    icon: CheckCircle,
    bgClass: 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800',
    textClass: 'text-green-800 dark:text-green-200',
    iconClass: 'text-green-500',
  },
  ERROR: {
    icon: XCircle,
    bgClass: 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800',
    textClass: 'text-red-800 dark:text-red-200',
    iconClass: 'text-red-500',
  },
};

export function AnnouncementBanner() {
  const queryClient = useQueryClient();

  const { data: announcements = [] } = useQuery({
    queryKey: ['active-announcements'],
    queryFn: async () => {
      const response = await api.get('/announcements/active');
      return response.data.data as Announcement[];
    },
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/announcements/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-announcements'] });
    },
  });

  if (announcements.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {announcements.map((announcement) => {
        const config = typeConfig[announcement.type];
        const Icon = config.icon;

        return (
          <div
            key={announcement.id}
            className={cn(
              'flex items-center gap-3 px-4 py-2 border-b',
              config.bgClass
            )}
          >
            <Icon className={cn('h-5 w-5 flex-shrink-0', config.iconClass)} />
            <div className={cn('flex-1 min-w-0', config.textClass)}>
              <span className="font-medium">{announcement.title}</span>
              {announcement.content && (
                <span className="ml-2 text-sm opacity-90">{announcement.content}</span>
              )}
            </div>
            {announcement.dismissable && (
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-6 w-6 p-0 flex-shrink-0', config.textClass)}
                onClick={() => dismissMutation.mutate(announcement.id)}
                disabled={dismissMutation.isPending}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Dismiss</span>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
