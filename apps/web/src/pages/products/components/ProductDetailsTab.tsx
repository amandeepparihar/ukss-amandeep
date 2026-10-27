/**
 * Product Details Tab (Tab 1) — Product code form with auto-lookup.
 * Requirements: REQ-1.1 through REQ-1.9, REQ-6.1 through REQ-6.3
 */

import { useState, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { Check, ChevronsUpDown, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
import { fetchProductLookupByCode } from '../utils/productLookup';
import {
  DuplicatesWarningPanel,
  type CheckDuplicatesResult,
} from './DuplicatesWarningPanel';

// ---------------------------------------------------------------------------
// Schema (mirrors backend productCodeSchema, but frontend-only subset)
// ---------------------------------------------------------------------------

const PRODUCT_CODE_FORBIDDEN = /['^£$%&*()}{@#~?><>,|=+¬]/;

const formSchema = z.object({
  productCode: z
    .string()
    .trim()
    .min(1, 'Product code is required')
    .max(100)
    .refine((v) => !PRODUCT_CODE_FORBIDDEN.test(v), {
      message: 'Product code contains invalid special characters',
    }),
  productName: z.string().trim().min(1, 'Product name is required').max(255),
  teamName: z.string().trim().min(1, 'Team is required').max(100),
  manufacturerName: z.string().trim().max(100).optional(),
  season: z.string().trim().min(1, 'Season is required').max(50),
  price: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().min(0, 'Price must be non-negative').default(0),
  ),
  productTypeId: z.string().min(1, 'Product type is required'),
  frontImage: z.string().optional(),
  backImage: z.string().optional(),
  additionalImage: z.string().optional(),
  // Persisted to product_lists.allows_personalisation; gates the AI description
  // workflow's add_legends section. Forced false in onSubmit when no team set.
  allowsPersonalisation: z.boolean().default(false),
  // product_lists.country_of_origin_id (FK to countries). Optional; held as a
  // string for the combobox, converted to a number in the save payload.
  countryOfOriginId: z.string().optional(),
  // product_lists.hs_code (PMS #166509) — the commodity code the goods are
  // declared under, beside the country they were made in. Free text: there is no
  // master list of commodity codes in the system. Separators are allowed while
  // typing and are stripped by the server, so this only checks that what is left
  // is a plausible code. Same 6-10 digit rule as sanitiseHsCode() on the API.
  hsCode: z
    .string()
    .trim()
    .max(20)
    .optional()
    .refine((v) => {
      if (!v) return true;
      const digits = v.replace(/[^0-9]/g, '');
      return digits.length >= 6 && digits.length <= 10;
    }, 'HS Code must be 6 to 10 digits'),
});

type FormData = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Origin details family conflicts (PMS #166509)
// ---------------------------------------------------------------------------

/** Shape of POST /api/products/origin-conflicts — one list per field. An empty
 *  list means there is nothing to ask about for that field. */
interface OriginDetailsConflicts {
  country_of_origin: Array<{
    countries_id: number;
    country_of_origin: string | null;
    product_code: string;
  }>;
  hs_code: Array<{ hs_code: string; product_code: string }>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProductDetailsTabProps {
  productListsId: number | null;
  onProductSaved: (id: number, info?: {
    productCode: string; productName: string; teamName: string; season: string;
    price: number; productTypeId: string;
    /** Resolved name for productTypeId — used by Step 3 to build context-aware
     *  AI edit prompts. Optional; missing → generic prompts. */
    productTypeName?: string;
    /** Manufacturer name — forwarded to the Dify image search workflow as
     *  manufacturer_name so the brand site:filter narrows Serper results. */
    manufacturerName?: string;
    frontImage: string; backImage: string; additionalImage: string;
    codeStatus?: 'new' | 'existing';
    // Saved-detail fields populated for existing products by check-code so
    // Steps 3 & 4 can pre-populate without re-running Dify.
    descriptionNotes?: string;
    productAttributes?: Record<string, string>;
    savedPrimaryImageUrl?: string | null;
    savedAdditionalImageUrls?: string[];
    savedBackImageUrl?: string | null;
    /** Backed by product_lists.allows_personalisation. Forwarded by Step 4
     *  to the Dify description workflow as the add_legends gate. */
    allowsPersonalisation?: boolean;
    countryOfOriginId?: number | null;
    countryOfOriginName?: string;
    /** product_lists.hs_code — mirrored forward so Steps 3 & 4 see what was
     *  just persisted without a refetch (PMS #166509). */
    hsCode?: string | null;
  }) => void;
  /** Cancel editing — only shown when editing an already-saved product */
  onCancel?: () => void;
  /** Saved product info for form reset when editing */
  savedInfo?: {
    productCode: string; productName: string; teamName: string; season: string;
    price: number; productTypeId: string;
    manufacturerName?: string;
    frontImage: string; backImage: string; additionalImage: string;
    allowsPersonalisation?: boolean;
    countryOfOriginId?: number | null;
    countryOfOriginName?: string;
    hsCode?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProductDetailsTab({
  productListsId,
  onProductSaved,
  onCancel,
  savedInfo,
}: ProductDetailsTabProps) {
  const [codeStatus, setCodeStatus] = useState<'new' | 'existing' | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamOpen, setTeamOpen] = useState(false);
  const [seasonSearch, setSeasonSearch] = useState('');
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [mfrSearch, setMfrSearch] = useState('');
  const [mfrOpen, setMfrOpen] = useState(false);
  // Product Type substring search (UI-only — filters the in-memory list).
  const [productTypeSearch, setProductTypeSearch] = useState('');
  const [productTypeOpen, setProductTypeOpen] = useState(false);
  // Country of origin combobox (searchable; options from the countries table).
  const [countrySearch, setCountrySearch] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  // Remember the picked country's {id,name} so the trigger button can render the
  // name independently of the searchable (LIMIT 50) options list, which may not
  // contain the current selection once the search input is cleared.
  const [selectedCountry, setSelectedCountry] = useState<{ id: string; name: string } | null>(null);
  // Origin details family conflicts (PMS #166509) — what the rest of the product
  // code family holds that disagrees with the form, one list per field. Non-null
  // means the dialog is up and has taken the save over.
  const [originConflicts, setOriginConflicts] = useState<OriginDetailsConflicts | null>(null);
  const [pendingSave, setPendingSave] = useState<FormData | null>(null);
  const [conflictPicks, setConflictPicks] = useState<{
    countryOfOriginId?: string;
    hsCode?: string;
  }>({});
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  // Saved-detail fields surfaced by /check-code for existing products so the
  // wizard can pre-fill Steps 3 & 4 without re-running Dify. Lives here (and
  // not in form state) because the form schema only covers Step 1 fields.
  const [savedDetail, setSavedDetail] = useState<{
    descriptionNotes: string;
    productAttributes: Record<string, string>;
    savedPrimaryImageUrl: string | null;
    savedAdditionalImageUrls: string[];
    savedBackImageUrl: string | null;
  } | null>(null);

  // --- Duplicate detection (Product Automation Improvement — Brazil case) ---
  // Only runs for brand-new codes; an existing code IS the product, so warning
  // about it makes no sense. Result gates Save when a strong candidate exists.
  const [duplicateResult, setDuplicateResult] = useState<CheckDuplicatesResult | null>(null);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      productCode: '',
      productName: '',
      teamName: '',
      manufacturerName: '',
      season: '',
      price: 0,
      productTypeId: '',
      frontImage: '',
      backImage: '',
      additionalImage: '',
      allowsPersonalisation: false,
      countryOfOriginId: '',
      hsCode: '',
    },
  });

  // Reset form with saved data when entering edit mode (requirement #9)
  useEffect(() => {
    if (savedInfo && onCancel && productListsId) {
      form.reset({
        productCode: savedInfo.productCode,
        productName: savedInfo.productName,
        teamName: savedInfo.teamName,
        manufacturerName: savedInfo.manufacturerName ?? '',
        season: savedInfo.season,
        price: savedInfo.price,
        productTypeId: savedInfo.productTypeId,
        frontImage: savedInfo.frontImage,
        backImage: savedInfo.backImage,
        additionalImage: savedInfo.additionalImage,
        allowsPersonalisation: savedInfo.allowsPersonalisation ?? false,
        countryOfOriginId:
          savedInfo.countryOfOriginId != null ? String(savedInfo.countryOfOriginId) : '',
        hsCode: savedInfo.hsCode ?? '',
      });
      setSelectedCountry(
        savedInfo.countryOfOriginId != null
          ? { id: String(savedInfo.countryOfOriginId), name: savedInfo.countryOfOriginName ?? '' }
          : null,
      );
    }
  }, [savedInfo, onCancel, productListsId, form]);

  // --- Lookups ---

  // Team & season are sourced from Typesense — same allowed-value list the
  // Dify workflow validates against, keeping the form and the AI panel in sync.
  // Response is `[{id, name}]` from /products/typesense/<key>; we shape it into
  // the legacy `{teams_id, team_name}` / `{seasons_id, season}` form so the
  // rest of the rendering (which uses those keys) is untouched.
  const { data: teamsData } = useQuery({
    queryKey: ['products', 'typesense', 'team', teamSearch],
    queryFn: async () => {
      const res = await api.get('/products/typesense/team', { params: { search: teamSearch } });
      const rows = res.data.data as Array<{ id: string; name: string }>;
      return rows.map((r, i) => ({ teams_id: i, team_name: r.name }));
    },
  });

  const { data: seasonsData } = useQuery({
    queryKey: ['products', 'typesense', 'season', seasonSearch],
    queryFn: async () => {
      const res = await api.get('/products/typesense/season', { params: { search: seasonSearch } });
      const rows = res.data.data as Array<{ id: string; name: string }>;
      return rows.map((r, i) => ({ seasons_id: i, season: r.name }));
    },
  });

  const { data: manufacturersData } = useQuery({
    queryKey: ['products', 'typesense', 'brand', mfrSearch],
    queryFn: async () => {
      const res = await api.get('/products/typesense/brand', { params: { search: mfrSearch } });
      const rows = res.data.data as Array<{ id: string; name: string }>;
      return rows.map((r, i) => ({ manufacturer_id: i, manufacturer_name: r.name }));
    },
  });

  const { data: productTypesData } = useQuery({
    queryKey: ['products', 'product-types'],
    queryFn: async () => {
      const res = await api.get('/products/product-types');
      return res.data.data as Array<{ type_id: number; type_name: string }>;
    },
  });

  // Country of origin options — searchable, ascending by name (server-sorted).
  const { data: countriesData } = useQuery({
    queryKey: ['products', 'countries', countrySearch],
    queryFn: async () => {
      const res = await api.get('/products/countries', { params: { search: countrySearch } });
      return res.data.data as Array<{ countries_id: number; countries_name: string }>;
    },
  });

  // --- Product code check on blur (REQ-1.3) ---

  const checkProductCode = useCallback(async (code: string) => {
    if (!code.trim()) {
      setCodeStatus(null);
      setSavedDetail(null);
      return;
    }
    try {
      const lookup = await fetchProductLookupByCode(code, productTypesData);
      if (lookup.codeStatus === 'existing') {
        setCodeStatus('existing');
        const p = lookup.product;
        form.setValue('productName', p.product_name || '');
        form.setValue('teamName', p.team_name || '');
        form.setValue('manufacturerName', p.manufacturer_name || '');
        form.setValue('season', p.season || '');
        form.setValue('price', Number(p.price) || 0);
        form.setValue('productTypeId', p.product_type ? String(p.product_type) : '');
        form.setValue('frontImage', p.front_image_url || '');
        form.setValue('backImage', p.back_image_url || '');
        form.setValue('additionalImage', p.additional_image_url || '');
        form.setValue('allowsPersonalisation', !!p.allows_personalisation);
        form.setValue('countryOfOriginId', p.country_of_origin_id != null ? String(p.country_of_origin_id) : '');
        form.setValue('hsCode', p.hs_code ?? '');
        setSelectedCountry(
          p.country_of_origin_id != null
            ? { id: String(p.country_of_origin_id), name: p.country_of_origin ?? '' }
            : null,
        );
        setSavedDetail({
          descriptionNotes: lookup.savedInfo.descriptionNotes ?? '',
          productAttributes: lookup.savedInfo.productAttributes ?? {},
          savedPrimaryImageUrl: lookup.savedInfo.savedPrimaryImageUrl ?? null,
          savedAdditionalImageUrls: lookup.savedInfo.savedAdditionalImageUrls ?? [],
          savedBackImageUrl: lookup.savedInfo.savedBackImageUrl ?? null,
        });
        // Existing product: surface productListsId + saved bundle to the parent
        // immediately so Steps 2-5 (Inventory, Images, Description) auto-load
        // their saved data without the user having to click "Save Product".
        if (lookup.productListsId > 0) {
          onProductSaved(lookup.productListsId, lookup.savedInfo);
        }
      } else {
        setCodeStatus('new');
        setSavedDetail(null);
      }
    } catch {
      setCodeStatus(null);
      setSavedDetail(null);
    }
  }, [form, onProductSaved, productTypesData]);

  // --- Duplicate detection: debounced check when the key attributes are set ---
  // Watch the structured key (team + season + type) plus the title. When all
  // three key fields are present for a NEW code, ask the backend for possible
  // duplicates across active + archived products. Debounced so typing in the
  // combobox doesn't spam the endpoint.
  const watchTeam = form.watch('teamName');
  const watchSeason = form.watch('season');
  const watchType = form.watch('productTypeId');
  const watchName = form.watch('productName');
  const watchCode = form.watch('productCode');

  useEffect(() => {
    // Never warn about an existing product against itself.
    if (codeStatus === 'existing') {
      setDuplicateResult(null);
      return;
    }
    const team = watchTeam?.trim();
    const season = watchSeason?.trim();
    const typeId = watchType?.trim();
    if (!team || !season || !typeId) {
      setDuplicateResult(null);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await api.post('/products/check-duplicates', {
          teamName: team,
          season,
          productTypeId: Number(typeId),
          productName: watchName?.trim() || undefined,
          excludeProductCode: watchCode?.trim() || undefined,
        });
        if (cancelled) return;
        const data = res.data.data as CheckDuplicatesResult;
        setDuplicateResult(data);
        // Fresh result → operator must re-acknowledge.
        setDuplicatesAcknowledged(false);
      } catch {
        // Duplicate detection is advisory — a failure must never block the form.
        if (!cancelled) setDuplicateResult(null);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [codeStatus, watchTeam, watchSeason, watchType, watchName, watchCode]);

  // --- Save mutation ---

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        productTypeId: Number(data.productTypeId),
        countryOfOriginId: data.countryOfOriginId ? Number(data.countryOfOriginId) : undefined,
        hsCode: data.hsCode ? data.hsCode : undefined,
      };
      const res = await api.post('/products/product-code', payload);
      return res.data.data as { productListsId: number; isNew: boolean; productCode: string; mapStatus: number };
    },
    onSuccess: (result, variables) => {
      toast.success(result.isNew ? 'Product code created' : 'Product code updated');
      // Forward saved-detail bundle for existing codes so Steps 3 & 4 can
      // skip auto-Dify and seed from saved data. New codes have no bundle.
      const codeStatus: 'new' | 'existing' = result.isNew ? 'new' : 'existing';
      const savedTypeName = productTypesData?.find(
        (pt) => String(pt.type_id) === variables.productTypeId,
      )?.type_name;
      onProductSaved(result.productListsId, {
        productCode: variables.productCode,
        productName: variables.productName,
        teamName: variables.teamName,
        season: variables.season,
        price: variables.price,
        productTypeId: variables.productTypeId,
        productTypeName: savedTypeName,
        manufacturerName: variables.manufacturerName ?? '',
        frontImage: variables.frontImage ?? '',
        backImage: variables.backImage ?? '',
        additionalImage: variables.additionalImage ?? '',
        codeStatus,
        descriptionNotes: codeStatus === 'existing' ? savedDetail?.descriptionNotes ?? '' : '',
        productAttributes: codeStatus === 'existing' ? savedDetail?.productAttributes ?? {} : {},
        savedPrimaryImageUrl: codeStatus === 'existing' ? savedDetail?.savedPrimaryImageUrl ?? null : null,
        savedAdditionalImageUrls: codeStatus === 'existing' ? savedDetail?.savedAdditionalImageUrls ?? [] : [],
        savedBackImageUrl: codeStatus === 'existing' ? savedDetail?.savedBackImageUrl ?? null : null,
        // Mirror what we just persisted so Step 4 picks up the toggle without a refetch.
        allowsPersonalisation: !!variables.allowsPersonalisation,
        countryOfOriginId: variables.countryOfOriginId ? Number(variables.countryOfOriginId) : null,
        countryOfOriginName:
          selectedCountry && selectedCountry.id === variables.countryOfOriginId
            ? selectedCountry.name
            : undefined,
        hsCode: variables.hsCode ? variables.hsCode : null,
      });
      setCodeStatus('existing');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  // Warn + acknowledge: block Save only when a strong duplicate exists and the
  // operator hasn't ticked the confirmation. Never a hard block — a tick lets
  // legitimate new products through.
  const blockedByDuplicates =
    codeStatus !== 'existing' &&
    !!duplicateResult?.requiresAcknowledgement &&
    !duplicatesAcknowledged;

  // --- Origin details family conflict check (PMS #166509) ---
  //
  // The country of origin and the HS Code are shared by the whole product code
  // family: saving them against one code decides them for the parent and every
  // child. Where somebody else in the family already holds a different value that
  // is a question for the operator, not something to settle quietly, so the form
  // asks before it saves — the same pre-flight check the SMS add-product forms
  // do, against the twin endpoint. Each field is asked about separately, so a
  // family that disagrees about only one of the two puts up only that section.
  const askAboutOriginConflicts = async (data: FormData): Promise<boolean> => {
    if (!data.countryOfOriginId && !data.hsCode) return false;

    setCheckingConflicts(true);
    try {
      const res = await api.post('/products/origin-conflicts', {
        productCode: data.productCode,
        countryOfOriginId: data.countryOfOriginId || undefined,
        hsCode: data.hsCode || undefined,
      });
      const conflicts = res.data.data as OriginDetailsConflicts;
      if (conflicts.country_of_origin.length === 0 && conflicts.hs_code.length === 0) {
        return false;
      }
      // Start with what is on the form already picked in each section, so the
      // dialog opens showing the operator's own answer rather than nothing, and
      // a single press changes it.
      setConflictPicks({
        countryOfOriginId: conflicts.country_of_origin.length > 0 ? data.countryOfOriginId || '' : undefined,
        hsCode: conflicts.hs_code.length > 0 ? data.hsCode || '' : undefined,
      });
      setPendingSave(data);
      setOriginConflicts(conflicts);
      return true;
    } catch (error) {
      // The check could not be done. Let the save through, which is what would
      // have happened anyway, rather than standing between the team and the work.
      console.warn('Origin details conflict check failed, letting the save through', error);
      return false;
    } finally {
      setCheckingConflicts(false);
    }
  };

  // How many questions the dialog is putting up — one per field with conflicts.
  const originConflictSectionCount =
    (originConflicts && originConflicts.country_of_origin.length > 0 ? 1 : 0) +
    (originConflicts && originConflicts.hs_code.length > 0 ? 1 : 0);

  // Name for the country the form is trying to save, for the dialog's own
  // "Use X" button. Falls back to the countries list when the operator picked it
  // before this render (selectedCountry) is not the one being saved.
  const formCountryName =
    selectedCountry && selectedCountry.id === pendingSave?.countryOfOriginId
      ? selectedCountry.name
      : countriesData?.find((c) => String(c.countries_id) === pendingSave?.countryOfOriginId)
          ?.countries_name ?? '';

  // Applies what was picked in each section and saves. Goes straight to the
  // mutation rather than back through onSubmit, so the check cannot re-fire on
  // the answer it just produced.
  const saveWithConflictPicks = () => {
    if (!pendingSave) return;
    const resolved: FormData = {
      ...pendingSave,
      countryOfOriginId: conflictPicks.countryOfOriginId ?? pendingSave.countryOfOriginId,
      hsCode: conflictPicks.hsCode ?? pendingSave.hsCode,
    };
    // Keep the visible form in step with what is being saved.
    form.setValue('countryOfOriginId', resolved.countryOfOriginId ?? '');
    form.setValue('hsCode', resolved.hsCode ?? '');
    const pickedCountry = countriesData?.find(
      (c) => String(c.countries_id) === resolved.countryOfOriginId,
    );
    if (pickedCountry) {
      setSelectedCountry({ id: String(pickedCountry.countries_id), name: pickedCountry.countries_name });
    }
    setOriginConflicts(null);
    setPendingSave(null);
    saveMutation.mutate(resolved);
  };

  const onSubmit = async (data: FormData) => {
    if (blockedByDuplicates) {
      toast.error('Possible duplicate detected — review the list and confirm this is a new product before saving.');
      return;
    }
    if (await askAboutOriginConflicts(data)) {
      // The dialog has taken the save over.
      return;
    }
    saveMutation.mutate(data);
  };

  return (
    <div className="space-y-3">
      {/* Status badges row */}
      {(codeStatus || productListsId) && (
        <div className="flex flex-wrap items-center gap-2">
          {codeStatus === 'existing' && (
            <Badge variant="secondary" className="text-xs">Existing product — details loaded</Badge>
          )}
          {codeStatus === 'new' && (
            <Badge variant="outline" className="text-xs">New product code</Badge>
          )}
          {productListsId && (
            <Badge variant="default" className="text-xs ml-auto">ID: {productListsId}</Badge>
          )}
        </div>
      )}

      <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            {/* Row 1: Product Code + Product Name + Team */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <FormField
                control={form.control}
                name="productCode"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Product Code</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. MAN-HOME-2425"
                        {...field}
                        onBlur={(e) => {
                          field.onBlur();
                          checkProductCode(e.target.value);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="productName"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Product Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Manchester United Home Shirt 24/25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Team combobox (REQ-6.1) */}
              <FormField
                control={form.control}
                name="teamName"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Team</FormLabel>
                    <Popover open={teamOpen} onOpenChange={setTeamOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              'w-full justify-between font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value || 'Select or type team...'}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search teams..."
                            value={teamSearch}
                            onValueChange={setTeamSearch}
                          />
                          <CommandList>
                            <CommandEmpty>
                              {teamSearch.trim() ? (
                                <button
                                  type="button"
                                  className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded"
                                  onClick={() => {
                                    field.onChange(teamSearch.trim());
                                    setTeamOpen(false);
                                  }}
                                >
                                  Create &quot;{teamSearch.trim()}&quot;
                                </button>
                              ) : (
                                'No teams found.'
                              )}
                            </CommandEmpty>
                            <CommandGroup>
                              {teamsData?.map((team) => (
                                <CommandItem
                                  key={team.teams_id}
                                  value={team.team_name}
                                  onSelect={() => {
                                    field.onChange(team.team_name);
                                    setTeamOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      field.value === team.team_name ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  {team.team_name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 2: Season + Product Type + Manufacturer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              {/* Season combobox (REQ-6.2) */}
              <FormField
                control={form.control}
                name="season"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Season</FormLabel>
                    <Popover open={seasonOpen} onOpenChange={setSeasonOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              'w-full justify-between font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value || 'Select or type season...'}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search seasons..."
                            value={seasonSearch}
                            onValueChange={setSeasonSearch}
                          />
                          <CommandList>
                            <CommandEmpty>No seasons found.</CommandEmpty>
                            <CommandGroup>
                              {seasonsData?.map((s) => (
                                <CommandItem
                                  key={s.seasons_id}
                                  value={s.season}
                                  onSelect={() => {
                                    field.onChange(s.season);
                                    setSeasonOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      field.value === s.season ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  {s.season}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="productTypeId"
                render={({ field }) => {
                  const selected = productTypesData?.find((pt) => String(pt.type_id) === field.value);
                  const filtered = productTypesData?.filter((pt) =>
                    productTypeSearch.trim() === ''
                      ? true
                      : pt.type_name.toLowerCase().includes(productTypeSearch.trim().toLowerCase()),
                  ) ?? [];
                  return (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Product Type</FormLabel>
                      <Popover open={productTypeOpen} onOpenChange={setProductTypeOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className={cn(
                                'w-full justify-between font-normal',
                                !field.value && 'text-muted-foreground',
                              )}
                            >
                              {selected ? selected.type_name : 'Select product type'}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Search e.g. football shirt, goalkeeper…"
                              value={productTypeSearch}
                              onValueChange={setProductTypeSearch}
                            />
                            <CommandList>
                              <CommandEmpty>No matching product type</CommandEmpty>
                              <CommandGroup>
                                {filtered.map((pt) => (
                                  <CommandItem
                                    key={pt.type_id}
                                    value={String(pt.type_id)}
                                    onSelect={() => {
                                      field.onChange(String(pt.type_id));
                                      setProductTypeOpen(false);
                                      setProductTypeSearch('');
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        'mr-2 h-4 w-4',
                                        field.value === String(pt.type_id) ? 'opacity-100' : 'opacity-0',
                                      )}
                                    />
                                    {pt.type_name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Manufacturer combobox — Typesense /brand facet (manufacturers_name).
                  Value is the brand name; the backend resolves it to
                  product_lists.manufacturers_id and forwards the name to the
                  Dify image-search workflow as manufacturer_name. */}
              <FormField
                control={form.control}
                name="manufacturerName"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>Manufacturer</FormLabel>
                    <Popover open={mfrOpen} onOpenChange={setMfrOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              'w-full justify-between font-normal',
                              !field.value && 'text-muted-foreground',
                            )}
                          >
                            {field.value || 'Select or type manufacturer...'}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Search manufacturers..."
                            value={mfrSearch}
                            onValueChange={setMfrSearch}
                          />
                          <CommandList>
                            <CommandEmpty>
                              {mfrSearch.trim() ? (
                                <button
                                  type="button"
                                  className="w-full px-2 py-1.5 text-sm text-left hover:bg-accent rounded"
                                  onClick={() => {
                                    field.onChange(mfrSearch.trim());
                                    setMfrOpen(false);
                                  }}
                                >
                                  Use &quot;{mfrSearch.trim()}&quot;
                                </button>
                              ) : (
                                'No manufacturers found.'
                              )}
                            </CommandEmpty>
                            <CommandGroup>
                              {manufacturersData?.map((m) => (
                                <CommandItem
                                  key={m.manufacturer_id}
                                  value={m.manufacturer_name}
                                  onSelect={() => {
                                    field.onChange(m.manufacturer_name);
                                    setMfrOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      field.value === m.manufacturer_name ? 'opacity-100' : 'opacity-0',
                                    )}
                                  />
                                  {m.manufacturer_name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Row 3: Price (optional). Mirrors legacy SMS new_product price
                field — saved to product_lists.price; blank is allowed. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>
                      Price{' '}
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        placeholder="e.g. 49.99"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? undefined : e.target.value)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Country of Origin combobox — optional. Searchable list from the
                  countries table (server-sorted ascending). Saved to
                  product_lists.country_of_origin_id (+ derived name). */}
              <FormField
                control={form.control}
                name="countryOfOriginId"
                render={({ field }) => {
                  const selectedName =
                    selectedCountry && selectedCountry.id === field.value
                      ? selectedCountry.name
                      : countriesData?.find((c) => String(c.countries_id) === field.value)?.countries_name;
                  return (
                    <FormItem className="space-y-1.5">
                      <FormLabel>
                        Country of Origin{' '}
                        <span className="font-normal text-muted-foreground">(optional)</span>
                      </FormLabel>
                      <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className={cn(
                                'w-full justify-between font-normal',
                                !field.value && 'text-muted-foreground',
                              )}
                            >
                              {selectedName || 'Select country of origin'}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Search country..."
                              value={countrySearch}
                              onValueChange={setCountrySearch}
                            />
                            <CommandList>
                              <CommandEmpty>No matching country</CommandEmpty>
                              <CommandGroup>
                                {field.value && (
                                  <CommandItem
                                    value="__clear__"
                                    onSelect={() => {
                                      field.onChange('');
                                      setSelectedCountry(null);
                                      setCountryOpen(false);
                                      setCountrySearch('');
                                    }}
                                  >
                                    <X className="mr-2 h-4 w-4 opacity-50" />
                                    Clear selection
                                  </CommandItem>
                                )}
                                {countriesData?.map((c) => (
                                  <CommandItem
                                    key={c.countries_id}
                                    value={String(c.countries_id)}
                                    onSelect={() => {
                                      field.onChange(String(c.countries_id));
                                      setSelectedCountry({ id: String(c.countries_id), name: c.countries_name });
                                      setCountryOpen(false);
                                      setCountrySearch('');
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        'mr-2 h-4 w-4',
                                        field.value === String(c.countries_id) ? 'opacity-100' : 'opacity-0',
                                      )}
                                    />
                                    {c.countries_name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* HS Code — directly under the country of origin, the two being
                  the pair a parcel leaving the UK is declared with (PMS #166509).
                  A plain text box and not a list: it is free text, there is no
                  master table of commodity codes. Separators may be typed and are
                  stripped server-side, so 9505.10.00 stores as 95051000. Saved
                  across the whole product code family, like the country. */}
              <FormField
                control={form.control}
                name="hsCode"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>
                      HS Code{' '}
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        maxLength={20}
                        placeholder="e.g. 6109100 or 9505.10.00"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Personalisation toggle — gates the AI description workflow's
                add_legends section so the LLM can mention current stars + legends
                of the selected team. Disabled when no team is set since legends
                make no sense without a team to source them from. */}
            <FormField
              control={form.control}
              name="allowsPersonalisation"
              render={({ field }) => {
                const teamName = form.watch('teamName')?.trim();
                const teamSet = !!teamName;
                return (
                  <FormItem className="flex items-start gap-2 rounded-md border border-dashed border-purple-200 bg-purple-50/30 px-3 py-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        id="allowsPersonalisation"
                        checked={!!field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                        disabled={!teamSet}
                        className="mt-0.5"
                      />
                    </FormControl>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <FormLabel
                        htmlFor="allowsPersonalisation"
                        className={cn(
                          'flex items-center gap-1.5 text-sm font-medium cursor-pointer',
                          !teamSet && 'cursor-not-allowed text-muted-foreground',
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                        Personalize Product? (Add legends &amp; current stars in the description)
                      </FormLabel>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {teamSet
                          ? `When ticked, the AI description will mention that buyers can add their own name & number, plus reference current first-team players and legends from ${teamName}.`
                          : 'Select a team first — legends and current stars are sourced from the team you pick.'}
                      </p>
                    </div>
                  </FormItem>
                );
              }}
            />

            {/* Possible-duplicate warning (active + archived) — gates Save when
                a strong match exists (warn + acknowledge). */}
            {duplicateResult && codeStatus !== 'existing' && (
              <DuplicatesWarningPanel
                result={duplicateResult}
                acknowledged={duplicatesAcknowledged}
                onAcknowledgedChange={setDuplicatesAcknowledged}
              />
            )}

            {/* Submit */}
            <div className="flex items-center justify-end gap-2">
              {onCancel && (
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saveMutation.isPending}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                disabled={saveMutation.isPending || checkingConflicts || blockedByDuplicates}
              >
                {(saveMutation.isPending || checkingConflicts) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Product
              </Button>
            </div>
          </form>
        </Form>

        {/* Origin details family conflict dialog (PMS #166509) — a section per
            field, and the save only goes through once every section that is up has
            been answered. With one section that is a single press, which is how
            this read before the HS Code existed. Cancel writes nothing and leaves
            the form exactly as it was, so the values can be corrected without the
            rest of the edit being thrown away. */}
        <Dialog
          open={originConflicts !== null}
          onOpenChange={(open) => {
            if (!open) {
              setOriginConflicts(null);
              setPendingSave(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Origin details of the product code family</DialogTitle>
              <DialogDescription>
                Whichever values are picked are given to the parent product code and to every child
                of it.
                {originConflictSectionCount > 1 &&
                  ' Both questions have to be answered before the product is saved.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {originConflicts && originConflicts.country_of_origin.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Country of origin</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {formCountryName || '(none)'}
                    </span>{' '}
                    is being saved against <span className="font-medium text-foreground">
                      {pendingSave?.productCode}
                    </span>, but the rest of its family holds:
                  </p>
                  <ul className="text-sm text-muted-foreground">
                    {originConflicts.country_of_origin.map((c) => (
                      <li key={c.countries_id}>
                        <span className="font-medium text-foreground">{c.product_code}</span> has{' '}
                        <span className="font-medium text-foreground">{c.country_of_origin}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        conflictPicks.countryOfOriginId === (pendingSave?.countryOfOriginId || '')
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() =>
                        setConflictPicks((p) => ({
                          ...p,
                          countryOfOriginId: pendingSave?.countryOfOriginId || '',
                        }))
                      }
                    >
                      Use {formCountryName || '(none)'}
                    </Button>
                    {originConflicts.country_of_origin.map((c) => (
                      <Button
                        key={c.countries_id}
                        type="button"
                        size="sm"
                        variant={
                          conflictPicks.countryOfOriginId === String(c.countries_id)
                            ? 'default'
                            : 'outline'
                        }
                        onClick={() =>
                          setConflictPicks((p) => ({
                            ...p,
                            countryOfOriginId: String(c.countries_id),
                          }))
                        }
                      >
                        Use {c.country_of_origin}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {originConflicts && originConflicts.hs_code.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">HS Code</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{pendingSave?.hsCode}</span> is
                    being saved against{' '}
                    <span className="font-medium text-foreground">{pendingSave?.productCode}</span>,
                    but the rest of its family holds:
                  </p>
                  <ul className="text-sm text-muted-foreground">
                    {originConflicts.hs_code.map((h) => (
                      <li key={h.hs_code}>
                        <span className="font-medium text-foreground">{h.product_code}</span> has{' '}
                        <span className="font-medium text-foreground">{h.hs_code}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        conflictPicks.hsCode === (pendingSave?.hsCode || '') ? 'default' : 'outline'
                      }
                      onClick={() =>
                        setConflictPicks((p) => ({ ...p, hsCode: pendingSave?.hsCode || '' }))
                      }
                    >
                      Use {pendingSave?.hsCode}
                    </Button>
                    {originConflicts.hs_code.map((h) => (
                      <Button
                        key={h.hs_code}
                        type="button"
                        size="sm"
                        variant={conflictPicks.hsCode === h.hs_code ? 'default' : 'outline'}
                        onClick={() => setConflictPicks((p) => ({ ...p, hsCode: h.hs_code }))}
                      >
                        Use {h.hs_code}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOriginConflicts(null);
                  setPendingSave(null);
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={saveWithConflictPicks}>
                Save with these values
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
