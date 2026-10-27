/**
 * Deliveries permissions — derives the 13 per-cell visibility flags from the
 * user's JWT permissions array.
 *
 * Migration source: IndexController::new_stock builds an identical
 * $permissionData array at app/controllers/index_controller.php:2382-2450,
 * exposed to the legacy view as a global `user_permissions` JS object.
 *
 * The frontend uses these flags to decide which columns to render. In phase 1
 * (read-only) the flags only control column visibility; phase 2 will reuse the
 * same shape to gate inline-edit endpoints.
 */

export interface DeliveryFeaturePermissions {
  EDIT_SEASON: boolean;
  EDIT_QUANTITIES: boolean;
  EDIT_PRICE: boolean;
  MAP_PRODUCTS: boolean;
  MYSTERY_LIST: boolean;
  SUPPLIER_BARCODE: boolean;
  SET_SPECIAL_PRICE_AND_DEAL: boolean;
  LINK_QUANTITY: boolean;
  ADD_SMS_PRODUCT: boolean;
  SET_EBAY_PRODUCTS: boolean;
  ASSIGN_FONTS: boolean;
  ADD_IMAGE: boolean;
  UPLOAD_IMAGE: boolean;
}

const PERMISSION_MAP: Record<keyof DeliveryFeaturePermissions, string> = {
  EDIT_SEASON: 'deliveries:edit_season',
  EDIT_QUANTITIES: 'deliveries:edit_quantities',
  EDIT_PRICE: 'deliveries:edit_price',
  MAP_PRODUCTS: 'deliveries:map_products',
  MYSTERY_LIST: 'deliveries:mystery_list',
  SUPPLIER_BARCODE: 'deliveries:supplier_barcode',
  SET_SPECIAL_PRICE_AND_DEAL: 'deliveries:set_special',
  LINK_QUANTITY: 'deliveries:link_quantity',
  ADD_SMS_PRODUCT: 'deliveries:add_sms_product',
  SET_EBAY_PRODUCTS: 'deliveries:set_ebay',
  ASSIGN_FONTS: 'deliveries:assign_fonts',
  ADD_IMAGE: 'deliveries:add_image',
  UPLOAD_IMAGE: 'deliveries:upload_image',
};

export function deriveDeliveryPermissions(
  userPermissions: string[]
): DeliveryFeaturePermissions {
  const has = new Set(userPermissions);
  const result = {} as DeliveryFeaturePermissions;
  for (const key of Object.keys(PERMISSION_MAP) as (keyof DeliveryFeaturePermissions)[]) {
    result[key] = has.has(PERMISSION_MAP[key]);
  }
  return result;
}
