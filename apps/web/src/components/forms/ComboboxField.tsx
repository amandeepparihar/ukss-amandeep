import { useState, useCallback, useEffect } from 'react';
import { useFormContext, type FieldPath, type FieldValues } from 'react-hook-form';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from './Form';

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxFieldProps<TFieldValues extends FieldValues = FieldValues> {
  name: FieldPath<TFieldValues>;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
  // Static options
  options?: ComboboxOption[];
  // Async options
  fetchOptions?: (search: string) => Promise<ComboboxOption[]>;
  // Debounce delay for search (ms)
  debounceMs?: number;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function ComboboxField<TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search...',
  description,
  required,
  disabled,
  className,
  emptyMessage = 'No results found.',
  options: staticOptions,
  fetchOptions,
  debounceMs = 300,
}: ComboboxFieldProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>(staticOptions || []);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedSearchQuery = useDebounce(searchQuery, debounceMs);

  // Fetch options when the popover opens or search query changes
  const loadOptions = useCallback(async (search: string) => {
    if (!fetchOptions) return;

    setIsLoading(true);
    try {
      const results = await fetchOptions(search);
      setOptions(results);
    } catch (error) {
      console.error('Failed to fetch options:', error);
      setOptions([]);
    } finally {
      setIsLoading(false);
    }
  }, [fetchOptions]);

  // Load initial options when popover opens
  useEffect(() => {
    if (open && fetchOptions) {
      loadOptions('');
    }
  }, [open, fetchOptions, loadOptions]);

  // Search as user types (debounced)
  useEffect(() => {
    if (open && fetchOptions && debouncedSearchQuery !== '') {
      loadOptions(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery, open, fetchOptions, loadOptions]);

  // Use static options if no fetchOptions provided
  useEffect(() => {
    if (staticOptions && !fetchOptions) {
      setOptions(staticOptions);
    }
  }, [staticOptions, fetchOptions]);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const selectedOption = options.find((opt) => opt.value === field.value);

        return (
          <FormItem className={cn('flex flex-col', className)}>
            {label && <FormLabel required={required}>{label}</FormLabel>}
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <FormControl>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                      'w-full justify-between font-normal',
                      !field.value && 'text-muted-foreground'
                    )}
                  >
                    {selectedOption?.label || placeholder}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </FormControl>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={!fetchOptions}>
                  <CommandInput
                    placeholder={searchPlaceholder}
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                  />
                  <CommandList>
                    {isLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                      </div>
                    ) : (
                      <>
                        <CommandEmpty>{emptyMessage}</CommandEmpty>
                        <CommandGroup>
                          {options.map((option) => (
                            <CommandItem
                              key={option.value}
                              value={option.value}
                              disabled={option.disabled}
                              onSelect={() => {
                                field.onChange(option.value);
                                setOpen(false);
                                setSearchQuery('');
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  field.value === option.value ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              {option.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
