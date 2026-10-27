import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Monitor, Smartphone, Tablet, Trash2, Shield, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api, getApiError } from '@/lib/api';

interface TrustedDevice {
  id: string;
  fingerprint: string;
  name: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  lastUsedAt: string;
  createdAt: string;
}

interface CurrentDevice {
  fingerprint: string;
  info: {
    browser: string;
    os: string;
    deviceType: string;
  };
}

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case 'mobile':
      return <Smartphone className="h-8 w-8" />;
    case 'tablet':
      return <Tablet className="h-8 w-8" />;
    default:
      return <Monitor className="h-8 w-8" />;
  }
}

export function TrustedDevicesPage() {
  const queryClient = useQueryClient();
  const [deviceToRemove, setDeviceToRemove] = useState<TrustedDevice | null>(null);

  const { data: currentDevice } = useQuery<{ data: CurrentDevice }>({
    queryKey: ['currentDevice'],
    queryFn: async () => {
      const response = await api.get('/auth/devices/current');
      return response.data;
    },
  });

  const { data: devicesData, isLoading } = useQuery<{ data: TrustedDevice[] }>({
    queryKey: ['trustedDevices'],
    queryFn: async () => {
      const response = await api.get('/auth/devices');
      return response.data;
    },
  });

  const devices = devicesData?.data || [];
  const currentFingerprint = currentDevice?.data.fingerprint;
  const isCurrentDeviceTrusted = devices.some((d) => d.fingerprint === currentFingerprint);

  const trustDeviceMutation = useMutation({
    mutationFn: async () => {
      await api.post('/auth/devices/trust', {
        name: `${currentDevice?.data.info.browser} on ${currentDevice?.data.info.os}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trustedDevices'] });
      toast.success('Device trusted successfully');
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error(apiError.message);
    },
  });

  const removeDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      await api.delete(`/auth/devices/${deviceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trustedDevices'] });
      toast.success('Device removed successfully');
      setDeviceToRemove(null);
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error(apiError.message);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Trusted Devices"
        description="Manage devices that can access your account"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Security', href: '/security' },
          { label: 'Trusted Devices' },
        ]}
      />

      <div className="space-y-6">
        {!isCurrentDeviceTrusted && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Current Device Not Trusted
              </CardTitle>
              <CardDescription className="text-blue-900 dark:text-blue-100">
                This device is not in your list of trusted devices.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => trustDeviceMutation.mutate()}
                loading={trustDeviceMutation.isPending}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Trust This Device
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your Trusted Devices</CardTitle>
            <CardDescription>
              These devices are trusted and won't trigger login notifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            {devices.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No trusted devices yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {devices.map((device) => {
                  const isCurrentDevice = device.fingerprint === currentFingerprint;
                  return (
                    <div
                      key={device.id}
                      className="flex items-start gap-4 p-4 rounded-lg border bg-card"
                    >
                      <div className="mt-1 text-muted-foreground">
                        {getDeviceIcon(device.deviceType)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{device.name || 'Unknown Device'}</h3>
                          {isCurrentDevice && (
                            <Badge variant="secondary">Current Device</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {device.browser && device.os && (
                            <p>{device.browser} on {device.os}</p>
                          )}
                          <p>Last used {format(new Date(device.lastUsedAt), 'PPp')}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeviceToRemove(device)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!deviceToRemove}
        onOpenChange={(open) => !open && setDeviceToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Trusted Device?</AlertDialogTitle>
            <AlertDialogDescription>
              This device will no longer be recognized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deviceToRemove && removeDeviceMutation.mutate(deviceToRemove.id)}
            >
              Remove Device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
