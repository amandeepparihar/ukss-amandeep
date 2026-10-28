import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, X } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Form, TextField } from '@/components/forms';
import { UploadImageButton } from '@/components/file-upload/UploadImageButton';
import { useNotifications } from '@/hooks/useNotifications';
import { getApiError } from '@/lib/api';

import {
  useStudent,
  useCreateStudent,
  useUpdateStudent,
  uploadStudentPhoto,
  type StudentPayload,
} from './useStudents';

// letters, spaces and ' . - only, starting with a letter
const lettersOnly = /^[A-Za-z][A-Za-z\s'.-]*$/;

// same rules as the api's createStudentSchema, so errors show before submitting
const studentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Max 100 characters')
    .regex(lettersOnly, 'Letters only'),
  rollNo: z
    .string()
    .trim()
    .min(1, 'Roll no is required')
    .regex(/^[0-9]{1,20}$/, 'Digits only, up to 20'),
  phoneNo: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, 'Enter a 10 digit phone number'),
  country: z
    .string()
    .trim()
    .min(1, 'Country is required')
    .max(50, 'Max 50 characters')
    .regex(lettersOnly, 'Letters only'),
  state: z
    .string()
    .trim()
    .min(1, 'State is required')
    .max(50, 'Max 50 characters')
    .regex(lettersOnly, 'Letters only'),
  city: z
    .string()
    .trim()
    .min(1, 'City is required')
    .max(50, 'Max 50 characters')
    .regex(lettersOnly, 'Letters only'),
});

type StudentFormValues = z.infer<typeof studentFormSchema>;

const FORM_FIELDS = new Set<string>(['name', 'rollNo', 'phoneNo', 'country', 'state', 'city']);

export function StudentFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const { success, error: errorNotify } = useNotifications();

  const { data: student, isLoading: isStudentLoading } = useStudent(id);
  const createStudentMutation = useCreateStudent();
  const updateStudentMutation = useUpdateStudent();

  const [photoKey, setPhotoKey] = useState<string | null | undefined>(undefined);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: {
      name: '',
      rollNo: '',
      phoneNo: '',
      country: '',
      state: '',
      city: '',
    },
  });

  useEffect(() => {
    if (isEdit && student) {
      form.reset({
        name: student.name,
        rollNo: student.rollNo,
        phoneNo: student.phoneNo,
        country: student.country,
        state: student.state,
        city: student.city,
      });
      setPhotoPreview(student.photoUrl);
    }
  }, [isEdit, student, form]);

  const handleRemovePhoto = () => {
    setPhotoKey(null);
    setPhotoPreview(null);
  };

  const onSubmit = async (values: StudentFormValues) => {
    const payload: StudentPayload = {
      name: values.name.trim(),
      rollNo: values.rollNo.trim(),
      phoneNo: values.phoneNo.trim(),
      country: values.country.trim(),
      state: values.state.trim(),
      city: values.city.trim(),
    };

    if (photoKey !== undefined) {
      payload.photoFile = photoKey;
    }

    try {
      if (isEdit && id) {
        await updateStudentMutation.mutateAsync({ id, data: payload });
        success('Student updated successfully');
      } else {
        await createStudentMutation.mutateAsync(payload);
        success('Student created successfully');
      }
      navigate('/students');
    } catch (err) {
      const apiError = getApiError(err);

      if (apiError.code === 'CONFLICT') {
        form.setError('rollNo', { message: apiError.message }, { shouldFocus: true });
        return;
      }

      if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
        const seen = new Set<string>();

        for (const detail of apiError.details) {
          if (!detail.field || !FORM_FIELDS.has(detail.field) || seen.has(detail.field)) continue;
          seen.add(detail.field);
          form.setError(
            detail.field as keyof StudentFormValues,
            { message: detail.message },
            { shouldFocus: seen.size === 1 }
          );
        }

        if (seen.size > 0) return;
      }

      errorNotify(apiError.message);
    }
  };

  const isSubmitting = createStudentMutation.isPending || updateStudentMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? 'Edit Student' : 'Add New Student'}
        description={isEdit ? 'Update student details' : 'Add a student to the library'}
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Students', href: '/students' },
          { label: isEdit ? 'Edit Student' : 'New Student' },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate('/students')}>
            Back to List
          </Button>
        }
      />

      <Card className="max-w-full mx-auto">
        <CardHeader>
          <h2 className="text-xl font-semibold">Student Details</h2>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? 'Update the student and their photo.'
              : 'Enter the student details and add a photo.'}
          </p>
        </CardHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt="Student photo"
                    className="h-24 w-24 rounded-full object-cover border"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border bg-muted">
                    <User className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <UploadImageButton
                    label={photoPreview ? 'Change Photo' : 'Upload Photo'}
                    disabled={isStudentLoading || isSubmitting}
                    onUpload={uploadStudentPhoto}
                    onComplete={(result) => {
                      setPhotoKey(result.storageKey);
                      setPhotoPreview(result.previewUrl);
                    }}
                    onError={errorNotify}
                  />
                  {photoPreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRemovePhoto}
                      disabled={isSubmitting}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or GIF, up to 5MB.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  name="name"
                  label="Name"
                  placeholder="e.g. Amandeep Singh"
                  required
                  disabled={isStudentLoading}
                />
                <TextField
                  name="rollNo"
                  label="Roll No"
                  placeholder="e.g. 34"
                  required
                  disabled={isStudentLoading}
                />
                <TextField
                  name="phoneNo"
                  label="Phone No"
                  type="tel"
                  placeholder="10 digits"
                  required
                  disabled={isStudentLoading}
                />
                <TextField
                  name="country"
                  label="Country"
                  placeholder="e.g. India"
                  required
                  disabled={isStudentLoading}
                />
                <TextField
                  name="state"
                  label="State"
                  placeholder="e.g. Uttar Pradesh"
                  required
                  disabled={isStudentLoading}
                />
                <TextField
                  name="city"
                  label="City"
                  placeholder="e.g. Ghaziabad"
                  required
                  disabled={isStudentLoading}
                />
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-3 border-t pt-6">
              <Button type="button" variant="outline" onClick={() => navigate('/students')}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isStudentLoading}>
                {isEdit ? 'Update Student' : 'Create Student'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
