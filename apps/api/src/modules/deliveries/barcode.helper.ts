/**
 * In-memory Code128 barcode PNG generator for the Print Label flow.
 *
 * Print Label (POST /api/deliveries/print-label) resolves the grid cell
 * server-side and renders the PDF natively (bwip-js + pdfkit) — no PNG files
 * touch disk, unlike the legacy TCPDF + filesystem path in
 * `ProductsBarcodeController::label` (products_barcode_controller.php:678-787),
 * which wrote barcode PNGs under `products_label/barcode_image/` and let
 * TCPDF pick them up via `<img src=...>`.
 *
 * bwip-js 4.x types use `export = BwipJs` (namespace). With esModuleInterop
 * (tsconfig.json) the default import is synthesized, so `bwipjs.toBuffer(...)`
 * resolves. `toBuffer` is Promise-returning when invoked without a callback
 * (overload at bwip-js-node.d.ts:200).
 */

import bwipjs from 'bwip-js/node';

export interface GenerateCode128Options {
  /** Bar module scale. Higher = wider barcode. 3-4 scans cleanly on a ~360pt PDF image. */
  scale?: number;
  /** Bar height in millimetres. */
  height?: number;
  /** Render the human-readable digits under the bars (drawn into the PNG). */
  includetext?: boolean;
}

/**
 * Generate a Code128 barcode as an in-memory PNG Buffer. No canvas, no files.
 * Throws if `text` is empty — never emits a blank/zero-length barcode.
 */
export async function generateCode128Png(
  text: string,
  opts: GenerateCode128Options = {}
): Promise<Buffer> {
  if (!text) throw new Error('generateCode128Png: empty barcode text');
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: opts.scale ?? 3,
    height: opts.height ?? 10,
    includetext: opts.includetext ?? true,
    textxalign: 'center',
    paddingwidth: 5,
    paddingheight: 2,
  });
}

/**
 * Read a PNG's native pixel dimensions from its IHDR chunk (bytes 16-23 of
 * any valid PNG — width then height, both big-endian uint32). Used by
 * print-label.service.ts to compute a barcode image's *actual* rendered
 * height at a given display width, instead of guessing a fixed advance
 * (pdfkit's `PDFDocument` type declarations don't expose `openImage`, so
 * this avoids an untyped/`as any` call to the undocumented runtime method).
 */
export function getPngDimensions(png: Buffer): { width: number; height: number } {
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}
