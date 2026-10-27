import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, TextField, SwitchField, SelectField } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

const securitySettingsSchema = z.object({
  // Password policy
  minPasswordLength: z.string().min(1),
  requireUppercase: z.boolean().default(true),
  requireNumbers: z.boolean().default(true),
  requireSpecialChars: z.boolean().default(false),
  // Session settings
  sessionTimeout: z.string().min(1),
  maxConcurrentSessions: z.string().min(1),
  // 2FA settings
  require2FA: z.boolean().default(false),
  allowed2FAMethods: z.enum(['authenticator', 'email', 'both']),
  // Login security
  maxLoginAttempts: z.string().min(1),
  lockoutDuration: z.string().min(1),
});

type SecuritySettingsData = z.infer<typeof securitySettingsSchema>;

// Transform API data (security.minPasswordLength) to form data (minPasswordLength)
function apiToForm(data: Record<string, any>): Partial<SecuritySettingsData> {
  return {
    minPasswordLength: data['security.minPasswordLength'] || '8',
    requireUppercase: data['security.requireUppercase'] ?? true,
    requireNumbers: data['security.requireNumbers'] ?? true,
    requireSpecialChars: data['security.requireSpecialChars'] ?? false,
    sessionTimeout: data['security.sessionTimeout'] || '60',
    maxConcurrentSessions: data['security.maxConcurrentSessions'] || '5',
    require2FA: data['security.require2FA'] ?? false,
    allowed2FAMethods: data['security.allowed2FAMethods'] || 'both',
    maxLoginAttempts: data['security.maxLoginAttempts'] || '5',
    lockoutDuration: data['security.lockoutDuration'] || '15',
  };
}

// Transform form data to API data
function formToApi(data: SecuritySettingsData): Record<string, any> {
  return {
    'security.minPasswordLength': data.minPasswordLength,
    'security.requireUppercase': data.requireUppercase,
    'security.requireNumbers': data.requireNumbers,
    'security.requireSpecialChars': data.requireSpecialChars,
    'security.sessionTimeout': data.sessionTimeout,
    'security.maxConcurrentSessions': data.maxConcurrentSessions,
    'security.require2FA': data.require2FA,
    'security.allowed2FAMethods': data.allowed2FAMethods,
    'security.maxLoginAttempts': data.maxLoginAttempts,
    'security.lockoutDuration': data.lockoutDuration,
  };
}

const sessionTimeoutOptions = [
  { label: '15 minutes', value: '15' },
  { label: '30 minutes', value: '30' },
  { label: '1 hour', value: '60' },
  { label: '4 hours', value: '240' },
  { label: '8 hours', value: '480' },
  { label: '24 hours', value: '1440' },
];

const twoFAOptions = [
  { label: 'Authenticator App Only', value: 'authenticator' },
  { label: 'Email Only', value: 'email' },
  { label: 'Both', value: 'both' },
];

export function SecuritySettings() {
  const { success, error } = useNotifications();
  const queryClient = useQueryClient();

  const form = useForm<SecuritySettingsData>({
    resolver: zodResolver(securitySettingsSchema),
    defaultValues: {
      minPasswordLength: '8',
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
      sessionTimeout: '60',
      maxConcurrentSessions: '5',
      require2FA: false,
      allowed2FAMethods: 'both',
      maxLoginAttempts: '5',
      lockoutDuration: '15',
    },
  });

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: async () => {
      const res = await api.get('/settings/category/security');
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
    mutationFn: async (data: SecuritySettingsData) => {
      const apiData = formToApi(data);
      const res = await api.put('/settings/category/security', apiData);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'security'] });
      success('Settings Saved', { message: 'Security settings have been updated' });
    },
    onError: (err: any) => {
      error('Save Failed', { message: err.response?.data?.error?.message || 'Failed to save settings' });
    },
  });

  const onSubmit = (data: SecuritySettingsData) => {
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
            <CardTitle>Security Settings</CardTitle>
            <CardDescription>
              Configure password policies, session management, and authentication settings
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['settings', 'security'] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <h4 className="text-sm font-medium mb-4">Password Policy</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  name="minPasswordLength"
                  label="Minimum Password Length"
                  type="number"
                  placeholder="8"
                />
              </div>
              <div className="mt-4 space-y-4">
                <SwitchField
                  name="requireUppercase"
                  label="Require Uppercase Letters"
                  description="Password must contain at least one uppercase letter"
                />
                <SwitchField
                  name="requireNumbers"
                  label="Require Numbers"
                  description="Password must contain at least one number"
                />
                <SwitchField
                  name="requireSpecialChars"
                  label="Require Special Characters"
                  description="Password must contain at least one special character"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-4">Session Management</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  name="sessionTimeout"
                  label="Session Timeout"
                  options={sessionTimeoutOptions}
                  description="Time until inactive sessions expire"
                />
                <TextField
                  name="maxConcurrentSessions"
                  label="Max Concurrent Sessions"
                  type="number"
                  placeholder="5"
                  description="Maximum active sessions per user"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-4">Two-Factor Authentication</h4>
              <div className="space-y-4">
                <SwitchField
                  name="require2FA"
                  label="Require 2FA for All Users"
                  description="All users must enable two-factor authentication"
                />
                <div className="max-w-xs">
                  <SelectField
                    name="allowed2FAMethods"
                    label="Allowed 2FA Methods"
                    options={twoFAOptions}
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-4">Login Security</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  name="maxLoginAttempts"
                  label="Max Login Attempts"
                  type="number"
                  placeholder="5"
                  description="Failed attempts before lockout"
                />
                <TextField
                  name="lockoutDuration"
                  label="Lockout Duration (minutes)"
                  type="number"
                  placeholder="15"
                  description="Time user is locked out after max attempts"
                />
              </div>
            </div>

            <div className="flex justify-end border-t pt-4">
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
