import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, getApiError } from '@/lib/api';

/**
 * One row from GET /api/seller-dynamics-listing.
 * Shape mirrors the API service (sd-tshirts.service.ts `getTshirts` select):
 * prices arrive as numbers and `sd_price` is the API-computed marked-up price.
 */
export interface SdProduct {
  products_id: number;
  products_name: string;
  products_model: string | null;
  products_price: number;
  sd_price: number;
  products_date_added: string;
  np_best_seller_7days: number;
  np_best_seller_6months: number;
  np_best_seller_1year: number;
  np_best_seller_lifetime: number;
  // true = already has Seller Dynamics (store 151) marketplace_listing rows.
  isApproved: boolean;
  // The Flag this product is (or would be) sent to Seller Dynamics with, derived from the
  // product's Is_Your_Name setting: 'UKSS-CUST' when customizable, 'UKSS-POD' otherwise.
  // Always present — Is_Your_Name is set on every product, approved or not.
  sdFlag: SdFlag;
}

/** Flags the T-shirts module emits. Plain 'UKSS' is only for items listed outside it. */
export type SdFlag = 'UKSS-POD' | 'UKSS-CUST';

/**
 * Client-side mirror of the API's `sdListingFlag()`
 * (apps/api/src/lib/marketplaces/seller-dynamics/sd-flags.ts). Needed because the approve
 * response returns only a count, so the dialog and the toast have to name the flag from
 * the checkbox state. Keep the two in step.
 */
export function sdFlagFor(isCustomisable: boolean): SdFlag {
  return isCustomisable ? 'UKSS-CUST' : 'UKSS-POD';
}

export interface SdListingParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  // 'true' = only approved, 'false' = only not-approved, omit = all.
  approved?: 'true' | 'false';
}

/** Server-side list query. Undefined params are dropped by axios. */
export function useSdListing(params: SdListingParams) {
  return useQuery({
    queryKey: ['seller-dynamics', 'listing', params],
    queryFn: async () => {
      const response = await api.get('/seller-dynamics-listing', { params });
      return response.data;
    },
  });
}

/** One product's approval decision. Customisability is chosen per product, not per batch. */
export interface ApproveProduct {
  productId: number;
  // true -> Is_Your_Name 'Yes' -> Flag 'UKSS-CUST', false -> 'No' -> 'UKSS-POD'.
  isCustomisable: boolean;
}

export interface ApproveVars {
  products: ApproveProduct[];
}

/**
 * "Approve" the selected products. The API (sd-tshirts.service.ts `approveProducts`)
 * looks up each product's non-deleted variations and inserts a draft row per variation
 * into marketplace_listing (store 151) — a later cron bulk-uploads them to Seller Dynamics.
 * It also writes each product's `isCustomisable` choice to its `Is_Your_Name` flag.
 *
 * Contract: body is `{ products: [{ productId, isCustomisable }] }`; success payload is
 * `{ data: { inserted: <count> } }` (count = variations inserted).
 * Errors: PRODUCTS_NOT_FOUND, VARIATIONS_NOT_FOUND, PRODUCTS_ALREADY_APPROVED.
 *
 * Approval itself is one-way (no un-approve), so the toast names the flag split that was
 * applied — the response only carries a total, so it is counted from the request.
 */
export function useApproveProducts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ products }: ApproveVars) => {
      const response = await api.patch('/seller-dynamics-listing/approve', { products });
      return response.data;
    },
    onSuccess: (data, { products }) => {
      const count = data?.data?.inserted ?? 0;
      const custCount = products.filter((p) => p.isCustomisable).length;
      const podCount = products.length - custCount;
      const split = [
        custCount > 0 ? `${custCount} ${sdFlagFor(true)}` : null,
        podCount > 0 ? `${podCount} ${sdFlagFor(false)}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      toast.success(
        `${count} listing${count === 1 ? '' : 's'} queued for Seller Dynamics (${split})`
      );
      // Refetch the list so it reflects the change.
      queryClient.invalidateQueries({ queryKey: ['seller-dynamics', 'listing'] });
    },
    onError: (error) => {
      // Surfaces PRODUCTS_NOT_FOUND / VARIATIONS_NOT_FOUND (and any other) from the envelope.
      toast.error(getApiError(error).message);
    },
  });
}
