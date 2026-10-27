/**
 * DeliveriesGrid — SlickGrid (slickgrid-react) rendering of the legacy SMS
 * "New Deliveries" / new_stock screen.
 *
 * Structure mirrors apps/web/src/pages/daily-deals/DailyDealsGrid.tsx.
 *
 * Spec: new_stock_grid.spec.md §6 (rows), §7 (background priority),
 * §8 (columns), §10 (permissions).
 *
 * Phase 2 wiring (this file):
 *  - Inline cell editors for `season`, `price`, and `option_<N>` columns gated
 *    by the matching permission. Submits via `useInlineCellEdit`.
 *  - Link Quantity dot fires `useLinkQuantityToggle` (with confirm).
 *  - Map / Special / +AddSmsProduct / Upload continue to deep-link to
 *    legacy SMS for parity. See documentation/deliveries-write-path-plan.md §2.
 *
 * First-load fix: SlickGrid v4 can mount with empty cell renderers when
 * the dataset prop is supplied in a single render pass. We force a
 * setColumns + setItems + resizeCanvas inside the grid-created callback to
 * "kick" the cell rendering into the populated state on first mount.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { SlickgridReact, type Column, type GridOption } from 'slickgrid-react';
import type { SlickgridReactInstance } from 'slickgrid-react';
import { Editors } from '@slickgrid-universal/common';
import '@slickgrid-universal/common/dist/styles/css/slickgrid-theme-bootstrap.css';
import { toast } from 'sonner';
import type { DeliveryRow, DeliveryFeaturePermissions } from './hooks/useDeliveries';

// Spec §6/§8 — 13 size columns. Header shows 4 stacked size variants per
// column (legacy parity, slickgrid_home_all_sizes.ctp:112-124):
//   line 1 = adult clothing size (XS, S, M, …)
//   line 2 = adult shoe size      (6, 6.5, 7, …)
//   line 3 = kids shoe size A     (10K, 11K, …)
//   line 4 = kids shoe size B     (11K, 12K, …)
// The full per-row size descriptor (e.g. "Small 36-38\" Chest") shown in the
// cell hover popup is NOT defined here — legacy reads it from
// `actual_size_options_comments` on manufacturers_sizes_to_default_size, which
// is per-row + per-size. Our API surfaces it via `row.size_comments[option_X]`
// (see deliveries.service.ts::optionSuffix).
export const SIZE_COLUMNS: {
  id: string;
  variants: [string, string, string, string];
  sizeId: number;
}[] = [
    { id: 'option_2701', sizeId: 2701, variants: ['XS', '6', '10K', '11K'] },
    { id: 'option_1', sizeId: 1, variants: ['S', '6.5', '11K', '12K'] },
    { id: 'option_2', sizeId: 2, variants: ['M', '7', '12K', '13K'] },
    { id: 'option_3', sizeId: 3, variants: ['L', '7.5', '13K', '1'] },
    { id: 'option_4', sizeId: 4, variants: ['XL', '8', '1', '1.5'] },
    { id: 'option_5', sizeId: 5, variants: ['XXL', '8.5', '1.5', '2'] },
    { id: 'option_623', sizeId: 623, variants: ['XXXL', '9', '2', '2.5'] },
    { id: 'option_1640', sizeId: 1640, variants: ['4XL', '9.5', '2.5', '3'] },
    { id: 'option_1641', sizeId: 1641, variants: ['5XL', '—', '—', '—'] },
    { id: 'option_509', sizeId: 509, variants: ['XSB', '10', '3', '3.5'] },
    { id: 'option_441', sizeId: 441, variants: ['SB', '10.5', '3.5', '4'] },
    { id: 'option_442', sizeId: 442, variants: ['MB', '11', '4', '4.5'] },
    { id: 'option_443', sizeId: 443, variants: ['LB', '12', '4.5', '5'] },
    { id: 'option_444', sizeId: 444, variants: ['XLB', '13', '5', '5.5'] },
  ];

// Per-size context resolved from a right-click on a size cell — the 4
// size-scoped context-menu commands (`remap_size`, `print_label`,
// `supplier_barcode`, `mystery_product`) all need this, not just the bare
// `product_code` the grid used to forward.
export interface SizeActionContext {
  productCode: string;
  productListsId: number;
  boxCode: string;
  sizeId: number;
}

// Greys out the size-scoped context-menu actions (remap/print/barcode/mystery) unless the right-clicked cell is a size box holding a quantity.
function isSizeCellActionUsable(args: {
  column?: { field?: string };
  dataContext?: DeliveryRow;
}): boolean {
  const field = args.column?.field;
  if (!field) return false;
  if (!SIZE_COLUMNS.some((sc) => sc.id === field)) return false;
  const row = args.dataContext;
  if (!row) return false;
  if ((row.product_lists_id ?? row.product_list_id) == null) return false;
  const cellValue = (row as unknown as Record<string, unknown>)[field];
  return !(cellValue == null || String(cellValue).trim() === '');
}

// ---------------------------------------------------------------------------
// Cell formatters
// ---------------------------------------------------------------------------

function sizeQuantityFormatter(
  _row: number,
  _cell: number,
  value: unknown,
  columnDef?: { field?: string },
  dataContext?: { size_comments?: Record<string, string> },
) {
  // API strips the legacy "<qty>#<descriptor>" suffix server-side; defensive
  // split keeps older cached payloads rendering correctly.
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value);
  const hash = raw.indexOf('#');
  const qty = hash === -1 ? raw : raw.slice(0, hash);
  // Legacy parity (slick.formatters.js CommentFormatter): the size name shown
  // on hover comes from the per-row `actual_size_options_comments` field — the
  // suffix after `#` in the original cell value. Our API now surfaces those
  // suffixes under `size_comments[<field>]`. Falls back to the inline `#`
  // suffix (above) only if the API hasn't been updated yet.
  const field = columnDef?.field ?? '';
  const fromMap = field && dataContext?.size_comments ? dataContext.size_comments[field] : undefined;
  const inline = hash === -1 ? '' : raw.slice(hash + 1);
  const sizeName = fromMap || inline;
  const box = sizeName ? `<div class="commentBox">${escapeHtml(sizeName)}</div>` : '';
  // Legacy parity: quantity is rendered plain — inherits the cell's default
  // black text colour (slick_grid.css `color: black`). We previously styled
  // non-zero values green (#15803d, bold) and zero values light grey, but
  // legacy uses no per-state colouring. Keeping the qty unstyled lets the
  // row's coloured background (red / pink / blue / etc.) be the sole signal.
  const text = !qty || qty === '0' ? '0' : qty;
  return `<div class="commentImage">${text}${box}</div>`;
}

// Small HTML escape helper — keeps quotes in tooltips from breaking the
// attribute string.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function priceFormatter(_r: number, _c: number, value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : String(value ?? '');
}

function mapFormatter(_r: number, _c: number, value: unknown) {
  // Click → open Map dialog (handled in onClick via data-action="map").
  const isMapped = value === 'Mapped';
  const bg = isMapped ? '#16a34a' : '#e5e7eb';
  const fg = isMapped ? '#fff' : '#6b7280';
  return `<span class="del-action" data-action="map" title="${isMapped ? 'Mapped — click to re-map' : 'Unmapped — click to map'}" style="display:inline-block;width:18px;height:18px;background:${bg};color:${fg};font-weight:bold;font-size:11px;line-height:18px;text-align:center;border-radius:2px;cursor:pointer">M</span>`;
}

function specialFormatter(_r: number, _c: number, value: unknown) {
  // Click → open Special dialog.
  const active = value === '1';
  const bg = active ? '#3b82f6' : '#e5e7eb';
  const fg = active ? '#fff' : '#6b7280';
  return `<span class="del-action" data-action="special" title="${active ? 'Special active — click to edit/clear' : 'No special — click to set'}" style="display:inline-block;width:18px;height:18px;background:${bg};color:${fg};font-weight:bold;font-size:11px;line-height:18px;text-align:center;border-radius:2px;cursor:pointer">S</span>`;
}

// `attr` is a comma-list of missing size *IDs* (legacy slickgrid_home.ctp:665
// splits on "," and prefixes each with "option_"). Map IDs -> the clothing
// label from SIZE_COLUMNS so the column reads "XS, S" instead of "2701, 1".
function missingSizeFormatter(_r: number, _c: number, value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const labelById = new Map(SIZE_COLUMNS.map((s) => [String(s.sizeId), s.variants[0]]));
  const parts = raw
    .split(',')
    .map((id) => labelById.get(id.trim()) ?? id.trim())
    .filter(Boolean);
  return escapeHtml(parts.join(', '));
}

// All status / action glyphs share this base — keeps the original symbols
// (●, ✓, ○, ⇪, ⬇, +) but renders them much larger so they read at a glance.
// 20px glyphs at column widths of 85-110 fit comfortably inside the 30px row.
const ICON_BASE =
  'display:inline-flex;align-items:center;justify-content:center;' +
  'width:24px;height:24px;line-height:1;' +
  'font-size:20px;font-weight:700;cursor:pointer;user-select:none;' +
  'text-shadow:0 1px 0 rgba(0,0,0,0.08);';

function linkQuantityFormatter(_r: number, _c: number, value: unknown) {
  return value === '1'
    ? `<span class="del-action" data-action="link-quantity" title="ZC Linked — click to unlink" style="${ICON_BASE}color:#16a34a">●</span>`
    : `<span class="del-action" data-action="link-quantity" title="Not linked — click to link" style="${ICON_BASE}color:#dc2626">●</span>`;
}

function assignFontFormatter(_r: number, _c: number, value: unknown) {
  // value format: "yes#productcode#boxcode" or "no#productcode#boxcode".
  const flag = String(value ?? '').split('#')[0];
  const assigned = flag === 'yes' || flag === '1';
  return assigned
    ? `<span class="del-action" data-action="assign-font" title="Fonts assigned — click to edit" style="${ICON_BASE}color:#16a34a">✓</span>`
    : `<span class="del-action" data-action="assign-font" title="No fonts — click to assign" style="${ICON_BASE}color:#6b7280">○</span>`;
}

function uploadImageFormatter(_r: number, _c: number, value: unknown, _cd: unknown, item: DeliveryRow) {
  // Upload icon (⇪) when no image yet, edit icon (✎) once one exists — both open the wizard's Images step.
  const code = escapeHtml(String(item.product_code ?? ''));
  const hasImage = value !== '0';
  const icon = hasImage ? '✎' : '⇪';
  const color = hasImage ? '#16a34a' : '#2563eb';
  const title = hasImage ? 'Edit image' : 'Upload image';
  return `<a class="del-action" data-action="upload-image" data-product-code="${code}" title="${title}" style="${ICON_BASE}color:${color};text-decoration:none">${icon}</a>`;
}

function descriptionFormatter(_r: number, _c: number, value: unknown, _cd: unknown, _item: DeliveryRow) {
  // Let the name fill the cell and ellipsize via CSS; full name shown on hover.
  const name = String(value ?? '');
  // Escape fully — the name is injected as innerHTML.
  const safe = escapeHtml(name);
  return `<span title="${safe}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safe}</span>`;
}

function addSmsProductFormatter(_r: number, _c: number, _v: unknown, _cd: unknown, item: DeliveryRow) {
  // Single "+" entry into the Stock2 New Product wizard.
  const code = escapeHtml(String(item.product_code ?? ''));
  return `<a class="del-action" data-action="add-sms-product" data-product-code="${code}" title="Add SMS Product" style="${ICON_BASE}color:#16a34a;text-decoration:none">+</a>`;
}

// ---------------------------------------------------------------------------
// Column factory
// ---------------------------------------------------------------------------

function buildColumns(
  perms: DeliveryFeaturePermissions,
  seasons: string[]
): Column[] {
  // Season dropdown collection — same source as the form's TypesenseCombobox
  // for the `season` facet, so the inline editor and the form stay in sync.
  // SlickGrid's singleSelect expects `{value, label}` rows.
  const seasonCollection = seasons.map((s) => ({ value: s, label: s }));

  const cols: Column[] = [
    {
      id: 'product_name',
      name: 'Product Name',
      field: 'product_name',
      width: 230,
      sortable: false,
      formatter: descriptionFormatter,
    },
    {
      id: 'season',
      name: 'Season',
      field: 'season',
      width: 80,
      // Legacy parity (slickgrid_home_all_sizes.ctp:106-108): only `season`
      // is sortable. Click toggles asc/desc within the current loaded page;
      // server-side ordering is driven separately by the page-level `sort`
      // filter dropdown.
      sortable: true,
      cssClass: 'text-center text-[11px]',
      headerCssClass: 'text-center',
      ...(perms.EDIT_SEASON
        ? {
          editor: {
            model: Editors.singleSelect,
            collection: seasonCollection,
            editorOptions: { filter: true },
          },
        }
        : {}),
    },
  ];

  // Each size header shows the 4 variants stacked vertically with a
  // thin horizontal rule between them (legacy parity — the legacy view
  // sets `name: "XS<hr/>6<hr/>10K<hr/>11K"` etc., see
  // slickgrid_home_all_sizes.ctp:112-124). SlickGrid renders
  // `column.name` as HTML, so we mirror the legacy `<hr/>` separators
  // and reset their default margin so they sit tight against the lines
  // they divide.
  const buildSizeHeaderHtml = (sc: typeof SIZE_COLUMNS[number]): string =>
    `<div style="line-height:1.15">${sc.variants
      .map((v) => `<div>${escapeHtml(v)}</div>`)
      .join('<hr style="margin:1px 2px;border:0;border-top:1px solid #9ca3af">')}</div>`;

  if (perms.EDIT_QUANTITIES) {
    for (const sc of SIZE_COLUMNS) {
      cols.push({
        id: sc.id,
        name: buildSizeHeaderHtml(sc),
        field: sc.id,
        width: 44,
        sortable: false,
        cssClass: 'text-center text-[11px]',
        headerCssClass: 'text-center',
        formatter: sizeQuantityFormatter,
        editor: { model: Editors.text, maxLength: 8 },
      });
    }
  } else {
    // Still render the size columns (read-only) when the user has view but
    // not edit. The grid's read service emits the values regardless.
    for (const sc of SIZE_COLUMNS) {
      cols.push({
        id: sc.id,
        name: buildSizeHeaderHtml(sc),
        field: sc.id,
        width: 44,
        sortable: false,
        cssClass: 'text-center text-[11px]',
        headerCssClass: 'text-center',
        formatter: sizeQuantityFormatter,
      });
    }
  }

  cols.push(
    {
      id: 'boxcode',
      name: 'Box',
      field: 'boxcode',
      width: 80,
      sortable: false,
      cssClass: 'text-[11px]',
    },
    {
      id: 'product_code',
      name: 'Product Code',
      field: 'product_code',
      width: 110,
      sortable: false,
      cssClass: 'font-mono text-[11px]',
    },
    {
      id: 'price',
      name: 'Price',
      field: 'price',
      width: 64,
      sortable: false,
      cssClass: 'text-right text-[11px]',
      headerCssClass: 'text-right',
      formatter: priceFormatter,
      ...(perms.EDIT_PRICE
        ? { editor: { model: Editors.text, maxLength: 16 } }
        : {}),
    },
  );

  if (perms.MAP_PRODUCTS) {
    cols.push({
      id: 'map',
      name: 'Map',
      field: 'map',
      width: 45,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: mapFormatter,
    });
  }

  cols.push({
    id: 'last_sale_day',
    name: 'Day Since Last Sale',
    field: 'last_sale_day',
    width: 110,
    sortable: false,
    cssClass: 'text-center text-[11px]',
    headerCssClass: 'text-center',
  });

  if (perms.SET_SPECIAL_PRICE_AND_DEAL) {
    cols.push({
      id: 'special',
      name: 'Special',
      field: 'special',
      width: 60,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: specialFormatter,
    });
    cols.push({
      id: 'special_price',
      name: 'Special Price',
      field: 'special_price',
      width: 60,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      editor: { model: Editors.text, maxLength: 8 },
    });
  }

  if (perms.LINK_QUANTITY) {
    cols.push({
      id: 'quantity_map',
      name: 'Link Quantity',
      field: 'quantity_map',
      width: 85,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: linkQuantityFormatter,
    });
  }

  if (perms.ADD_SMS_PRODUCT) {
    cols.push({
      id: 'add_sms_product',
      name: 'Add SMS Product',
      field: 'product_code',
      width: 110,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: addSmsProductFormatter,
    });
  }

  cols.push({
    id: 'percentage_sold',
    name: 'Sold %',
    field: 'percentage_sold',
    width: 60,
    sortable: false,
    cssClass: 'text-center text-[11px]',
    headerCssClass: 'text-center',
  });

  if (perms.ASSIGN_FONTS) {
    cols.push({
      id: 'assign_font',
      name: 'Assign Font',
      field: 'assign_font',
      width: 90,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: assignFontFormatter,
    });
  }

  // Missing Size (attr) — read-only comma-list of missing size IDs, shown as
  // size labels via missingSizeFormatter. Legacy parity (slickgrid_home.ctp:360).
  cols.push({
    id: 'attr',
    name: 'Missing Size',
    field: 'attr',
    width: 80,
    sortable: false,
    cssClass: 'text-center text-[11px]',
    headerCssClass: 'text-center',
    formatter: missingSizeFormatter,
  });

  if (perms.UPLOAD_IMAGE) {
    cols.push({
      id: 'upload_image',
      name: 'Upload Image',
      field: 'upload_image',
      width: 95,
      sortable: false,
      cssClass: 'text-center',
      headerCssClass: 'text-center',
      formatter: uploadImageFormatter,
    });
  }

  return cols;
}

// Spec §7 — first match wins.
function rowBgClass(row: DeliveryRow): string | undefined {
  if (row.submitted_for_review === '1') return 'delivery-row-red';
  if (row.image_added_bit === '1') return 'delivery-row-lightblue';
  if (row.one_size === '1') return 'delivery-row-green';
  if (row.add_product_status === 'partially_complete') return 'delivery-row-orange';
  if (row.map !== 'Mapped') return 'delivery-row-pink';
  if (row.special === '1') return 'delivery-row-blue';
  if (row.quantity_map === '1') return 'delivery-row-yellow';
  return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DeliveriesGridCallbacks {
  /** Server-side write — caller decides UX (toast/error etc.). Returning a
   *  Promise that resolves indicates success; reject indicates failure. The
   *  grid uses this to flash the cell green on success only. */
  onCellEdit?: (payload: { productQuantitiesId: number; column: string; value: string }) => Promise<void> | void;
  /** Toggle quantity_map (link/unlink). */
  onLinkQuantityClick?: (productCode: string, currentlyLinked: boolean) => void;
  /** Navigate to the Stock2 New Product wizard (+ button). */
  onAddSmsProductClick?: (productCode: string) => void;
  /** Navigate to the Stock2 New Product wizard (E badge on Description). */
  onEditProductClick?: (productCode: string) => void;
  /** Navigate to the Stock2 New Product wizard's Images step. */
  onUploadImageClick?: (productCode: string) => void;
  /** Open Map dialog (ZC-category-mapping) for the given product code. Fired
   *  by the row's inline "M" button — distinct from `onRemapSizeClick`,
   *  which is fired by the context-menu "Remap Size" command and opens an
   *  unrelated per-size barcode remap dialog. */
  onMapClick?: (productCode: string) => void;
  /** Open Special dialog for the given product code. */
  onSpecialClick?: (productCode: string) => void;
  /** Open Assign Font dialog for the given product code. */
  onAssignFontClick?: (productCode: string) => void;
  /** Context-menu "Remap Size" command — moves a barcode from one size to
   *  another. Distinct from `onMapClick` (ZC-category-mapping dialog). */
  onRemapSizeClick?: (ctx: SizeActionContext) => void;
  /** Context-menu "Print Label" command. */
  onPrintLabelClick?: (ctx: SizeActionContext) => void;
  /** Context-menu "Add Alternate/Supplier Barcode" command. */
  onSupplierBarcodeClick?: (ctx: SizeActionContext) => void;
  /** Context-menu "Add to Mystery Product List" command. */
  onMysteryProductClick?: (ctx: SizeActionContext) => void;
}

