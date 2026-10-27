/**
 * Order edit page — full layout composing all section components.
 * Requirements: REQ-04-001 through REQ-04-027 (layout & display)
 *
 * REQ-04-001: Validates order exists, redirects to listing if not found.
 * REQ-04-003: Invoice printing warning — deferred to SPEC-13.
 * REQ-04-006: Remote order processing — deferred to SPEC-13.
 * REQ-04-015: Delivery review — deferred to SPEC-11.
 * REQ-04-016: WorldPay/SagePay — deferred to SPEC-10.
 * REQ-04-017: Credit card info — deferred to SPEC-10.
 * REQ-04-020: Shopify refund — deferred to SPEC-10.
 * REQ-04-023: Allocate section — deferred to SPEC-12.
 * REQ-04-024: Order query form — implemented in SPEC-08 (OrderQueries component).
 * REQ-04-008: Change Address dialog, ISF checkbox — deferred to SPEC-11.
 * REQ-04-025: Dialog containers — populated by later specs.
 * REQ-04-026: SweetAlert popups — populated by later specs.
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { useOrderDetail, useOrderViewers } from './hooks/useOrderDetail';
import { OrderEditHeader } from './components/OrderEditHeader';
import { OrderToolbar } from './components/OrderToolbar';
import { CustomerInfoSection } from './components/CustomerInfoSection';
import { AddressSection } from './components/AddressSection';
import { MarketplaceIdsSection } from './components/MarketplaceIdsSection';
import { FcOrderSection } from './components/FcOrderSection';
import { OrderMetadataSection } from './components/OrderMetadataSection';
import { TrackingSection } from './components/TrackingSection';
import { OrderInfoSection } from './components/OrderInfoSection';
import { ColorLegend } from './components/ColorLegend';
import { ProductsTable } from './components/ProductsTable';
import { StatusManagement } from './components/StatusManagement';
import { StatusHistory } from './components/StatusHistory';
import { OrderQueries } from './components/OrderQueries';
import { ProcessingSimulation } from './components/ProcessingSimulation';
import { InvoiceLog } from './components/InvoiceLog';

export function OrderEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // REQ-04-001: Parse and validate order ID (integer cast for SQL safety)
  const orderId = id ? parseInt(id, 10) : 0;

  // REQ-04-001: Fetch full order details
  const { data: order, isLoading, isError } = useOrderDetail(orderId > 0 ? orderId : null);

  // REQ-04-004: Poll concurrent viewers every 3 seconds
  const { data: viewers = [] } = useOrderViewers(orderId > 0 ? orderId : null);

  // REQ-04-001: If order doesn't exist, redirect to listing
  useEffect(() => {
    if (!isLoading && isError) {
      toast.error(`Order #${orderId} does not exist`);
      navigate('/orders', { replace: true });
    }
  }, [isLoading, isError, orderId, navigate]);

  // If oID is empty/missing, redirect to listing
  useEffect(() => {
    if (!id || orderId <= 0) {
      navigate('/orders', { replace: true });
    }
  }, [id, orderId, navigate]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!order) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* REQ-04-002 + REQ-04-004 + REQ-04-027: Header with nav, viewers, labels */}
      <OrderEditHeader order={order} viewers={viewers} />

      {/* REQ-04-005 + REQ-04-022: Action toolbar */}
      <OrderToolbar order={order} />

      {/* REQ-04-007 + REQ-04-008: Customer info + addresses */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CustomerInfoSection order={order} />
        <div className="lg:col-span-2">
          <AddressSection
            deliveryAddress={order.deliveryAddress}
            billingAddress={order.billingAddress}
          />
        </div>
      </div>

      {/* REQ-04-009: Marketplace order IDs */}
      <MarketplaceIdsSection marketplaceIds={order.marketplaceIds} orderSite={order.orderSite} />

      {/* FC Order Status — shown only for Amazon FC orders (#485, #490) */}
      <FcOrderSection marketplaceIds={order.marketplaceIds} />

      {/* REQ-04-010: Order metadata row */}
      <OrderMetadataSection order={order} />

      {/* REQ-04-011 + REQ-04-012/13/14: Tracking + order info side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TrackingSection tracking={order.tracking} />
        <OrderInfoSection order={order} />
      </div>

      {/* SPEC-13: Order Processing Simulation (REQ-13-001/002) */}
      <ProcessingSimulation orderId={order.orderId} />

      {/* SPEC-05: Products table */}
      <ProductsTable orderId={order.orderId} />

      {/* SPEC-13: Invoice Log (REQ-13-005) */}
      <InvoiceLog orderId={order.orderId} />

      {/* SPEC-07: Status Management + History */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatusManagement
          orderId={order.orderId}
          currentStatus={order.status}
          currentStatusName={order.statusName}
          isMultisite={
            order.marketplaceIds.multisite != null
            && order.marketplaceIds.multisite !== '0'
            && order.marketplaceIds.multisite !== ''
          }
        />
        <StatusHistory orderId={order.orderId} />
      </div>

      {/* SPEC-08: Order Queries (REQ-08-011, REQ-08-013) */}
      <OrderQueries orderId={order.orderId} />

      {/* REQ-04-019: Color legend + lock for review */}
      <ColorLegend orderId={order.orderId} lockForReview={order.flags.lockForReview} />
    </div>
  );
}
