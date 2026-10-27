import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import FontForm, { FontFormValues } from './component/FontForm';
import { useCreateFont, useUpdateFont, useFontById } from './useFonts';

const createSchema = z.object({

  fontName: z.string().trim().min(1, 'Font name is required').max(50, 'Max 50 characters'),
  fontDescription: z.string().trim().min(1, 'Font description is required').max(1000, 'Max 1000 characters'),
  textCase: z.string().min(1, 'Text case is required'),
  fontStyle: z.string().min(1, 'Font style is required'),
  fontZipFile: z.instanceof(File, { message: 'ZIP file is required', }).refine((file) => file.name.toLowerCase().endsWith('.zip'),
    {
      message:
        'Only .zip files are allowed',
    }
  ).refine((file) =>
    [
      'application/zip',
      'application/x-zip-compressed',
    ].includes(file.type),
    {
      message:
        'Invalid ZIP file type',
    }
  ),
});

const updateSchema = z.object({
  fontName: z.string().min(1, 'Font name is required').max(50, 'Max 50 characters'),
  fontDescription: z.string().min(1, 'Font Description is required').max(1000, 'Max 100 characters'),
  textCase: z.string().min(1, 'Text case is required'),
  fontStyle: z.string().min(1, 'Font style is required'),
  fontZipFile: z.instanceof(File).refine((file) => !file || file.name.toLowerCase().endsWith('.zip'), { message: 'Only .zip files are allowed', }).refine(
    (file) =>
      !file ||
      [
        'application/zip',
        'application/x-zip-compressed',
      ].includes(file.type),
    {
      message: 'Invalid ZIP file type',
    }
  )
    .nullable()
    .optional(),
});

export function FontFormPage() {

  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const createFontMutation = useCreateFont();
  const updateFontMutation = useUpdateFont();
  const { data: fontData, isLoading: isFontLoading } = useFontById(Number(id));

  const form = useForm<FontFormValues>({
    resolver: zodResolver(isEdit ? updateSchema : createSchema),

    defaultValues: {
      fontName: '',
      fontDescription: '',
      textCase: '',
      fontStyle: '',
      fontZipFile: null,
    },
  });

  useEffect(() => {
    if (fontData && isEdit) {
      form.reset({
        fontName: fontData.fontName || '',
        fontDescription: fontData.fontDescription || '',
        textCase: fontData.textCase || '',
        fontStyle: fontData.fontStyle || '',
        fontZipFile: null,
      });
    }
  }, [fontData, isEdit, form]);

  const onSubmit = async (values: FontFormValues) => {

    const formData = new FormData();
    formData.append('fontName', values.fontName);
    formData.append('fontDescription', values.fontDescription || '');
    formData.append('textCase', values.textCase);
    formData.append('fontStyle', values.fontStyle);

    if (values.fontZipFile) {
      formData.append('fontZipFile', values.fontZipFile);
    }

    if (isEdit && id) {
      updateFontMutation.mutate({ id: Number(id), data: formData });
      updateFontMutation.isSuccess
    } else {
      createFontMutation.mutate(formData);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          isEdit
            ? 'Edit Font'
            : 'Create New Font'
        }
        description={
          isEdit
            ? 'Update font configuration'
            : 'Add a new font configuration'
        }
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Fonts', href: '/fonts' },
          {
            label:
              isEdit
                ? 'Edit Font'
                : 'New Font'
          },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate('/fonts')} >
            Back to List
          </Button>
        }
      />

      <Card className="max-w-full mx-auto">
        <CardHeader>
          <h2 className="text-xl font-semibold">
            {
              isEdit ? 'Edit Font' : 'Font Details'
            }
          </h2>

          <p className="text-sm text-muted-foreground">
            {
              isEdit
                ? 'Update font details and optionally upload a new ZIP file.'
                : 'Configure font details and upload the font ZIP package.'
            }
          </p>

        </CardHeader>

        <FontForm
          form={form}
          onSubmit={onSubmit}
          formType={isEdit ? 'Update Font' : 'Create Font'}
          isEdit={isEdit}
          isLoading={
            isFontLoading || createFontMutation.isPending || updateFontMutation.isPending
          }
          currentZipFile={fontData?.fontImage1}
        />

      </Card>

    </div>
  );
}