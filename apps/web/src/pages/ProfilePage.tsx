import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateProfileSchema, type UpdateProfileInput } from '@admin/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Form, TextField } from '@/components/forms';
import { useCurrentUser } from '@/hooks/useAuth';
import { api, getApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TwoFactorSettings } from '@/components/profile';

export function ProfilePage() {
  const { user, isLoading } = useCurrentUser();
  const { setUser } = useAuthStore();
  const queryClient = useQueryClient();

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    values: user ? {
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar || null,
    } : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateProfileInput) => {
      const response = await api.put('/auth/me', data);
      return response.data.data;
    },
    onSuccess: (data) => {
      setUser(data);
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Profile updated successfully');
    },
    onError: (error) => {
      const apiError = getApiError(error);
      toast.error(apiError.message);
    },
  });

  const onSubmit = (data: UpdateProfileInput) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Ticket ID: 164781 - Handle cases where firstName/lastName might be undefined (SSO users)
  const initials = user
    ? `${(user.firstName || user.email || 'U').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase()
    : 'U';

  return (
    <div>
      <PageHeader
        title="Profile"
        description="Manage your account settings"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Profile' },
        ]}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Profile Picture</CardTitle>
            <CardDescription>
              Your profile photo will be visible to other users
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <Avatar className="h-24 w-24 mb-4">
              <AvatarImage src={user?.avatar || undefined} alt={user?.firstName} />
              <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
            </Avatar>
            <Button variant="outline" size="sm">
              Change Photo
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your personal details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField<UpdateProfileInput>
                    name="firstName"
                    label="First Name"
                    required
                  />
                  <TextField<UpdateProfileInput>
                    name="lastName"
                    label="Last Name"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    value={user?.email || ''}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Contact an administrator to change your email
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Input
                    id="role"
                    value={user?.role?.name || ''}
                    disabled
                    className="bg-muted"
                  />
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    type="submit"
                    disabled={!form.formState.isDirty}
                    loading={updateMutation.isPending}
                  >
                    Save Changes
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* Two-Factor Authentication Section */}
      <div className="mt-6">
        <TwoFactorSettings />
      </div>
    </div>
  );
}
