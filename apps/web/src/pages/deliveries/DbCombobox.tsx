/**
 * DbCombobox — searchable single-select bound to a static `{id, name}[]` list.
 *
 * Same UX as TypesenseCombobox (popover + searchable command palette) but the
 * options come from the form's `dropdowns` payload (DB-backed) instead of a
 * Typesense facet. Used by the legacy-replica product form for fields whose
 * source-of-truth is the DB list (Manufacturer, Team Category, Product Type,
 * etc.) — the legacy SMS form populates these from DB tables directly, so
 * Typesense facets can lag or omit values, breaking pre-fill.
 *
 * Stores the selected option's `name` in parent state (not the id) to keep
 * symmetry with how other CreateEditProductFormPage fields work (the page
 * resolves names → ids at submit time).
 *
 * Long lists (Team Category has ~1032 rows, Manufacturer ~186) are clipped to
 * `defaultLimit` rows until the user starts typing; search filters across the
 * full list. A short `…` hint row tells the user more matches exist when the
 * displayed slice is incomplete.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
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

interface DbComboboxProps {
  options: Array<{ id: number | string; name: string }>;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /** Soft cap on rows shown when the popover opens or the search box is empty.
   *  When the user types, the full list is filtered and the cap is re-applied
   *  to the match set so long facets stay scroll-friendly. */
  defaultLimit?: number;
  /** Debounce window in ms for the search input. Keeps re-renders cheap on
   *  large local lists; matches the "user types and stops" UX the user asked
   *  for so we don't flicker the result list on every keystroke. */
  searchDebounceMs?: number;
  /** Show a spinner in the trigger and disable opening while the parent is
   *  resolving a value to pre-select (e.g. a team-based default category).
   *  Distinct from `disabled` so callers can express "busy" without making
   *  the field look permanently disabled. */
  loading?: boolean;
  /** Optional text shown in the trigger while `loading` is true. Defaults to
   *  the regular placeholder. Use this to be explicit about WHY the user is
   *  waiting (e.g. "Loading category…"). */
  loadingText?: string;
}

export function DbCombobox({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className,
  disabled,
  allowClear = true,
  defaultLimit = 9,
  searchDebounceMs = 200,
  loading = false,
  loadingText,
}: DbComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), searchDebounceMs);
    return () => clearTimeout(t);
  }, [search, searchDebounceMs]);

  const { display, totalMatches } = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => o.name.toLowerCase().includes(q))
      : options;
    return {
      display: matches.slice(0, defaultLimit),
      totalMatches: matches.length,
    };
  }, [options, debouncedSearch, defaultLimit]);

  const hiddenCount = totalMatches - display.length;

  // While `loading` is true we force the popover closed and swap the chevron
  // for a spinner so the user gets a clear cue that the field is in flight.
  return (
    <Popover open={loading ? false : open} onOpenChange={(o) => !loading && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-busy={loading}
          className={cn('w-full justify-between font-normal', className)}
          disabled={disabled || loading}
        >
          <span
            className={cn(
              'truncate',
              !value && 'text-muted-foreground',
              loading && 'text-muted-foreground italic'
            )}
          >
            {loading ? (loadingText ?? placeholder) : value || placeholder}
          </span>
          {loading ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-70" />
          ) : (
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type to search…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {allowClear && value ? (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  <span className="text-muted-foreground italic">Clear selection</span>
                </CommandItem>
              ) : null}
              {display.map((opt) => (
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
              {hiddenCount > 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground italic select-none">
                  +{hiddenCount} more — type to filter
                </div>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// DbMultiCombobox — searchable multi-select bound to a `{id, name}[]` list.
//
// Stores the selected ids (as `number[]`) directly — sub-categories are the
// only consumer right now and the form already stores `category_menu` as
// `number[]`, so id-typed values avoid name↔id resolution churn.
//
// Visual: same popover+command as DbCombobox, but with checkmarks on every
// row and a chip strip above the trigger showing the current selection (each
// chip is clickable to remove). Matches the legacy `<select multiple>` UX
// (PMS 116626) where users can toggle categories and see a comma-joined
// summary; the chip strip is the dropdown-friendly equivalent of that.
// ---------------------------------------------------------------------------

interface DbMultiComboboxProps {
  options: Array<{ id: number; name: string }>;
  values: number[];
  onChange: (values: number[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Soft cap on rows shown when search box is empty. */
  defaultLimit?: number;
  searchDebounceMs?: number;
  /** Hard cap on number of selections. Legacy sub-categories were capped at
   *  4 (controller PMS 116626); pass `max={4}` to enforce that. */
  max?: number;
}

export function DbMultiCombobox({
  options,
  values,
  onChange,
  placeholder = 'Select…',
  className,
  disabled,
  defaultLimit = 9,
  searchDebounceMs = 200,
  max,
}: DbMultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), searchDebounceMs);
    return () => clearTimeout(t);
  }, [search, searchDebounceMs]);

  const selectedOptions = useMemo(() => {
    // Preserve user's selection order: walk `values`, look up each in options.
    const byId = new Map(options.map((o) => [o.id, o] as const));
    return values
      .map((id) => byId.get(id))
      .filter((o): o is { id: number; name: string } => !!o);
  }, [options, values]);

  const { display, totalMatches } = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => o.name.toLowerCase().includes(q))
      : options;
    return {
      display: matches.slice(0, defaultLimit),
      totalMatches: matches.length,
    };
  }, [options, debouncedSearch, defaultLimit]);

  const hiddenCount = totalMatches - display.length;
  const atCap = max != null && values.length >= max;

  function toggle(id: number) {
    if (values.includes(id)) {
      onChange(values.filter((v) => v !== id));
    } else if (!atCap) {
      onChange([...values, id]);
    }
  }

  const triggerLabel =
    selectedOptions.length === 0
      ? placeholder
      : selectedOptions.length <= 2
        ? selectedOptions.map((o) => o.name).join(', ')
        : `${selectedOptions.length} selected`;

  return (
    <div className={cn('space-y-1.5', className)}>
      {selectedOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selectedOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              className="text-xs px-2 py-0.5 rounded-full border bg-muted hover:bg-muted/70"
              onClick={() => toggle(o.id)}
              disabled={disabled}
            >
              <span className="opacity-60 mr-1">×</span>
              {o.name}
            </button>
          ))}
        </div>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            disabled={disabled}
          >
            <span
              className={cn(
                'truncate',
                selectedOptions.length === 0 && 'text-muted-foreground'
              )}
            >
              {triggerLabel}
              {atCap ? ` (max ${max})` : ''}
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
              placeholder="Type to search…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                {display.map((opt) => {
                  const selected = values.includes(opt.id);
                  // Allow deselect even at cap; only block fresh selections.
                  const itemDisabled = !selected && atCap;
                  return (
                    <CommandItem
                      key={opt.id}
                      value={opt.name}
                      onSelect={() => {
                        if (itemDisabled) return;
                        toggle(opt.id);
                      }}
                      className={cn(itemDisabled && 'opacity-50')}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          selected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {opt.name}
                    </CommandItem>
                  );
                })}
                {hiddenCount > 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground italic select-none">
                    +{hiddenCount} more — type to filter
                  </div>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
