/**
 * TypesenseCombobox — searchable single-select bound to GET /api/products/typesense/:key.
 *
 * Mirrors the staging /products/new pattern in
 * apps/web/src/pages/products/components/ProductDetailsTab.tsx so dropdown
 * values stay consistent with what the Dify workflow validates against.
 *
 * The endpoint returns `{ data: Array<{id: string; name: string}> }` — strings
 * only. Numeric DB IDs are resolved at submit time by the parent against the
 * `useProductFormLoad` dropdown payload (see CreateEditProductFormPage).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

export interface TypesenseOption {
  id: string;
  name: string;
}

interface TypesenseComboboxProps {
  /** Typesense facet key — `brand`, `team`, `season`, `color`, `sleeve-length`,
   *  `size-guide`, `age-group`, `gender`, or `manufacturer`. */
  facetKey: string;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TypesenseCombobox({
  facetKey,
  value,
  onChange,
  placeholder = 'Select…',
  className,
  disabled,
}: TypesenseComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: options, isLoading } = useQuery<TypesenseOption[]>({
    queryKey: ['products', 'typesense', facetKey, search],
    queryFn: async () => {
      const res = await api.get<{ data: TypesenseOption[] }>(
        `/products/typesense/${facetKey}`,
        { params: { search } }
      );
      return res.data.data;
    },
    staleTime: 60_000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
          disabled={disabled}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading…' : 'No results.'}
            </CommandEmpty>
            <CommandGroup>
              {options?.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={opt.name}
                  onSelect={() => {
                    onChange(opt.name);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === opt.name ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {opt.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface TypesenseMultiComboboxProps {
  facetKey: string;
  values: string[];
  onChange: (names: string[]) => void;
  /** Optional cap — e.g. Colors is capped at 3 in legacy SMS. */
  maxSelected?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TypesenseMultiCombobox({
  facetKey,
  values,
  onChange,
  maxSelected,
  placeholder = 'Add…',
  className,
  disabled,
}: TypesenseMultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: options, isLoading } = useQuery<TypesenseOption[]>({
    queryKey: ['products', 'typesense', facetKey, search],
    queryFn: async () => {
      const res = await api.get<{ data: TypesenseOption[] }>(
        `/products/typesense/${facetKey}`,
        { params: { search } }
      );
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const atCap = maxSelected != null && values.length >= maxSelected;
  const singleSelect = maxSelected === 1;

  function selectOption(name: string) {
    // Single-select (e.g. Sleeve Length, Gender) mirrors the Product Type
    // DbCombobox: replace the value and close the popover on select.
    if (singleSelect) {
      onChange([name]);
      setOpen(false);
      return;
    }
    if (values.includes(name)) {
      onChange(values.filter((v) => v !== name));
    } else if (!atCap) {
      onChange([...values, name]);
    }
  }

  function remove(name: string) {
    onChange(values.filter((v) => v !== name));
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <button
              key={v}
              type="button"
              className="text-xs px-2 py-0.5 rounded-full border bg-muted hover:bg-muted/70"
              onClick={() => remove(v)}
            >
              {v} <span className="ml-1 opacity-60">×</span>
            </button>
          ))}
        </div>
      ) : null}
      {/*
        Single-select REPLACES its value, so it is never "at cap" for the
        purpose of disabling the trigger — disabling it would lock the user into
        their first pick (the selectOption replace path becomes unreachable).
        Only multi-select disables on cap.
      */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || (atCap && !singleSelect)}
            className="w-full justify-between font-normal"
          >
            <span className="text-muted-foreground">
              {atCap && !singleSelect ? `Limit reached (${maxSelected})` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? 'Loading…' : 'No results.'}
              </CommandEmpty>
              <CommandGroup>
                {options?.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={opt.name}
                    onSelect={() => selectOption(opt.name)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        values.includes(opt.name) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {opt.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
