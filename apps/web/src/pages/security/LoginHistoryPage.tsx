import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Monitor,
  Smartphone,
  Tablet,
  MapPin,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { DataTable, useDataTable } from '@/components/data-table';
import { api } from '@/lib/api';

interface LoginHistoryItem {
  id: string;
  ipAddress: string;
  location: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  isTrusted: boolean;
  success: boolean;
  createdAt: string;
}

interface LoginHistoryResponse {
  data: LoginHistoryItem[];
  total: number;
}

function getDeviceIcon(deviceType: string | null, className?: string) {
  switch (deviceType?.toLowerCase()) {
    case 'mobile':
      return <Smartphone className={className} />;
    case 'tablet':
      return <Tablet className={className} />;
    default:
      return <Monitor className={className} />;
  }
}

export function LoginHistoryPage() {
  const { data: historyData, isLoading } = useQuery<{ data: LoginHistoryResponse }>({
    queryKey: ['loginHistory'],
    queryFn: async () => {
      const response = await api.get('/auth/login-history', {
        params: { limit: 100 },
      });
      return response.data;
    },
  });

  const history = historyData?.data.data || [];

  const columns = useMemo<ColumnDef<LoginHistoryItem>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Date & Time',
        cell: ({ row }) => (
          <div className="font-medium">
            {format(new Date(row.original.createdAt), 'PPp')}
          </div>
        ),
      },
      {
        accessorKey: 'device',
        header: 'Device',
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex items-center gap-2">
              {getDeviceIcon(item.deviceType, 'h-4 w-4')}
              <div>
                <div className="font-medium">{item.browser || 'Unknown'}</div>
                <div className="text-xs text-muted-foreground">{item.os || 'Unknown'}</div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'location',
        header: 'Location',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <MapPin className="h-3 w-3" />
            <span className="text-sm">{row.original.location || 'Unknown'}</span>
          </div>
        ),
      },
      {
        accessorKey: 'ipAddress',
        header: 'IP Address',
        cell: ({ row }) => (
          <code className="text-xs">{row.original.ipAddress}</code>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const item = row.original;
          if (!item.success) {
            return (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Failed
              </Badge>
            );
          }
          if (!item.isTrusted) {
            return (
              <Badge variant="secondary">
                <AlertTriangle className="h-3 w-3 mr-1" />
                New Device
              </Badge>
            );
          }
          return (
            <Badge variant="outline">
              <CheckCircle className="h-3 w-3 mr-1" />
              Trusted
            </Badge>
          );
        },
      },
    ],
    []
  );

  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
  } = useDataTable({ pageSize: 20, enableUrlSync: false });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const stats = {
    total: history.length,
    successful: history.filter((h) => h.success).length,
    failed: history.filter((h) => !h.success).length,
    newDevices: history.filter((h) => h.success && !h.isTrusted).length,
  };

  return (
    <div>
      <PageHeader
        title="Login History"
        description="View your recent login activity"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Security', href: '/security' },
          { label: 'Login History' },
        ]}
      />

      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Logins</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Successful</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.successful}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.failed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">New Devices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.newDevices}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Login Activity</CardTitle>
            <CardDescription>
              Recent login attempts for your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={history}
              pagination={pagination}
              onPaginationChange={setPagination}
              sorting={sorting}
              onSortingChange={setSorting}
              pageCount={Math.ceil(history.length / pagination.pageSize)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
