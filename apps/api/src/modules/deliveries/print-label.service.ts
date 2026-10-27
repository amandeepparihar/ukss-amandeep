/**
 * Print Label — server-side barcode resolution + native PDF render.
 *
 * Replaces the legacy `ProductsBarcodeController::label` grid path
 * (products_barcode_controller.php:678-787) which wrote PNG files to disk and
 * shelled out to TCPDF. Here the grid cell (productListsId + boxCode +
 * sizeOptionId) is resolved to its `product_quantities.barcode` server-side
 * (legacy `IndexController::get_data_from_grid_size` print_label branch,
 * index_controller.php:4367-4386, joins at 4520-4576) and the PDF is rendered
 * in-memory with bwip-js (Code128 PNG) + pdfkit (A4 label).
 *
 * Why raw SQL: `manufacturers_sizes_to_default_sizes` and `new_products` are
 * not in our Prisma schema, so the resolution SELECT and the audit-flag
 * UPDATEs go through `$queryRawUnsafe` / `$executeRawUnsafe` with `?` bind
 * params — the module style established in stock-grid-cache.ts. Zero string
 * interpolation of values.
 */

import PDFDocument from 'pdfkit';
import { prisma } from '../../lib/prisma';
import { createLogger } from '../../lib/logger';
import { generateCode128Png, getPngDimensions } from './barcode.helper';

const logger = createLogger('deliveries.print-label');

/** A single grid cell — the frontend context-menu payload. */
export interface PrintLabelItemInput {
  productListsId: number;
  boxCode: string;
  sizeOptionId: number;
}

/** A resolved grid cell ready to render onto one A4 page. */
export interface ResolvedLabelItem {
  /**
   * `product_quantities.barcode` — the UKSS barcode that gets printed.
   * NOTE: the grid path uses `product_quantities.barcode`, NOT
   * `npv_products_barcodes` (that is the popup path). Legacy parity:
   * index_controller.php `get_data_from_grid_size` print_label branch L4385.
   */
  barcode: string;
  /** `product_quantities.supplier_barcode_1` — optional second barcode. */
  supplierBarcode1: string | null;
  productCode: string;
  productName: string;
  season: string | null;
  sizeName: string;
  boxCode: string;
  /** `new_products.products_id` (LEFT JOIN — null when no ZC product maps). */
  npvProductsId: number | null;
  /**
   * Original grid input — the grid's default-size-bucket id
   * (`manufacturers_sizes_to_default_sizes.default_options_values_id`), used
   * only to resolve this row and to detect price/URL mismatches upstream.
   */
  sizeOptionId: number;
  /**
   * The product's own `products_options_values_id` (legacy's true label/audit
   * key — matches `new_products_variations.npv_size_options_value_id`),
   * resolved via `pq.size_id -> products_options_values_to_products_options.
   * products_options_values_to_products_options_id`. NOT the same as
   * `sizeOptionId` above, which is the grid's default-size-bucket id
   * (`manufacturers_sizes_to_default_sizes.default_options_values_id`) used
   * only to find this row — the two frequently differ (verified against
   * production data).
   */
  sizeOptionValueId: number;
}

/**
 * Thrown when a grid cell cannot be resolved to a product_quantities row.
 * The route handler collects these across all items and returns a single 422
 * listing every failure — no partial PDF is ever rendered.
 */
export class LabelResolutionError extends Error {
  constructor(
    public readonly input: PrintLabelItemInput,
    message: string
  ) {
    super(message);
    this.name = 'LabelResolutionError';
  }
}

const RESOLVE_SQL = `
  SELECT
    pq.barcode                       AS barcode,
    pq.supplier_barcode_1            AS supplierBarcode1,
    pl.product_code                  AS productCode,
    COALESCE(NULLIF(np.products_name, ''), pl.product_name) AS productName,
    s.season                         AS season,
    pov.products_options_values_name AS sizeName,
    bl.box_code                      AS boxCode,
    np.products_id                   AS npvProductsId,
    potpo.products_options_values_id AS sizeOptionValueId
  FROM product_quantities pq
  INNER JOIN product_lists pl   ON pl.product_lists_id = pq.product_lists_id
  INNER JOIN box_lists bl       ON bl.box_lists_id = pq.box_lists_id
  INNER JOIN manufacturers_sizes_to_default_sizes ms
         ON ms.manufacturers_options_values_id = pq.size_id
  INNER JOIN products_options_values_to_products_options potpo
         ON potpo.products_options_values_to_products_options_id = pq.size_id
  INNER JOIN products_options_values pov
         ON pov.products_options_values_id = potpo.products_options_values_id
  INNER JOIN seasons s          ON s.seasons_id = pl.seasons_id
  LEFT JOIN new_products np     ON pl.product_code = TRIM(TRAILING ',' FROM np.products_model)
  WHERE pq.product_lists_id = ?
    AND bl.box_code = ?
    AND ms.default_options_values_id = ?
  LIMIT 1`;

