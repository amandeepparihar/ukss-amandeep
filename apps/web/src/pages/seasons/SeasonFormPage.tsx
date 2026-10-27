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

import {
  useSeason,
  useNextSort,
  useNameAvailable,
  useCreateSeason,
  useUpdateSeason,
} from './useSeasons';

// sort is kept as a string in the form (that is what the input returns) and converted on submit
const seasonFormSchema = z.object({
  season: z
    .string()
    .trim()
    .min(1, 'Season is required')
    .max(11, 'Season cannot exceed 11 characters')
    .regex(/^\d{4}-\d{4}$/, 'Season must be in the format YYYY-YYYY, e.g. 2023-2024'),
  sort: z
    .string()
    .trim()
    .min(1, 'Sort order is required')
    .regex(/^-?\d+$/, 'Sort order must be a whole number')
    .superRefine((value, ctx) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      if (parsed < -2147483648) {
        ctx.addIssue({ code: 'custom', message: 'Sort order is too small' });
      } else if (parsed > 2147483647) {
        ctx.addIssue({ code: 'custom', message: 'Sort order is too large' });
      }
    }),
});

type SeasonFormValues = z.infer<typeof seasonFormSchema>;

export function SeasonFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const { success, error: errorNotify } = useNotifications();

  const { data: season, isLoading: isSeasonLoading } = useSeason(id);
  const { data: nextSortData } = useNextSort(!isEdit);
  const createSeasonMutation = useCreateSeason();
  const updateSeasonMutation = useUpdateSeason();

  const form = useForm<SeasonFormValues>({
    resolver: zodResolver(seasonFormSchema),
    defaultValues: {
      season: '',
      sort: '',
    },
  });

  // populate the form once the season is loaded (edit mode)
  useEffect(() => {
    if (isEdit && season) {
      form.reset({
        season: season.season || '',
        sort: season.sort != null ? String(season.sort) : '',
      });
    }
  }, [isEdit, season, form]);

  // prefill the suggested sort value (create mode) without clobbering user input
  useEffect(() => {
    if (!isEdit && nextSortData && !form.getValues('sort')) {
      form.setValue('sort', String(nextSortData.nextSort));
    }
  }, [isEdit, nextSortData, form]);

  const seasonName = form.watch('season');
  const trimmedName = seasonName.trim();
  const nameError = form.formState.errors.season;

  // skip the availability check while the field is invalid or unchanged from the original name
  const shouldCheckName =
    trimmedName.length > 0 && !nameError && trimmedName !== (season?.season ?? '').trim();

  const nameCheck = useNameAvailable(shouldCheckName ? seasonName : '', id);
  const isCheckingName = shouldCheckName && nameCheck.isFetching;
  const isNameTaken =
    shouldCheckName &&
    nameCheck.debouncedName === trimmedName &&
    nameCheck.data?.available === false;

  const onSubmit = async (values: SeasonFormValues) => {
    const payload = { season: values.season.trim(), sort: Number(values.sort) };

    try {
      if (isEdit && id) {
        await updateSeasonMutation.mutateAsync({ id, data: payload });
        success('Season updated successfully');
      } else {
        await createSeasonMutation.mutateAsync(payload);
        success('Season created successfully');
      }
      navigate('/seasons');
    } catch (err) {
      const apiError = getApiError(err);

      // duplicate name belongs on the field, not in a toast
      if (apiError.code === 'CONFLICT') {
        form.setError('season', { message: apiError.message });
        return;
      }

      // server-side validation errors belong on their fields, same as CONFLICT
      if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
        const formFields = new Set<string>(['season', 'sort']);
        const seen = new Set<string>();

        for (const detail of apiError.details) {
          if (!formFields.has(detail.field) || seen.has(detail.field)) continue;
          seen.add(detail.field);
          form.setError(
            detail.field as keyof SeasonFormValues,
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

  const isSubmitting = createSeasonMutation.isPending || updateSeasonMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? 'Edit Season' : 'Create New Season'}
        description={isEdit ? 'Update season details' : 'Add a new season'}
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Seasons', href: '/seasons' },
          { label: isEdit ? 'Edit Season' : 'New Season' },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate('/seasons')}>
            Back to List
          </Button>
        }
      />

      <Card className="max-w-full mx-auto">
        <CardHeader>
          <h2 className="text-xl font-semibold">Season Details</h2>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? 'Update the season and its sort order.'
              : 'Enter the season and its sort order.'}
          </p>
        </CardHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <TextField
                    name="season"
                    label="Season"
                    placeholder="e.g. 2023-2024"
                    description="Format: YYYY-YYYY, e.g. 2023-2024"
                    required
                    disabled={isSeasonLoading}
                  />
                  {!nameError && isCheckingName && (
                    <p className="text-sm text-muted-foreground">Checking availability…</p>
                  )}
                  {!nameError && !isCheckingName && isNameTaken && (
                    <p className="text-sm font-medium text-destructive">
                      This season is already taken
                    </p>
                  )}
                </div>

                <TextField
                  name="sort"
                  label="Sort"
                  type="number"
                  placeholder="e.g. 10"
                  required
                  disabled={isSeasonLoading}
                />
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-3 border-t pt-6">
              <Button type="button" variant="outline" onClick={() => navigate('/seasons')}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isSeasonLoading || isNameTaken}>
                {isEdit ? 'Update Season' : 'Create Season'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
