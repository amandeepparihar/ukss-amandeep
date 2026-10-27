/**
 * Per-row click action dialogs for the deliveries grid.
 *
 * Each dialog backs one click handler:
 *   - MapDialog        — Map button "M"
 *   - SpecialDialog    — Special button "S"
 *   - AssignFontDialog — Assign Font checkbox
 *
 * They are mounted at the page level so the grid's onClick can simply set
 * an `action` + `productCode` and let the dialogs do the heavy lifting.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DbCombobox } from './DbCombobox';
import { FontsCombobox } from './FontsCombobox';
import { type SizeActionContext } from './DeliveriesGrid';
import {
  useMapCandidates,
  useMapToZc,
  useSetSpecial,
  useClearSpecial,
  useSpecialState,
  useTeamCategoriesForMap,
  useMapPrefill,
  useAssignFontState,
  useAssignFont,
  useRemapCheck,
  useRemapSize,
  useSizeOptions,
  useSizeGroups,
  useSizes,
  useValidateRemapSize,
  useSupplierBarcodeData,
  useCheckSupplierBarcodeUnique,
  useSaveSupplierBarcode,
  type SupplierBarcodeFetchData,
} from './hooks/useDeliveriesMutations';

// ---------------------------------------------------------------------------
// Map dialog
// ---------------------------------------------------------------------------

export function MapDialog({
  productCode,
  onClose,
}: {
  productCode: string | null;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [linkQuantity, setLinkQuantity] = useState(true);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const { data: categories, isLoading: categoriesLoading } =
    useTeamCategoriesForMap(!!productCode);
  const { data: prefill, isLoading: prefillLoading } = useMapPrefill(productCode);
  const { data, isLoading } = useMapCandidates(productCode, categoryId);
  const mapMutation = useMapToZc();

  useEffect(() => {
    if (productCode) {
      setSearch('');
      setPicked([]);
      setLinkQuantity(true);
      setCategoryId(null);
    }
  }, [productCode]);

  // Auto-select the team-based default category once the prefill arrives.
  // Only fires when the dialog opens (categoryId still null) — never overrides
  // a category the operator has already picked.
  useEffect(() => {
    if (!productCode) return;
    if (categoryId != null) return;
    if (prefill?.defaultCategoryId != null) {
      setCategoryId(prefill.defaultCategoryId);
    }
  }, [productCode, prefill?.defaultCategoryId, categoryId]);

  // Build a quick lookup of already-mapped category ids so the dropdown can
  // badge them. Memoising keeps the option list stable across keystrokes.
  const mappedIdSet = useMemo(
    () => new Set(prefill?.alreadyMappedCategoryIds ?? []),
    [prefill?.alreadyMappedCategoryIds]
  );

  // Annotate the category list with a "(mapped)" suffix on already-mapped
  // rows. DbCombobox's option type already accepts {id, name} — we render the
  // hint into the name itself so it shows up both in the trigger and the
  // popover list without needing a new prop.
  const annotatedCategories = useMemo(() => {
    const list = categories ?? [];
    if (mappedIdSet.size === 0) return list;
    return list.map((c) =>
      mappedIdSet.has(Number(c.id))
        ? { ...c, name: `${c.name}  ·  mapped` }
        : c
    );
  }, [categories, mappedIdSet]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (c) =>
        (c.products_name ?? '').toLowerCase().includes(q) ||
        (c.products_model ?? '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const handleSave = () => {
    if (!productCode) return;
    if (picked.length === 0) {
      toast.error('Select at least one product to map.');
      return;
    }
    mapMutation.mutate(
      { productCode, productIds: picked, linkQuantity },
      {
        onSuccess: (res) => {
          toast.success(
            `Mapped ${productCode} to ${res.productsAffected} product(s). ${linkQuantity ? 'Quantity linked.' : ''}`
          );
          onClose();
        },
        onError: (err) => toast.error(err.message || 'Map failed'),
      }
    );
  };

  return (
    <Dialog open={!!productCode} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Map Product Code — {productCode}</DialogTitle>
          <DialogDescription>
            Pick a category, then tick the products to map this code to.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Select Category</Label>
              {/* DbCombobox: dynamic search-on-demand dropdown. Categories are
                  ~1k+ rows and rendering them all in a vanilla <select> was
                  slowing the modal open. Combobox shows top 9 by default and
                  filters as the operator types — matches the pattern used by
                  Manufacturer / Team Category on the product form. */}
              <DbCombobox
                options={annotatedCategories}
                value={
                  categoryId
                    ? (annotatedCategories.find((c) => c.id === categoryId)?.name ?? '')
                    : ''
                }
                onChange={(name) => {
                  if (!name) {
                    setCategoryId(null);
                    return;
                  }
                  const match = annotatedCategories.find((c) => c.name === name);
                  setCategoryId(match ? Number(match.id) : null);
                }}
                placeholder="Select a category"
                // Show the spinner while we're still fetching either the full
                // categories list or the team-based prefill. Combobox stays
                // disabled during this window so the operator can't pick
                // something only to have it overwritten by the auto-select.
                loading={categoriesLoading || prefillLoading}
                loadingText="Loading category…"
              />
            </div>
            <div className="space-y-1">
              <Label>Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="filter by name or model…"
              />
            </div>
          </div>
          <div className="rounded border bg-muted/30">
            <div className="grid grid-cols-[28px_90px_1fr_80px] gap-2 px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground border-b">
              <span></span>
              <span>Product Id</span>
              <span>Product Name</span>
              <span className="text-right">Price</span>
            </div>
            <ScrollArea className="h-72">
              {/* While the team-based prefill is still resolving, show a
                  skeleton + "Loading candidates…" hint instead of the
                  "Pick a category" placeholder. Without this, the body
                  looks idle for the 1-2 s window the prefill takes,
                  which made operators think they needed to act. */}
              {prefillLoading || categoriesLoading ? (
                <div className="p-2 space-y-2">
                  <div className="px-1 py-0.5 text-xs text-muted-foreground italic">
                    Loading candidates…
                  </div>
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : isLoading ? (
                <div className="p-2 space-y-1">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
              ) : !categoryId ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Pick a category to load candidate products.
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No products in this category.
                </div>
              ) : (
                <ul className="text-sm divide-y">
                  {filtered.map((c) => (
                    <li
                      key={c.products_id}
                      className="grid grid-cols-[28px_90px_1fr_80px] gap-2 items-center px-2 py-1"
                    >
                      <Checkbox
                        checked={picked.includes(c.products_id)}
                        onCheckedChange={() =>
                          setPicked((prev) =>
                            prev.includes(c.products_id)
                              ? prev.filter((x) => x !== c.products_id)
                              : [...prev, c.products_id]
                          )
                        }
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        #{c.products_id}
                      </span>
                      <span className="truncate flex items-center gap-2">
                        <span className="truncate">{c.products_name ?? '(no name)'}</span>
                        {c.already_mapped ? (
                          <span className="text-[10px] uppercase text-amber-600 shrink-0">
                            mapped
                          </span>
                        ) : null}
                      </span>
                      <span className="text-right text-xs tabular-nums">
                        {c.products_price ? `£${Number(c.products_price).toFixed(2)}` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={linkQuantity}
              onCheckedChange={(c) => setLinkQuantity(!!c)}
            />
            <span>
              Link Product — also set <code>quantity_map = 1</code> and copy SMS qty into{' '}
              <code>products.products_quantity</code>.
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            close
          </Button>
          <Button onClick={handleSave} disabled={mapMutation.isPending}>
            {mapMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Remap Size dialog — right-click "Remap Size" context-menu command. Moves a
// barcode from its current size to a different size. Distinct from
// `MapDialog` above (ZC-category-mapping), which is unrelated.
// ---------------------------------------------------------------------------

export function RemapSizeDialog({
  context,
  onClose,
}: {
  context: SizeActionContext | null;
  onClose: () => void;
}) {
  const checkMutation = useRemapCheck();
  const remapMutation = useRemapSize();
  const validateSize = useValidateRemapSize();

  const [sizeOptionId, setSizeOptionId] = useState<number | null>(null);
  const [sizeGroupId, setSizeGroupId] = useState<number | null>(null);
  const [targetSizeId, setTargetSizeId] = useState<number | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  // Tracks the most recently selected New Size so a slow validate-size response
  // for a since-superseded size can't set/clear the warning for the wrong size.
  const latestSizeRef = useRef<number | null>(null);

  const sizeOptions = useSizeOptions();
  const sizeGroups = useSizeGroups(sizeOptionId);
  const sizes = useSizes(sizeGroupId);

  // On open: run the pre-check and seed the dropdowns from the current selection.
  useEffect(() => {
    if (!context) return;
    setSizeOptionId(null);
    setSizeGroupId(null);
    setTargetSizeId(null);
    setSizeWarning(null);
    latestSizeRef.current = null;
    checkMutation.reset();
    checkMutation.mutate(
      { productListsId: context.productListsId, sizeId: context.sizeId, boxCode: context.boxCode },
      {
        onSuccess: (res) => {
          if (res.blocked) return; // block message rendered below
          if (res.current) {
            setSizeOptionId(res.current.sizeOptionId);
            setSizeGroupId(res.current.sizeGroupId);
            setTargetSizeId(res.current.currentSizeId);
          }
        },
        onError: (err) => {
          toast.error(err.message || 'Remap check failed');
          onClose();
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const checkResult = checkMutation.data;
  const currentSizeId = checkResult?.current?.currentSizeId ?? null;

  const onSizeOptionChange = (v: string) => {
    setSizeOptionId(Number(v));
    setSizeGroupId(null);
    setTargetSizeId(null);
    setSizeWarning(null);
  };

  const onSizeGroupChange = (v: string) => {
    setSizeGroupId(Number(v));
    setTargetSizeId(null);
    setSizeWarning(null);
  };

  const onNewSizeChange = (v: string) => {
    const sid = Number(v);
    latestSizeRef.current = sid;
    setTargetSizeId(sid);
    setSizeWarning(null);
    if (!context || !checkResult?.barcode) return;
    validateSize.mutate(
      { productListsId: context.productListsId, barcode: checkResult.barcode, targetSizeId: sid },
      {
        onSuccess: (r) => {
          // Ignore responses for a size the user has since changed away from.
          if (latestSizeRef.current !== sid) return;
          if (r.result !== 'ok') setSizeWarning(r.message || 'This size is not available for remap.');
        },
      }
    );
  };

  const confirmDisabled =
    targetSizeId == null ||
    targetSizeId === currentSizeId ||
    sizeWarning != null ||
    validateSize.isPending ||
    remapMutation.isPending;

  const handleConfirm = () => {
    if (!context || !checkResult?.barcode || targetSizeId == null) return;
    remapMutation.mutate(
      { productListsId: context.productListsId, barcode: checkResult.barcode, targetSizeId, targetSizeGroupId: sizeGroupId ?? undefined },
      {
        onSuccess: () => {
          toast.success('Size remapped');
          onClose();
        },
        onError: (err) => toast.error(err.message || 'Remap failed'),
      }
    );
  };

  const productCode = checkResult?.productCode ?? context?.productCode ?? '';
  const productName = checkResult?.productName ?? '';
  const barcode = checkResult?.barcode ?? '';

  return (
    <Dialog open={!!context} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remap Size {context ? `— ${context.productCode}` : ''}</DialogTitle>
          <DialogDescription>
            Confirm the barcode below, then choose the size option, group, and new size.
          </DialogDescription>
        </DialogHeader>

        {checkMutation.isPending && <Skeleton className="h-40 w-full" />}

        {checkResult?.blocked && (
          <DialogDescription className="text-destructive">
            {checkResult.reason ?? 'This item cannot be remapped (FC product already created).'}
          </DialogDescription>
        )}

        {checkResult && !checkResult.blocked && (
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Barcode</Label>
              <Input value={barcode} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Product Code</Label>
              <Input value={productCode} readOnly />
            </div>
            <div className="space-y-1">
              <Label>Product Name</Label>
              <Input value={productName} readOnly />
            </div>

            <div className="space-y-1">
              <Label>Size Option</Label>
              <Select
                value={sizeOptionId != null ? String(sizeOptionId) : undefined}
                onValueChange={onSizeOptionChange}
                disabled={sizeOptions.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={sizeOptions.isLoading ? 'Loading…' : 'Select a size option'} />
                </SelectTrigger>
                <SelectContent>
                  {(sizeOptions.data ?? []).map((o) => (
                    <SelectItem key={o.products_options_id} value={String(o.products_options_id)}>
                      {o.products_options_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Size Group</Label>
              <Select
                value={sizeGroupId != null ? String(sizeGroupId) : undefined}
                onValueChange={onSizeGroupChange}
                disabled={sizeOptionId == null || sizeGroups.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={sizeGroups.isLoading ? 'Loading…' : 'Select a size group'} />
                </SelectTrigger>
                <SelectContent>
                  {(sizeGroups.data ?? []).map((g) => (
                    <SelectItem key={g.sms_size_groups_id} value={String(g.sms_size_groups_id)}>
                      {g.size_group_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>New Size *</Label>
              <Select
                value={targetSizeId != null ? String(targetSizeId) : undefined}
                onValueChange={onNewSizeChange}
                disabled={sizeGroupId == null || sizes.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={sizes.isLoading ? 'Loading…' : 'Select a size'} />
                </SelectTrigger>
                <SelectContent>
                  {(sizes.data ?? []).map((s) => (
                    <SelectItem
                      key={s.manufacturers_sizes_to_default_sizes_id}
                      value={String(s.manufacturers_sizes_to_default_sizes_id)}
                    >
                      {s.manufacturer_size_shortname}
                      {s.manufacturers_sizes_to_default_sizes_id === currentSizeId ? ' (current)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sizeWarning && <p className="text-xs text-destructive">{sizeWarning}</p>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {checkResult && !checkResult.blocked && (
            <Button onClick={handleConfirm} disabled={confirmDisabled}>
              {remapMutation.isPending ? 'Remapping…' : 'Confirm Remap'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Supplier Barcode dialog — right-click "Add Alternate/Supplier Barcode"
// context-menu command. Port of legacy supplier_barcode_popup.ctp.
// ---------------------------------------------------------------------------

type FieldMessage = { type: 'error' | 'success' | 'info'; text: string } | null;

interface SupplierBarcodeFieldState {
  value: string;
  /** Value at fetch time — the baseline every validation rule compares against. */
  initial: string;
  message: FieldMessage;
}

const SUPPLIER_BARCODE_FIELD_LABELS = [
  'Supplier Barcode',
] as const;

const SUPPLIER_BARCODE_REMOVE_WARNING =
  'Are you sure you want to remove this supplier barcode? It will be saved to the system but may take time to update on Green FC, and will not update on Amazon/Shopify/other marketplaces except Green FC.';
const SUPPLIER_BARCODE_UPDATE_WARNING =
  'Are you sure you want to update this supplier barcode? It will be saved to the system but may take time to update on Green FC, and will not update on Amazon/Shopify/other marketplaces except Green FC.';

function makeSupplierBarcodeField(value: string | null): SupplierBarcodeFieldState {
  return { value: value ?? '', initial: value ?? '', message: null };
}

const EMPTY_SUPPLIER_BARCODE_FIELDS: SupplierBarcodeFieldState[] = [
  makeSupplierBarcodeField(null),
];

export function SupplierBarcodeDialog({
  context,
  onClose,
}: {
  context: SizeActionContext | null;
  onClose: () => void;
}) {
  const fetchMutation = useSupplierBarcodeData();
  const checkMutation = useCheckSupplierBarcodeUnique();
  const saveMutation = useSaveSupplierBarcode();
  const confirm = useConfirm();

  const [fetchData, setFetchData] = useState<SupplierBarcodeFetchData | null>(null);
  const [fields, setFields] = useState<SupplierBarcodeFieldState[]>(EMPTY_SUPPLIER_BARCODE_FIELDS);
  const [saveError, setSaveError] = useState<string | null>(null);

  // validateField needs the latest field values inside async confirm/await
  // chains, where the closure captured at call-time would otherwise be stale.
  const fieldsRef = useRef(fields);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    if (!context) return;
    setFetchData(null);
    setFields(EMPTY_SUPPLIER_BARCODE_FIELDS);
    setSaveError(null);
    fetchMutation.reset();
    fetchMutation.mutate(
      { product_lists_id: context.productListsId, size: context.sizeId },
      {
        onSuccess: (result) => {
          if (!result.success) {
            toast.error(result.message);
            onClose();
            return;
          }
          setFetchData(result.data);
          setFields([
            makeSupplierBarcodeField(result.data.supplier_barcode_1),
          ]);
        },
        onError: (err) => {
          toast.error(err.message || 'Failed to fetch supplier barcode data');
          onClose();
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const handleChange = (idx: number, value: string) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value, message: null } : f)));
    setSaveError(null);
  };

  const validateField = async (idx: number) => {
    const current = fieldsRef.current[idx];
    const trimmed = current.value.trim();

    // b. unchanged vs fetch-time value -> no-op, clear error
    if (trimmed === current.initial) {
      setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value: trimmed, message: null } : f)));
      return;
    }

    // c. now empty AND was non-empty at fetch time -> confirm removal
    if (trimmed === '' && current.initial !== '') {
      const confirmed = await confirm({
        title: 'Remove supplier barcode?',
        description: SUPPLIER_BARCODE_REMOVE_WARNING,
        confirmLabel: 'Remove',
        variant: 'destructive',
      });
      if (!confirmed) {
        setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value: f.initial, message: null } : f)));
        return;
      }
      setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value: '', message: null } : f)));
      return;
    }

    // d. not all-digits
    if (!/^\d+$/.test(trimmed)) {
      setFields((prev) =>
        prev.map((f, i) =>
          i === idx
            ? { ...f, value: trimmed, message: { type: 'error', text: 'must contain numbers only, no letters or special characters.' } }
            : f
        )
      );
      return;
    }

    // e. length 12-25
    if (trimmed.length < 12 || trimmed.length > 25) {
      setFields((prev) =>
        prev.map((f, i) =>
          i === idx ? { ...f, value: trimmed, message: { type: 'error', text: 'must be 12-25 digits long.' } } : f
        )
      );
      return;
    }

    // f. duplicates another field's CURRENT value
    const duplicate = fieldsRef.current.some((f, i) => i !== idx && f.value.trim() === trimmed);
    if (duplicate) {
      setFields((prev) =>
        prev.map((f, i) =>
          i === idx ? { ...f, value: trimmed, message: { type: 'error', text: 'already entered in another field.' } } : f
        )
      );
      return;
    }

    // g. fetch-time value was non-empty -> this is an update, confirm it
    if (current.initial !== '') {
      const confirmed = await confirm({
        title: 'Update supplier barcode?',
        description: SUPPLIER_BARCODE_UPDATE_WARNING,
        confirmLabel: 'Update',
        variant: 'default',
      });
      if (!confirmed) {
        setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value: f.initial, message: null } : f)));
        return;
      }
    }

    // h. uniqueness check
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, value: trimmed, message: { type: 'info', text: 'Checking…' } } : f))
    );
    try {
      const result = await checkMutation.mutateAsync({ barcode: trimmed });
      if (result.isNew) {
        setFields((prev) =>
          prev.map((f, i) => (i === idx ? { ...f, message: { type: 'success', text: 'Barcode is available.' } } : f))
        );
      } else {
        const text = (result.message ?? 'Barcode already in use.').replace(/<\/?b>/g, '');
        setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, message: { type: 'error', text } } : f)));
      }
    } catch (err) {
      const text = (err as Error).message || 'Failed to check barcode uniqueness.';
      setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, message: { type: 'error', text } } : f)));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const hasError = fields.some((f) => f.message?.type === 'error');
  const hasPendingCheck = fields.some((f) => f.message?.type === 'info');
  const hasChange = fields.some((f) => f.value.trim() !== f.initial);
  const saveDisabled = hasError || hasPendingCheck || !hasChange || saveMutation.isPending;

  const handleSave = () => {
    if (!fetchData) return;
    setSaveError(null);
    saveMutation.mutate(
      {
        barcode: fetchData.barcode,
        size_id: fetchData.size_id,
        product_lists_id: fetchData.product_lists_id,
        supplier_barcode_1: fields[0].value.trim(),
      },
      {
        onSuccess: (res) => {
          if (res.success) {
            toast.success(res.message);
            onClose();
          } else {
            setSaveError(res.message);
          }
        },
        onError: (err) => setSaveError(err.message || 'Failed to save supplier barcodes.'),
      }
    );
  };

  return (
    <Dialog open={!!context} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supplier Barcode {context ? `— ${context.productCode}` : ''}</DialogTitle>
        </DialogHeader>

        {fetchMutation.isPending && (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {fetchData && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm rounded border p-2 bg-muted/30">
              <div><span className="text-muted-foreground">Product Code:</span> {fetchData.product_code}</div>
              <div><span className="text-muted-foreground">Product Name:</span> {fetchData.product_name}</div>
              <div><span className="text-muted-foreground">Barcode:</span> {fetchData.barcode}</div>
              <div><span className="text-muted-foreground">Size Name:</span> {fetchData.size_name}</div>
              <div><span className="text-muted-foreground">Season:</span> {fetchData.season}</div>
              <div><span className="text-muted-foreground">Boxes:</span> {fetchData.boxes}</div>
            </div>

            <div className="space-y-3">
              {fields.map((field, idx) => (
                <div key={SUPPLIER_BARCODE_FIELD_LABELS[idx]} className="space-y-1">
                  <Label>{SUPPLIER_BARCODE_FIELD_LABELS[idx]}</Label>
                  <Input
                    value={field.value}
                    maxLength={25}
                    onChange={(e) => handleChange(idx, e.target.value)}
                    onBlur={() => void validateField(idx)}
                    onKeyDown={handleKeyDown}
                  />
                  {field.message && (
                    <p
                      className={cn(
                        'text-xs',
                        field.message.type === 'error' && 'text-destructive',
                        field.message.type === 'success' && 'text-green-600',
                        field.message.type === 'info' && 'text-muted-foreground'
                      )}
                    >
                      {field.message.text}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {saveError && (
              <div className="text-sm text-destructive rounded border border-destructive/40 bg-destructive/10 p-2">
                {saveError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {fetchData && (
            <Button onClick={handleSave} disabled={saveDisabled}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Special dialog — full legacy parity port of `set_specials.ctp`.
//
//   - Shared start/end date inputs at the top.
//   - Per-mapped-product row: price, four deal checkboxes
//     (Thursday Mega / Black Friday / Cyber Monday / Mega Friday),
//     "Show Sizes" toggle.
//   - When sizes are toggled on, a nested per-size table appears under that
//     product (size name, price, +/-, start/end date).
//   - Four "Check All" checkboxes in the table header toggle every deal in
//     that column at once.
// ---------------------------------------------------------------------------

type SpecialSizeDraft = {
  optionValueId: number;
  name: string;
  price: string;
  prefix: '+' | '-';
  startDate: string;
  endDate: string;
};
type SpecialProductDraft = {
  productsId: number;
  productsName: string;
  productsModel: string;
  price: string;
  thursdayDeal: boolean;
  blackFridayDeal: boolean;
  cyberMondayDeal: boolean;
  megaFridayDeal: boolean;
  showSizes: boolean;
  sizes: SpecialSizeDraft[];
};
const DEAL_KEYS = [
  'thursdayDeal',
  'blackFridayDeal',
  'cyberMondayDeal',
  'megaFridayDeal',
] as const;
type DealKey = (typeof DEAL_KEYS)[number];

function normalizeEndDate(value: string | null): string {
  // Legacy stores '0000-00-00' for open-ended; surface as '0001-01-01' in the
  // UI so users see the legacy placeholder they're used to.
  if (!value || value === '0000-00-00') return '0001-01-01';
  return value;
}

export function SpecialDialog({
  productCode,
  onClose,
}: {
  productCode: string | null;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('0001-01-01');
  const [rows, setRows] = useState<SpecialProductDraft[]>([]);
  const setMutation = useSetSpecial();
  const clearMutation = useClearSpecial();
  const confirm = useConfirm();
  const { data: state, isLoading: stateLoading } = useSpecialState(productCode);

  // Seed local state whenever a new product code is opened or the API state
  // arrives. Legacy popup defaults to today + open-ended when no row carries
  // a date (set_specials.ctp:11-14).
  useEffect(() => {
    if (!productCode) return;
    const today = new Date().toISOString().slice(0, 10);
    setStartDate(today);
    setEndDate('0001-01-01');
    setRows([]);
  }, [productCode]);

  useEffect(() => {
    if (!state) return;
    if (state.startDate) setStartDate(state.startDate);
    setEndDate(normalizeEndDate(state.endDate));
    setRows(
      state.products.map((p) => ({
        productsId: p.productsId,
        productsName: p.productsName,
        productsModel: p.productsModel,
        price: p.specialPrice && Number(p.specialPrice) > 0 ? p.specialPrice : '',
        thursdayDeal: p.thursdayDeal,
        blackFridayDeal: p.blackFridayDeal,
        cyberMondayDeal: p.cyberMondayDeal,
        megaFridayDeal: p.megaFridayDeal,
        showSizes: false,
        sizes: p.sizes.map((s) => ({
          optionValueId: s.optionValueId,
          name: s.name,
          price: s.price && Number(s.price) > 0 ? s.price : '',
          prefix: s.prefix,
          startDate: s.startDate ?? '',
          endDate: s.endDate ?? '',
        })),
      }))
    );
  }, [state]);

  // ---- Mutators -------------------------------------------------------
  const updateRow = (productsId: number, patch: Partial<SpecialProductDraft>) =>
    setRows((prev) => prev.map((r) => (r.productsId === productsId ? { ...r, ...patch } : r)));

  const updateSize = (
    productsId: number,
    optionValueId: number,
    patch: Partial<SpecialSizeDraft>
  ) =>
    setRows((prev) =>
      prev.map((r) =>
        r.productsId !== productsId
          ? r
          : {
              ...r,
              sizes: r.sizes.map((s) =>
                s.optionValueId === optionValueId ? { ...s, ...patch } : s
              ),
            }
      )
    );

  const checkAll = (key: DealKey, value: boolean) =>
    setRows((prev) => prev.map((r) => ({ ...r, [key]: value })));

  const allChecked = (key: DealKey) => rows.length > 0 && rows.every((r) => r[key]);

  // ---- Save -----------------------------------------------------------
  const handleSave = () => {
    if (!productCode) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      toast.error('Please set the specials date');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      toast.error('End date must be YYYY-MM-DD (use 0001-01-01 for none).');
      return;
    }
    const anyPriced = rows.some((r) => r.price.trim() !== '' && Number(r.price) > 0);
    const anySizePriced = rows.some((r) =>
      r.sizes.some((s) => s.price.trim() !== '' && Number(s.price) > 0)
    );
    const anyDeal = rows.some((r) =>
      DEAL_KEYS.some((k) => r[k])
    );
    if (!anyPriced && !anySizePriced && !anyDeal) {
      toast.error('Please set the specials price');
      return;
    }

    setMutation.mutate(
      {
        productCode,
        startDate,
        endDate,
        products: rows.map((r) => ({
          productsId: r.productsId,
          price:
            r.price.trim() === '' || !Number.isFinite(Number(r.price))
              ? null
              : Number(r.price),
          thursdayDeal: r.thursdayDeal,
          blackFridayDeal: r.blackFridayDeal,
          cyberMondayDeal: r.cyberMondayDeal,
          megaFridayDeal: r.megaFridayDeal,
          sizes: r.sizes
            .filter((s) => s.price.trim() !== '' && Number.isFinite(Number(s.price)))
            .map((s) => ({
              optionValueId: s.optionValueId,
              price: Number(s.price),
              prefix: s.prefix,
              startDate: /^\d{4}-\d{2}-\d{2}$/.test(s.startDate) ? s.startDate : '0000-00-00',
              endDate: /^\d{4}-\d{2}-\d{2}$/.test(s.endDate) ? s.endDate : '0000-00-00',
            })),
        })),
      },
      {
        onSuccess: (res) => {
          toast.success(`Special saved for ${res.productCode} (${res.productsAffected} product(s)).`);
          onClose();
        },
        onError: (err) => toast.error(err.message || 'Failed'),
      }
    );
  };

  const handleClear = async () => {
    if (!productCode) return;
    try {
      await confirm({
        title: 'Clear special?',
        description: (
          <>
            This will DELETE the <code>specials</code> row for every mapped product under{' '}
            <code>{productCode}</code> and clear the storefront special price.
            This cannot be undone — you'd need to re-enter the special.
          </>
        ),
        variant: 'destructive',
        confirmLabel: 'Clear special',
        run: async () => {
          await clearMutation.mutateAsync({ productCode });
          toast.success(`Special cleared for ${productCode}.`);
          onClose();
        },
      });
    } catch (err) {
      toast.error((err as Error).message || 'Failed');
    }
  };

  const tshirtBlocked = !!state && state.tshirtBlocked;
  const noMapped = !!state && !tshirtBlocked && state.mappedProducts === 0;
  const blocked = tshirtBlocked || noMapped;

  return (
    <Dialog open={!!productCode} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Specials</DialogTitle>
          {!blocked && !stateLoading ? (
            <DialogDescription>
              Set a special price for <code>{productCode}</code>. Leave the end
              date as <code>0001-01-01</code> for an open-ended special.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {stateLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : tshirtBlocked ? (
          <div className="py-10 text-center text-sm font-medium">
            You cannot set special price for Tshirt Virtual type product.
          </div>
        ) : noMapped ? (
          <div className="py-10 text-center text-sm font-medium">
            No Mapped Products Found.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Shared start/end dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Specials Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Specials End Date (use 0001-01-01 for none)</Label>
                <Input
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>

            {/* Per-product table */}
            <ScrollArea className="max-h-[55vh] border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 sticky top-0 z-10">
                  <tr className="text-left">
                    <th className="px-2 py-2 w-[80px] text-center">Products Id</th>
                    <th className="px-2 py-2">Products Name</th>
                    <th className="px-2 py-2 w-[110px] text-center">Specials Price</th>
                    <th className="px-2 py-2 w-[110px] text-center">Thursday Mega Deals</th>
                    <th className="px-2 py-2 w-[110px] text-center">Black Friday Deals</th>
                    <th className="px-2 py-2 w-[110px] text-center">Cyber Monday Deals</th>
                    <th className="px-2 py-2 w-[110px] text-center">Mega Friday Deals</th>
                    <th className="px-2 py-2 w-[90px] text-center">Show Sizes</th>
                  </tr>
                  {/* Per-column "Check All" toggles. Legacy parity: SMS
                      `set_specials.ctp:76` puts a small `Check All` label
                      next to each deal-column checkbox rather than one
                      shared label, which also keeps the Specials Price
                      column header clear. */}
                  <tr className="bg-muted/30 text-xs">
                    <th colSpan={3} />
                    {DEAL_KEYS.map((k) => (
                      <th key={k} className="px-2 py-1">
                        <label className="flex items-center justify-center gap-1 cursor-pointer">
                          <Checkbox
                            checked={allChecked(k)}
                            onCheckedChange={(v) => checkAll(k, !!v)}
                          />
                          <span>Check All</span>
                        </label>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <RowSpecial
                      key={r.productsId}
                      row={r}
                      onChange={(patch) => updateRow(r.productsId, patch)}
                      onSizeChange={(svId, patch) => updateSize(r.productsId, svId, patch)}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}
        <DialogFooter className="gap-2">
          {blocked ? (
            <Button onClick={onClose}>close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleClear}
                disabled={clearMutation.isPending}
              >
                {clearMutation.isPending ? 'Clearing…' : 'Clear special'}
              </Button>
              <Button onClick={handleSave} disabled={setMutation.isPending}>
                {setMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowSpecial({
  row,
  onChange,
  onSizeChange,
}: {
  row: SpecialProductDraft;
  onChange: (patch: Partial<SpecialProductDraft>) => void;
  onSizeChange: (optionValueId: number, patch: Partial<SpecialSizeDraft>) => void;
}) {
  return (
    <>
      <tr className="border-t hover:bg-muted/20">
        <td className="px-2 py-1 align-middle">{row.productsId}</td>
        <td className="px-2 py-1 align-middle">
          <div className="text-sm">{row.productsName}</div>
          <div className="text-xs text-muted-foreground">{row.productsModel}</div>
        </td>
        <td className="px-2 py-1 align-middle">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={row.price}
            onChange={(e) => onChange({ price: e.target.value })}
            className="h-8"
          />
        </td>
        {DEAL_KEYS.map((k) => (
          <td key={k} className="px-2 py-1 align-middle text-center">
            <Checkbox
              checked={row[k]}
              onCheckedChange={(v) => onChange({ [k]: !!v } as Partial<SpecialProductDraft>)}
            />
          </td>
        ))}
        <td className="px-2 py-1 align-middle text-center">
          <Checkbox
            checked={row.showSizes}
            onCheckedChange={(v) => onChange({ showSizes: !!v })}
            disabled={row.sizes.length === 0}
          />
        </td>
      </tr>
      {row.showSizes && row.sizes.length > 0 ? (
        <tr className="bg-muted/10 border-t">
          <td colSpan={8} className="px-3 py-2">
            <table className="w-full text-xs">
              <thead className="text-left">
                <tr>
                  <th className="px-2 py-1 w-[30%]">Size Attribute</th>
                  <th className="px-2 py-1 w-[15%]">Price</th>
                  <th className="px-2 py-1 w-[10%]">Prefix</th>
                  <th className="px-2 py-1 w-[20%]">Start Date</th>
                  <th className="px-2 py-1 w-[20%]">End Date</th>
                </tr>
              </thead>
              <tbody>
                {row.sizes.map((s) => (
                  <tr key={s.optionValueId} className="border-t">
                    <td className="px-2 py-1">{s.name}</td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={s.price}
                        onChange={(e) =>
                          onSizeChange(s.optionValueId, { price: e.target.value })
                        }
                        className="h-7"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <select
                        className="border rounded h-7 px-1 text-xs"
                        value={s.prefix}
                        onChange={(e) =>
                          onSizeChange(s.optionValueId, {
                            prefix: e.target.value === '+' ? '+' : '-',
                          })
                        }
                      >
                        <option value="+">+</option>
                        <option value="-">-</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={s.startDate}
                        onChange={(e) =>
                          onSizeChange(s.optionValueId, { startDate: e.target.value })
                        }
                        className="h-7"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={s.endDate}
                        onChange={(e) =>
                          onSizeChange(s.optionValueId, { endDate: e.target.value })
                        }
                        className="h-7"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Assign Font dialog
// ---------------------------------------------------------------------------

interface FontAssignmentDraft {
  /** Stable identity for React keys — array index is unsafe because rows are
   *  deletable (removeRow), which would re-attach a row's component state
   *  (FontsCombobox search/open) to the wrong draft. */
  uid: number;
  fontName: string;
  sizeIds: number[];
}

// Monotonic id source for font-draft rows. Module-level so it survives
// re-renders; only needs to be unique within a dialog session.
let nextFontDraftUid = 1;
const newFontDraft = (fontName = '', sizeIds: number[] = []): FontAssignmentDraft => ({
  uid: nextFontDraftUid++,
  fontName,
  sizeIds,
});

export function AssignFontDialog({
  productCode,
  onClose,
}: {
  productCode: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAssignFontState(productCode);
  const mutation = useAssignFont();
  const [drafts, setDrafts] = useState<FontAssignmentDraft[]>(() => [newFontDraft()]);

  // Seed the draft list from server state so existing assignments are visible.
  useEffect(() => {
    if (!data) return;
    const byFont = new Map<string, number[]>();
    for (const r of data.rows) {
      if (!r.font_name) continue;
      const arr = byFont.get(r.font_name) ?? [];
      arr.push(r.size_id);
      byFont.set(r.font_name, arr);
    }
    const seeded = Array.from(byFont.entries()).map(([fontName, sizeIds]) => newFontDraft(fontName, sizeIds));
    setDrafts(seeded.length ? seeded : [newFontDraft()]);
  }, [data]);

  const sizes = data?.rows ?? [];

  const updateDraft = (idx: number, patch: Partial<FontAssignmentDraft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  const toggleSize = (idx: number, sizeId: number) =>
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === idx
          ? {
              ...d,
              sizeIds: d.sizeIds.includes(sizeId)
                ? d.sizeIds.filter((s) => s !== sizeId)
                : [...d.sizeIds, sizeId],
            }
          : d
      )
    );

  const addRow = () =>
    setDrafts((prev) => [...prev, newFontDraft()]);

  const removeRow = (idx: number) =>
    setDrafts((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!productCode) return;
    // Strip empty rows.
    const cleaned = drafts.filter((d) => d.fontName.trim() && d.sizeIds.length > 0);
    mutation.mutate(
      { productCode, assignments: cleaned },
      {
        onSuccess: (res) => {
          toast.success(
            `Fonts ${cleaned.length === 0 ? 'cleared' : `saved (${res.rowsTouched} rows updated)`} for ${productCode}.`
          );
          onClose();
        },
        onError: (err) => toast.error(err.message || 'Failed'),
      }
    );
  };

  return (
    <Dialog open={!!productCode} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign Fonts — {productCode}</DialogTitle>
          <DialogDescription>
            Assign a font name to one or more sizes for this product.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : sizes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No stocked sizes found for this product.
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft, idx) => (
              <div key={draft.uid} className="rounded border p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <FontsCombobox
                      value={draft.fontName}
                      onChange={(name) => updateDraft(idx, { fontName: name })}
                    />
                  </div>
                  {drafts.length > 1 ? (
                    <Button variant="ghost" size="sm" onClick={() => removeRow(idx)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {sizes.map((s) => (
                    <label key={s.size_id} className="flex items-center gap-1">
                      <Checkbox
                        checked={draft.sizeIds.includes(s.size_id)}
                        onCheckedChange={() => toggleSize(idx, s.size_id)}
                      />
                      <span>{s.size_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addRow}>+ Add another font</Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={mutation.isPending || sizes.length === 0}>
            {mutation.isPending ? 'Saving…' : 'Save fonts'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