/** Shape of the resolution SELECT row (bind-params omitted). */
interface LabelRow {
  barcode: string;
  supplierBarcode1: string | null;
  productCode: string;
  productName: string;
  season: string | null;
  sizeName: string;
  boxCode: string;
  npvProductsId: number | bigint | null;
  sizeOptionValueId: number | bigint;
}

/**
 * Resolve one grid cell to the row needed to print its label.
 *
 * This is the cleaned form of the legacy `get_data_from_grid_size`
 * print_label SELECT. Notes vs the legacy ORM find:
 *   - `sizeOptionId` from the grid = `option_<id>` = the
 *     `default_options_values_id` filtered in the WHERE clause — it is only
 *     precise enough to locate the row, not to key the audit-flag UPDATE.
 *   - `products_options_values_to_products_options` (junction) IS joined
 *     (`potpo.products_options_values_to_products_options_id = pq.size_id`,
 *     legacy index_controller.php:4494-4498) to surface the product's own
 *     `products_options_values_id` as `sizeOptionValueId` — the true
 *     per-product size-option-value id, distinct from the grid's default
 *     bucket id and required to match `new_products_variations.
 *     npv_size_options_value_id` correctly (see markLabelGenerated below).
 *     `pov` (the printed `sizeName`) joins off `potpo`, not the bucket id —
 *     the legacy find()'s real 'joins' array does the same
 *     (index_controller.php ~4560-4568). An illustrative raw-SQL comment a
 *     few lines above that array joins `pov` off the bucket id instead, but
 *     that comment is stale and isn't what CakePHP actually executes.
 *   - All columns below verified against the legacy ORM field list
 *     (index_controller.php:4368-4386) per CLAUDE.md rule 6 — these tables
 *     are partly unmodeled in Prisma, so the legacy field list is canonical.
 */
export async function resolveLabelItem(
  input: PrintLabelItemInput
): Promise<ResolvedLabelItem> {
  // Cast form (not the generic `$queryRawUnsafe<T>(...)`) because this
  // project's `prisma` typing loses the generic overload — see grid-actions
  // for the same systemic TS2347. Raw SQL results are `unknown` at the ORM
  // boundary, so an explicit cast is the honest, type-safe representation.
  const rows = (await prisma.$queryRawUnsafe(
    RESOLVE_SQL,
    input.productListsId,
    input.boxCode,
    input.sizeOptionId
  )) as LabelRow[];

  const row = rows[0];
  if (!row) {
    throw new LabelResolutionError(
      input,
      `No product_quantities row for productListsId=${input.productListsId}, boxCode="${input.boxCode}", sizeOptionId=${input.sizeOptionId}`
    );
  }

  // Legacy guards the barcode render behind `isset && != ""`
  // (products_barcode_controller.php:612). A row that resolves but has no
  // printable barcode would otherwise reach bwip-js and surface as a generic
  // 500 ("empty barcode text"). Fail fast with a 422 naming the cell instead.
  if (!row.barcode) {
    throw new LabelResolutionError(
      input,
      `No barcode set on product_quantities for productListsId=${input.productListsId}, boxCode="${input.boxCode}", sizeOptionId=${input.sizeOptionId}`
    );
  }

  return {
    barcode: row.barcode,
    supplierBarcode1: row.supplierBarcode1,
    productCode: row.productCode,
    productName: row.productName,
    season: row.season,
    sizeName: row.sizeName,
    boxCode: row.boxCode,
    // MySQL driver may return BIGINT as bigint when the column is BIGINT;
    // new_products.products_id is INT but normalize defensively.
    npvProductsId: row.npvProductsId == null ? null : Number(row.npvProductsId),
    sizeOptionId: input.sizeOptionId,
    sizeOptionValueId: Number(row.sizeOptionValueId),
  };
}

// ---------------------------------------------------------------------------
// PDF render
// ---------------------------------------------------------------------------

type PdfDoc = InstanceType<typeof PDFDocument>;

/**
 * Render one A4 page per resolved item into a single in-memory PDF Buffer.
 *
 * Layout mirrors the legacy HTML label (products_barcode_controller.php:725-785):
 * bordered box, UKSS barcode prominent at top, optional SUPPLIER barcode below,
 * then a two-column field block (Product / Product Code / Season — Size / Box).
 * Condition and Sleeve are intentionally NOT printed (see renderOneLabel).
 *
 * The buffer-then-send pattern matches export.service.ts (exportToPdf) and
 * reconciliation/audit.routes.ts. pdfkit emits bytes via 'data'; we concatenate
 * and resolve on 'end'.
 */
