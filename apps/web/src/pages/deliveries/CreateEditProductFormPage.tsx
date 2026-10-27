/**
 * Add / Edit SMS Product form — matches legacy newsmsreplica visual layout.
 *
 * Migration source: `add_sms_products/create_edit_product_form.ctp` (964 lines).
 * Visual structure mirrors the legacy form 1:1 for the fields the user listed,
 * with Generic Product Type, Categories Selection, Storefront-flag, Pre-own,
 * and standalone "Add new option" cards removed per product request. The bottom
 * 3×3 attribute grid is the legacy `select2` tag UI with an "Enter New X" input
 * directly below each cell.
 *
 * Field option sources:
 *  - Typesense facets (manufacturer, team, season, color, sleeve-length,
 *    size-guide, age-group, gender) via `/api/products/typesense/:key`.
 *  - Local `dropdowns.extraInfoTypes` for the remaining attributes (Glove Type,
 *    attribute-grid Product Type, Driver, Name & Number Setting) — these have
 *    no Typesense facet today.
 *
 * Pre-population: the API resolves names server-side into
 * `data.preSelectedNames` so the combobox `value` props are correct on mount.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronRight, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useProductFormLoad,
  useSubmitForReview,
  useImageUrls,
  type SubmitForReviewPayload,
  type FormDropdowns,
} from './hooks/useDeliveriesMutations';
import { TypesenseMultiCombobox } from './TypesenseCombobox';
import { ExtraInfoTagSelect } from './ExtraInfoTagSelect';
import { DbCombobox, DbMultiCombobox } from './DbCombobox';

// ---------------------------------------------------------------------------
// Hardcoded option ids for the "Custom (Optional)" checkbox block. These match
// the legacy form's three personalisation rows (controller L498-509).
// ---------------------------------------------------------------------------
const CUSTOM_OPTIONS = [
  { id: 261, label: 'Name and Number' },
  { id: 5781, label: 'Shorts Printing' },
  { id: 5762, label: 'Training Personalisation' },
] as const;

// ---------------------------------------------------------------------------
// Form state — Typesense / extraInfo-backed fields store NAMES, resolved to
// IDs at submit time via the loaded dropdowns payload.
// ---------------------------------------------------------------------------

interface FormState {
  products_name: string;
  teamzo_products_name: string;
  products_description: string;
  products_price: string;
  products_teamzo_price: string;
  products_rrp_price: string;
  manufacturer_name: string;
  team_category_name: string;
  // Bottom 3x3 grid attribute selections (one value each, except colors which is multi).
  season_name: string;
  size_guide_name: string;
  age_group_name: string;
  product_type_attr_name: string; // attribute-grid Product Type
  glove_type_name: string;
  color_names: string[]; // max 3
  sleeve_length_name: string;
  gender_name: string;
  driver_name: string;
  // Top-level Product Type dropdown (distinct from attribute-grid Product Type).
  // Stores the *name* (matches the other DB-backed comboboxes); resolved to a
  // `product_types.type_id` at submit time. Legacy default for an un-saved
  // pcode is "Football Shirts" (legacy controller PMS 122471).
  products_type_name: string;
  // Custom (Optional) personalisation checkboxes.
  custom_options: number[];
  // Secondary sub-categories under the chosen Team Category.
  category_menu: number[];
  // Sleeve patch checkbox grid.
  sleeve_patches: number[];
  sleevePatchPrices: Record<string, string>;
  // Size attribute checkboxes (single group filtered by sizeAttributesForPcode).
  selectedSizeAttrs: number[];
  // Per-size price + prefix entered by the user (legacy: `price<povtpoId>` /
  // `prefix<povtpoId>` form fields). Keyed by povtpo id as string. Submit
  // packs these into `attributePrices` / `attributePrefixes`.
  sizeAttrPrices: Record<string, string>;
  sizeAttrPrefixes: Record<string, '+' | '-' | ''>;
  // Hero shirt queue checkbox.
  hero_shirt_queue: boolean;
  // "Enter New X" inputs underneath each bottom-grid attribute. Keyed by
  // extra-info type id so the submit payload's `newExtraInfo` is direct.
  newExtraInfo: Record<string, string>;
  // Personalisation player suggestions + description.
  player1: string;
  player2: string;
  player3: string;
}

const EMPTY_FORM: FormState = {
  products_name: '',
  teamzo_products_name: '',
  products_description: '',
  products_price: '',
  products_teamzo_price: '',
  products_rrp_price: '',
  manufacturer_name: '',
  team_category_name: '',
  season_name: '',
  size_guide_name: '',
  age_group_name: '',
  product_type_attr_name: '',
  glove_type_name: '',
  color_names: [],
  sleeve_length_name: '',
  gender_name: '',
  driver_name: '',
  products_type_name: '',
  custom_options: [],
  category_menu: [],
  sleeve_patches: [],
  sleevePatchPrices: {},
  selectedSizeAttrs: [],
  sizeAttrPrices: {},
  sizeAttrPrefixes: {},
  hero_shirt_queue: false,
  newExtraInfo: {},
  player1: '',
  player2: '',
  player3: '',
};

function highlightClass(field: string, prefilled: string[]): string {
  return prefilled.includes(field) ? '' : 'bg-yellow-50 border-yellow-300';
}

function toggleInArray<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

// ---------------------------------------------------------------------------
// Name → ID resolvers used at submit. Look up the loaded dropdowns payload as
// the source of truth.
// ---------------------------------------------------------------------------

function resolveId(
  list: Array<{ id: number; name: string }> | undefined,
  name: string
): number {
  if (!name || !list) return 0;
  const norm = name.trim().toLowerCase();
  const hit = list.find((x) => x.name.trim().toLowerCase() === norm);
  return hit ? hit.id : 0;
}

/** Look up the display name for an id in a `{id, name}[]` list. Used to
 *  pre-fill DbCombobox-backed fields whose form state stores names. */
function productTypeName(
  list: Array<{ id: number; name: string }> | undefined,
  id: number | null | undefined
): string | null {
  if (!id || !list) return null;
  return list.find((x) => x.id === id)?.name ?? null;
}

