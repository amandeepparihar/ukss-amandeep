/**
 * Shopify Sync Types
 */

export interface ShopifyProductInput {
  title: string;
  body_html?: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  variants: ShopifyVariantInput[];
}

export interface ShopifyVariantInput {
  sku: string;
  price: string;
  compare_at_price?: string;
  inventory_quantity?: number;
  option1?: string;
  option2?: string;
  option3?: string;
}

export interface ShopifyInventoryUpdate {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
}

export interface SyncResult {
  success: boolean;
  shopifyId?: string;
  error?: string;
}

export interface CheckpointState {
  lastProductId: string | null;
  batchNumber: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
}

export interface SyncJobData {
  storeId: string;
  syncId?: string;
  isManual?: boolean;
}

export interface ProductWithVariants {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  isDeleted: boolean;
  variants: {
    id: string;
    sku: string;
    title: string;
    price: number;
    compareAtPrice: number | null;
    stock: number;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    shopifyVariantId: string | null;
  }[];
  syncStatus?: {
    shopifyId: string | null;
    needsSync: boolean;
  };
}