export async function generateLabelPdf(
  items: ResolvedLabelItem[]
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 45, bottom: 45, left: 42, right: 42 },
      bufferPages: false,
    });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Async page rendering (each barcode PNG is awaited). On success, end the
    // doc (flushes bytes, fires "end" -> resolve). On error, reject; the
    // orphaned doc is GC'd (no consumer pipe to leak). Promise is settled
    // once, so a later stray "end" -> resolve() is a harmless no-op.
    void renderLabelPages(doc, items).then(
      () => doc.end(),
      (err: unknown) => reject(err)
    );
  });
}

async function renderLabelPages(
  doc: PdfDoc,
  items: ResolvedLabelItem[]
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (i > 0) doc.addPage();
    await renderOneLabel(doc, items[i]);
  }
}

/**
 * Draw one label page. Field set per legacy HTML (L749-779): Product,
 * Product Code, Season (left); Size, Box (right). Condition and Sleeve are
 * omitted — the legacy HTML guards each with isset/!empty and the grid Print
 * Label path routinely surfaces empty Condition/Sleeve, so they'd blank out
 * anyway. Matching the legacy grid label, not the popup label.
 *
 * Three sections stacked inside one bordered box, each separated by a
 * full-width divider line (legacy HTML table-row borders,
 * products_barcode_controller.php:725-779): UKSS barcode, optional SUPPLIER
 * barcode, product details. Barcode section heights are driven by the
 * actual scaled image height (via `getPngDimensions`), not a guessed
 * constant — a fixed `cursorY` advance previously caused the two barcode
 * images to overlap because bwip-js's native aspect ratio makes a
 * width-380 render taller than the guess accounted for.
 */
async function renderOneLabel(
  doc: PdfDoc,
  item: ResolvedLabelItem
): Promise<void> {
  const m = doc.page.margins;
  const contentWidth = doc.page.width - m.left - m.right;
  const boxX = m.left;
  const boxY = m.top;

  // Bordered box (legacy `.content { border: 2px solid black; }`). Height
  // fills the page margins; content below is top-aligned within it, so the
  // box extends past the content with blank space — matches legacy/reference.
  doc.lineWidth(2).rect(boxX, boxY, contentWidth, doc.page.height - m.top - m.bottom).stroke();

  const innerX = boxX + 20;
  const innerWidth = contentWidth - 40;
  const rightHalfX = boxX + contentWidth * 0.42;
  const rightHalfWidth = boxX + contentWidth - 24 - rightHalfX;

  let cursorY = boxY;
  const ukssPng = await generateCode128Png(item.barcode, {
    scale: 4,
    height: 12,
    includetext: false,
  });
  cursorY = drawBarcodeSection(doc, ukssPng, {
    innerX,
    rightHalfX,
    rightHalfWidth,
    y: cursorY,
    label: 'UKSS BARCODE:',
    barcodeText: item.barcode,
    imgWidth: 340,
  });
  doc.moveTo(boxX, cursorY).lineTo(boxX + contentWidth, cursorY).lineWidth(1).stroke();

  if (item.supplierBarcode1) {
    const supPng = await generateCode128Png(item.supplierBarcode1, {
      scale: 3,
      height: 10,
      includetext: false,
    });
    cursorY = drawBarcodeSection(doc, supPng, {
      innerX,
      rightHalfX,
      rightHalfWidth,
      y: cursorY,
      label: 'SUPPLIER BARCODE:',
      barcodeText: item.supplierBarcode1,
      imgWidth: 300,
    });
    doc.moveTo(boxX, cursorY).lineTo(boxX + contentWidth, cursorY).lineWidth(1).stroke();
  }

  // Two-column field block.
  const detailsTopPad = 26;
  const colGap = 30;
  const colWidth = (innerWidth - colGap) / 2;
  const leftX = innerX;
  const rightX = innerX + colWidth + colGap;
  const fieldStartY = cursorY + detailsTopPad;

  drawField(doc, leftX, fieldStartY, 'Product', item.productName, colWidth);
  drawField(doc, leftX, doc.y + 10, 'Product Code', item.productCode, colWidth);
  drawField(doc, leftX, doc.y + 10, 'Season', item.season ?? '', colWidth);

  drawField(doc, rightX, fieldStartY, 'Size', item.sizeName, colWidth);
  drawField(doc, rightX, doc.y + 10, 'Box', item.boxCode, colWidth);
}

interface BarcodeSectionOptions {
  innerX: number;
  rightHalfX: number;
  rightHalfWidth: number;
  y: number;
  label: string;
  barcodeText: string;
  imgWidth: number;
}

/**
 * Draw one "LABEL: ... barcode ... number" section and return the Y where
 * its divider line belongs (bottom of the section's content + bottom pad).
 * Barcode is centered within the right-hand half of the box; the
 * human-readable number is a separate centered text line below it (not
 * bwip-js's baked-in `includetext`), matching the legacy's visible gap
 * between bars and digits.
 */
