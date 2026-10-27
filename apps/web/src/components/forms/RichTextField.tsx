import { useFormContext, type FieldPath, type FieldValues } from 'react-hook-form';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from './Form';

interface RichTextFieldProps<TFieldValues extends FieldValues = FieldValues> {
  name: FieldPath<TFieldValues>;
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  minHeight?: string;
  className?: string;
}

export function RichTextField<TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  placeholder,
  description,
  required,
  disabled,
  minHeight = '200px',
  className,
}: RichTextFieldProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label && <FormLabel required={required}>{label}</FormLabel>}
          <FormControl>
            <RichTextEditor
              value={field.value ?? ''}
              onChange={field.onChange}
              placeholder={placeholder}
              disabled={disabled}
              minHeight={minHeight}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
