/**
 * Order listing alerts — Amazon late orders + FC error/pending panels.
 * Requirements: REQ-02-002, REQ-02-003, REQ-02-004, REQ-02-005
 * REQ-02-025: If alerts fail, shows error state without disrupting listing.
 */

import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useOrderAlerts } from '../hooks/useOrders';
import type { AlertOrder } from '../hooks/useOrders';

function AlertOrderLinks({ orders, label }: { orders: AlertOrder[]; label: string }) {
  if (orders.length === 0) return null;
  return (
    <span className="text-sm">
      <strong>{label}:</strong>{' '}
      {orders.map((o, i) => (
        <span key={o.orderId}>
          <Link
            to={`/orders/${o.orderId}`}
            className="text-blue-600 hover:underline"
          >
            {o.orderId}
          </Link>
          {i < orders.length - 1 && ', '}
        </span>
      ))}
    </span>
  );
}

export function OrderAlerts() {
  const { data: alerts, isError } = useOrderAlerts();

  if (isError) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTitle>Alert Error</AlertTitle>
        <AlertDescription>Could not load order alerts.</AlertDescription>
      </Alert>
    );
  }

  if (!alerts) return null;

  const hasAmazonUK =
    alerts.amazon.uk.lateShipments.length > 0 ||
    alerts.amazon.uk.expectedLate.length > 0;

  const hasAmazonUS =
    alerts.amazon.us.lateShipments.length > 0 ||
    alerts.amazon.us.avoidableLate.length > 0 ||
    alerts.amazon.us.expectedLate.length > 0;

  const hasFcAlerts = alerts.fc.errorOrders > 0 || alerts.fc.manualPending > 0;

  if (!hasAmazonUK && !hasAmazonUS && !hasFcAlerts) return null;

  return (
    <div className="space-y-2 mb-4">
      {/* REQ-02-002: Amazon UK Late Orders */}
      {hasAmazonUK && (
        <Alert className="border-orange-300 bg-orange-50">
          <AlertTitle className="text-sm font-semibold">Amazon UK Late Orders</AlertTitle>
          <AlertDescription className="space-y-1">
            <div className="rounded px-2 py-1" style={{ backgroundColor: '#FFB1B3' }}>
              <AlertOrderLinks orders={alerts.amazon.uk.lateShipments} label="Late Shipments" />
            </div>
            {alerts.amazon.uk.expectedLate.length > 0 && (() => {
              const now = new Date();
              const isOrange = alerts.amazon.uk.expectedLate.some(
                (o) => (new Date(o.shipByDate).getTime() - now.getTime()) / (1000 * 60 * 60) < 7
              );
              return (
                <div className={`rounded px-2 py-1 ${isOrange ? 'bg-orange-200' : 'bg-yellow-200'}`}>
                  <AlertOrderLinks orders={alerts.amazon.uk.expectedLate} label="Expected Late" />
                </div>
              );
            })()}
          </AlertDescription>
        </Alert>
      )}

      {/* REQ-02-003: Amazon US Late Orders */}
      {hasAmazonUS && (
        <Alert className="border-blue-300 bg-blue-50">
          <AlertTitle className="text-sm font-semibold">Amazon US/CA Late Orders</AlertTitle>
          <AlertDescription className="space-y-1">
            <div className="rounded px-2 py-1" style={{ backgroundColor: '#FFB1B3' }}>
              <AlertOrderLinks orders={alerts.amazon.us.lateShipments} label="Late Shipments" />
            </div>
            <div className="rounded px-2 py-1 bg-orange-200">
              <AlertOrderLinks orders={alerts.amazon.us.avoidableLate} label="Avoidable Late" />
            </div>
            <div className="rounded px-2 py-1 bg-yellow-200">
              <AlertOrderLinks orders={alerts.amazon.us.expectedLate} label="Expected Late" />
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* REQ-02-004 + REQ-02-005: FC Alerts */}
      {hasFcAlerts && (
        <div className="flex gap-4">
          {alerts.fc.errorOrders > 0 && (
            <Alert className="flex-1 border-red-300 bg-red-50">
              <AlertTitle className="text-sm font-semibold">GREEN FC (ERROR ORDERS)</AlertTitle>
              <AlertDescription>
                <span className="text-2xl font-bold text-red-600">{alerts.fc.errorOrders}</span>
                <span className="ml-2 text-sm text-muted-foreground">orders failed auto-creation</span>
              </AlertDescription>
            </Alert>
          )}
          {alerts.fc.manualPending > 0 && (
            <Alert className="flex-1 border-yellow-300 bg-yellow-50">
              <AlertTitle className="text-sm font-semibold">GREEN FC (MANUAL PENDING)</AlertTitle>
              <AlertDescription>
                <span className="text-2xl font-bold text-yellow-600">{alerts.fc.manualPending}</span>
                <span className="ml-2 text-sm text-muted-foreground">orders need manual creation</span>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