function drawBarcodeSection(doc: PdfDoc, png: Buffer, opts: BarcodeSectionOptions): number {
  const topPad = 18;
  const bottomPad = 20;
  const labelY = opts.y + topPad;

  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('black')
    .text(opts.label, opts.innerX, labelY);

  const native = getPngDimensions(png);
  const imgHeight = opts.imgWidth * (native.height / native.width);
  const imgX = opts.rightHalfX + (opts.rightHalfWidth - opts.imgWidth) / 2;
  const imgY = labelY;
  doc.image(png, imgX, imgY, { width: opts.imgWidth });

  const numberGap = 8;
  const numberY = imgY + imgHeight + numberGap;
  doc
    .font('Helvetica')
    .fontSize(13)
    .fillColor('black')
    .text(opts.barcodeText, opts.rightHalfX, numberY, {
      width: opts.rightHalfWidth,
      align: 'center',
    });

  const contentBottom = numberY + 16; // one text line at fontSize 13
  return contentBottom + bottomPad;
}

/**
 * Draw a "Label value" line. Label bold, value regular — both at fontSize 12.
 * `continued: true` keeps the value on the same line as the label and lets
 * pdfkit wrap the value naturally within `maxWidth`. `doc.y` advances past
 * the line (or the last wrapped line) on return.
 */
function drawField(
  doc: PdfDoc,
  x: number,
  y: number,
  label: string,
  value: string,
  maxWidth: number
): void {
  const v = value && value.trim() !== '' ? value : '—';
  doc.font('Helvetica-Bold').fontSize(12).fillColor('black');
  doc.text(label + ' ', x, y, { width: maxWidth, continued: true });
  doc.font('Helvetica').text(v, { width: maxWidth });
}

// ---------------------------------------------------------------------------
// Audit-flag UPDATEs (best-effort, after successful PDF render)
// ---------------------------------------------------------------------------

// Two static literals (not string-built) so there is zero SQL interpolation;
// only the bind params carry values.
const FLAG_SINGLE_SQL =
  'UPDATE new_products_variations SET is_label_generated = 1 WHERE npv_products_id = ? AND npv_size_options_value_id = ?';
const FLAG_BULK_SQL =
  'UPDATE new_products_variations SET is_bulk_label_generated = 1 WHERE npv_products_id = ? AND npv_size_options_value_id = ?';

/**
 * Set the label-generated audit flag on `new_products_variations` for each
 * resolved item, AFTER the PDF was generated successfully.
 *
 *   single-item print (items.length === 1) → `is_label_generated = 1`
 *   bulk print        (items.length  >  1) → `is_bulk_label_generated = 1`
 *
 * Each UPDATE keys on `npvProductsId` (resolved `new_products.products_id`)
 * and `sizeOptionValueId` — the product's own `products_options_values_id`,
 * which is what `new_products_variations.npv_size_options_value_id` actually
 * holds (confirmed: every legacy join reads `npv.npv_size_options_value_id =
 * pov.products_options_values_id`, and cross-checked against
 * `new_products_variations.npv_size_options_value_id` on production data).
 * This is NOT the grid's `sizeOptionId` (default-size-bucket id) — the two
 * frequently differ, so binding `sizeOptionId` here would silently match
 * zero rows. Items with `npvProductsId === null` (no `new_products` match via
 * the TRIM(TRAILING ',') join) are skipped + logged.
 *
 * Best-effort: each UPDATE is wrapped in try/catch. A failed flag write is
 * logged but never fails the request — the PDF has already streamed to the
 * operator; the flag is a downstream batch-status hint, not a hard contract.
 */
export async function markLabelGenerated(
  items: ResolvedLabelItem[],
  isBulk: boolean
): Promise<void> {
  const sql = isBulk ? FLAG_BULK_SQL : FLAG_SINGLE_SQL;
  const flagColumn = isBulk ? 'is_bulk_label_generated' : 'is_label_generated';

  for (const item of items) {
    if (item.npvProductsId == null) {
      logger.warn(
        {
          productCode: item.productCode,
          sizeOptionId: item.sizeOptionId,
          sizeOptionValueId: item.sizeOptionValueId,
        },
        'markLabelGenerated: skipping — npvProductsId is null (no new_products match)'
      );
      continue;
    }
    try {
      await prisma.$executeRawUnsafe(sql, item.npvProductsId, item.sizeOptionValueId);
    } catch (err) {
      logger.error(
        {
          err: (err as Error).message,
          productCode: item.productCode,
          npvProductsId: item.npvProductsId,
          sizeOptionId: item.sizeOptionId,
          sizeOptionValueId: item.sizeOptionValueId,
          flagColumn,
        },
        'markLabelGenerated: UPDATE failed (best-effort, ignoring)'
      );
    }
  }
}
