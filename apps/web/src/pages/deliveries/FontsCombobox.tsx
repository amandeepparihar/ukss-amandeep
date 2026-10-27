/**
 * FontsCombobox — searchable single-select bound to
 * `GET /api/deliveries/grid/fonts/search`.
 *
 * Mirrors TypesenseCombobox's UX (Popover + Command list) but hits the fonts
 * endpoint instead of the typesense facet proxy. The server returns 50 rows
 * per keystroke so we never dump the full catalogue at once.
 *
 * Free-typing is preserved, but decoupled from search: the search box is
 * internal state and never writes the form value on its own. The value changes
 * only on an explicit pick — a list row, or the "Use …" item shown when the
 * typed query isn't already in the results — so an operator can still save a
 * font name that's not yet in the `fonts` table, while typing to search can no
 * longer clobber an existing assignment on dismiss.
 */

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
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

interface FontsComboboxProps {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function FontsCombobox({
  value,
  onChange,
  placeholder = 'Font name (e.g. Arial Bold)',
  className,
  disabled,
}: FontsComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: options, isLoading } = useQuery<{ font_name: string }[]>({
    queryKey: ['deliveries', 'fonts', 'search', search],
    queryFn: async () => {
      const res = await api.get<{ ok: boolean; data: { font_name: string }[] }>(
        '/deliveries/grid/fonts/search',
        { params: { q: search } }
      );
      return res.data.data ?? [];
    },
    // Keep showing the prior matches while the next request is in flight so
    // the dropdown doesn't flash empty on every keystroke.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: open,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // `search` is internal-only and never written back to the form value
        // except on an explicit pick (a list item or the "Use …" item). On
        // open we seed it from the current value so the user is editing what's
        // actually saved; on close we clear it. Dismissing without picking
        // therefore leaves the saved value untouched — typing to search can no
        // longer clobber an existing assignment.
        setSearch(o ? value : '');
      }}
    >
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
            placeholder="Search fonts…"
            value={search}
            // Search is internal only — it does NOT touch the form value. The
            // value changes solely on an explicit pick below (a list row or the
            // "Use …" free-text item), so free-typing a brand-new font name is
            // still possible without letting an in-progress query overwrite the
            // saved value.
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading…' : 'Type to search.'}
            </CommandEmpty>
            {/* Free-text commit: when the typed query isn't an exact match in
                the results, offer it as an explicit selectable so operators can
                still save a font name that isn't in the `fonts` table. */}
            {search.trim() &&
            !options?.some((o) => o.font_name.toLowerCase() === search.trim().toLowerCase()) ? (
              <CommandGroup>
                <CommandItem
                  value={`__use__${search}`}
                  onSelect={() => {
                    onChange(search.trim());
                    setOpen(false);
                  }}
                >
                  Use &quot;{search.trim()}&quot;
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {options?.map((opt) => (
                <CommandItem
                  key={opt.font_name}
                  value={opt.font_name}
                  onSelect={() => {
                    onChange(opt.font_name);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === opt.font_name ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {opt.font_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
