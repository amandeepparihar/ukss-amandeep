/**
 * Tag-style multi-select for fields backed by `product_extra_info_type_options`
 * (e.g. Glove Type, Driver, attribute-grid Product Type). Same visual API as
 * `TypesenseMultiCombobox` so the bottom 3 × 3 attribute grid can render every
 * cell with one template regardless of source. Options come from a static list
 * (the dropdowns payload) and the popover has a built-in search filter — the
 * user asked for search on every dropdown.
 *
 * Pass `max={1}` for legacy single-value attributes and `max={3}` for Color.
 */

import { useMemo, useState } from 'react';
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

interface Option {
  value: string;
  label: string;
}

interface ExtraInfoTagSelectProps {
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  max?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function ExtraInfoTagSelect({
  options,
  values,
  onChange,
  max = 1,
  placeholder = 'Select options',
  className,
  disabled,
}: ExtraInfoTagSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const atCap = values.length >= max;

  function toggle(value: string) {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
      return;
    }
    if (max === 1) {
      onChange([value]);
      setOpen(false);
      return;
    }
    if (!atCap) onChange([...values, value]);
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => {
            const label = options.find((o) => o.value === v)?.label ?? v;
            return (
              <button
                key={v}
                type="button"
                className="text-xs px-2 py-0.5 rounded-full border bg-muted hover:bg-muted/70"
                onClick={() => toggle(v)}
              >
                <span className="opacity-60 mr-1">×</span>
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || (max > 1 && atCap)}
            className="w-full justify-between font-normal"
          >
            <span className="text-muted-foreground">
              {max > 1 && atCap ? `Limit reached (${max})` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => toggle(opt.value)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        values.includes(opt.value) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {opt.label}
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
