/**
 * Pure status-decision logic for order processing.
 *
 * Extracted from processing.service.ts / processing.stock.ts so it can be
 * unit-tested without those modules' DB/logger/config imports. No side effects,
 * no I/O — only field inspection.
 *
 * Source of truth: legacy webadmin/includes/modules/order_processing_new.php.
 */
import { STATUS, VIRTUAL_PRODUCT_TYPE } from '../orders.constants';
import type {
  ProductType,
  SimulationProductResult,
  OrderProductForProcessingRow,
} from './processing.types';

/**
 * Classify an order product line. Pure field inspection (no I/O).
 * Relocated here from processing.stock.ts (which re-exports it) so the pure
 * status logic and its callers share one implementation.
 */
export function detectProductType(product: OrderProductForProcessingRow): ProductType {
  // T-shirt
  if (product.virtual_product_type_id === VIRTUAL_PRODUCT_TYPE.TSHIRT) {
    return 'tshirt';
  }

  // Toffs: toffs field is non-empty (PHP: `!= ''` — treats '0' as toffs)
  if (product.toffs && product.toffs !== '') {
    return 'toffs';
  }

  // Copa: copa field is non-empty (PHP: `!= ''` — treats '0' as copa)
  if (product.copa && product.copa !== '') {
    return 'copa';
  }

  // Keyring
  if (
    product.virtual_product_type_id === VIRTUAL_PRODUCT_TYPE.KEYRING ||
    product.products_model.toLowerCase().includes('keyring')
  ) {
    return 'keyring';
  }

  // Hero shirt: hero_shirt_parent non-empty and not '0', or hero_shirts = '1'
  if (
    (product.hero_shirt_parent && product.hero_shirt_parent !== '0' && product.hero_shirt_parent !== '') ||
    product.hero_shirts === '1'
  ) {
    return 'hero_shirt';
  }

  return 'normal';
}

/**
 * Aggregate per-product results into order-level flags.
 * Pre-order and out-of-stock are tracked so the caller can apply the legacy
 * override precedence (see determineProposedStatus).
 */
export function aggregateProductResults(products: SimulationProductResult[]) {
  let hasRetro = false;
  let hasPrinting = false;
  let hasOutOfStock = false;
  let hasPreOrder = false;
  let stockAvailable = 0;
  for (const p of products) {
    if (p.productType === 'toffs' || p.productType === 'copa') hasRetro = true;
    // PHP: tshirts and hero_shirts are unconditionally counted as printing products
    if (p.hasPrinting || p.productType === 'tshirt' || p.productType === 'hero_shirt') hasPrinting = true;
    if (p.isPreOrder) hasPreOrder = true;
    if (p.isOutOfStock) hasOutOfStock = true;
    if (!p.isOutOfStock) stockAvailable++;
  }
  return { hasRetro, hasPrinting, hasOutOfStock, hasPreOrder, stockAvailable };
}

/**
 * Determine the proposed order status.
 *
 * Legacy order_processing_new.php: the per-product loop computes a base status
 * (retro 22 / printing 14·24 / picking 16). Then an override block (L1539-1550)
 * forces:
 *   - 12 (Pre Order)  if ANY line is a pre-order product (preOrderedOrderBit), else
 *   - 2  (Processing) if ANY line is out of stock (outOfStockProduct > 0).
 * Final precedence: preOrder(12) > OOS(2) > retro(22) > printing(14/24) > picking(16).
 *
 * Fixes the prior port's two defects:
 *  (a) retro was returned first and unconditionally (wrongly beating pre-order/OOS);
 *  (b) OOS was handled by suppressing the status write entirely in the service,
 *      instead of transitioning to Processing(2). Legacy writes the status
 *      unconditionally (L1623-1624) and sets 2 on OOS (L1065-1072).
 */
export function determineProposedStatus(
  hasRetro: boolean,
  hasPrinting: boolean,
  hasPreOrder: boolean,
  hasOutOfStock: boolean,
  products?: OrderProductForProcessingRow[]
): { status: number; name: string } {
  // Override block — legacy L1539-1550 (applied after the loop's base status).
  if (hasPreOrder) {
    return { status: STATUS.PRE_ORDERED, name: 'Pre Order' };
  }
  if (hasOutOfStock) {
    return { status: STATUS.PROCESSING, name: 'Processing' };
  }

  // Base status from the product loop — unchanged from the prior port.
  // PHP: any retro product → status 22, regardless of stock availability.
  if (hasRetro) {
    return { status: STATUS.RETRO_SHIRTS, name: 'Retro Shirts' };
  }

  if (hasPrinting) {
    // PHP lines 1329-1347: checkpoint2 check — if ALL printing products are at
    // checkpoint2, upgrade from status 14 to 24.
    if (products && products.length > 0) {
      const printingProducts = products.filter((p) => {
        const pType = detectProductType(p);
        return pType === 'tshirt' || pType === 'hero_shirt' ||
               (p.printing_status !== 'Printed' && p.scan_checkpoint);
      });

      if (printingProducts.length > 0) {
        const allAtCheckpoint2 = printingProducts.every(
          (p) => p.scan_checkpoint && p.scan_checkpoint.toLowerCase().includes('checkpoint2')
        );
        const anyNotPrinted = printingProducts.some(
          (p) => p.printing_status === 'Not Printed'
        );

        if (allAtCheckpoint2 && anyNotPrinted) {
          return { status: STATUS.READY_TO_SHIP, name: 'Ready to Ship' };
        }

        if (!allAtCheckpoint2) {
          return { status: STATUS.AWAITING_PRINTING, name: 'Awaiting Printing' };
        }
      }
    }

    return { status: STATUS.AWAITING_PRINTING, name: 'Awaiting Printing' };
  }

  return { status: STATUS.BEING_PICKED, name: 'Being Picked' };
}
