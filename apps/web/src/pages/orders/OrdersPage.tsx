/**
 * Orders listing page — main page with alerts, filters, tabs, DataTable, and details panel.
 * Requirements: REQ-02-001 (three-section layout), REQ-02-006-023 (full listing),
 *   REQ-03-001 (panel loading on row click), REQ-03-002 (panel display)
 */

import { useEffect, useMemo, useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable } from '@/components/data-table/DataTable';
import { useDataTable } from '@/components/data-table/useDataTable';
import {
  useOrderStatuses,
  useOrderPermissions,
  useOrderListing,
  useOrderTabCounts,
  useOrderStores,
} from './hooks/useOrders';
import { useOrderStore } from './stores/orderStore';
import { OrderAlerts } from './components/OrderAlerts';
import { OrderTabs, type TabKey } from './components/OrderTabs';
import { OrderFilters, type FilterState } from './components/OrderFilters';
import { getOrderColumns } from './components/OrderColumns';
import { OrderDetailsPanel } from './components/OrderDetailsPanel';
import { ProcessQueueButton } from './components/ProcessQueueButton';
import type { OrderListItem } from './hooks/useOrders';
import './components/order-row-colors.css';

export function OrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedOrderId, setPermissions, setSelectedOrderId } = useOrderStore();

  // REQ-03-001: Track panel open state separately from selected order
  const [panelOpen, setPanelOpen] = useState(false);

  // Parse tab from URL
  const urlTab = searchParams.get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey | undefined>(urlTab ?? undefined);

  // Parse filters from URL
  const [filters, setFilters] = useState<FilterState>(() => {
    const initial: FilterState = {};
    const status = searchParams.get('status');
    if (status) initial.status = Number(status);
    const seller = searchParams.get('seller');
    if (seller) initial.seller = seller;
    const marketplace = searchParams.get('marketplace');
    if (marketplace) initial.marketplace = marketplace;
    const marketplaceSearchValue = searchParams.get('marketplaceSearchValue');
    if (marketplaceSearchValue) initial.marketplaceSearchValue = marketplaceSearchValue;
    const orderType = searchParams.get('orderType');
    if (orderType) initial.orderType = orderType;
    const sortBy = searchParams.get('sortBy');
    if (sortBy) initial.sortBy = sortBy;
    const search = searchParams.get('search');
    if (search) initial.search = search;
    const interval = searchParams.get('interval');
    if (interval) initial.interval = Number(interval);
    const toffsCode = searchParams.get('toffsCode');
    if (toffsCode) initial.toffsCode = toffsCode;
    const fsBarcode = searchParams.get('fsBarcode');
    if (fsBarcode) initial.fsBarcode = fsBarcode;
    const productSearch = searchParams.get('productSearch');
    if (productSearch) initial.productSearch = productSearch;
    const sizeFilter = searchParams.get('sizeFilter');
    if (sizeFilter) initial.sizeFilter = Number(sizeFilter);
    const popupProductId = searchParams.get('popupProductId');
    if (popupProductId) initial.popupProductId = Number(popupProductId);
    const popupCategoryId = searchParams.get('popupCategoryId');
    if (popupCategoryId) initial.popupCategoryId = Number(popupCategoryId);
    return initial;
  });

  // DataTable state
  const {
    pagination,
    setPagination,
    sorting,
    setSorting,
    queryParams,
  } = useDataTable({ pageSize: 20, enableUrlSync: false });

  // Foundation data
  const { data: statuses } = useOrderStatuses();
  const { data: permissions } = useOrderPermissions();
  const { data: stores } = useOrderStores();

  // Build API params combining DataTable state + custom filters
  const apiParams = useMemo(() => ({
    page: queryParams.page,
    pageSize: queryParams.limit,
    ...filters,
    tab: activeTab,
  }), [queryParams.page, queryParams.limit, filters, activeTab]);

  // Listing data
  const { data: listingResponse, isLoading } = useOrderListing(apiParams);

  // Tab counts (pass filters so counts reflect current filter state)
  const tabCountParams = useMemo(() => {
    const p: Record<string, unknown> = { ...filters };
    delete p.orderId;
    return p;
  }, [filters]);
  const { data: tabCounts, isLoading: tabCountsLoading } = useOrderTabCounts(tabCountParams);

  // Sync permissions to store
  useEffect(() => {
    if (permissions) {
      setPermissions(permissions.refundPermission, permissions.rejectPermission);
    }
  }, [permissions, setPermissions]);

  // Handle redirect response from orderId search
  useEffect(() => {
    if (listingResponse?.data && 'redirect' in listingResponse.data) {
      navigate(listingResponse.data.redirect);
    }
  }, [listingResponse, navigate]);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab) params.set('tab', activeTab);
    if (filters.status) params.set('status', String(filters.status));
    if (filters.seller) params.set('seller', String(filters.seller));
    if (filters.marketplace) params.set('marketplace', filters.marketplace);
    if (filters.marketplaceSearchValue) params.set('marketplaceSearchValue', filters.marketplaceSearchValue);
    if (filters.orderType) params.set('orderType', filters.orderType);
    if (filters.sortBy && filters.sortBy !== 'default') params.set('sortBy', filters.sortBy);
    if (filters.search) params.set('search', filters.search);
    if (filters.interval) params.set('interval', String(filters.interval));
    if (filters.toffsCode) params.set('toffsCode', filters.toffsCode);
    if (filters.fsBarcode) params.set('fsBarcode', filters.fsBarcode);
    if (filters.productSearch) params.set('productSearch', filters.productSearch);
    if (filters.sizeFilter) params.set('sizeFilter', String(filters.sizeFilter));
    if (filters.popupProductId) params.set('popupProductId', String(filters.popupProductId));
    if (filters.popupCategoryId) params.set('popupCategoryId', String(filters.popupCategoryId));
    if (queryParams.page > 1) params.set('page', String(queryParams.page));
    setSearchParams(params, { replace: true });
  }, [activeTab, filters, queryParams.page, setSearchParams]);

  // Extract listing data
  const orders: OrderListItem[] = useMemo(() => {
    if (!listingResponse?.data || 'redirect' in listingResponse.data) return [];
    return listingResponse.data;
  }, [listingResponse]);

  const pageCount = listingResponse?.meta?.totalPages ?? 0;

  // Tab change resets to page 1
  const handleTabChange = useCallback((tab: TabKey | undefined) => {
    setActiveTab(tab);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [setPagination]);

  // Filter change resets to page 1
  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [setPagination]);

  // REQ-03-001: Info click opens panel and selects order
  const handleInfoClick = useCallback((orderId: number) => {
    setSelectedOrderId(orderId);
    setPanelOpen(true);
  }, [setSelectedOrderId]);

  // REQ-03-001: Close panel
  const handlePanelClose = useCallback(() => {
    setPanelOpen(false);
    setSelectedOrderId(null);
  }, [setSelectedOrderId]);

  // Column configuration
  const showRefund = activeTab === 'toBeRefund';
  const showTouchpoints = filters.status === 12;
  const columns = useMemo(
    () => getOrderColumns(showRefund, showTouchpoints, handleInfoClick),
    [showRefund, showTouchpoints, handleInfoClick],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description="Manage customer orders"
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Orders' },
        ]}
        actions={<ProcessQueueButton />}
      />

      {/* Section 1: Alerts (REQ-02-002-005) — loaded independently */}
      <OrderAlerts />

      {/* Section 1: Filters (REQ-02-006-015) */}
      <OrderFilters
        statuses={statuses}
        stores={stores}
        filters={filters}
        onFilterChange={handleFilterChange}
      />

      {/* Section 2: Tabs (REQ-02-017) */}
      <OrderTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        counts={tabCounts}
        isLoading={tabCountsLoading}
      />

      {/* REQ-03-001: Split layout — table (left) + panel (right) when panel open */}
      <div className={panelOpen ? 'flex gap-4' : ''}>
        <div className={panelOpen ? 'flex-1 min-w-0' : ''}>
          {/* Section 2: Listing Table (REQ-02-018) */}
          <DataTable<OrderListItem, unknown>
            columns={columns}
            data={orders}
            pageCount={pageCount}
            isLoading={isLoading}
            pagination={pagination}
            onPaginationChange={setPagination}
            sorting={sorting}
            onSortingChange={setSorting}
            getRowId={(row) => String(row.orderId)}
            rowClassName={(row) => row.rowClass}
            emptyState={
              <div className="text-center py-8 text-muted-foreground">
                No orders found matching the current filters.
              </div>
            }
          />
        </div>

        {/* REQ-03-001/002: Right-side details panel */}
        {panelOpen && (
          <div className="w-[400px] flex-shrink-0 sticky top-4 self-start max-h-[calc(100vh-8rem)] overflow-hidden">
            <OrderDetailsPanel
              orderId={selectedOrderId}
              onClose={handlePanelClose}
              statuses={statuses}
            />
          </div>
        )}
      </div>
    </div>
  );
}
