/**
 * Orders Zustand store — replaces PHP session variables for order context.
 * Requirements: REQ-01-005 to REQ-01-008
 *
 * REQ-01-005: Core identity is handled by authStore (JWT).
 * REQ-01-006: Order context session variables.
 * REQ-01-007: Consumable (flash) session variables.
 * REQ-01-008: Invoice printing state.
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** REQ-01-007: Possible pick operation results */
type PickResponse = 'all' | 'partial' | 'none' | 'unable' | null;

interface OrderStore {
  // REQ-01-006: Order context variables (persist across page loads)
  selectedOrderId: number | null;
  dropdownProductsId: number | null;
  dropdownCategoriesId: number | null;
  statusDropdown: number | null;
  popupFilter: boolean;

  // REQ-01-007: Consumable (flash) variables — read once then cleared
  pickResponse: PickResponse;
  checkUpdateSoccerstore: string | null;

  // REQ-01-008: Invoice printing state
  invoicePrintingOrderId: number | null;
  invoicePrinting: boolean;

  // Feature permissions (REQ-01-003, loaded from API)
  refundPermission: boolean;
  rejectPermission: boolean;

  // Actions — REQ-01-006
  setSelectedOrderId: (id: number | null) => void;
  setDropdownProductsId: (id: number | null) => void;
  setDropdownCategoriesId: (id: number | null) => void;
  setStatusDropdown: (id: number | null) => void;
  setPopupFilter: (active: boolean) => void;

  // Actions — REQ-01-007 (consume = read + clear)
  setPickResponse: (response: PickResponse) => void;
  consumePickResponse: () => PickResponse;
  setCheckUpdateSoccerstore: (message: string | null) => void;
  consumeCheckUpdateSoccerstore: () => string | null;

  // Actions — REQ-01-008
  setInvoicePrinting: (orderId: number | null, printing: boolean) => void;

  // Actions — permissions
  setPermissions: (refund: boolean, reject: boolean) => void;

  // Reset
  resetStore: () => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState = {
  selectedOrderId: null,
  dropdownProductsId: null,
  dropdownCategoriesId: null,
  statusDropdown: null,
  popupFilter: false,
  pickResponse: null as PickResponse,
  checkUpdateSoccerstore: null,
  invoicePrintingOrderId: null,
  invoicePrinting: false,
  refundPermission: false,
  rejectPermission: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useOrderStore = create<OrderStore>((set, get) => ({
  ...initialState,

  // REQ-01-006: Context setters
  setSelectedOrderId: (id) => set({ selectedOrderId: id }),
  setDropdownProductsId: (id) => set({ dropdownProductsId: id }),
  setDropdownCategoriesId: (id) => set({ dropdownCategoriesId: id }),
  setStatusDropdown: (id) => set({ statusDropdown: id }),
  setPopupFilter: (active) => set({ popupFilter: active }),

  // REQ-01-007: Flash message setters/consumers
  setPickResponse: (response) => set({ pickResponse: response }),
  consumePickResponse: () => {
    const current = get().pickResponse;
    set({ pickResponse: null });
    return current;
  },
  setCheckUpdateSoccerstore: (message) => set({ checkUpdateSoccerstore: message }),
  consumeCheckUpdateSoccerstore: () => {
    const current = get().checkUpdateSoccerstore;
    set({ checkUpdateSoccerstore: null });
    return current;
  },

  // REQ-01-008: Invoice printing
  setInvoicePrinting: (orderId, printing) =>
    set({ invoicePrintingOrderId: orderId, invoicePrinting: printing }),

  // Permissions
  setPermissions: (refund, reject) =>
    set({ refundPermission: refund, rejectPermission: reject }),

  // Reset
  resetStore: () => set(initialState),
}));
