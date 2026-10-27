/**
 * AttributeDropdown — Reusable single-select dropdown for product attributes.
 *
 * Features:
 * - Fetches options from API on mount
 * - Case-insensitive matching for AI-suggested values
 * - Warning indicator when AI value doesn't match any option
 * - Loading and error states
 * - Configurable label and value field extraction
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle, ChevronDown, Check, Loader2, Search } from 'lucide-react';
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
import { api, getApiError } from '@/lib/api';

interface OptionItem {
  id: string;
  label: string;
}

interface AttributeDropdownProps {
  /** API endpoint to fetch options from (e.g., '/products/colors') */
  endpoint: string;
  /** Field name to extract ID from response items */
  idField: string;
  /** Field name to extract label from response items */
  labelField: string;
  /** Currently selected value (label, not ID) */
  value: string;
  /** AI-suggested value (for matching and warning display) */
  aiSuggestedValue?: string;
  /** Typesense-side review message: present when the Dify workflow couldn't
   * match the LLM's value to a DB facet. Triggers the amber warning even
   * if `aiSuggestedValue` is empty (the LLM cleared its own pick), and is
   * surfaced as the warning tooltip — typically a candidate hint string
   * like "No close match for 'Sail' (closest candidates: Red, White, ...)". */
  reviewMessage?: string;
  /** Callback when selection changes */
  onChange: (value: string, label: string) => void;
  /** Placeholder text when no selection */
  placeholder?: string;
  /** Display label for the attribute */
  label?: string;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
  /** CSS class for custom styling */
  className?: string;
}

