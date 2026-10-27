/**
 * Primary action toolbar — conditional buttons based on order state.
 * Requirements: REQ-04-005, REQ-04-021, REQ-04-022
 *
 * Note: Many actions (FC, processing, payments, invoices) are stubs
 * that will be fully implemented in their respective specs.
 */

import { useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft, Mail, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { OrderDetailData } from '../hooks/useOrderDetail';

interface OrderToolbarProps {
  order: OrderDetailData;
}

export function OrderToolbar({ order }: OrderToolbarProps) {
  const navigate = useNavigate();

  // REQ-04-022: Fraud status determines button visibility
  const { processOrder, fraudStatus } = order.flags;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* REQ-04-005: Fraud toggle button */}
      <Button
        variant="outline" size="sm"
        onClick={() => toast.info('Fraud toggle will be implemented in SPEC-07')}
      >
        {fraudStatus === 1 ? 'Mark As Not Fraud' : 'Mark As Fraud'}
      </Button>

      {/* REQ-04-005: Process button (shown if process_order=='yes') */}
      {processOrder && (
        <Button
          variant="outline" size="sm"
          onClick={() => toast.info('Process order will be implemented in SPEC-13')}
        >
          Process
        </Button>
      )}

      {/* REQ-04-005: Refund/Tax Refund — always shown */}
      <Button
        variant="outline" size="sm"
        onClick={() => toast.info('Refund will be implemented in SPEC-10')}
      >
        Refund
      </Button>
      <Button
        variant="outline" size="sm"
        onClick={() => toast.info('Tax refund will be implemented in SPEC-10')}
      >
        Tax Refund
      </Button>

      {/* REQ-04-005: Return History */}
      <Button
        variant="outline" size="sm"
        onClick={() => toast.info('Return history will be implemented in SPEC-15')}
      >
        <RotateCcw className="mr-1 h-3.5 w-3.5" />
        Return History
      </Button>

      {/* REQ-04-005: PDF Invoice (if processable) */}
      {processOrder && (
        <Button
          variant="outline" size="sm"
          onClick={() => toast.info('PDF invoice will be implemented in SPEC-13')}
        >
          <Printer className="mr-1 h-3.5 w-3.5" />
          PDF Invoice
        </Button>
      )}

      {/* REQ-04-005: Email */}
      <Button
        variant="outline" size="sm"
        onClick={() => toast.info('Email dialog will be implemented in SPEC-08')}
      >
        <Mail className="mr-1 h-3.5 w-3.5" />
        Email
      </Button>

      {/* REQ-04-005 + REQ-04-021: Back to orders list */}
      <Button
        variant="outline" size="sm"
        onClick={() => navigate('/orders')}
      >
        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
        Back
      </Button>
    </div>
  );
}
