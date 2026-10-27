import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, SwitchField, SelectField } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';

const notificationSettingsSchema = z.object({
  // Email notifications
  emailOnUserCreate: z.boolean().default(true),
  emailOnUserDelete: z.boolean().default(true),
  emailOnLogin: z.boolean().default(false),
  emailOnPasswordChange: z.boolean().default(true),
  // System notifications
  notifyAdminsOnError: z.boolean().default(true),
  notifyOnMaintenance: z.boolean().default(true),
  // Digest settings
  digestFrequency: z.enum(['daily', 'weekly', 'never']),
});

type NotificationSettingsData = z.infer<typeof notificationSettingsSchema>;

const digestOptions = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Never', value: 'never' },
];

export function NotificationSettings() {
  const { success } = useNotifications();

  const form = useForm<NotificationSettingsData>({
    resolver: zodResolver(notificationSettingsSchema),
    defaultValues: {
      emailOnUserCreate: true,
      emailOnUserDelete: true,
      emailOnLogin: false,
      emailOnPasswordChange: true,
      notifyAdminsOnError: true,
      notifyOnMaintenance: true,
      digestFrequency: 'weekly',
    },
  });

  const onSubmit = (data: NotificationSettingsData) => {
    console.log('Notification settings:', data);
    success('Settings Saved', { message: 'Notification settings have been updated' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Settings</CardTitle>
        <CardDescription>
          Configure when and how notifications are sent
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <h4 className="text-sm font-medium mb-4">Email Notifications</h4>
              <div className="space-y-4">
                <SwitchField
                  name="emailOnUserCreate"
                  label="New User Registration"
                  description="Send email when a new user is created"
                />
                <SwitchField
                  name="emailOnUserDelete"
                  label="User Deletion"
                  description="Send email when a user is deleted"
                />
                <SwitchField
                  name="emailOnLogin"
                  label="Login Alerts"
                  description="Send email on new login from unknown device"
                />
                <SwitchField
                  name="emailOnPasswordChange"
                  label="Password Changes"
                  description="Send email when password is changed"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-4">System Notifications</h4>
              <div className="space-y-4">
                <SwitchField
                  name="notifyAdminsOnError"
                  label="Error Alerts"
                  description="Notify admins when system errors occur"
                />
                <SwitchField
                  name="notifyOnMaintenance"
                  label="Maintenance Alerts"
                  description="Notify users about scheduled maintenance"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-4">Digest Settings</h4>
              <div className="max-w-xs">
                <SelectField
                  name="digestFrequency"
                  label="Activity Digest"
                  options={digestOptions}
                  description="How often to send activity summary emails"
                />
              </div>
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button type="submit">Save Changes</Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
