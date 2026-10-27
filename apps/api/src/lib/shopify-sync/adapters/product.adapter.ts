/**
 * Product Adapter
 *
 * Maps local Product/ProductVariant data to Shopify API format
 */

import type { ShopifyProductInput, ShopifyVariantInput, ProductWithVariants } from '../types';

export class ProductAdapter {
  /**
   * Map a local product to Shopify product input
   */
  mapToShopify(product: ProductWithVariants): ShopifyProductInput {
    // Determine status based on soft delete
    const status = product.isDeleted ? 'DRAFT' : 'ACTIVE';

    // Map variants
    const variants = this.mapVariants(product);

    return {
      title: product.name,
      body_html: product.description || '',
      status,
      variants,
    };
  }

  /**
   * Map product variants to Shopify format
   */
  private mapVariants(product: ProductWithVariants): ShopifyVariantInput[] {
    // If product has variants, map them
    if (product.variants && product.variants.length > 0) {
      return product.variants.map(variant => ({
        sku: variant.sku,
        price: this.formatPrice(variant.price),
        compare_at_price: variant.compareAtPrice
          ? this.formatPrice(variant.compareAtPrice)
          : undefined,
        inventory_quantity: variant.stock,
        option1: variant.option1 || undefined,
        option2: variant.option2 || undefined,
        option3: variant.option3 || undefined,
      }));
    }

    // If no variants, create a default variant from product data
    return [{
      sku: product.sku,
      price: this.formatPrice(product.price),
      compare_at_price: product.compareAtPrice
        ? this.formatPrice(product.compareAtPrice)
        : undefined,
      inventory_quantity: product.stock,
    }];
  }

  /**
   * Create a price update payload for existing Shopify product
   */
  mapPriceUpdate(product: ProductWithVariants): {
    productId: string;
    variants: { variantId: string; price: string; compareAtPrice?: string }[];
  } | null {
    const shopifyId = product.syncStatus?.shopifyId;
    if (!shopifyId) {
      return null;
    }

    const variants: { variantId: string; price: string; compareAtPrice?: string }[] = [];

    // Map variants if they have Shopify IDs
    if (product.variants && product.variants.length > 0) {
      for (const variant of product.variants) {
        if (variant.shopifyVariantId) {
          variants.push({
            variantId: variant.shopifyVariantId,
            price: this.formatPrice(variant.price),
            compareAtPrice: variant.compareAtPrice
              ? this.formatPrice(variant.compareAtPrice)
              : undefined,
          });
        }
      }
    }

    return {
      productId: shopifyId,
      variants,
    };
  }

  /**
   * Create inventory update payloads
   */
  mapInventoryUpdates(
    product: ProductWithVariants,
    locationId: string,
    variantInventoryMap: Map<string, string> // variantId -> inventoryItemId
  ): { inventoryItemId: string; locationId: string; quantity: number }[] {
    const updates: { inventoryItemId: string; locationId: string; quantity: number }[] = [];

    if (product.variants && product.variants.length > 0) {
      for (const variant of product.variants) {
        if (variant.shopifyVariantId) {
          const inventoryItemId = variantInventoryMap.get(variant.shopifyVariantId);
          if (inventoryItemId) {
            updates.push({
              inventoryItemId,
              locationId,
              quantity: variant.stock,
            });
          }
        }
      }
    }

    return updates;
  }

  /**
   * Format price as string with 2 decimal places
   */
  private formatPrice(price: number | { toNumber?: () => number }): string {
    const numPrice = typeof price === 'number' ? price : (price.toNumber?.() ?? 0);
    return numPrice.toFixed(2);
  }

  /**
   * Check if product needs full update or just price/inventory
   */
  needsFullUpdate(product: ProductWithVariants): boolean {
    // If no Shopify ID, needs full create
    if (!product.syncStatus?.shopifyId) {
      return true;
    }

    // For now, we only sync price and inventory, so no full update needed
    return false;
  }
}