function resolveExtraInfoOid(
  dd: FormDropdowns | undefined,
  typeId: number | null,
  name: string
): number[] {
  if (!name || !dd || typeId == null) return [];
  const type = dd.extraInfoTypes.find((t) => t.id === typeId);
  if (!type) return [];
  const norm = name.trim().toLowerCase();
  const hit = type.options.find((o) => o.option_name.trim().toLowerCase() === norm);
  return hit ? [hit.oid] : [];
}

function resolveExtraInfoOids(
  dd: FormDropdowns | undefined,
  typeId: number | null,
  names: string[]
): number[] {
  if (!names.length || !dd || typeId == null) return [];
  const type = dd.extraInfoTypes.find((t) => t.id === typeId);
  if (!type) return [];
  const out: number[] = [];
  for (const n of names) {
    const norm = n.trim().toLowerCase();
    const hit = type.options.find((o) => o.option_name.trim().toLowerCase() === norm);
    if (hit) out.push(hit.oid);
  }
  return out;
}

function findTypeIdByName(dd: FormDropdowns | undefined, name: string): number | null {
  if (!dd) return null;
  const wanted = name.trim().toLowerCase();
  return (
    dd.extraInfoTypes.find((t) => (t.name ?? '').trim().toLowerCase() === wanted)?.id ?? null
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateEditProductFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pcode = (params.get('pcode') || '').trim();
  const calledFrom = params.get('called_from') ?? undefined;
  const requestUri = params.get('request_uri') ?? undefined;

  const { data, isLoading, isError, error } = useProductFormLoad(pcode || null);
  const submit = useSubmitForReview();

  // Image Preview overlay: legacy auto-opens an Image Preview popup on form
  // mount (create_sms_edit_product_form_js.ctp L105-120 → checkImageExist
  // AJAX), with Edit Images / Continue buttons. We mirror that here using
  // the legacy `product_code_image` + `product_code_additional_img` columns
  // (the only ones populated for SMS-only product codes; the newer
  // front/back/additional URL columns are NULL for these).
  const { data: images } = useImageUrls(pcode || null);
  const imageList = images?.sms_image_urls ?? [];
  const [imagePreviewClosed, setImagePreviewClosed] = useState(false);
  const imagePreviewOpen = imageList.length > 0 && !imagePreviewClosed;
  const handleEditImagesClick = () => {
    if (!pcode) return;
    window.open(
      `/products/new?pcode=${encodeURIComponent(pcode)}&step=images`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Attributes section is expanded by default so the user can see the
  // pre-checked sizes without having to click the toggle. The chevron still
  // collapses the grid on click for users who want to skip past it.
  const [sizeGroupOpen, setSizeGroupOpen] = useState(true);

  // Mandatory-field validation errors. Mirrors legacy `submit_form()` in
  // `create_sms_edit_product_form_js.ctp` L200-300: any failing field gets a
  // red border + light-red background and the user sees an inline error
  // banner. Empty Set = no errors / pre-submit state.
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const errorBorder = (field: string) =>
    errors.has(field) ? 'border-red-500 bg-red-50' : '';

  // Pre-fill once API returns. The server resolves all names so we just lift
  // them into state without lookup gymnastics.
  useEffect(() => {
    if (!data) return;
    const names = data.preSelectedNames;
    const ps = data.preSave;
    const m = data.mapped;
    // Re-prefill from previously-submitted sms_products_for_review row. Sits
    // just below `mapped` in precedence so an already-published product still
    // wins, but for Flow A pcodes the user's last form submission persists
    // across reopens.
    const rs = data.reviewSnapshot;

    // Pre-select Custom Options from sms_products_for_review.is_printing
    // (CSV of attribute ids written at submit), else pre_save.pscpd_printing
    // tokens, else mapped attrs.
    let customOptions: number[] = [];
    if (m?.selectedAttributes?.length) {
      const ids = m.selectedAttributes.map((a) => a.options_values_id);
      customOptions = CUSTOM_OPTIONS.map((c) => c.id).filter((id) => ids.includes(id));
    } else if (rs?.is_printing) {
      const customIds: Set<number> = new Set(CUSTOM_OPTIONS.map((c) => c.id));
      customOptions = rs.is_printing
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && customIds.has(n));
    } else if (ps?.pscpd_printing) {
      const tokens = ps.pscpd_printing.toLowerCase();
      if (tokens.includes('name')) customOptions.push(261);
      if (tokens.includes('short')) customOptions.push(5781);
      if (tokens.includes('training')) customOptions.push(5762);
    }

    // Pre-select size attrs (povtpo ids) from is_printing CSV — same source
    // as Custom Options above but the *non-custom* ids. Falls back to the
    // server-resolved default-set when no SPR row exists.
    let selectedSizeAttrs: number[] = data.defaultSelectedSizeAttrs ?? [];
    if (rs?.is_printing) {
      const customIds: Set<number> = new Set(CUSTOM_OPTIONS.map((c) => c.id));
      selectedSizeAttrs = rs.is_printing
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && !customIds.has(n));
    }

    // Pre-select Sleeve Patches.
    //   1. SPR `sleeve_patch` is `<option_value_id>:<price>,…`. To recover
    //      the povtpo ids the form keys on, we resolve option_value_id →
    //      povtpo via the dropdowns payload (each sleeve patch entry knows
    //      its povtpo, but only by id — so we look at the row's existing
    //      `products_options_values_to_products_options_id` and the
    //      underlying option value through the patch metadata). Simpler:
    //      legacy keeps the CSV stable, so we round-trip the prices map
    //      using option_value_id as the key shape if it doesn't match a
    //      povtpo (defensive — current sleeve patches table has 1:1
    //      povtpo↔option_value mapping in practice).
    //   2. Fall back to pre_save.pscpd_patch (CSV of povtpo ids).
    let sleevePatches: number[] = [];
    const sleevePatchPrices: Record<string, string> = {};

    if (rs?.sleeve_patch) {
      // Build option_value_id → povtpo lookup from dropdowns.
      const optionValueToPovtpo = new Map<number, number>();
      for (const p of data.dropdowns.sleevePatches) {
        // The dropdown row's `products_options_values_to_products_options_id`
        // IS the povtpo id; we cannot derive the option_value_id from the
        // dropdown payload alone, but the legacy convention is the column
        // names align, so we treat the povtpo→option_value resolution as
        // implicit here. For now, store the SPR price under the povtpo key
        // by trying both interpretations (SPR id key as povtpo first).
        optionValueToPovtpo.set(
          p.products_options_values_to_products_options_id,
          p.products_options_values_to_products_options_id
        );
      }
      for (const pair of rs.sleeve_patch.split(',')) {
        const [idStr, priceStr] = pair.split(':');
        const id = Number((idStr ?? '').trim());
        if (!Number.isFinite(id) || id <= 0) continue;
        const povtpo = optionValueToPovtpo.get(id) ?? id;
        if (!sleevePatches.includes(povtpo)) sleevePatches.push(povtpo);
        sleevePatchPrices[String(povtpo)] = (priceStr ?? '').trim() || '0';
      }
    } else if (ps?.pscpd_patch) {
      sleevePatches = ps.pscpd_patch
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }

    // Seed defaults for any pre-selected patch that doesn't have a price
    // yet — Flow B mapped, Flow A pscpd_patch (no price), or SPR rows that
    // resolved a povtpo but had an empty price.
    const attrPriceById = new Map(
      (m?.selectedAttributes ?? []).map((a) => [
        a.options_values_id,
        a.options_values_price ?? '',
      ])
    );
    for (const id of sleevePatches) {
      if (sleevePatchPrices[String(id)]) continue;
      const patch = data.dropdowns.sleevePatches.find(
        (p) => p.products_options_values_to_products_options_id === id
      );
      if (!patch) continue;
      const savedPrice = attrPriceById.get(id);
      sleevePatchPrices[String(id)] =
        (m?.products_id && savedPrice ? savedPrice : null) ??
        patch.options_values_price ??
        '0';
    }

    // Pre-fill category_menu: prefer SPR `product_categories` (legacy CSV
    // like "#123#,#456#"), else mapped categoryIds.
    let categoryMenu: number[] = (m?.categoryIds ?? []).filter(
      (id) => id !== (m?.master_categories_id ?? -1)
    );
    if (rs?.product_categories) {
      const ids = rs.product_categories
        .split(',')
        .map((s) => Number(s.replace(/[^0-9]/g, '')))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length) categoryMenu = ids;
    }

    // Pre-fill player names: SPR `players_name` is comma-joined player1/2/3.
    const reviewPlayers = (rs?.players_name ?? '')
      .split(',')
      .map((s) => s.trim());

    setForm((prev) => ({
      ...prev,
      products_name:
        m?.products_name ??
        rs?.product_name ??
        ps?.pscpd_title ??
        data.productList?.productName ??
        prev.products_name,
      teamzo_products_name:
        m?.teamzo_name ??
        rs?.teamzo_product_name ??
        ps?.pscpd_teamzo_product_title ??
        prev.teamzo_products_name,
      products_description:
        m?.products_description ?? rs?.product_description ?? prev.products_description,
      products_price:
        m?.products_price ?? rs?.product_price ?? ps?.pscpd_price ?? prev.products_price,
      products_teamzo_price:
        rs?.teamzo_price ?? ps?.pscpd_teamzo_price ?? prev.products_teamzo_price,
      products_rrp_price:
        m?.products_rrp_price ??
        rs?.rrp_price ??
        ps?.pscpd_rrp_price ??
        prev.products_rrp_price,
      manufacturer_name: names.manufacturer ?? prev.manufacturer_name,
      team_category_name: names.teamCategory ?? prev.team_category_name,
      season_name: names.season ?? prev.season_name,
      size_guide_name: names.sizeGuide ?? prev.size_guide_name,
      age_group_name: names.ageGroup ?? prev.age_group_name,
      product_type_attr_name: names.productTypeAttribute ?? prev.product_type_attr_name,
      glove_type_name: names.gloveType ?? prev.glove_type_name,
      color_names: names.colors.length ? names.colors : prev.color_names,
      sleeve_length_name: names.sleeveLength ?? prev.sleeve_length_name,
      gender_name: names.gender ?? prev.gender_name,
      driver_name: names.driver ?? prev.driver_name,
      // Product Type pre-fill — sources in precedence order:
      //   1. new_products.products_type (Flow B mapped product)
      //   2. product_lists.product_type (deliveries feed — set for fresh
      //      pcodes like KC4908 that haven't been mapped or pre-saved yet)
      //   3. Hard-coded "Football Shirts" (legacy default, PMS 122471).
      // Names rather than ids so the DbCombobox can render the value
      // directly without a follow-up lookup. We never fall back to
      // pscpd_type — that column holds the *Generic Product Type* CSV
      // hierarchy (legacy controller L3244-3247), not a product_types row.
      products_type_name:
        productTypeName(
          data.dropdowns.productTypes,
          m?.products_type ?? rs?.products_type ?? data.productList?.productType ?? null
        ) ?? 'Football Shirts',
      custom_options: customOptions,
      category_menu: categoryMenu,
      sleeve_patches: sleevePatches,
      sleevePatchPrices,
      // Pre-checked sizes: SPR-derived ids win on reopen (preserves user
      // edits), otherwise fall back to the server-resolved default-set
      // (resolved via sms_size_groups + default_selected_size).
      selectedSizeAttrs,
      hero_shirt_queue: Number(data.heroShirtQueue) > 0,
      player1: reviewPlayers[0] || ps?.pscpd_player1 || prev.player1,
      player2: reviewPlayers[1] || ps?.pscpd_player2 || prev.player2,
      player3: reviewPlayers[2] || ps?.pscpd_player3 || prev.player3,
    }));
  }, [data]);

  const prefilled = data?.prefilledMandatoryFields ?? [];
  const dd = data?.dropdowns;

  // Sub-categories filtered by selected team/master category (resolved → id).
  const subCategoriesForMaster = useMemo(() => {
    if (!dd) return [];
    const masterId = resolveId(dd.teamCategories, form.team_category_name);
    if (!masterId) return [];
    return dd.subCategoriesByParent.filter((c) => c.parent_id === masterId);
  }, [dd, form.team_category_name]);

  // DbMultiCombobox expects `{id, name}`; map the rows once per master change.
  const subCategoryOptions = useMemo(
    () =>
      subCategoriesForMaster.map((c) => ({
        id: c.categories_id,
        name: c.categories_name,
      })),
    [subCategoriesForMaster]
  );

  // Sort Attributes size rows so pre-selected sizes rise to the top — matches
  // the legacy form, which shows the resolved sms_size_groups_id picks first
  // then the rest of the manufacturer's sizes below. Sort is stable so legacy
  // backend ordering (povtpo.orderId then options_values_name) is preserved
  // within each half.
  const sortedSizeValues = useMemo(() => {
    const sizeGroup = data?.sizeAttributesForPcode;
    if (!sizeGroup) return [];
    const selected = new Set(form.selectedSizeAttrs);
    return [...sizeGroup.values].sort((a, b) => {
      const aSel = selected.has(a.products_options_values_to_products_options_id) ? 0 : 1;
      const bSel = selected.has(b.products_options_values_to_products_options_id) ? 0 : 1;
      return aSel - bSel;
    });
  }, [data?.sizeAttributesForPcode, form.selectedSizeAttrs]);

  // Resolve attribute-grid extra-info type ids dynamically (legacy and new
  // codebases disagree on numeric ids; resolve by name at runtime).
  const ageGroupTypeId = useMemo(() => findTypeIdByName(dd, 'Age Group'), [dd]);
  const productTypeAttrTypeId = useMemo(
    () => findTypeIdByName(dd, 'Product Type'),
    [dd]
  );
  const gloveTypeTypeId = useMemo(() => findTypeIdByName(dd, 'Glove Type'), [dd]);
  const genderTypeId = useMemo(() => findTypeIdByName(dd, 'Gender'), [dd]);
  const driverTypeId = useMemo(() => findTypeIdByName(dd, 'Driver') ?? 8, [dd]);

  // Helper to turn an extraInfoTypes row's options into the ExtraInfoTagSelect
  // option shape (value=option_name so resolution at submit is by-name).
  const optionsForType = (typeId: number | null) => {
    if (!dd || typeId == null) return [];
    const t = dd.extraInfoTypes.find((x) => x.id === typeId);
    if (!t) return [];
    return t.options.map((o) => ({ value: o.option_name, label: o.option_name }));
  };

  if (!pcode) {
    return (
      <div className="space-y-4">
        <PageHeader title="Add SMS Product" description="Submit a new product code for review." />
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Missing <code>pcode</code> in URL. Open this page via the{' '}
            <Link to="/deliveries" className="underline">deliveries grid</Link>.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ----- submit ---------------------------------------------------------
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;

    // Legacy mandatory-field validation — mirrors `submit_form()` in
    // `create_sms_edit_product_form_js.ctp` L200-300. We collect every
    // failing field, paint each one with a red border, and abort the submit
    // with a single banner-style toast — same UX as legacy
    // `#styleswitcher-bar2` "Fill out all of the required fields…".
    const next = new Set<string>();
    if (!form.products_name.trim()) next.add('products_name');
    if (!form.manufacturer_name.trim()) next.add('manufacturer_name');
    if (!form.products_type_name.trim()) next.add('products_type_name');
    if (!form.season_name.trim()) next.add('season_name');
    if (!form.size_guide_name.trim()) next.add('size_guide_name');
    if (!form.sleeve_length_name.trim()) next.add('sleeve_length_name');
    // Color is mandatory AND capped at 3 (legacy L243-248).
    if (form.color_names.length === 0 || form.color_names.length > 3) {
      next.add('color_names');
    }
    // At least one size must be checked when the size grid is rendered
    // (legacy L267-272 `.mainSize` check).
    if (data.sizeAttributesForPcode && form.selectedSizeAttrs.length === 0) {
      next.add('selectedSizeAttrs');
    }
    // Sleeve patch prices: any checked patch must have a non-negative price
    // (legacy L249-265). We mark the patch row in error and rely on the
    // input border below.
    for (const id of form.sleeve_patches) {
      const v = form.sleevePatchPrices[String(id)];
      if (v === '' || v == null || Number(v) < 0) {
        next.add(`sleevePatchPrice:${id}`);
      }
    }
    if (next.size > 0) {
      setErrors(next);
      toast.error('Fill out all of the required fields correctly in order to save.');
      return;
    }
    setErrors(new Set());

    const dd = data.dropdowns;
    const payload: SubmitForReviewPayload = {
      adults_products_model: pcode,
      mappedProductId: data.mappedProductId ? String(data.mappedProductId) : '',
      called_from: calledFrom,
      request_uri: requestUri,
      products_name: form.products_name.trim(),
      teamzo_products_name: form.teamzo_products_name.trim(),
      products_description: form.products_description.trim(),
      products_price: form.products_price ? Number(form.products_price) : 0,
      products_teamzo_price: form.products_teamzo_price ? Number(form.products_teamzo_price) : 0,
      products_rrp_price: form.products_rrp_price ? Number(form.products_rrp_price) : 0,
      manufacturers_id: resolveId(dd.manufacturers, form.manufacturer_name),
      master_category: resolveId(dd.teamCategories, form.team_category_name),
      products_type_id: resolveId(dd.productTypes, form.products_type_name),
      category_menu: form.category_menu,
      training_wear: [],
      // Submit Custom Optional ids + size grid ids in a single `attribute` array
      // (legacy contract — backend splits by id range).
      attribute: [...form.custom_options, ...form.selectedSizeAttrs],
      // Per-size price + prefix (legacy `price<povtpoId>` / `prefix<povtpoId>`).
      // Empty strings dropped client-side to mirror legacy default behavior of
      // not sending the form input when blank.
      attributePrices: Object.fromEntries(
        Object.entries(form.sizeAttrPrices).filter(([, v]) => v !== '')
      ),
      attributePrefixes: {
        // Custom Optional rows are always '+' in legacy (L564-566 hidden inputs).
        ...Object.fromEntries(CUSTOM_OPTIONS.map((c) => [String(c.id), '+'])),
        // Per-size prefixes (user-selected '+' or '-').
        ...form.sizeAttrPrefixes,
      },
      sleevePatchPrices: form.sleevePatchPrices,
      newExtraInfo: form.newExtraInfo,
      extra_info_kids_1: resolveExtraInfoOid(dd, 1, form.size_guide_name),
      extra_info_kids_2: resolveExtraInfoOid(dd, 2, form.sleeve_length_name),
      extra_info_kids_3: resolveExtraInfoOids(dd, 3, form.color_names),
      extra_info_kids_4: [],
      extra_info_kids_5: resolveExtraInfoOid(dd, 5, form.season_name),
      extra_info_kids_6: resolveExtraInfoOid(dd, gloveTypeTypeId, form.glove_type_name),
      extra_info_kids_7: [],
      extra_info_kids_8: form.driver_name
        ? resolveExtraInfoOid(dd, driverTypeId, form.driver_name).length
          ? resolveExtraInfoOid(dd, driverTypeId, form.driver_name).map(String)
          : [form.driver_name]
        : [],
      extra_info_kids_sleeve_patch: form.sleeve_patches,
      player1: form.player1,
      player2: form.player2,
      player3: form.player3,
      season_sort_order: data.productList?.seasonSort ?? 0,
      hot_product: 0,
      products_copa: 0,
      products_toffs: 0,
      grp_id: 0,
      kids_size_group_dropdown: 0,
    };

    submit.mutate(payload, {
      onSuccess: (res) => {
        const verb = data.mappedProductId ? 'updated' : 'submitted for review';
        toast.success(`Product ${res.productCode} ${verb} (id=${res.spr_id}).`);
        navigate(data.mappedProductId ? '/deliveries' : '/deliveries?sort=2');
      },
      onError: (err: Error & { code?: string }) => {
        toast.error(err.message || 'Submission failed');
      },
    });
  };

  // Image Preview overlay — extracted so it can render during the form's
  // loading/error states too (image URLs come from a separate endpoint and
  // can resolve before the form payload does).
  const imagePreviewDialog = (
    <Dialog
      open={imagePreviewOpen}
      onOpenChange={(open) => !open && setImagePreviewClosed(true)}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="flex flex-row items-center justify-between border-b pb-2 space-y-0">
          <DialogTitle>Image Preview</DialogTitle>
          <div className="flex items-center gap-2 mr-6">
            <Button type="button" size="sm" onClick={handleEditImagesClick}>
              Edit Images
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setImagePreviewClosed(true)}
            >
              Continue
            </Button>
          </div>
        </DialogHeader>
        <div className="flex gap-3 overflow-x-auto py-3">
          {imageList.map((img) => (
            <div key={img.label} className="relative shrink-0">
              {img.primary && (
                <span className="absolute top-2 left-2 bg-muted text-foreground text-xs px-2 py-0.5 rounded">
                  Primary
                </span>
              )}
              <img
                src={img.url}
                alt={img.label}
                className="h-40 w-auto object-contain border rounded"
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );

  // ----- loading / error states ----------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-4">
        {imagePreviewDialog}
        <PageHeader title={`Add SMS Product — ${pcode}`} />
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-sm font-medium">
                Loading form for <code>{pcode}</code>…
              </div>
              <div className="text-xs">
                Fetching product details, dropdowns and pre-saved attributes.
              </div>
            </div>
          </CardContent>
        </Card>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-4">
        {imagePreviewDialog}
        <PageHeader title={`Add SMS Product — ${pcode}`} />
        <Card>
          <CardContent className="py-8 text-sm text-destructive">
            Failed to load form: {(error as Error)?.message ?? 'unknown error'}
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFlowB = !!data.mappedProductId;
  const sizeGroup = data.sizeAttributesForPcode;

  return (
    <form onSubmit={handleSubmit} className="relative space-y-3">
      {imagePreviewDialog}

      <PageHeader
        title={isFlowB ? `Edit SMS Product — ${pcode}` : `Add SMS Product — ${pcode}`}
        description={
          isFlowB
            ? 'Edit an already-mapped product.'
            : 'Submit a new product code for review.'
        }
      />

      {prefilled.length > 0 && (
        <div className="text-xs flex items-start gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <Info className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            Yellow-highlighted fields below were not uploaded in the pre-save
            snapshot for <code>{pcode}</code>.
          </div>
        </div>
      )}

      {/* ===== Listing details ============================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listing Details</CardTitle>
          <p className="text-xs text-muted-foreground">
            Tell the world all about your item and why they'll love it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Read-only SMS Description Name + SMS Code Season */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">SMS Description Name</Label>
              <p className="font-medium">{data.productList?.productName ?? '—'}</p>
            </div>
            <div>
              <Label className="text-xs">SMS Code Season</Label>
              <p className="font-medium">{data.productList?.season ?? '—'}</p>
            </div>
          </div>

          <hr />

          {/* Title + Title (For Teamzo) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>
                Title <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Include keywords that buyers would use to search for your item.
              </p>
              <Input
                value={form.products_name}
                onChange={(e) => setForm({ ...form, products_name: e.target.value })}
                className={cn(
                  highlightClass('Product Title', prefilled),
                  errorBorder('products_name')
                )}
                placeholder="Title (For UKSoccerShop)"
                readOnly={isFlowB && !!form.products_name}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Title (For Teamzo)</Label>
              <p className="text-xs text-muted-foreground">
                Title with which product will be listed on Teamzo.
              </p>
              <Input
                value={form.teamzo_products_name}
                onChange={(e) =>
                  setForm({ ...form, teamzo_products_name: e.target.value })
                }
                placeholder="Title (For Teamzo)"
                readOnly={isFlowB && !!form.teamzo_products_name}
              />
            </div>
          </div>

          {/* Manufacturer + Product Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>
                Manufacturer <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">Who made it?</p>
              <DbCombobox
                options={dd?.manufacturers ?? []}
                value={form.manufacturer_name}
                onChange={(name) => setForm({ ...form, manufacturer_name: name })}
                className={cn(
                  highlightClass('Manufacturers', prefilled),
                  errorBorder('manufacturer_name')
                )}
                placeholder="Who Made It?"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Product Type <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Type of the product that you want to create
              </p>
              <DbCombobox
                options={dd?.productTypes ?? []}
                value={form.products_type_name}
                onChange={(name) => setForm({ ...form, products_type_name: name })}
                className={cn(errorBorder('products_type_name'))}
                placeholder="Select Product Type"
                allowClear={false}
              />
            </div>
          </div>

          <hr />

          {/* Team Category — sourced from DB (categories table) to match the
              legacy form. Typesense's `team` facet is a *subset* indexed from
              live products, so unmapped pcodes' team category wouldn't appear
              and the name→id lookup that drives the Sub-Categories block
              would silently fail. */}
          <div className="space-y-1">
            <Label>Team Category</Label>
            <p className="text-xs text-muted-foreground">
              Team Category for the Product. On select of any, corresponding
              Sub-Categories will be displayed and can be marked as category for
              this product.
            </p>
            <DbCombobox
              options={dd?.teamCategories ?? []}
              value={form.team_category_name}
              onChange={(name) =>
                setForm({ ...form, team_category_name: name, category_menu: [] })
              }
              placeholder="Select"
            />
          </div>
          {subCategoriesForMaster.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Sub-Categories (Max 4)
              </Label>
              <DbMultiCombobox
                options={subCategoryOptions}
                values={form.category_menu}
                onChange={(ids) => setForm({ ...form, category_menu: ids })}
                placeholder="Select sub-categories…"
                max={4}
              />
            </div>
          ) : null}

          <hr />

          {/* Pricing — Cost / UKSS / Teamzo / RRP */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label>Cost Price</Label>
              <Input
                value={data.preSave?.pscpd_cost_price ?? ''}
                placeholder="NA"
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-1">
              <Label>Products Price (UKSS)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.products_price}
                onChange={(e) => setForm({ ...form, products_price: e.target.value })}
                placeholder="UkSoccerShop Price"
              />
            </div>
            <div className="space-y-1">
              <Label>Products Price (Teamzo)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.products_teamzo_price}
                onChange={(e) =>
                  setForm({ ...form, products_teamzo_price: e.target.value })
                }
                placeholder="Teamzo Price"
              />
            </div>
            <div className="space-y-1">
              <Label>Recommended Retail Price (RRP)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.products_rrp_price}
                onChange={(e) =>
                  setForm({ ...form, products_rrp_price: e.target.value })
                }
                placeholder="Retail Price"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Custom (Optional) ========================================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom (Optional)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Choose your Personalization options. This will give buyers the
            option to personalize their favourite products.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {CUSTOM_OPTIONS.map((c) => {
              const checked = form.custom_options.includes(c.id);
              // Legacy form (`create_edit_product_form.ctp` L546-552) renders
              // Player 1/2/3 inputs inline with the *Name and Number* row only,
              // visible exclusively when that checkbox is ticked (JS at
              // `create_edit_product_form_js.ctp` L251-261 toggles the
              // `.customfields` display). Mirror that here so the input layout
              // matches one-for-one — `id === 261` is the Name and Number row.
              const showPlayerInputs = c.id === 261 && checked;
              return (
                <div key={c.id} className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        setForm({
                          ...form,
                          custom_options: toggleInArray(form.custom_options, c.id),
                        })
                      }
                    />
                    <span>{c.label}</span>
                  </label>
                  {showPlayerInputs ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 ml-6">
                      <Input
                        placeholder="Player 1"
                        value={form.player1}
                        onChange={(e) =>
                          setForm({ ...form, player1: e.target.value })
                        }
                      />
                      <Input
                        placeholder="Player 2"
                        value={form.player2}
                        onChange={(e) =>
                          setForm({ ...form, player2: e.target.value })
                        }
                      />
                      <Input
                        placeholder="Player 3"
                        value={form.player3}
                        onChange={(e) =>
                          setForm({ ...form, player3: e.target.value })
                        }
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ===== Sleeve Patch =============================================== */}
      {dd?.sleevePatches.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sleeve Patch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {dd.sleevePatches.map((p) => {
                const id = p.products_options_values_to_products_options_id;
                const checked = form.sleeve_patches.includes(id);
                // Legacy default price comes from `products_options_values.defualt_price`
                // (preserved typo) — see the `sleevePatches` query in product-form.service.ts
                // where it's surfaced as `options_values_price`. Use the
                // user-edited value if present, else the default.
                const priceKey = String(id);
                const priceValue =
                  form.sleevePatchPrices[priceKey] ??
                  (p.options_values_price || '0');
                return (
                  <div
                    key={id}
                    className={cn(
                      'rounded border px-2 py-1.5 text-sm space-y-1',
                      checked && 'bg-blue-50 border-blue-300'
                    )}
                  >
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          const nextSelected = toggleInArray(form.sleeve_patches, id);
                          const nextPrices = { ...form.sleevePatchPrices };
                          if (!form.sleeve_patches.includes(id)) {
                            // Newly checked — seed with the default price so
                            // the input isn't blank on first render. Matches
                            // legacy controller L586/L604 fallback chain.
                            nextPrices[priceKey] =
                              form.sleevePatchPrices[priceKey] ??
                              (p.options_values_price || '0');
                          } else {
                            // Unchecking — drop the price so we don't send a
                            // stale value at submit.
                            delete nextPrices[priceKey];
                          }
                          setForm({
                            ...form,
                            sleeve_patches: nextSelected,
                            sleevePatchPrices: nextPrices,
                          });
                        }}
                      />
                      <span>{p.products_options_values_name}</span>
                    </label>
                    {checked ? (
                      <div className="flex items-center gap-1.5 pl-6">
                        <span className="text-xs text-muted-foreground">Price:</span>
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={priceValue}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              sleevePatchPrices: {
                                ...form.sleevePatchPrices,
                                [priceKey]: e.target.value,
                              },
                            })
                          }
                          className={cn(
                            'h-7 text-xs',
                            errorBorder(`sleevePatchPrice:${id}`)
                          )}
                          placeholder="Patch Price"
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.hero_shirt_queue}
                  onCheckedChange={(c) =>
                    setForm({ ...form, hero_shirt_queue: !!c })
                  }
                  disabled={Number(data.heroShirtQueue) === 2}
                />
                <span>
                  Add to Hero Shirt Queue{' '}
                  {Number(data.heroShirtQueue) === 2 ? '(locked)' : ''}
                </span>
              </label>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ===== Attributes (size grid filtered to one group) ================ */}
      {sizeGroup ? (
        <Card className={cn(errors.has('selectedSizeAttrs') && 'border-red-500')}>
          <CardHeader>
            <CardTitle className="text-base">
              Attributes <span className="text-destructive">*</span>
            </CardTitle>
            {/* Collapsible header mirrors legacy `toggle()` JS — clicking the
                group name expands/collapses the size grid (legacy
                `create_edit_product_form_js.ctp` L324-347). */}
            <button
              type="button"
              onClick={() => setSizeGroupOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm font-bold text-left hover:text-primary transition-colors"
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 transition-transform',
                  sizeGroupOpen && 'rotate-90'
                )}
              />
              {sizeGroup.options_name}
            </button>
            {errors.has('selectedSizeAttrs') ? (
              <p className="text-xs text-destructive">
                Select at least one size.
              </p>
            ) : null}
          </CardHeader>
          {sizeGroupOpen ? (
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                {sortedSizeValues.map((v) => {
                  const povtpoId = v.products_options_values_to_products_options_id;
                  const checked = form.selectedSizeAttrs.includes(povtpoId);
                  const key = String(povtpoId);
                  // Legacy seeds the per-size price input with `0.0000` on the
                  // create/edit form (create_edit_product_form.ctp size grid).
                  const price = form.sizeAttrPrices[key] ?? '0.0000';
                  const prefix = form.sizeAttrPrefixes[key] ?? '+';
                  return (
                    <div
                      key={povtpoId}
                      className={cn(
                        'rounded border px-2 py-1.5 text-sm space-y-1',
                        checked && 'bg-blue-50 border-blue-300'
                      )}
                    >
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            const nextSelected = toggleInArray(
                              form.selectedSizeAttrs,
                              povtpoId
                            );
                            const nextPrefixes = { ...form.sizeAttrPrefixes };
                            const nextPrices = { ...form.sizeAttrPrices };
                            if (!checked) {
                              // Newly checked — seed default prefix '+' so the
                              // dropdown has a sensible initial value (matches
                              // legacy default at L2189/L2301), and seed the
                              // price with `0.0000` to mirror the legacy form's
                              // default size-price input value.
                              if (!nextPrefixes[key]) nextPrefixes[key] = '+';
                              if (nextPrices[key] == null) nextPrices[key] = '0.0000';
                            } else {
                              // Unchecking — drop price/prefix so we don't
                              // submit stale values for an unselected size.
                              delete nextPrices[key];
                              delete nextPrefixes[key];
                            }
                            setForm({
                              ...form,
                              selectedSizeAttrs: nextSelected,
                              sizeAttrPrices: nextPrices,
                              sizeAttrPrefixes: nextPrefixes,
                            });
                          }}
                        />
                        <span>{v.products_options_values_name}</span>
                      </label>
                      {checked ? (
                        <div className="flex items-center gap-1.5 pl-6">
                          <span className="text-xs text-muted-foreground">
                            Price:
                          </span>
                          <select
                            value={prefix}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                sizeAttrPrefixes: {
                                  ...form.sizeAttrPrefixes,
                                  [key]: e.target.value as '+' | '-',
                                },
                              })
                            }
                            className="h-7 px-1 text-xs rounded border bg-background"
                          >
                            <option value="+">+</option>
                            <option value="-">−</option>
                          </select>
                          <Input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={price}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                sizeAttrPrices: {
                                  ...form.sizeAttrPrices,
                                  [key]: e.target.value,
                                },
                              })
                            }
                            className="h-7 text-xs"
                            placeholder="Price"
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {/* ===== Bottom 3 × 3 attribute grid ================================ */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
            {/* Row 1: Season | Size Guide | Age Group */}
            <AttributeGridCell
              label="Season:"
              required
              kind="typesense"
              facetKey="season"
              values={form.season_name ? [form.season_name] : []}
              onChange={(vs) =>
                setForm({ ...form, season_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Season"
              newKey="5"
              newValue={form.newExtraInfo['5'] ?? ''}
              onNewChange={(v) =>
                setForm({ ...form, newExtraInfo: { ...form.newExtraInfo, 5: v } })
              }
              highlight={cn(
                highlightClass('Season', prefilled),
                errorBorder('season_name')
              )}
            />
            <AttributeGridCell
              label="Size Guide:"
              required
              kind="typesense"
              facetKey="size-guide"
              values={form.size_guide_name ? [form.size_guide_name] : []}
              onChange={(vs) =>
                setForm({ ...form, size_guide_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Size Guide"
              newKey="1"
              newValue={form.newExtraInfo['1'] ?? ''}
              onNewChange={(v) =>
                setForm({ ...form, newExtraInfo: { ...form.newExtraInfo, 1: v } })
              }
              highlight={cn(
                highlightClass('Size Guide', prefilled),
                errorBorder('size_guide_name')
              )}
            />
            <AttributeGridCell
              label="Age Group:"
              kind="typesense"
              facetKey="age-group"
              values={form.age_group_name ? [form.age_group_name] : []}
              onChange={(vs) =>
                setForm({ ...form, age_group_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Age Group"
              newKey={ageGroupTypeId ? String(ageGroupTypeId) : '_age'}
              newValue={
                ageGroupTypeId ? form.newExtraInfo[String(ageGroupTypeId)] ?? '' : ''
              }
              onNewChange={(v) =>
                ageGroupTypeId
                  ? setForm({
                      ...form,
                      newExtraInfo: { ...form.newExtraInfo, [ageGroupTypeId]: v },
                    })
                  : undefined
              }
            />

            {/* Row 2: Product Type | Glove Type | Color */}
            <AttributeGridCell
              label="Product Type:"
              kind="extra-info"
              options={optionsForType(productTypeAttrTypeId)}
              values={
                form.product_type_attr_name ? [form.product_type_attr_name] : []
              }
              onChange={(vs) =>
                setForm({ ...form, product_type_attr_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Product Type"
              newKey={
                productTypeAttrTypeId ? String(productTypeAttrTypeId) : '_pt'
              }
              newValue={
                productTypeAttrTypeId
                  ? form.newExtraInfo[String(productTypeAttrTypeId)] ?? ''
                  : ''
              }
              onNewChange={(v) =>
                productTypeAttrTypeId
                  ? setForm({
                      ...form,
                      newExtraInfo: {
                        ...form.newExtraInfo,
                        [productTypeAttrTypeId]: v,
                      },
                    })
                  : undefined
              }
            />
            <AttributeGridCell
              label="Glove Type:"
              kind="extra-info"
              options={optionsForType(gloveTypeTypeId)}
              values={form.glove_type_name ? [form.glove_type_name] : []}
              onChange={(vs) =>
                setForm({ ...form, glove_type_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Glove Type"
              newKey={gloveTypeTypeId ? String(gloveTypeTypeId) : '_gt'}
              newValue={
                gloveTypeTypeId
                  ? form.newExtraInfo[String(gloveTypeTypeId)] ?? ''
                  : ''
              }
              onNewChange={(v) =>
                gloveTypeTypeId
                  ? setForm({
                      ...form,
                      newExtraInfo: {
                        ...form.newExtraInfo,
                        [gloveTypeTypeId]: v,
                      },
                    })
                  : undefined
              }
            />
            <AttributeGridCell
              label="Color (select max 3 colors):"
              required
              kind="typesense-multi"
              facetKey="color"
              values={form.color_names}
              onChange={(vs) => setForm({ ...form, color_names: vs })}
              max={3}
              newPlaceholder="Enter New Color"
              newKey="3"
              newValue={form.newExtraInfo['3'] ?? ''}
              onNewChange={(v) =>
                setForm({ ...form, newExtraInfo: { ...form.newExtraInfo, 3: v } })
              }
              highlight={cn(
                highlightClass('Color', prefilled),
                errorBorder('color_names')
              )}
            />

            {/* Row 3: Sleeve Length | Gender | Driver */}
            <AttributeGridCell
              label="Sleeve Length:"
              required
              kind="typesense"
              facetKey="sleeve-length"
              values={form.sleeve_length_name ? [form.sleeve_length_name] : []}
              onChange={(vs) =>
                setForm({ ...form, sleeve_length_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Sleeve Length"
              newKey="2"
              newValue={form.newExtraInfo['2'] ?? ''}
              onNewChange={(v) =>
                setForm({ ...form, newExtraInfo: { ...form.newExtraInfo, 2: v } })
              }
              highlight={cn(
                highlightClass('Sleeve Length', prefilled),
                errorBorder('sleeve_length_name')
              )}
            />
            <AttributeGridCell
              label="Gender:"
              kind="typesense"
              facetKey="gender"
              values={form.gender_name ? [form.gender_name] : []}
              onChange={(vs) =>
                setForm({ ...form, gender_name: vs[0] ?? '' })
              }
              max={1}
              newPlaceholder="Enter New Gender"
              newKey={genderTypeId ? String(genderTypeId) : '_g'}
              newValue={
                genderTypeId ? form.newExtraInfo[String(genderTypeId)] ?? '' : ''
              }
              onNewChange={(v) =>
                genderTypeId
                  ? setForm({
                      ...form,
                      newExtraInfo: { ...form.newExtraInfo, [genderTypeId]: v },
                    })
                  : undefined
              }
            />
            <AttributeGridCell
              label="Driver:"
              kind="extra-info"
              options={optionsForType(driverTypeId)}
              values={form.driver_name ? [form.driver_name] : []}
              onChange={(vs) => setForm({ ...form, driver_name: vs[0] ?? '' })}
              max={1}
              newPlaceholder="Enter New Driver"
              newKey={String(driverTypeId)}
              newValue={form.newExtraInfo[String(driverTypeId)] ?? ''}
              onNewChange={(v) =>
                setForm({
                  ...form,
                  newExtraInfo: { ...form.newExtraInfo, [driverTypeId]: v },
                })
              }
              hideNewInput
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" asChild>
          <Link to="/deliveries">Cancel</Link>
        </Button>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending
            ? isFlowB
              ? 'Saving…'
              : 'Submitting…'
            : isFlowB
              ? 'Save Product'
              : 'Submit for Review'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AttributeGridCell — one bold label + tag-multi-select + "Enter New X" input.
// Matches the legacy newsmsreplica bottom-grid cell visuals.
// ---------------------------------------------------------------------------

type AttributeGridCellProps =
  | ({
      label: string;
      required?: boolean;
      kind: 'typesense';
      facetKey: string;
      values: string[];
      onChange: (vs: string[]) => void;
      max: number;
      newPlaceholder: string;
      newKey: string;
      newValue: string;
      onNewChange: (v: string) => void;
      highlight?: string;
      hideNewInput?: boolean;
    } & { options?: never })
  | ({
      label: string;
      required?: boolean;
      kind: 'typesense-multi';
      facetKey: string;
      values: string[];
      onChange: (vs: string[]) => void;
      max: number;
      newPlaceholder: string;
      newKey: string;
      newValue: string;
      onNewChange: (v: string) => void;
      highlight?: string;
      hideNewInput?: boolean;
    } & { options?: never })
  | {
      label: string;
      required?: boolean;
      kind: 'extra-info';
      options: Array<{ value: string; label: string }>;
      values: string[];
      onChange: (vs: string[]) => void;
      max: number;
      newPlaceholder: string;
      newKey: string;
      newValue: string;
      onNewChange: ((v: string) => void) | undefined;
      highlight?: string;
      hideNewInput?: boolean;
    };

function AttributeGridCell(props: AttributeGridCellProps) {
  return (
    <div className="space-y-1.5">
      <Label className="font-bold">
        {props.label}
        {props.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <div className={cn('rounded', props.highlight)}>
        {props.kind === 'typesense' ? (
          // Single-select Typesense rendered as a 1-cap multi for the legacy
          // tag look. Reuses TypesenseMultiCombobox with max=1.
          <TypesenseMultiCombobox
            facetKey={props.facetKey}
            values={props.values}
            onChange={props.onChange}
            maxSelected={1}
            placeholder="Select options"
          />
        ) : props.kind === 'typesense-multi' ? (
          <TypesenseMultiCombobox
            facetKey={props.facetKey}
            values={props.values}
            onChange={props.onChange}
            maxSelected={props.max}
            placeholder="Select options"
          />
        ) : (
          <ExtraInfoTagSelect
            options={props.options}
            values={props.values}
            onChange={props.onChange}
            max={props.max}
            placeholder="Select options"
          />
        )}
      </div>
      {props.hideNewInput ? null : (
        <Input
          value={props.newValue}
          onChange={(e) => props.onNewChange?.(e.target.value)}
          placeholder={props.newPlaceholder}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}