export function AttributeDropdown({
  endpoint,
  idField,
  labelField,
  value,
  aiSuggestedValue,
  reviewMessage,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className,
}: AttributeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid dependency issues
  const onChangeRef = useRef(onChange);
  const autoMatchedRef = useRef(false);
  onChangeRef.current = onChange;

  // Fetch options from API - only on mount or when endpoint changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    autoMatchedRef.current = false;

    api.get<{ data: Record<string, unknown>[] }>(endpoint)
      .then((res) => {
        if (cancelled) return;
        const items = res.data.data.map((item) => ({
          id: String(item[idField]),
          label: String(item[labelField]),
        }));
        setOptions(items);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getApiError(err).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, idField, labelField]);

  // Tracks the "auto-match wasn't in the first page of options" branch — used
  // to drive the amber warning when the targeted fallback also fails.
  const [autoMatchFailedFallback, setAutoMatchFailedFallback] = useState(false);

  // Auto-match AI suggested value after options are loaded (only once).
  //
  // Two-step strategy:
  //   1. Try to find the AI value in the already-loaded options (fast path).
  //   2. If not found, do a targeted server-side lookup with the AI value as
  //      the search term. This catches the case where the facet has > 250
  //      distinct values and the AI value's sort_order pushed it past the
  //      first-page cap (same root cause as the team `Spain`/`England` bug).
  //      If a match comes back, splice it into options so the user sees it
  //      in the dropdown too.
  useEffect(() => {
    if (autoMatchedRef.current || loading || !aiSuggestedValue || value) return;

    const inLoaded = options.find(
      (opt) => opt.label.toLowerCase() === aiSuggestedValue.toLowerCase(),
    );
    if (inLoaded) {
      autoMatchedRef.current = true;
      onChangeRef.current(inLoaded.id, inLoaded.label);
      return;
    }

    // Not in the first page of loaded options — try a targeted search.
    autoMatchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${endpoint}${separator}search=${encodeURIComponent(aiSuggestedValue)}`;
        const res = await api.get<{ data: Record<string, unknown>[] }>(url);
        if (cancelled) return;
        const items = res.data.data.map((item) => ({
          id: String(item[idField]),
          label: String(item[labelField]),
        }));
        const match = items.find(
          (opt) => opt.label.toLowerCase() === aiSuggestedValue.toLowerCase(),
        );
        if (match) {
          // Add it to the local list so the dropdown shows it too.
          setOptions((prev) =>
            prev.some((o) => o.id === match.id) ? prev : [...prev, match],
          );
          onChangeRef.current(match.id, match.label);
        } else {
          setAutoMatchFailedFallback(true);
        }
      } catch {
        if (!cancelled) setAutoMatchFailedFallback(true);
      }
    })();
    return () => { cancelled = true; };
  }, [loading, options, aiSuggestedValue, value, endpoint, idField, labelField]);

  // Find the selected option by label (since we store label in value)
  const selectedOption = useMemo(
    () => options.find((opt) => opt.label === value),
    [options, value],
  );

  // Check if AI-suggested value has no match in options
  const hasUnmatchedAiValue = useMemo(() => {
    if (reviewMessage) return true;
    if (autoMatchFailedFallback && !value) return true;
    if (!aiSuggestedValue || !options.length) return false;
    const normalized = aiSuggestedValue.toLowerCase();
    return !options.some((opt) => opt.label.toLowerCase() === normalized);
  }, [aiSuggestedValue, options, reviewMessage, autoMatchFailedFallback, value]);

  // Tooltip text for the amber warning — prefer the Typesense candidate hint
  // when present, otherwise fall back to the local "AI suggested but no match" copy.
  const warningTitle = reviewMessage
    ?? (aiSuggestedValue ? `AI suggested: "${aiSuggestedValue}" (no match)` : '');

  // Handle selection
  const handleSelect = useCallback((opt: OptionItem) => {
    onChange(opt.id, opt.label);
    setOpen(false);
  }, [onChange]);

  // Render loading state
  if (loading) {
    return (
      <div className={cn('flex-1 flex items-center gap-1', className)}>
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={cn('flex-1 flex items-center gap-1 text-red-500', className)}>
        <AlertTriangle className="h-3 w-3" />
        <span className="text-[11px]">Failed to load</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-6 w-full justify-between text-[11px] font-normal px-2',
            !selectedOption?.label && 'text-muted-foreground',
            hasUnmatchedAiValue && !selectedOption?.label && 'border-amber-400',
            className,
          )}
        >
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {hasUnmatchedAiValue && !selectedOption && (
              <span title={warningTitle}>
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              </span>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={opt.label}
                  onSelect={() => handleSelect(opt)}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      'mr-2 h-3 w-3',
                      value && value === opt.label ? 'opacity-100' : 'opacity-0',
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
  );
}

/**
 * SearchableCombobox — Same as AttributeDropdown but with a different visual style
 * for the Team field. Kept as a separate component for clarity.
 */
export function TeamSearchableCombobox({
  value,
  aiSuggestedValue,
  onChange,
  disabled = false,
  className,
}: {
  value: string;
  aiSuggestedValue?: string;
  onChange: (teamId: string, teamName: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <AttributeDropdown
      endpoint="/products/teams"
      idField="teams_id"
      labelField="team_name"
      value={value}
      aiSuggestedValue={aiSuggestedValue}
      onChange={onChange}
      placeholder="Select team..."
      disabled={disabled}
      className={className}
    />
  );
}

/**
 * SearchableAttributeDropdown — For large datasets (1000+ options).
 * Fetches options dynamically based on search input instead of loading all at once.
 */
interface SearchableAttributeDropdownProps {
  /** API endpoint with search param (e.g., '/products/team-categories?search=') */
  endpoint: string;
  /** Field name to extract ID from response items */
  idField: string;
  /** Field name to extract label from response items */
  labelField: string;
  /** Currently selected value (label, not ID) */
  value: string;
  /** AI-suggested value (for matching and warning display) */
  aiSuggestedValue?: string;
  /** Typesense-side review message: see AttributeDropdownProps for semantics. */
  reviewMessage?: string;
  /** Callback when selection changes */
  onChange: (value: string, label: string) => void;
  /** Placeholder text when no selection */
  placeholder?: string;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
  /** CSS class for custom styling */
  className?: string;
}

export function SearchableAttributeDropdown({
  endpoint,
  idField,
  labelField,
  value,
  aiSuggestedValue,
  reviewMessage,
  onChange,
  placeholder = 'Type to search...',
  disabled = false,
  className,
}: SearchableAttributeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<OptionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoMatchAttemptedRef = useRef(false);
  const [autoMatchFailed, setAutoMatchFailed] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Track selected option separately (since we may not have it in current options)
  const [selectedLabel, setSelectedLabel] = useState(value);

  // Update selected label when value prop changes
  useEffect(() => {
    setSelectedLabel(value);
  }, [value]);

  // Auto-match AI suggested value by searching for it
  useEffect(() => {
    // Skip if already attempted, no AI value, or already has a value
    if (autoMatchAttemptedRef.current || !aiSuggestedValue || value) return;
    autoMatchAttemptedRef.current = true;

    // Search for the AI suggested value
    const searchForMatch = async () => {
      try {
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${endpoint}${separator}search=${encodeURIComponent(aiSuggestedValue)}`;
        const res = await api.get<{ data: Record<string, unknown>[] }>(url);
        const items = res.data.data.map((item) => ({
          id: String(item[idField]),
          label: String(item[labelField]),
        }));

        // Find case-insensitive exact match
        const match = items.find(
          (opt) => opt.label.toLowerCase() === aiSuggestedValue.toLowerCase()
        );

        if (match) {
          setSelectedLabel(match.label);
          onChangeRef.current(match.id, match.label);
        } else {
          // No match found - show warning
          setAutoMatchFailed(true);
        }
      } catch {
        // Search failed - show warning
        setAutoMatchFailed(true);
      }
    };

    searchForMatch();
  }, [aiSuggestedValue, value, endpoint, idField, labelField]);

  // Fetch options based on search term
  const fetchOptions = useCallback(async (search: string) => {
    setLoading(true);
    setError(null);
    try {
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${endpoint}${separator}search=${encodeURIComponent(search)}`;
      const res = await api.get<{ data: Record<string, unknown>[] }>(url);
      const items = res.data.data.map((item) => ({
        id: String(item[idField]),
        label: String(item[labelField]),
      }));
      setOptions(items);
    } catch (err) {
      setError(getApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, idField, labelField]);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchOptions(searchTerm);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchTerm, fetchOptions]);

  // Load initial options when dropdown opens and focus input
  useEffect(() => {
    if (open) {
      fetchOptions('');
      // Focus input after a small delay to ensure popover is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, fetchOptions]);

  // Handle search input change
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  }, []);

  // Handle selection
  const handleSelect = useCallback((opt: OptionItem) => {
    onChange(opt.id, opt.label);
    setSelectedLabel(opt.label);
    setOpen(false);
    setSearchTerm('');
  }, [onChange]);

  // Check if AI-suggested value has no match
  const hasUnmatchedAiValue = useMemo(() => {
    if (reviewMessage && !selectedLabel) return true;
    // Show warning if auto-match was attempted and failed, or if there's an AI value but no selection
    if (autoMatchFailed) return true;
    if (!aiSuggestedValue || selectedLabel) return false;
    return true; // AI value exists but no selection yet
  }, [aiSuggestedValue, selectedLabel, autoMatchFailed, reviewMessage]);

  const warningTitle = reviewMessage
    ?? (aiSuggestedValue ? `AI suggested: "${aiSuggestedValue}" (no match)` : '');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-6 w-full justify-between text-[11px] font-normal px-2',
            !selectedLabel && 'text-muted-foreground',
            hasUnmatchedAiValue && !selectedLabel && 'border-amber-400',
            className,
          )}
        >
          <span className="truncate">
            {selectedLabel || placeholder}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {hasUnmatchedAiValue && !selectedLabel && (
              <span title={warningTitle}>
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              </span>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <div className="flex flex-col">
          {/* Custom search input instead of CommandInput */}
          <div className="flex items-center border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type to search..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              value={searchTerm}
              onChange={handleSearchChange}
            />
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-2" />}
          </div>

          {/* Results list */}
          <div className="max-h-[200px] overflow-y-auto">
            {error && (
              <div className="flex items-center justify-center py-4 text-red-500">
                <AlertTriangle className="h-4 w-4" />
                <span className="ml-2 text-xs">Failed to load</span>
              </div>
            )}
            {!loading && !error && options.length === 0 && (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {searchTerm ? 'No results found.' : 'Type to search...'}
              </div>
            )}
            {!error && options.length > 0 && (
              <div className="p-1">
                {options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelect(opt)}
                    className={cn(
                      'flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none',
                      'hover:bg-accent hover:text-accent-foreground',
                      'focus:bg-accent focus:text-accent-foreground',
                      selectedLabel === opt.label && 'bg-accent'
                    )}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-3 w-3',
                        selectedLabel === opt.label ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
