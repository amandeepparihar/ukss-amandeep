/**
 * Reusable link components for order IDs in reconciliation result tables.
 */

import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

interface MarketplaceOrderLinkProps {
  orderId: string;
  url?: string;
}

export function MarketplaceOrderLink({ orderId, url }: MarketplaceOrderLinkProps) {
  if (!url) {
    return <span className="font-mono">{orderId}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-blue-600 hover:underline"
    >
      {orderId}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

interface UkssOrderLinkProps {
  ukssOrderId?: string | null;
}

export function UkssOrderLink({ ukssOrderId }: UkssOrderLinkProps) {
  if (!ukssOrderId) {
    return <span className="text-muted-foreground">Not converted</span>;
  }

  return (
    <Link
      to={`/orders/${ukssOrderId}`}
      className="font-mono text-blue-600 hover:underline"
    >
      {ukssOrderId}
    </Link>
  );
}
