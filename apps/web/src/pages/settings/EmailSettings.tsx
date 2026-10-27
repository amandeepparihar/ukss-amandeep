import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, TextField, SelectField, SwitchField } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { Loader2, Send, CheckCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

const emailSettingsSchema = z.object({
  provider: z.enum(['smtp', 'sendgrid', 'mailgun', 'ses']),
  fromEmail: z.string().email('Please enter a valid email'),
  fromName: z.string().min(1, 'From name is required'),
  smtpHost: z.string().optional(),
  smtpPort: z.string().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpSecure: z.boolean().default(true),
  apiKey: z.string().optional(),
});

type EmailSettingsData = z.infer<typeof emailSettingsSchema>;

const providerOptions = [
  { label: 'SMTP', value: 'smtp' },
  { label: 'SendGrid', value: 'sendgrid' },
  { label: 'Mailgun', value: 'mailgun' },
  { label: 'Amazon SES', value: 'ses' },
];

// Transform API data (email.provider) to form data (provider)
function apiToForm(data: Record<string, any>): Partial<EmailSettingsData> {
  return {
    provider: data['email.provider'] || 'smtp',
    fromEmail: data['email.fromEmail'] || '',
    fromName: data['email.fromName'] || 'Admin Panel',
    smtpHost: data['email.smtpHost'] || '',
    smtpPort: data['email.smtpPort'] || '587',
    smtpUser: data['email.smtpUser'] || '',
    smtpPassword: data['email.smtpPassword'] || '',
    smtpSecure: data['email.smtpSecure'] ?? true,
    apiKey: data['email.apiKey'] || '',
  };
}

// Transform form data to API data
function formToApi(data: EmailSettingsData): Record<string, any> {
  return {
    'email.provider': data.provider,
    'email.fromEmail': data.fromEmail,
    'email.fromName': data.fromName,
    'email.smtpHost': data.smtpHost,
    'email.smtpPort': data.smtpPort,
    'email.smtpUser': data.smtpUser,
    'email.smtpPassword': data.smtpPassword,
    'email.smtpSecure': data.smtpSecure,
    'email.apiKey': data.apiKey,
  };
}

export function EmailSettings() {
  const { success, error } = useNotifications();
  const queryClient = useQueryClient();
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  const form = useForm<EmailSettingsData>({
    resolver: zodResolver(emailSettingsSchema),
    defaultValues: {
      provider: 'smtp',
      fromEmail: '',
      fromName: 'Admin Panel',
      smtpHost: '',
      smtpPort: '587',
      smtpUser: '',
      smtpPassword: '',
      smtpSecure: true,
      apiKey: '',
    },
  });

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', 'email'],
    queryFn: async () => {
      const res = await api.get('/settings/category/email');
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
    mutationFn: async (data: EmailSettingsData) => {
      const apiData = formToApi(data);
      const res = await api.put('/settings/category/email', apiData);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'email'] });
      success('Settings Saved', { message: 'Email settings have been updated' });
    },
    onError: (err: any) => {
      error('Save Failed', { message: err.response?.data?.error?.message || 'Failed to save settings' });
    },
  });

  const provider = form.watch('provider');

  const onSubmit = (data: EmailSettingsData) => {
    saveMutation.mutate(data);
  };

  const handleTestEmail = async () => {
    const toEmail = form.getValues('fromEmail');
    if (!toEmail) {
      error('Error', { message: 'Please enter a From Email address first' });
      return;
    }

    setIsTesting(true);
    setTestSuccess(false);
    try {
      const response = await api.post('/email/send-test', {
        to: toEmail,
        subject: 'Test Email from Admin Panel',
        message: 'This is a test email to verify your email configuration.',
      });

      if (response.data.success) {
        setTestSuccess(true);
        success('Test Email Sent', { message: `Check ${toEmail} for the test email` });
      } else {
        error('Test Failed', { message: response.data.message || 'Failed to send test email' });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send test email. Please check your settings.';
      error('Test Failed', { message: errorMsg });
    } finally {
      setIsTesting(false);
    }
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
            <CardTitle>Email Settings</CardTitle>
            <CardDescription>
              Configure email delivery settings for notifications and system emails
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['settings', 'email'] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                name="provider"
                label="Email Provider"
                options={providerOptions}
                description="Select your email delivery service"
                required
              />
              <TextField
                name="fromEmail"
                label="From Email"
                type="email"
                placeholder="noreply@example.com"
                required
              />
              <TextField
                name="fromName"
                label="From Name"
                placeholder="Admin Panel"
                required
              />
            </div>

            {provider === 'smtp' && (
              <>
                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-4">SMTP Configuration</h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      name="smtpHost"
                      label="SMTP Host"
                      placeholder="smtp.example.com"
                    />
                    <TextField
                      name="smtpPort"
                      label="SMTP Port"
                      placeholder="587"
                    />
                    <TextField
                      name="smtpUser"
                      label="SMTP Username"
                      placeholder="username"
                    />
                    <TextField
                      name="smtpPassword"
                      label="SMTP Password"
                      type="password"
                      placeholder="password"
                    />
                  </div>
                  <div className="mt-4">
                    <SwitchField
                      name="smtpSecure"
                      label="Use TLS/SSL"
                      description="Enable secure connection (recommended)"
                    />
                  </div>
                </div>
              </>
            )}

            {provider !== 'smtp' && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-4">{providerOptions.find(p => p.value === provider)?.label} Configuration</h4>
                <TextField
                  name="apiKey"
                  label="API Key"
                  type="password"
                  placeholder="Enter your API key"
                  description={`Enter your ${providerOptions.find(p => p.value === provider)?.label} API key`}
                />
              </div>
            )}

            <div className="flex justify-between border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestEmail}
                disabled={isTesting}
              >
                {isTesting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : testSuccess ? (
                  <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isTesting ? 'Sending...' : testSuccess ? 'Test Sent!' : 'Send Test Email'}
              </Button>
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
