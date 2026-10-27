/**
 * Order details panel — right-side quick view on the listing page.
 * Requirements: REQ-03-001 (AJAX loading), REQ-03-002 (initial/dynamic load),
 *   REQ-03-007 (document buttons)
 *
 * Assembles panel sub-components: header, document buttons, rejection, status,
 * suppliers, metadata, products, refund review.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, X, FileText, FileOutput, File } from 'lucide-react';
import { useOrderPanel } from '../hooks/useOrderPanel';
import { useOrderStore } from '../stores/orderStore';
import type { OrderStatus } from '../hooks/useOrders';
import { PanelHeader } from './panel/PanelHeader';
import { PanelMetadata } from './panel/PanelMetadata';
import { PanelStatusControls } from './panel/PanelStatusControls';
import { PanelRejection } from './panel/PanelRejection';
import { PanelRefundReview } from './panel/PanelRefundReview';
import { PanelProducts } from './panel/PanelProducts';
import { PanelSuppliers } from './panel/PanelSuppliers';
import { ProcessingSimulation } from './ProcessingSimulation';
import { InvoiceLog } from './InvoiceLog';

/**
 * Legacy webadmin base URL for document generation.
 * Document pages (invoice, packing slip, PDF) are served by the PHP system.
 */
const LEGACY_WEBADMIN_URL = 'https://stock.uksoccershop.com/webadmin';

interface OrderDetailsPanelProps {
  orderId: number | null;
  onClose: () => void;
  statuses: OrderStatus[] | undefined;
}

export function OrderDetailsPanel({ orderId, onClose, statuses }: OrderDetailsPanelProps) {
  const { rejectPermission } = useOrderStore();
  const { data, isLoading, isError } = useOrderPanel(orderId);

  // REQ-03-002: "No Order Found" if empty
  if (!orderId) {
    return (
      <PanelShell onClose={onClose}>
        <div className="text-center py-8 text-muted-foreground">
          Click an order row to view details.
        </div>
      </PanelShell>
    );
  }

  // REQ-03-001: Loading overlay
  if (isLoading) {
    return (
      <PanelShell onClose={onClose}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PanelShell>
    );
  }

  // REQ-03-001: Error state
  if (isError || !data) {
    return (
      <PanelShell onClose={onClose}>
        <div className="text-center py-8 text-red-600">
          Some error occurred! Please try again.
        </div>
      </PanelShell>
    );
  }

  // REQ-03-007: Fraud status clear = show document buttons
  const showDocumentButtons = data.fraudStatus === 0;

  return (
    <PanelShell onClose={onClose}>
      <div className="space-y-4">
        {/* Section C: Header & Navigation */}
        <PanelHeader
          data={data}
          rejectPermission={rejectPermission}
          onOrderDeleted={onClose}
        />

        <Separator />

        {/* REQ-03-007: Document buttons (conditional on fraud status) */}
        {showDocumentButtons && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`${LEGACY_WEBADMIN_URL}/invoice.php?oID=${data.orderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  Invoice
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`${LEGACY_WEBADMIN_URL}/packingslip.php?oID=${data.orderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileOutput className="h-3.5 w-3.5 mr-1" />
                  Packing Slip
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`${LEGACY_WEBADMIN_URL}/invoice-pdf.php?oID=${data.orderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <File className="h-3.5 w-3.5 mr-1" />
                  PDF Invoice
                </a>
              </Button>
            </div>
            <Separator />
          </>
        )}

        {/* Section E: Rejection buttons */}
        <PanelRejection
          orderId={data.orderId}
          rejectPermission={rejectPermission}
          refundStatusForReject={data.refundStatusForReject}
        />

        <Separator />

        {/* Section F: Status controls */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Current:</span>
            <Badge variant="outline">{data.statusName}</Badge>
          </div>
          <PanelStatusControls data={data} statuses={statuses} />
        </div>

        <Separator />

        {/* Section G: Suppliers */}
        <PanelSuppliers
          orderId={data.orderId}
          status={data.status}
          currentSuppliers={data.suppliers}
          allSuppliers={data.allSuppliers}
        />

        <Separator />

        {/* SPEC-13 processing-simulation widget (propose/execute/disagree), surfaced
          * here so staff don't have to leave the listing to run it. Distinct from
          * REQ-03-014's Multipart/Complete/Part/Invoice/Print buttons, which have
          * no UI anywhere in the app yet — not implemented by this. */}
        <ProcessingSimulation orderId={data.orderId} />

        <Separator />

        {/* Section I: Refund Review */}
        <PanelRefundReview
          orderId={data.orderId}
          refundReviewStatus={data.refundReviewStatus}
          refundReviewComment={data.refundReviewComment}
        />

        <Separator />

        {/* Section J: Metadata */}
        <PanelMetadata data={data} />

        <Separator />

        {/* Section K: Products */}
        <PanelProducts
          orderId={data.orderId}
          products={data.products}
          productCount={data.productCount}
        />

        <Separator />

        {/* SPEC-13 invoice log, click-to-load. REQ-03-023 calls for this to
          * auto-load on panel-ready — not implemented by this; still manual here. */}
        <InvoiceLog orderId={data.orderId} />
      </div>
    </PanelShell>
  );
}

/** Panel shell wrapper with close button and scroll */
function PanelShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-medium">Order Details</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <CardContent className="flex-1 overflow-y-auto p-3">
        {children}
      </CardContent>
    </Card>
  );
}
