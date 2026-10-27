// apps/web/src/pages/reports/ebay-reconciliation/ReconActionDialog.tsx
/**
 * Two-step action dialog (spec §8): step 1 shows the DRY-RUN plan returned by
 * the API; the live run is a second explicit confirmation. Never fires a live
 * mutation without a previewed dry-run in the same dialog session.
 */
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEbayReconAction } from '../hooks/useEbayReconciliation';
import type { EbayReconActionName, EbayReconActionResponse } from '@admin/shared';

const ACTION_LABELS: Record<EbayReconActionName, string> = {
  reactivate: 'Reactivate false-deletes (verifies each ItemID is live on eBay first)',
  relist: 'Relist ghosts with stock (GetItem-verified; live listings are reactivated, never duplicated)',
  mark_gone: 'Mark gone in DB only (sync stops considering these rows; eBay is never called)',
  verify_oversell: 'Re-check buyer-facing availability via the Browse API (read-only)',
};

interface Props {
  action: EbayReconActionName | null;
  itemIds: string[];
  runId?: number;
  onClose: () => void;
}

export function ReconActionDialog({ action, itemIds, runId, onClose }: Props) {
  const mutation = useEbayReconAction();
  const [preview, setPreview] = useState<EbayReconActionResponse | null>(null);
  const [liveResult, setLiveResult] = useState<EbayReconActionResponse | null>(null);

  // Fetch the dry-run preview whenever the dialog opens for an action.
  useEffect(() => {
    setPreview(null);
    setLiveResult(null);
    if (action && itemIds.length > 0) {
      mutation.mutate({ action, itemIds, dryRun: true, runId }, { onSuccess: setPreview });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, itemIds.join(',')]);

  if (!action) return null;
  const isReadOnly = action === 'verify_oversell';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirm: {action.replace('_', ' ')}</DialogTitle>
          <DialogDescription>{ACTION_LABELS[action]} — {itemIds.length} ItemID(s) selected.</DialogDescription>
        </DialogHeader>

        {mutation.isPending && !preview && <p className="text-sm text-muted-foreground">Running dry-run preview…</p>}
        {mutation.isError && <p className="text-sm text-destructive">Failed: {(mutation.error as Error).message}</p>}

        {(liveResult ?? preview) && (
          <div className="max-h-64 overflow-y-auto rounded border p-2 text-sm font-mono">
            <p className="mb-2 font-sans font-medium">
              {liveResult ? 'Live result' : 'Dry-run plan'} — {(liveResult ?? preview)!.outcomes.length} outcome(s)
            </p>
            {(liveResult ?? preview)!.outcomes.map((o, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <Badge variant="outline">{o.action}</Badge>
                <span>{o.itemId}</span>
                {o.newItemId && <span className="text-muted-foreground">→ {o.newItemId}</span>}
                {o.rows !== undefined && <span className="text-muted-foreground">({o.rows} rows)</span>}
                {o.detail && <span className="text-muted-foreground truncate">{o.detail}</span>}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!liveResult && preview && !isReadOnly && (
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ action, itemIds, dryRun: false, runId }, { onSuccess: setLiveResult })
              }
            >
              Apply live to eBay/DB
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