interface Props extends DeliveriesGridCallbacks {
  rows: DeliveryRow[];
  permissions: DeliveryFeaturePermissions;
  /** Season options for the inline season dropdown. Comes from the same
   *  /products/typesense/season endpoint the New SMS Product form uses. */
  seasons?: string[];
}

// Persisted grid height storage key + bounds. Kept short so the localStorage
// inspector stays tidy; the default `calc(100vh - 360px)` from CSS still
// applies when no override is stored.
const GRID_HEIGHT_STORAGE_KEY = 'deliveries.gridHeight';
const GRID_HEIGHT_MIN = 240;
const GRID_HEIGHT_MAX = 2000;

export function DeliveriesGrid({
  rows,
  permissions,
  seasons = [],
  onCellEdit,
  onLinkQuantityClick,
  onAddSmsProductClick,
  onEditProductClick,
  onUploadImageClick,
  onMapClick,
  onSpecialClick,
  onAssignFontClick,
  onRemapSizeClick,
  onPrintLabelClick,
  onSupplierBarcodeClick,
  onMysteryProductClick,
}: Props) {
  const gridInstanceRef = useRef<SlickgridReactInstance | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Client-side header-row filters (legacy spec §5.5 — within-loaded-page).
  const headerFiltersRef = useRef<{ product_name: string; boxcode: string; product_code: string }>({
    product_name: '',
    boxcode: '',
    product_code: '',
  });

  const columnDefinitions = useMemo(
    () => buildColumns(permissions, seasons),
    [
      permissions.EDIT_SEASON,
      permissions.EDIT_QUANTITIES,
      permissions.EDIT_PRICE,
      permissions.MAP_PRODUCTS,
      permissions.SET_SPECIAL_PRICE_AND_DEAL,
      permissions.LINK_QUANTITY,
      permissions.ADD_SMS_PRODUCT,
      permissions.ASSIGN_FONTS,
      permissions.ADD_IMAGE,
      permissions.UPLOAD_IMAGE,
      seasons,
    ]
  );

  // Mirrors slickgrid-react's `loadSlickGridEditors` (slickgrid-react.js:1330):
  //   `{ ...column, editorClass: column.editor?.model }`
  // SlickGrid's `getEditor(row, cell)` reads `column.editorClass` — NOT
  // `column.editor`. The React wrapper attaches `editorClass` automatically
  // when columns flow through `<SlickgridReact columnDefinitions={...}>`, but
  // we lose it whenever we call `inst.slickGrid.setColumns(columnDefinitions)`
  // directly (we do this twice — once in the rows effect to fix the
  // "blank first load" issue, once in handleGridCreated). Without `editorClass`,
  // `isCellPotentiallyEditable` returns false → dblclick never opens the
  // editor. That's the intermittent edit-failure bug: when a dialog open/close
  // triggers the React wrapper to reprocess columns, the editor works again,
  // until our next manual setColumns overwrites it. Pre-attaching `editorClass`
  // here keeps the property alive across our manual setColumns calls.
  const columnsForSlickGrid = useMemo(
    () => columnDefinitions.map((col: any) => ({
      ...col,
      editorClass: col.editorClass ?? col.editor?.model,
    })),
    [columnDefinitions]
  );


  // Right-click context-menu command dispatch (edit / map / print_label /
  // supplier_barcode / mystery_product — see `contextMenu.commandItems`
  // below). SlickGrid's ContextMenu plugin snapshots `gridOptions.contextMenu`
  // once at creation time, so `onCommand` itself must stay a stable function
  // reference (assigned inside the `[]`-memoized `gridOptions` below) — it
  // forwards through this ref so it always dispatches to the latest
  // callback props without requiring the plugin to be re-created.
  const contextMenuCommandHandlerRef = useRef<
    (
      e: unknown,
      args: { command?: string; cell?: number; column?: { field?: string }; dataContext?: DeliveryRow }
    ) => void
  >(() => { });

  useEffect(() => {
    contextMenuCommandHandlerRef.current = (_e, args) => {
      const row = args.dataContext;
      const productCode = row?.product_code;
      if (!productCode) return;

      if (args.command === 'edit') {
        onEditProductClick?.(productCode);
        return;
      }

      // The remaining commands are size-scoped — resolve the clicked column
      // to a size, and require a product_lists_id, before dispatching.
      const columnField =
        args.column?.field ??
        gridInstanceRef.current?.slickGrid?.getColumns?.()?.[args.cell as number]?.field;
      const sizeEntry = SIZE_COLUMNS.find((sc) => sc.id === columnField);
      const productListsId = row?.product_lists_id ?? row?.product_list_id;
      const boxCode = row?.boxcode;

      switch (args.command) {
        case 'remap_size':
        case 'print_label':
        case 'supplier_barcode':
        case 'mystery_product': {
          if (!sizeEntry || productListsId == null) {
            toast.error('Right-click a size cell to use this action.');
            return;
          }
          const ctx: SizeActionContext = {
            productCode,
            productListsId,
            boxCode: boxCode ?? '',
            sizeId: sizeEntry.sizeId,
          };
          if (args.command === 'remap_size') onRemapSizeClick?.(ctx);
          else if (args.command === 'print_label') onPrintLabelClick?.(ctx);
          else if (args.command === 'supplier_barcode') onSupplierBarcodeClick?.(ctx);
          else onMysteryProductClick?.(ctx);
          break;
        }
        default:
          break;
      }
    };
  }, [onEditProductClick, onRemapSizeClick, onPrintLabelClick, onSupplierBarcodeClick, onMysteryProductClick]);

  const gridOptions = useMemo<GridOption>(
    () => ({
      enableSorting: true,
      enableCellNavigation: true,
      // Legacy parity (slick.grid.js default at L66: `enableColumnReorder: true`).
      // SlickGrid attaches a jQuery-UI sortable to the header strip; with
      // `frozenColumn: 1` the left and right panes act as independent sortable
      // zones — operators can reorder within each pane but cannot drag a column
      // across the freeze line. Same as legacy.
      enableColumnReorder: true,
      enableAutoResize: true,
      // Default autoResize mode ('window') sizes the grid from
      // `window.innerHeight - gridElement.offsetTop - bottomPadding`, ignoring
      // `.deliveries-grid-wrap`'s own CSS height entirely. When that offset is
      // measured before layout has settled it falls back to SlickGrid's
      // hardcoded 180px floor (≈5 rows), only self-correcting on a later
      // window-resize event — which is what made rows-per-page + scrolling
      // "fix" it. Pointing the resizer at our own wrapper via
      // `calculateAvailableSizeBy: 'container'` + `resizeDetection: 'container'`
      // makes it read the wrapper's actual (CSS-driven) height directly via
      // ResizeObserver, so it's correct on first paint and stays in sync with
      // the wrapper's calc(100vh - …) height and its drag-to-resize handle.
      autoResize: {
        container: '.deliveries-grid-wrap',
        calculateAvailableSizeBy: 'container',
        resizeDetection: 'container',
        bottomPadding: 0,
      },
      forceFitColumns: false,
      rowHeight: 30,
      headerRowHeight: 30,
      enableHeaderMenu: false,
      enableGridMenu: false,
      enableColumnPicker: false,
      // Header-row inline filter inputs (legacy headerRow). Wired in
      // wireGridEvents via grid.onHeaderRowCellRendered.
      showHeaderRow: true,
      // Cell-edit infrastructure. `autoEdit: false` keeps single-click
      // for navigation; the editor opens only on dblclick (handler below)
      // or F2 (SlickGrid built-in keybinding). Single-click-to-edit
      // (`autoEdit: true`) had intermittent failures that we haven't
      // root-caused — TODO: revisit once we can reproduce reliably.
      editable: true,
      autoEdit: false,
      asyncEditorLoading: false,
      enableAddRow: false,
      // Freeze the first two columns (Description + Season). SlickGrid splits
      // the grid into a left (frozen) pane and a right (scrollable) pane. The
      // grid owns both its scrollbars internally — the wrapper has a fixed
      // height so the page itself never grows a horizontal scrollbar.
      frozenColumn: 1,
      // Right-click context menu: kept ON so SlickGrid's built-in "Copy
      // Cell Value" command is available. No custom commands — editing is
      // driven by `autoEdit: true` (single click) above, not by a context
      // menu entry. (Legacy's contextMenu has Edit/Remap/Close items but
      // those navigate to separate pages, not the inline editor — see
      // slickgrid_home_all_sizes.ctp:462-493.)
      enableContextMenu: true,
      contextMenu: {
        hideCopyCellValueCommand: false,
        // Centralised dispatch for all custom commandItems below — forwards
        // through contextMenuCommandHandlerRef (see above) rather than
        // reading these callback props directly, since this object is
        // captured once by the ContextMenu plugin at grid-creation time.
        onCommand: (e, args) => contextMenuCommandHandlerRef.current(e, args),
        commandItems: [
          {
            command: 'edit',
            title: 'Edit Product',
          },
          ...(permissions.MAP_PRODUCTS
            ? [{
              command: 'remap_size',
              title: 'Remap Size',
              itemUsabilityOverride: isSizeCellActionUsable,
            }]
            : []),
          {
            command: 'print_label',
            title: 'Print Label',
            itemUsabilityOverride: isSizeCellActionUsable,
          },
          ...(permissions.SUPPLIER_BARCODE
            ? [{
              command: 'supplier_barcode',
              title: 'Add Alternate/Supplier Barcode',
              itemUsabilityOverride: isSizeCellActionUsable,
            }]
            : []),
          ...(permissions.MYSTERY_LIST
            ? [{
              command: 'mystery_product',
              title: 'Add to Mystery Product List',
              itemUsabilityOverride: isSizeCellActionUsable,
            }]
            : []),
        ],
      },
    }),
    [permissions.MAP_PRODUCTS, permissions.SUPPLIER_BARCODE, permissions.MYSTERY_LIST]
  );


  /**
   * Wire SlickGrid event subscriptions into our React callbacks.
   *
   * We attach to the underlying SlickGrid (not the slickgrid-react wrapper)
   * because the wrapper does not surface `onCellChange` as a prop.
   */
  const wireGridEvents = useCallback(
    (inst: SlickgridReactInstance) => {
      const grid = inst.slickGrid;
      if (!grid) return () => { };
      const unsubs: Array<() => void> = [];

      // ---- Cell flash on save (3s) --------------------------------------
      // Green → server accepted the edit. Red → server rejected (the parent
      // toast already shows the error message). Uses addCellCssStyles +
      // setTimeout. The CSS class fades the colour away via a transition
      // (see delivery-row-colors.css).
      const flashCell = (row: number, cell: number, kind: 'green' | 'red') => {
        const cols = grid.getColumns();
        const colId = cols[cell]?.id;
        if (colId == null) return;
        const cssClass =
          kind === 'green' ? 'delivery-cell-flash-green' : 'delivery-cell-flash-red';
        const key = `delivery-cell-flash-${kind}-${row}-${cell}-${Date.now()}`;
        try {
          grid.addCellCssStyles(key, { [row]: { [colId]: cssClass } });
        } catch {
          return;
        }
        setTimeout(() => {
          try { grid.removeCellCssStyles(key); } catch { /* unmounted */ }
        }, 3000);
      };

      // Cell-change → server mutation, then flash green on success / red on
      // rejection. The parent (DeliveriesPage) already toasts the error
      // message; the red flash is purely the visual confirmation that the
      // cell value is NOT what the server has.
      const onCellChangeHandler = (
        _e: unknown,
        args: { row: number; cell: number; item: DeliveryRow }
      ) => {
        if (!onCellEdit) return;
        const col = grid.getColumns()[args.cell];
        if (!col || !col.field) return;
        const field = col.field as keyof DeliveryRow;
        const value = String((args.item as any)[field] ?? '');
        const pqid = args.item.product_quantities_id;
        if (!pqid) return;
        const column = String(col.id ?? col.field);
        if (
          column !== 'season' &&
          column !== 'price' &&
          column !== 'special_price' &&
          !column.startsWith('option_')
        ) {
          return;
        }
        const result = onCellEdit({ productQuantitiesId: pqid, column, value });
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).then(
            () => flashCell(args.row, args.cell, 'green'),
            () => flashCell(args.row, args.cell, 'red')
          );
        } else {
          // Sync caller — assume success.
          flashCell(args.row, args.cell, 'green');
        }
      };
      grid.onCellChange.subscribe(onCellChangeHandler as any);
      unsubs.push(() => grid.onCellChange.unsubscribe(onCellChangeHandler as any));

      // ---- Header-click sort (legacy parity) ----------------------------
      // Legacy slickgrid_home_all_sizes.ctp:264-281 wires a generic
      // comparator on `grid.onSort` that works for any `sortable: true`
      // column. In practice only `season` is marked sortable, so this
      // behaves as a single-column toggle on the Season header. We delegate
      // to DataView.sort so the order survives subsequent setItems calls.
      //
      // Sort is client-side over the loaded page (matches legacy — the
      // server-side ordering is owned by the page-level `sort` filter
      // dropdown). String / number aware: if both values parse as finite
      // numbers we compare numerically, otherwise as case-insensitive
      // strings. Empty / null sort to the end on asc.
      const onSortHandler = (
        _e: unknown,
        args: {
          multiColumnSort?: boolean;
          sortCols?: Array<{ sortAsc: boolean; sortCol: { field: string } }>;
          sortCol?: { field: string };
          sortAsc?: boolean;
        }
      ) => {
        const dv = inst.dataView;
        if (!dv) return;
        const cols =
          args.sortCols && args.sortCols.length > 0
            ? args.sortCols
            : args.sortCol
              ? [{ sortAsc: args.sortAsc ?? true, sortCol: args.sortCol }]
              : [];
        if (cols.length === 0) return;

        const compareValues = (a: unknown, b: unknown): number => {
          const aEmpty = a == null || a === '';
          const bEmpty = b == null || b === '';
          if (aEmpty && bEmpty) return 0;
          if (aEmpty) return 1; // empties last on asc; sign-flipped by caller for desc
          if (bEmpty) return -1;
          const an = Number(a);
          const bn = Number(b);
          if (Number.isFinite(an) && Number.isFinite(bn)) {
            return an === bn ? 0 : an < bn ? -1 : 1;
          }
          return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
        };

        // The comparator already owns direction via `sign` (c.sortAsc ? 1 : -1),
        // so SlickGrid's second arg MUST be `true` — passing `cols[0].sortAsc`
        // here would flip an already-signed result a second time, making
        // "descending" actually sort ascending.
        dv.sort((row1: Record<string, unknown>, row2: Record<string, unknown>) => {
          for (const c of cols) {
            const field = c.sortCol.field;
            const sign = c.sortAsc ? 1 : -1;
            const r = compareValues(row1[field], row2[field]) * sign;
            if (r !== 0) return r;
          }
          return 0;
        }, true);
      };
      grid.onSort.subscribe(onSortHandler as any);
      unsubs.push(() => grid.onSort.unsubscribe(onSortHandler as any));

      // ---- Header-row inline filter inputs ------------------------------
      // Renders a small <input> into the header-row cell for the three
      // filterable columns (Description / Box / Product Code). The filter
      // value is stored in a ref and applied via dataView.setFilter — purely
      // client-side over the loaded page (matches legacy spec §5.5).
      const FILTERABLE: Record<string, keyof typeof headerFiltersRef.current> = {
        product_name: 'product_name',
        boxcode: 'boxcode',
        product_code: 'product_code',
      };
      const onHeaderRowCellRenderedHandler = (
        _e: unknown,
        args: { node: HTMLElement; column: { id: string } }
      ) => {
        const colId = args.column?.id;
        const key = colId ? FILTERABLE[colId] : undefined;
        if (!key) return;
        const node = args.node;
        while (node.firstChild) node.removeChild(node.firstChild);
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '';
        input.value = headerFiltersRef.current[key];
        input.style.cssText =
          'width:100%;box-sizing:border-box;padding:1px 4px;font-size:11px;height:22px;border:1px solid #d1d5db;border-radius:2px';
        input.addEventListener('input', (ev) => {
          headerFiltersRef.current = {
            ...headerFiltersRef.current,
            [key]: (ev.target as HTMLInputElement).value,
          };
          inst.dataView?.refresh();
        });
        // Stop SlickGrid from intercepting keystrokes inside the filter input.
        input.addEventListener('keydown', (ev) => ev.stopPropagation());
        node.appendChild(input);
      };
      grid.onHeaderRowCellRendered.subscribe(onHeaderRowCellRenderedHandler as any);
      unsubs.push(() =>
        grid.onHeaderRowCellRendered.unsubscribe(onHeaderRowCellRenderedHandler as any)
      );

      // Install the dataView filter once. Pulls every read from the ref so
      // updates from the input handler take effect immediately.
      inst.dataView?.setFilter((item: DeliveryRow) => {
        const f = headerFiltersRef.current;
        if (f.product_name && !String(item.product_name ?? '').toLowerCase().includes(f.product_name.toLowerCase())) return false;
        if (f.boxcode && !String(item.boxcode ?? '').toLowerCase().includes(f.boxcode.toLowerCase())) return false;
        if (f.product_code && !String(item.product_code ?? '').toLowerCase().includes(f.product_code.toLowerCase())) return false;
        return true;
      });

      // ---- Double-click to edit -----------------------------------------
      // Minimal handler — opens the editor for the dblclick'd cell. Uses
      // the atomic `setActiveCell(row, cell, true)` form so SlickGrid
      // does the activation + edit-mode entry in one internal call.
      //
      // NB: relies on `column.editorClass` being set by our `columnsForSlickGrid`
      // wrapper. Without it, SlickGrid's `getEditor` returns undefined and
      // `isCellPotentiallyEditable` short-circuits → editor never opens.
      // See the comment on `columnsForSlickGrid` (above) for the full bug
      // history.
      const onDblClickHandler = (_e: any, args: { row: number; cell: number }) => {
        const cols = (grid as any).getColumns?.() ?? [];
        if (!cols[args.cell]?.editor) return;
        (grid as any).setActiveCell?.(args.row, args.cell, true);
      };
      grid.onDblClick.subscribe(onDblClickHandler as any);
      unsubs.push(() => grid.onDblClick.unsubscribe(onDblClickHandler as any));

      // ---- Click delegation for the action icons ------------------------
      const onClickHandler = (e: any, args: { row: number; cell: number }) => {
        const target = e?.target as HTMLElement | undefined;
        if (!target) return;
        const actionEl = target.closest('.del-action') as HTMLElement | null;
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        if (!action) return;
        const dv = inst.dataView;
        const item = dv?.getItem(args.row) as DeliveryRow | undefined;
        if (!item) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        if (action === 'link-quantity' && onLinkQuantityClick) {
          onLinkQuantityClick(item.product_code, item.quantity_map === '1');
        } else if (action === 'add-sms-product' && onAddSmsProductClick) {
          onAddSmsProductClick(item.product_code);
        } else if (action === 'upload-image' && onUploadImageClick) {
          onUploadImageClick(item.product_code);
        } else if (action === 'map' && onMapClick) {
          onMapClick(item.product_code);
        } else if (action === 'special' && onSpecialClick) {
          onSpecialClick(item.product_code);
        } else if (action === 'assign-font' && onAssignFontClick) {
          onAssignFontClick(item.product_code);
        }
      };
      grid.onClick.subscribe(onClickHandler as any);
      unsubs.push(() => grid.onClick.unsubscribe(onClickHandler as any));

      return () => {
        for (const fn of unsubs) fn();
      };
    },
    [onCellEdit, onLinkQuantityClick, onAddSmsProductClick, onEditProductClick, onUploadImageClick, onMapClick, onSpecialClick, onAssignFontClick]
  );

  // Imperative dataset + column update.
  useEffect(() => {
    const inst = gridInstanceRef.current;
    if (inst?.dataView && rows.length > 0) {
      inst.dataView.setItems(rows, 'id');
      inst.dataView.getItemMetadata = (i: number) => {
        const r = inst.dataView!.getItem(i) as DeliveryRow | undefined;
        if (!r) return null;
        const cls = rowBgClass(r);
        return cls ? { cssClasses: cls } : null;
      };
      // Re-apply columns and resize. This fixes the "blank first load" issue
      // — SlickGrid v4 sometimes mounts with the cell renderer disconnected
      // from the column definitions on initial render. Calling setColumns
      // explicitly and resizing the canvas wakes the renderer up.
      //
      // NB: we MUST pass `columnsForSlickGrid` (carries `editorClass`), NOT
      // `columnDefinitions`. See the comment on columnsForSlickGrid above —
      // passing the raw definitions strips `editorClass` and breaks
      // dblclick-to-edit.
      inst.slickGrid?.setColumns(columnsForSlickGrid);
      inst.slickGrid?.invalidate();
      inst.slickGrid?.render();
      inst.slickGrid?.resizeCanvas?.();
    }
  }, [rows, columnsForSlickGrid]);

  // Right-pane width is owned entirely by this effect (replaces the previous
  // CSS rule in delivery-row-colors.css). Goal:
  //   right_pane = wrapper.offsetWidth - left_pane.offsetWidth
  //
  // i.e. the right pane consumes whatever horizontal space remains inside the
  // grid wrapper after the frozen left pane. This is fully responsive — the
  // wrapper itself is sized by the page layout (sidebar + main padding +
  // window width), so the formula automatically adapts to:
  //   - large vs small monitors
  //   - sidebar open (w-64 = 256px) vs collapsed (w-16 = 64px)
  //   - window resize
  //   - left-pane column drags (right pane shrinks/grows inversely)
  //
  // Earlier versions hard-coded 900px / 1100px for the two sidebar states
  // which clipped the grid on >= 1600px screens. Anchoring to the live
  // wrapper width removes that ceiling.
  //
  // `setProperty` with 'important' priority lets the inline style win over
  // any future !important CSS without fighting specificity.
  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    const applyWidth = () => {
      const wrapper = document.querySelector<HTMLElement>('.deliveries-grid-wrap');
      const leftPane = wrapper?.querySelector<HTMLElement>('.slick-pane-left');
      if (!wrapper || !leftPane) return;
      const rightWidth = Math.max(0, wrapper.offsetWidth - leftPane.offsetWidth);
      wrapper
        .querySelectorAll<HTMLElement>(
          '.slick-pane.slick-pane-header.slick-pane-right, .slick-viewport.slick-viewport-top.slick-viewport-right'
        )
        .forEach((el) => el.style.setProperty('width', `${rightWidth}px`, 'important'));
    };

    const tryInit = () => {
      if (cancelled) return;
      const wrapper = document.querySelector<HTMLElement>('.deliveries-grid-wrap');
      const leftPane = wrapper?.querySelector<HTMLElement>('.slick-pane-left');
      const rightPaneHeader = wrapper?.querySelector<HTMLElement>(
        '.slick-pane.slick-pane-header.slick-pane-right'
      );
      if (!wrapper || !leftPane || !rightPaneHeader) {
        requestAnimationFrame(tryInit);
        return;
      }

      // Defer the FIRST apply by one frame so SlickGrid finishes its initial
      // auto-resize before we write the right-pane width. Without this delay
      // the apply happens mid-mount and SlickGrid's own auto-resize fires
      // AFTER ours and overwrites the right pane.
      requestAnimationFrame(() => {
        if (cancelled) return;
        applyWidth();

        resizeObserver = new ResizeObserver(() => applyWidth());
        // Observe the wrapper (sidebar toggle, window resize), the left pane
        // (column drags), and the right pane itself (re-apply if SlickGrid or
        // anything else changes the right pane width after we've set it).
        // Writing the same width back is a no-op for ResizeObserver, so this
        // does not loop.
        resizeObserver.observe(wrapper);
        resizeObserver.observe(leftPane);
        resizeObserver.observe(rightPaneHeader);
      });
    };

    tryInit();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [rows]);

  // Holds the cleanup returned by `wireGridEvents` so each new grid
  // creation tears down the previous subscriptions before installing new
  // ones. Without this every handleGridCreated stacks another set of
  // listeners on top — visible in the logs as every event firing 2x (or
  // more under React StrictMode double-mount).
  const gridSubsCleanupRef = useRef<(() => void) | null>(null);

  const handleGridCreated = (e: CustomEvent<unknown>) => {
    const inst = e.detail as SlickgridReactInstance;
    gridInstanceRef.current = inst;

    // Dispose any previously-installed event subscriptions BEFORE wiring
    // up new ones, so we never accumulate duplicate handlers.
    if (gridSubsCleanupRef.current) {
      try { gridSubsCleanupRef.current(); } catch { /* ignore */ }
      gridSubsCleanupRef.current = null;
    }

    // Kick the cell renderer on first mount — same reason as above. Without
    // this nudge, the headers and cells often render as empty <span/> on
    // the very first paint and only repopulate once the user paginates.
    if (inst.slickGrid && rows.length > 0) {
      // Defer one frame so SlickGrid finishes its own setup first.
      requestAnimationFrame(() => {
        try {
          // Must pass `columnsForSlickGrid` (with editorClass), not the raw
          // `columnDefinitions` — see comment on columnsForSlickGrid.
          inst.slickGrid?.setColumns(columnsForSlickGrid);
          if (inst.dataView) {
            inst.dataView.setItems(rows, 'id');
            inst.dataView.getItemMetadata = (i: number) => {
              const r = inst.dataView!.getItem(i) as DeliveryRow | undefined;
              if (!r) return null;
              const cls = rowBgClass(r);
              return cls ? { cssClasses: cls } : null;
            };
          }
          inst.slickGrid.invalidate();
          inst.slickGrid.render();
          inst.slickGrid.resizeCanvas?.();
        } catch {
          /* SlickGrid lifecycle race — safe to swallow */
        }
      });
    }

    // Install subscriptions and remember the cleanup so the next
    // handleGridCreated (or unmount) can dispose them.
    gridSubsCleanupRef.current = wireGridEvents(inst) ?? null;
  };

  // On unmount, dispose any in-flight subscriptions so they don't leak.
  useEffect(() => {
    return () => {
      if (gridSubsCleanupRef.current) {
        try { gridSubsCleanupRef.current(); } catch { /* ignore */ }
        gridSubsCleanupRef.current = null;
      }
    };
  }, []);

  // Restore the user's last saved grid height on mount. The wrapper has a
  // sensible CSS default (calc(100vh - 360px)), so we only apply an inline
  // height when there is a persisted value. After applying, kick the grid
  // canvas so SlickGrid's viewports re-fit.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(GRID_HEIGHT_STORAGE_KEY);
    if (!raw) return;
    const px = Number(raw);
    if (!Number.isFinite(px)) return;
    const clamped = Math.max(GRID_HEIGHT_MIN, Math.min(GRID_HEIGHT_MAX, px));
    if (wrapRef.current) {
      wrapRef.current.style.height = `${clamped}px`;
      // resizeCanvas is safe even if the grid hasn't finished mounting; the
      // grid-created callback below will fire its own resize once ready.
      gridInstanceRef.current?.slickGrid?.resizeCanvas?.();
    }
  }, []);

  // Corner drag-to-resize. Captures the starting Y + height on mousedown,
  // tracks the delta on mousemove, persists the final height on mouseup.
  // Pointer events would be nicer than mouse events but most operators are on
  // mouse + the existing grid handlers already use plain mouse semantics, so
  // we stay consistent.
  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const startY = e.clientY;
    const startHeight = wrap.getBoundingClientRect().height;
    // Block text selection while dragging — otherwise the cursor highlights
    // grid cells. The body cursor override gives a global visual cue.
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const next = Math.max(
        GRID_HEIGHT_MIN,
        Math.min(GRID_HEIGHT_MAX, startHeight + delta)
      );
      wrap.style.height = `${next}px`;
      // Live-resize the SlickGrid viewport so the user sees the inner content
      // reflow during the drag, not just the wrapper.
      gridInstanceRef.current?.slickGrid?.resizeCanvas?.();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      const final = Math.round(wrap.getBoundingClientRect().height);
      try {
        window.localStorage.setItem(GRID_HEIGHT_STORAGE_KEY, String(final));
      } catch {
        /* localStorage unavailable (private mode / quota) — silent */
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No deliveries match the current filters.
      </div>
    );
  }

  const safeColumns = columnDefinitions.map((col) => ({ ...col }));

  // No outer overflow wrapper — SlickGrid manages its own internal horizontal
  // scrolling. The previous `overflowX: 'auto'` wrapper introduced a competing
  // scroll container which made the pan feel stuck/janky.
  return (
    <div ref={wrapRef} className="deliveries-grid-wrap">
      <SlickgridReact
        gridId="deliveriesGrid"
        columnDefinitions={safeColumns}
        gridOptions={gridOptions}
        dataset={rows}
        onReactGridCreated={handleGridCreated}
      />
      {/* Bottom-right corner drag handle. Mirrors the textarea resize
          affordance operators already know. Persists the chosen height to
          localStorage so the next visit opens at the same size. */}
      <div
        className="deliveries-grid-resize-handle"
        role="separator"
        aria-label="Resize grid height"
        title="Drag to resize the grid"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}
