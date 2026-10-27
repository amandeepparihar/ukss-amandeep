import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Form, TextField } from '@/components/forms';
import { useNotifications } from '@/hooks/useNotifications';
import { getApiError } from '@/lib/api';

import { useTeam, useNextSort, useNameAvailable, useCreateTeam, useUpdateTeam } from './useTeams';

// sort is kept as a string in the form (that is what the input returns) and converted on submit
const teamFormSchema = z.object({
  teamName: z
    .string()
    .trim()
    .min(1, 'Team name is required')
    .max(55, 'Team name cannot exceed 55 characters')
    .regex(/^[A-Za-z]/, 'Team name must start with a letter'),
  sort: z
    .string()
    .trim()
    .min(1, 'Sort order is required')
    .regex(/^-?\d+$/, 'Sort order must be a whole number')
    // value bounds mirror the API schema so out-of-range input is caught without a round-trip
    .superRefine((value, ctx) => {
      const parsed = Number(value);
      // non-numeric input is already reported by the regex above
      if (!Number.isFinite(parsed)) return;
      if (parsed < -2147483648) {
        ctx.addIssue({ code: 'custom', message: 'Sort order is too small' });
      } else if (parsed > 2147483647) {
        ctx.addIssue({ code: 'custom', message: 'Sort order is too large' });
      }
    }),
});

type TeamFormValues = z.infer<typeof teamFormSchema>;

export function TeamFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const { success, error: errorNotify } = useNotifications();

  const { data: team, isLoading: isTeamLoading } = useTeam(id);
  const { data: nextSortData } = useNextSort(!isEdit);
  const createTeamMutation = useCreateTeam();
  const updateTeamMutation = useUpdateTeam();

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      teamName: '',
      sort: '',
    },
  });

  // populate the form once the team is loaded (edit mode)
  useEffect(() => {
    if (isEdit && team) {
      form.reset({
        teamName: team.teamName || '',
        sort: team.sort != null ? String(team.sort) : '',
      });
    }
  }, [isEdit, team, form]);

  // prefill the suggested sort value (create mode) without clobbering user input
  useEffect(() => {
    if (!isEdit && nextSortData && !form.getValues('sort')) {
      form.setValue('sort', String(nextSortData.nextSort));
    }
  }, [isEdit, nextSortData, form]);

  const teamName = form.watch('teamName');
  const trimmedName = teamName.trim();
  const nameError = form.formState.errors.teamName;

  // skip the availability check while the field is invalid or unchanged from the original name
  const shouldCheckName =
    trimmedName.length > 0 && !nameError && trimmedName !== (team?.teamName ?? '').trim();

  const nameCheck = useNameAvailable(shouldCheckName ? teamName : '', id);
  const isCheckingName = shouldCheckName && nameCheck.isFetching;
  const isNameTaken =
    shouldCheckName &&
    nameCheck.debouncedName === trimmedName &&
    nameCheck.data?.available === false;

  const onSubmit = async (values: TeamFormValues) => {
    const payload = { teamName: values.teamName.trim(), sort: Number(values.sort) };

    try {
      if (isEdit && id) {
        await updateTeamMutation.mutateAsync({ id, data: payload });
        success('Team updated successfully');
      } else {
        await createTeamMutation.mutateAsync(payload);
        success('Team created successfully');
      }
      navigate('/teams');
    } catch (err) {
      const apiError = getApiError(err);

      // duplicate name belongs on the field, not in a toast
      if (apiError.code === 'CONFLICT') {
        form.setError('teamName', { message: apiError.message });
        return;
      }

      // server-side validation errors belong on their fields, same as CONFLICT
      if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
        const formFields = new Set<string>(['teamName', 'sort']);
        const seen = new Set<string>();

        for (const detail of apiError.details) {
          if (!formFields.has(detail.field) || seen.has(detail.field)) continue;
          seen.add(detail.field);
          form.setError(
            detail.field as keyof TeamFormValues,
            { message: detail.message },
            { shouldFocus: seen.size === 1 }
          );
        }

        // nothing matched a rendered field: still tell the user something failed
        if (seen.size > 0) return;
      }

      errorNotify(apiError.message);
    }
  };

  const isSubmitting = createTeamMutation.isPending || updateTeamMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? 'Edit Team' : 'Create New Team'}
        description={isEdit ? 'Update team details' : 'Add a new team'}
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Teams', href: '/teams' },
          { label: isEdit ? 'Edit Team' : 'New Team' },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate('/teams')}>
            Back to List
          </Button>
        }
      />

      <Card className="max-w-full mx-auto">
        <CardHeader>
          <h2 className="text-xl font-semibold">Team Details</h2>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? 'Update the team name and its sort order.'
              : 'Enter the team name and its sort order.'}
          </p>
        </CardHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <TextField
                    name="teamName"
                    label="Team Name"
                    placeholder="e.g. Manchester United"
                    required
                    disabled={isTeamLoading}
                  />
                  {!nameError && isCheckingName && (
                    <p className="text-sm text-muted-foreground">Checking availability…</p>
                  )}
                  {!nameError && !isCheckingName && isNameTaken && (
                    <p className="text-sm font-medium text-destructive">
                      This team name is already taken
                    </p>
                  )}
                </div>

                <TextField
                  name="sort"
                  label="Sort"
                  type="number"
                  placeholder="e.g. 10"
                  required
                  disabled={isTeamLoading}
                />
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-3 border-t pt-6">
              <Button type="button" variant="outline" onClick={() => navigate('/teams')}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isTeamLoading || isNameTaken}>
                {isEdit ? 'Update Team' : 'Create Team'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
