import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, TextField, SwitchField } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

const generalSettingsSchema = z.object({
  siteName: z.string().min(1, 'Site name is required'),
  siteDescription: z.string().optional(),
  maintenanceMode: z.boolean().default(false),
  debugMode: z.boolean().default(false),
});

type GeneralSettingsData = z.infer<typeof generalSettingsSchema>;

// Transform API data (general.siteName) to form data (siteName)
function apiToForm(data: Record<string, any>): Partial<GeneralSettingsData> {
  return {
    siteName: data['general.siteName'] || 'Admin Panel',
    siteDescription: data['general.siteDescription'] || 'A modern admin panel for your application',
    maintenanceMode: data['general.maintenanceMode'] ?? false,
    debugMode: data['general.debugMode'] ?? false,
  };
}

// Transform form data to API data
function formToApi(data: GeneralSettingsData): Record<string, any> {
  return {
    'general.siteName': data.siteName,
    'general.siteDescription': data.siteDescription,
    'general.maintenanceMode': data.maintenanceMode,
    'general.debugMode': data.debugMode,
  };
}

export function GeneralSettings() {
  const { success, error } = useNotifications();
  const queryClient = useQueryClient();

  const form = useForm<GeneralSettingsData>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: {
      siteName: 'Admin Panel',
      siteDescription: 'A modern admin panel for your application',
      maintenanceMode: false,
      debugMode: false,
    },
  });

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', 'general'],
    queryFn: async () => {
      const res = await api.get('/settings/category/general');
      return res.data.data;
    },
  });

  // Update form when settings are loaded
  useEffect(() => {
    if (settings && Object.keys(settings).length > 0) {
      const formData = apiToForm(settings);
      form.reset(formData);
    }
  }, [settings, form]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: GeneralSettingsData) => {
      const apiData = formToApi(data);
      const res = await api.put('/settings/category/general', apiData);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'general'] });
      success('Settings Saved', { message: 'General settings have been updated' });
    },
    onError: (err: any) => {
      error('Save Failed', { message: err.response?.data?.error?.message || 'Failed to save settings' });
    },
  });

  const onSubmit = (data: GeneralSettingsData) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading settings...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>
              Configure basic application settings
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['settings', 'general'] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                name="siteName"
                label="Site Name"
                placeholder="My Admin Panel"
                description="The name displayed in the header and title"
                required
              />
              <TextField
                name="siteDescription"
                label="Site Description"
                placeholder="A brief description of your site"
              />
            </div>

            <div className="space-y-4">
              <SwitchField
                name="maintenanceMode"
                label="Maintenance Mode"
                description="When enabled, only admins can access the site"
              />
              <SwitchField
                name="debugMode"
                label="Debug Mode"
                description="Enable detailed error messages and logging"
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
